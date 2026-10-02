#!/usr/bin/env python3
"""Build the Tours travel-time cartogram from the committed official snapshots.

IGN 2026 defines the territory, SNCF Réseau provides rail geometry and station
positions, Fil Bleu GTFS provides tram A, and the supplied Rémi KML identifies
the direct-service corridors. Travel times are deliberately approximate.
"""

from __future__ import annotations

import json
import math
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data" / "tours"
REMI_KML = ROOT / "archive" / "kml-reference" / "Tours_REMI_trains_directs_septembre_2026.kml"
OUTPUT = ROOT / "site" / "data" / "commute_map_data.json"
LAT0 = 47.4
COS_LAT = math.cos(math.radians(LAT0))
GRID_COLS = GRID_ROWS = 128
WALK_METRES_PER_MINUTE = 80.0
TER_METRES_PER_MINUTE = 1050.0
TRAM_METRES_PER_MINUTE = 420.0
COLOURS = ["#386b8d", "#467c73", "#76649a", "#9a6848", "#587396", "#7b7752", "#735f88", "#527a89", "#9a705c", "#5b7980", "#795f70", "#637c55", "#8a6e78", "#557299"]


def xy(lon: float, lat: float) -> tuple[float, float]:
    return lon * 111_320 * COS_LAT, lat * 111_320


def rounded(point) -> list[float]:
    return [round(point[0], 1), round(point[1], 1)]


def read_json(name: str):
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def polyline_length(points) -> float:
    return sum(math.dist(a, b) for a, b in zip(points, points[1:]))


def simplify(points, gap: float, closed: bool = False):
    if not points:
        return []
    source = points[:-1] if closed and points[0] == points[-1] else points
    if len(source) < 3:
        return list(points)
    out = [source[0]]
    for point in source[1:-1]:
        if math.dist(point, out[-1]) >= gap:
            out.append(point)
    out.append(source[-1])
    if closed and out[0] != out[-1]:
        out.append(out[0])
    return out


def polygons(geometry: dict, gap: float = 80.0):
    source = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
    return [[simplify([xy(*p[:2]) for p in ring], gap, closed=True) for ring in polygon] for polygon in source]


def point_in_ring(point, ring) -> bool:
    x, y = point
    inside = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def point_in_polygons(point, features) -> bool:
    return any(point_in_ring(point, polygon[0]) and not any(point_in_ring(point, hole) for hole in polygon[1:]) for feature in features for polygon in feature["raw"])


def bounds_for(features, pad: float = 1500.0):
    points = [p for feature in features for polygon in feature["raw"] for ring in polygon for p in ring]
    return [min(p[0] for p in points) - pad, min(p[1] for p in points) - pad, max(p[0] for p in points) + pad, max(p[1] for p in points) + pad]


