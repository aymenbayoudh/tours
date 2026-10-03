#!/usr/bin/env python3
"""Reduce the official Fil Bleu GTFS to compact bus data for 5–11 October 2026.

The browser never receives the raw GTFS. We keep commercial stop areas as the
routing nodes for this first bus layer, while preserving physical platforms in
the reduced file so road-based walking can refine access later.
"""
from __future__ import annotations

import argparse
import json
import math
import statistics
import zipfile
from collections import defaultdict
from pathlib import Path

from prepare_timetables import active_services, representative, rows, seconds

ROOT = Path(__file__).resolve().parents[1]
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
        active = active_services(z)
        route_rows = {
            r["route_id"]: r for r in rows(z, "routes.txt")
            if r.get("route_type") == "3"
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
            })

        groups = defaultdict(list)
        route_departures = defaultdict(lambda: defaultdict(list))
        used_parents = defaultdict(set)
        selected_shape_ids = set()

        for trip_id, times in stop_times.items():
            trip = trip_rows[trip_id]
            route = route_rows[trip["route_id"]]
            short = (route.get("route_short_name") or route["route_id"]).strip()
            route_id = f"BUS {short}"
            times.sort(key=lambda x: x["sequence"])

            # Collapse consecutive physical platforms belonging to the same
            # commercial stop area, but retain the physical IDs separately.
            collapsed = []
            for item in times:
                used_parents[item["parent"]].add(item["physical"])
                if collapsed and collapsed[-1]["parent"] == item["parent"]:
                    collapsed[-1]["departure"] = item["departure"]
                    collapsed[-1]["pickup"] = collapsed[-1]["pickup"] or item["pickup"]
                    collapsed[-1]["dropoff"] = collapsed[-1]["dropoff"] or item["dropoff"]
                else:
                    collapsed.append(dict(item))
            if len(collapsed) < 2:
                continue
            arrivals = [x["arrival"] / 60 for x in collapsed]
            departures = [x["departure"] / 60 for x in collapsed]
            if any(departure < arrival for arrival, departure in zip(arrivals, departures)) or any(arrivals[i + 1] < departures[i] for i in range(len(arrivals) - 1)):
                continue
            sequence = tuple("FILBLEU:" + x["parent"] for x in collapsed)
            permissions = tuple((x["pickup"], x["dropoff"]) for x in collapsed)
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
            })
            route_departures[route_id][direction].append(departures[0])

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
                gaps = [b - a for a, b in zip(dep, dep[1:]) if 3 <= b - a <= 180]
                if gaps:
                    headways.append(statistics.median(gaps))
            wait = min(30.0, max(2.0, statistics.median(headways) / 2 if headways else 30.0))
            reduced_routes[runtime] = {
                "title": f"Bus {short} — {(route.get('route_long_name') or '').strip()}".rstrip(" —"),
                "shortName": short,
                "color": "#" + ((route.get("route_color") or "3B6F8F").lstrip("#")),
                "textColor": "#" + ((route.get("route_text_color") or "FFFFFF").lstrip("#")),
                "waitMinutes": round(wait, 2),
                "gtfsRouteId": gtfs_id,
            }

        # Keep commercial areas as runtime nodes, with all physical platforms
        # retained for the later road-walking graph.
        reduced_stops = {}
        for parent_id, physical_ids in used_parents.items():
            parent = all_stops.get(parent_id)
            children = [all_stops[sid] for sid in physical_ids if sid in all_stops]
            point_source = parent if parent and parent.get("stop_lat") and parent.get("stop_lon") else (children[0] if children else None)
            if not point_source:
                continue
            reduced_stops[parent_id] = {
                "name": (parent or point_source).get("stop_name") or point_source.get("stop_name") or parent_id,
                "point": [float(point_source["stop_lon"]), float(point_source["stop_lat"])],
                "platforms": [
                    {
                        "id": child["stop_id"],
                        "point": [float(child["stop_lon"]), float(child["stop_lat"])],
                        "name": child.get("stop_name") or "",
                    }
                    for child in children if child.get("stop_lat") and child.get("stop_lon")
                ],
            }

        # One simplified display geometry per representative pattern shape.
        route_by_shape = {}
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
        },
        "stops": reduced_stops,
        "routes": reduced_routes,
        "patterns": patterns,
        "shapes": shapes,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {OUTPUT}: {len(reduced_routes)} bus routes, {len(reduced_stops)} commercial stops, {len(patterns)} representative patterns, {len(shapes)} shapes")


if __name__ == "__main__":
    main()
