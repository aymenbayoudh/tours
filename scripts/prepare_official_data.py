#!/usr/bin/env python3
"""Reduce official IGN, SNCF and Fil Bleu exports to the SERM de Touraine area.

The full source exports are downloaded separately; see README.md. This script
keeps a small, reviewable snapshot so the site can be rebuilt offline.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import math
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "tours"

# The fourteen 2026 EPCI identified by the supplied SERM reference KML.
EPCI_SIRENS = {
    "200030385", "200043065", "200043081", "200071587", "200071876",
    "200072072", "200072650", "200072668", "200072981", "200073161",
    "200073237", "243700499", "243700754", "243700820",
}
BBOX = (-0.5, 46.6, 1.7, 48.1)


def read_features(path: Path) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))["features"]


def write_json(name: str, value: object) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / name).write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def in_ring(point: list[float], ring: list[list[float]]) -> bool:
    x, y = point
    inside = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def in_geometry(point: list[float], geometry: dict) -> bool:
    polygons = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
    return any(in_ring(point, polygon[0]) and not any(in_ring(point, hole) for hole in polygon[1:]) for polygon in polygons)


def in_bbox(point: list[float]) -> bool:
    return BBOX[0] <= point[0] <= BBOX[2] and BBOX[1] <= point[1] <= BBOX[3]


def read_kml(path: Path) -> tuple[list[list[float]], list[list[list[float]]]]:
    root = ET.parse(path).getroot()
    ns = {"k": "http://www.opengis.net/kml/2.2"}
    stops, routes = [], []
    for placemark in root.findall(".//k:Placemark", ns):
        point = placemark.find(".//k:Point/k:coordinates", ns)
        if point is not None and point.text:
            stops.append([float(v) for v in point.text.strip().split(",")[:2]])
        for line in placemark.findall(".//k:LineString/k:coordinates", ns):
            if line.text:
                routes.append([[float(v) for v in token.split(",")[:2]] for token in line.text.split()])
    return stops, routes


def near(point: list[float], other: list[float], metres: float) -> bool:
    return math.hypot((point[0] - other[0]) * 75_000, (point[1] - other[1]) * 111_320) <= metres


def gtfs_rows(archive: zipfile.ZipFile, name: str):
    yield from csv.DictReader(io.TextIOWrapper(archive.open(name), encoding="utf-8-sig"))


def extract_tram(path: Path) -> dict:
    with zipfile.ZipFile(path) as archive:
        route = next(row for row in gtfs_rows(archive, "routes.txt") if row["route_short_name"].upper() == "A" and row["route_type"] == "0")
        counts = Counter(row["shape_id"] for row in gtfs_rows(archive, "trips.txt") if row["route_id"] == route["route_id"])
        chosen = {shape for shape, _ in counts.most_common(4)}
        trip_by_shape = {}
        for row in gtfs_rows(archive, "trips.txt"):
            if row["route_id"] == route["route_id"] and row["shape_id"] in chosen:
                trip_by_shape.setdefault(row["shape_id"], row["trip_id"])
        stop_ids = {row["stop_id"] for row in gtfs_rows(archive, "stop_times.txt") if row["trip_id"] in trip_by_shape.values()}
        stops = {row["stop_id"]: row for row in gtfs_rows(archive, "stops.txt") if row["stop_id"] in stop_ids or row["location_type"] == "1"}
        by_trip = defaultdict(list)
        for row in gtfs_rows(archive, "stop_times.txt"):
            if row["trip_id"] in trip_by_shape.values():
                by_trip[row["trip_id"]].append((int(row["stop_sequence"]), row["stop_id"]))
        shapes = defaultdict(list)
        for row in gtfs_rows(archive, "shapes.txt"):
            if row["shape_id"] in chosen:
                shapes[row["shape_id"]].append((int(row["shape_pt_sequence"]), [float(row["shape_pt_lon"]), float(row["shape_pt_lat"])]))
        result_shapes = []
        for shape_id, trip_id in trip_by_shape.items():
            ordered_ids = [stop_id for _, stop_id in sorted(by_trip[trip_id])]
            parents = []
            for stop_id in ordered_ids:
                child = stops[stop_id]
                parent_id = child["parent_station"] or stop_id
                if parents and parents[-1] == parent_id:
                    continue
                parents.append(parent_id)
            result_shapes.append({"id": shape_id, "points": [p for _, p in sorted(shapes[shape_id])], "stops": parents})
        used_parents = {s for shape in result_shapes for s in shape["stops"]}
        result_stops = {}
        for parent_id in used_parents:
            row = stops.get(parent_id)
            if not row:
                continue
            result_stops[parent_id] = {"name": row["stop_name"], "point": [float(row["stop_lon"]), float(row["stop_lat"])]}
        return {"route": {"id": "TRAM A", "name": route["route_long_name"], "color": "#" + route["route_color"]}, "stops": result_stops, "shapes": result_shapes}


def main() -> None:
    parser = argparse.ArgumentParser()
    for key in ("ign_epci", "ign_communes", "sncf_gares", "sncf_lignes", "gtfs", "remi_kml"):
        parser.add_argument("--" + key.replace("_", "-"), type=Path, required=True)
    args = parser.parse_args()
    epci = [f for f in read_features(args.ign_epci) if f["properties"]["code_siren"] in EPCI_SIRENS]
    if len(epci) != len(EPCI_SIRENS):
        raise ValueError(f"Expected 14 EPCI, got {len(epci)}")
    communes = [f for f in read_features(args.ign_communes) if any(s in EPCI_SIRENS for s in f["properties"].get("codes_siren_des_epci", "").split("/"))]
    for feature in epci:
        feature["properties"] = {"code": feature["properties"]["code_siren"], "name": feature["properties"]["nom_officiel"]}
    for feature in communes:
        p = feature["properties"]
        feature["properties"] = {"code": p["code_insee"], "name": p["nom_officiel"], "epci": p["codes_siren_des_epci"]}
    write_json("admin_2026.geojson", {"type": "FeatureCollection", "features": [{**f, "properties": {**f["properties"], "level": "epci"}} for f in epci] + [{**f, "properties": {**f["properties"], "level": "commune"}} for f in communes]})

    reference_stops, reference_routes = read_kml(args.remi_kml)
    # SNCF publishes a station once per attached RFN line. Keep one point per UIC.
    all_gares = [f for f in read_features(args.sncf_gares) if f["properties"].get("voyageurs") == "O"]
    referenced_uics = set()
    for point in reference_stops:
        closest = min(all_gares, key=lambda f: math.hypot((f["geometry"]["coordinates"][0] - point[0]) * 75_000, (f["geometry"]["coordinates"][1] - point[1]) * 111_320))
        if near(point, closest["geometry"]["coordinates"], 2000):
            referenced_uics.add(closest["properties"]["code_uic"])
    stations = {}
    for feature in all_gares:
        p = feature["properties"]
        if p["code_uic"] not in referenced_uics and not any(in_geometry(feature["geometry"]["coordinates"], e["geometry"]) for e in epci):
            continue
        uic = p["code_uic"]
        if uic not in stations:
            stations[uic] = {"uic": uic, "name": p["libelle"], "point": feature["geometry"]["coordinates"], "lineCodes": []}
        if p["code_ligne"] not in stations[uic]["lineCodes"]:
            stations[uic]["lineCodes"].append(p["code_ligne"])
    write_json("sncf_stations.json", sorted(stations.values(), key=lambda s: s["name"]))
    line_codes = {code for station in stations.values() for code in station["lineCodes"]}
    # Keep official RFN geometry near the supplied direct-service corridors.
    # The KML is a selection guide; line geometry in the output comes from SNCF.
    route_cells = {(round(point[0] / 0.05), round(point[1] / 0.05)) for route in reference_routes for point in route[::10]}
    fine_cells = {(round(point[0] / 0.01), round(point[1] / 0.01)) for route in reference_routes for point in route}
    def near_route(points: list[list[float]]) -> bool:
        for point in points[::max(1, len(points) // 30)] + points[-1:]:
            cx, cy = round(point[0] / 0.05), round(point[1] / 0.05)
            if any((cx + dx, cy + dy) in route_cells for dx in (-1, 0, 1) for dy in (-1, 0, 1)):
                return True
        return False
    def on_corridor(point: list[float]) -> bool:
        cx, cy = round(point[0] / 0.01), round(point[1] / 0.01)
        return any((cx + dx, cy + dy) in fine_cells for dx in (-2, -1, 0, 1, 2) for dy in (-2, -1, 0, 1, 2))
    rail = []
    for feature in read_features(args.sncf_lignes):
        p = feature["properties"]
        if p.get("mnemo") != "EXPLOITE" or p.get("code_ligne") not in line_codes:
            continue
        geometry = feature["geometry"]
        parts = geometry["coordinates"] if geometry["type"] == "MultiLineString" else [geometry["coordinates"]]
        for part in parts:
            if not near_route(part):
                continue
            run = []
            for point in part:
                if on_corridor(point):
                    run.append(point)
                elif run:
                    if len(run) >= 2:
                        rail.append({"code": p["code_ligne"], "geometry": {"type": "LineString", "coordinates": run}})
                    run = []
            if len(run) >= 2:
                rail.append({"code": p["code_ligne"], "geometry": {"type": "LineString", "coordinates": run}})
    write_json("sncf_lines.json", rail)
    tram = extract_tram(args.gtfs)
    write_json("filbleu_tram.json", tram)
    print(f"Prepared {len(epci)} EPCI, {len(communes)} communes, {len(stations)} passenger stations, {len(rail)} RFN segments, {len(tram['stops'])} tram stops")


if __name__ == "__main__":
    main()