def segment_distance(point, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    size = dx * dx + dy * dy
    t = max(0.0, min(1.0, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / size)) if size else 0.0
    return math.dist(point, (a[0] + t * dx, a[1] + t * dy)), t


def station_on_path(point, path):
    best = (float("inf"), 0.0)
    progress = 0.0
    for a, b in zip(path, path[1:]):
        length = math.dist(a, b)
        if abs(point[0] - a[0]) > 3000 and abs(point[0] - b[0]) > 3000:
            progress += length
            continue
        if abs(point[1] - a[1]) > 3000 and abs(point[1] - b[1]) > 3000:
            progress += length
            continue
        dist, fraction = segment_distance(point, a, b)
        if dist < best[0]:
            best = (dist, progress + fraction * length)
        progress += length
    return best


def read_remi_routes():
    root = ET.parse(REMI_KML).getroot()
    ns = {"k": "http://www.opengis.net/kml/2.2"}
    routes = []
    for placemark in root.findall(".//k:Placemark", ns):
        lines = placemark.findall(".//k:LineString/k:coordinates", ns)
        if not lines:
            continue
        title = placemark.findtext("k:name", default="TER", namespaces=ns)
        route_id = "TER " + title.split(" - ", 1)[0]
        paths = []
        for line in lines:
            if line.text:
                points = [xy(*[float(n) for n in token.split(",")[:2]]) for token in line.text.split()]
                paths.append(simplify(points, 170))
        routes.append({"id": route_id, "title": title, "paths": paths})
    return routes


def build_administration():
    features = read_json("admin_2026.geojson")["features"]
    epci, communes = [], []
    for feature in features:
        item = {"name": feature["properties"]["name"], "code": feature["properties"]["code"], "raw": polygons(feature["geometry"], gap=0)}
        if feature["properties"]["level"] == "epci":
            epci.append(item)
        else:
            communes.append(item)
    bounds = bounds_for(epci)
    boroughs = []
    for item in epci:
        clean = [[simplify(ring, 120, closed=True) for ring in polygon] for polygon in item["raw"]]
        largest = max((polygon[0] for polygon in clean), key=lambda ring: abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:]))))
        boroughs.append({"name": item["name"], "code": item["code"], "polygons": [[[rounded(p) for p in ring] for ring in polygon] for polygon in clean], "outline": [[rounded(p) for p in polygon[0]] for polygon in clean], "label": rounded((sum(p[0] for p in largest) / len(largest), sum(p[1] for p in largest) / len(largest)))})
    commune_outlines = [[rounded(p) for p in simplify(polygon[0], 95, closed=True)] for item in communes for polygon in item["raw"]]
    return epci, bounds, boroughs, commune_outlines


def build_stations_and_routes():
    stations = []
    for item in read_json("sncf_stations.json"):
        stations.append({"id": "SNCF:" + item["uic"], "name": item["name"], "point": xy(*item["point"]), "mode": "TER", "routes": set()})
    tram = read_json("filbleu_tram.json")
    tram_index = {}
    for stop_id, item in tram["stops"].items():
        tram_index[stop_id] = len(stations)
        stations.append({"id": "FILBLEU:" + stop_id, "name": item["name"], "point": xy(*item["point"]), "mode": "TRAM", "routes": {"TRAM A"}})
    route_waits = {"TRAM A": 4.0}
    edges = {}
    routes = []
    for i, item in enumerate(read_remi_routes()):
        route_id = item["id"]
        route_waits[route_id] = 15.0
        colour = COLOURS[i % len(COLOURS)]
        for path in item["paths"]:
            matches = []
            for index, station in enumerate(stations):
                if station["mode"] != "TER":
                    continue
                distance, progress = station_on_path(station["point"], path)
                if distance <= 450:
                    matches.append((progress, index))
                    station["routes"].add(route_id)
            matches.sort()
            for (pa, a), (pb, b) in zip(matches, matches[1:]):
                if a == b or pb - pa > 65_000:
                    continue
                key = (min(a, b), max(a, b), route_id)
                minutes = max(1.2, (pb - pa) / TER_METRES_PER_MINUTE + 0.8)
                edges[key] = min(edges.get(key, float("inf")), minutes)
        # The corridor names come from the supplied KML. The visible rail lines
        # themselves are taken from SNCF Réseau below.
    for feature in read_json("sncf_lines.json"):
        geometry = feature["geometry"]
        parts = geometry["coordinates"] if geometry["type"] == "MultiLineString" else [geometry["coordinates"]]
        for part in parts:
            points = simplify([xy(*p[:2]) for p in part], 170)
            if len(points) >= 2:
                routes.append({"id": "RFN " + feature["code"], "color": "#526f84", "mode": "TER", "points": [rounded(p) for p in points]})
    for shape in tram["shapes"]:
        points = simplify([xy(*p) for p in shape["points"]], 35)
        routes.append({"id": "TRAM A", "color": tram["route"]["color"], "mode": "TRAM", "points": [rounded(p) for p in points]})
        for sa, sb in zip(shape["stops"], shape["stops"][1:]):
            if sa not in tram_index or sb not in tram_index:
                continue
            a, b = tram_index[sa], tram_index[sb]
            if a == b:
                continue
            key = (min(a, b), max(a, b), "TRAM A")
            minutes = max(0.65, math.dist(stations[a]["point"], stations[b]["point"]) / TRAM_METRES_PER_MINUTE + 0.25)
            edges[key] = min(edges.get(key, float("inf")), minutes)
    return stations, routes, edges, route_waits


