#!/usr/bin/env python3
"""Reduce the official Fil Bleu GTFS to compact bus data for 5–11 October 2026.

The browser never receives the raw GTFS. Physical stop points remain distinct
routing nodes (not merged across opposite sides of a road); their commercial
stop area is retained as metadata for later road-based walking refinement.
"""
from __future__ import annotations

import argparse
import json
import math
import statistics
import zipfile
from collections import defaultdict
from pathlib import Path

from prepare_timetables import active_service_dates, representative, rows, seconds

ROOT = Path(__file__).resolve().parents[1]
EXCLUDED_SERVICE_LINES = {"66", "67", "69", "70", "72", "73", "N1", "N2"}
# Official Fil Bleu school/special and night categories, excluded from this map.
OUTPUT = ROOT / "data" / "tours" / "filbleu_bus.json"


def simplify(points: list[list[float]], metres: float = 35.0) -> list[list[float]]:
    if len(points) <= 2:
        return points
    out = [points[0]]
    for point in points[1:-1]:
        prev = out[-1]
        d = math.hypot((point[0] - prev[0]) * 75_000, (point[1] - prev[1]) * 111_320)
        if d >= metres:
            out.append(point)
    out.append(points[-1])
    return out


def valid_time(value: str) -> bool:
    return bool(value and value.count(":") == 2)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gtfs", type=Path, required=True)
    args = parser.parse_args()

    with zipfile.ZipFile(args.gtfs) as z:
        active = active_service_dates(z)
        route_rows = {
            r["route_id"]: r for r in rows(z, "routes.txt")
            if r.get("route_type") == "3"
            and (r.get("route_short_name") or r["route_id"]).strip() not in EXCLUDED_SERVICE_LINES
        }
        all_stops = {r["stop_id"]: r for r in rows(z, "stops.txt")}
        trip_rows = {
            r["trip_id"]: r for r in rows(z, "trips.txt")
            if r["route_id"] in route_rows and r["service_id"] in active
        }

        stop_times = defaultdict(list)
        for r in rows(z, "stop_times.txt"):
            trip = trip_rows.get(r["trip_id"])
            if not trip or not valid_time(r.get("arrival_time", "")) or not valid_time(r.get("departure_time", "")):
                continue
            stop = all_stops.get(r["stop_id"])
            if not stop:
                continue
            parent = stop.get("parent_station") or stop["stop_id"]
            stop_times[r["trip_id"]].append({
                "sequence": int(r["stop_sequence"]),
                "parent": parent,
                "physical": stop["stop_id"],
                "arrival": seconds(r["arrival_time"]),
                "departure": seconds(r["departure_time"]),
                "pickup": r.get("pickup_type", "0") not in {"1"},
                "dropoff": r.get("drop_off_type", "0") not in {"1"},
                "reservation": r.get("pickup_type", "0") in {"2", "3"}
                    or r.get("drop_off_type", "0") in {"2", "3"}
                    or bool(r.get("pickup_booking_rule_id") or r.get("drop_off_booking_rule_id")),
            })

        groups = defaultdict(list)
        route_departures = defaultdict(lambda: defaultdict(list))
        used_stops = set()
        selected_shape_ids = set()
        display_shapes = {}
        display_stop_routes = defaultdict(set)
        excluded_trips = defaultdict(int)

        for trip_id, times in stop_times.items():
            trip = trip_rows[trip_id]
            route = route_rows[trip["route_id"]]
            short = (route.get("route_short_name") or route["route_id"]).strip()
            route_id = f"BUS {short}"
            times.sort(key=lambda x: x["sequence"])

            if len(times) < 2:
                continue
            for item in times:
                used_stops.add(item["physical"])
                display_stop_routes[item["physical"]].add(route_id)
            shape_id = trip.get("shape_id") or ""
            if shape_id:
                selected_shape_ids.add(shape_id)
                display_shapes.setdefault(shape_id, route_id)
            # Reservation zones are not an ordered fixed itinerary. Identical
            # timestamps must never become instantaneous cross-zone journeys.
            # Keep their geometry as reference, but exclude conditional trips
            # until a reservation-aware model is available.
            if any(item["reservation"] for item in times):
                excluded_trips[route_id] += 1
                continue
            first_departure = times[0]["departure"] / 60
            arrivals = [x["arrival"] / 60 - first_departure for x in times]
            departures = [x["departure"] / 60 - first_departure for x in times]
            if any(departure < arrival for arrival, departure in zip(arrivals, departures)) or any(arrivals[i + 1] < departures[i] for i in range(len(arrivals) - 1)):
                continue
            sequence = tuple("FILBLEU:" + x["physical"] for x in times)
            permissions = tuple((x["pickup"], x["dropoff"]) for x in times)
            direction = trip.get("direction_id") or "0"
            shape_id = trip.get("shape_id") or ""
            label = f"Bus {short}" + (f" → {trip.get('trip_headsign','').strip()}" if trip.get("trip_headsign", "").strip() else "")
            groups[(route_id, sequence, permissions)].append({
                "train": label,
                "tripId": trip_id,
                "arrivals": arrivals,
                "departures": departures,
                "shapeId": shape_id,
                "directionId": direction,
                "requiresReservation": False,
            })
            # Do not merge departures from different days or different origins
            # of a branched line into one fictitious frequency.
            for date in active[trip["service_id"]]:
                route_departures[route_id][(date, direction, times[0]["parent"])].append(first_departure)

        patterns = representative(groups)
        for p in patterns:
            if p.get("shapeId"):
                selected_shape_ids.add(p["shapeId"])

        shape_points = defaultdict(list)
        if selected_shape_ids and "shapes.txt" in z.namelist():
            for r in rows(z, "shapes.txt"):
                if r["shape_id"] not in selected_shape_ids:
                    continue
                shape_points[r["shape_id"]].append((
                    int(r["shape_pt_sequence"]),
                    [float(r["shape_pt_lon"]), float(r["shape_pt_lat"])]
                ))

        # Route metadata and a data-derived waiting hypothesis: half the median
        # same-direction headway, bounded to 2–30 min. Sparse one-trip routes use 30 min.
        reduced_routes = {}
        gtfs_to_runtime = {}
        for gtfs_id, route in route_rows.items():
            short = (route.get("route_short_name") or gtfs_id).strip()
            runtime = f"BUS {short}"
            gtfs_to_runtime[gtfs_id] = runtime
            headways = []
            for departures in route_departures[runtime].values():
                dep = sorted(set(departures))
                gaps = [b - a for a, b in zip(dep, dep[1:]) if b > a]
                # Rare school/partial services must not outweigh a frequent
                # full-length service. Pool observed gaps, not bucket medians.
                # A pair of near-simultaneous school departures does not imply
                # a frequent all-day line: sparse buckets retain the fallback.
                if len(dep) >= 4:
                    headways.extend(gaps)
                elif dep:
                    headways.append(60.0)
            wait = min(30.0, max(2.0, statistics.median(headways) / 2 if headways else 30.0))
            reduced_routes[runtime] = {
                "title": f"Bus {short} — {(route.get('route_long_name') or '').strip()}".rstrip(" —"),
                "shortName": short,
                "color": "#" + ((route.get("route_color") or "3B6F8F").lstrip("#")),
                "textColor": "#" + ((route.get("route_text_color") or "FFFFFF").lstrip("#")),
                "waitMinutes": round(wait, 2),
                "gtfsRouteId": gtfs_id,
                "excludedReservationTrips": excluded_trips[runtime],
                "calculationAvailable": any(p["routeId"] == runtime for p in patterns),
                "excludedReason": "Service sur réservation non modélisé" if not any(p["routeId"] == runtime for p in patterns) and excluded_trips[runtime] else None,
                "waitMethod": "half-median-headway-per-day-direction-origin-bounded-2-30",
            }

        # Keep every physical boarding point separate. Parent stop areas are
        # metadata only, so opposite platforms are never silently merged.
        reduced_stops = {}
        for stop_id in sorted(used_stops):
            stop = all_stops.get(stop_id)
            if not stop or not stop.get("stop_lat") or not stop.get("stop_lon"):
                continue
            parent_id = stop.get("parent_station") or ""
            parent = all_stops.get(parent_id) if parent_id else None
            reduced_stops[stop_id] = {
                "name": stop.get("stop_name") or (parent or {}).get("stop_name") or stop_id,
                "point": [float(stop["stop_lon"]), float(stop["stop_lat"])],
                "parent": parent_id,
                "areaName": (parent or {}).get("stop_name") or "",
                "displayRoutes": sorted(display_stop_routes[stop_id]),
            }

        # One simplified display geometry per representative pattern shape.
        route_by_shape = dict(display_shapes)
        for p in patterns:
            sid = p.get("shapeId")
            if sid and sid not in route_by_shape:
                route_by_shape[sid] = p["routeId"]
        shapes = []
        for sid, route_id in route_by_shape.items():
            pts = [p for _, p in sorted(shape_points.get(sid, []))]
            if len(pts) >= 2:
                shapes.append({"routeId": route_id, "shapeId": sid, "points": simplify(pts)})

    output = {
        "source": {
            "name": "Réseau urbain et périurbain Fil Bleu — GTFS",
            "publisher": "Tours Métropole Val de Loire / Syndicat des Mobilités de Touraine",
            "license": "Licence Ouverte 2.0",
            "url": "https://data.tours-metropole.fr/api/v2/catalog/datasets/horaires-temps-reel-gtfsrt-reseau-filbleu-tmvl/alternative_exports/filbleu_gtfszip",
            "referenceWeek": ["2026-10-05", "2026-10-11"],
            "excludedServiceLines": sorted(EXCLUDED_SERVICE_LINES),
            "reservationPolicy": "conditional trips excluded from calculations; shapes retained",
        },
        "stops": reduced_stops,
        "routes": reduced_routes,
        "patterns": patterns,
        "shapes": shapes,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {OUTPUT}: {len(reduced_routes)} bus routes, {len(reduced_stops)} physical stops, {len(patterns)} representative patterns, {len(shapes)} shapes")


if __name__ == "__main__":
    main()