def build_graph(stations, edges, route_waits):
    route_states, station_states = [], [[] for _ in stations]
    lookup = {}
    for i, station in enumerate(stations):
        for route_id in sorted(station["routes"]):
            lookup[(i, route_id)] = len(route_states)
            station_states[i].append(len(route_states))
            route_states.append({"stationIndex": i, "routeId": route_id})
    adjacency = [[] for _ in route_states]
    def add(a, b, minutes):
        adjacency[a].append([b, round(minutes, 3)])
    for (a, b, route_id), minutes in edges.items():
        if (a, route_id) in lookup and (b, route_id) in lookup:
            add(lookup[(a, route_id)], lookup[(b, route_id)], minutes)
            add(lookup[(b, route_id)], lookup[(a, route_id)], minutes)
    for states in station_states:
        for src in states:
            for dst in states:
                if src != dst:
                    add(src, dst, 3.5 + route_waits[route_states[dst]["routeId"]])
    for i, a in enumerate(stations):
        for j in range(i + 1, len(stations)):
            distance = math.dist(a["point"], stations[j]["point"])
            if distance > 650:
                continue
            for src in station_states[i]:
                for dst in station_states[j]:
                    add(src, dst, distance / WALK_METRES_PER_MINUTE + 2 + route_waits[route_states[dst]["routeId"]])
                    add(dst, src, distance / WALK_METRES_PER_MINUTE + 2 + route_waits[route_states[src]["routeId"]])
    return route_states, station_states, adjacency


def build_grid(epci, stations, bounds):
    min_x, min_y, max_x, max_y = bounds
    width, height = (max_x - min_x) / GRID_COLS, (max_y - min_y) / GRID_ROWS
    cells = []
    mask = [-1] * (GRID_COLS * GRID_ROWS)
    for row in range(GRID_ROWS):
        for col in range(GRID_COLS):
            point = (min_x + (col + 0.5) * width, min_y + (row + 0.5) * height)
            if not point_in_polygons(point, epci):
                continue
            near = sorted(((i, math.dist(point, s["point"])) for i, s in enumerate(stations)), key=lambda item: item[1])[:4]
            mask[row * GRID_COLS + col] = len(cells)
            cells.append({"row": row, "col": col, "point": rounded(point), "access": [[i, round(d, 1)] for i, d in near]})
    return cells, mask


def main():
    epci, bounds, boroughs, communes = build_administration()
    stations, routes, edges, route_waits = build_stations_and_routes()
    route_states, station_states, adjacency = build_graph(stations, edges, route_waits)
    cells, mask = build_grid(epci, stations, bounds)
    visible_points = [p for route in routes for p in route["points"]] + [rounded(s["point"]) for s in stations]
    explore_bounds = [min(p[0] for p in visible_points) - 20_000, min(p[1] for p in visible_points) - 20_000, max(p[0] for p in visible_points) + 20_000, max(p[1] for p in visible_points) + 20_000]
    output = {
        "meta": {"lat0": LAT0, "bounds": [round(x, 1) for x in bounds], "exploreBounds": [round(x, 1) for x in explore_bounds], "gridCols": GRID_COLS, "gridRows": GRID_ROWS, "walkMetersPerMinute": WALK_METRES_PER_MINUTE, "stationAccessPenalty": 1.8, "originStationCount": 5, "cellNearestStations": 4, "defaultBoardWait": 15.0},
        "boroughs": boroughs, "communes": communes, "parks": [], "routes": routes,
        "stations": [{"id": s["id"], "name": s["name"], "point": rounded(s["point"]), "routes": sorted(s["routes"]), "mode": s["mode"]} for s in stations],
        "routeStates": route_states, "stationStates": station_states, "routeWaits": route_waits, "adjacency": adjacency, "cells": cells, "mask": mask,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {OUTPUT}: {len(stations)} stations, {len(route_states)} route states, {len(routes)} line segments, {len(cells)} grid cells")


if __name__ == "__main__":
    main()
