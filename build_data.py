#!/usr/bin/env python3
"""Build the Tours travel-time cartogram from the committed official snapshots.

IGN 2026 defines the territory, SNCF Réseau provides rail geometry and station
positions, Fil Bleu GTFS provides tram A, and the supplied Rémi KML identifies
the direct-service corridors. Travel times are deliberately approximate.
"""

from __future__ import annotations

import json
import math
import re
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data" / "tours"
NETWORK_KML = ROOT / "archive" / "kml-reference" / "Tours - Secteur 2 (export Google My Maps).kml"
OUTPUT = ROOT / "site" / "data" / "commute_map_data.json"
LAT0 = 47.4
COS_LAT = math.cos(math.radians(LAT0))
GRID_COLS = GRID_ROWS = 256
WALK_METRES_PER_MINUTE = 80.0
TRAM_METRES_PER_MINUTE = 420.0
PROJECT_SPEED_KMH = {"TRAM B": 18.4, "BHNS C": 18.0}
# Representative direct TER timetables from SNCF Connect, listed in README.md.
# Adjacent routes on the same corridor share a calibrated commercial speed.
TER_SPEED_KMH = {
    "K1": 82, "K16": 82, "K39": 78, "K6+": 95,
    "P1": 90, "P6": 82, "P7": 78, "P11": 70,
    "P17": 78, "P21": 50, "P30": 78, "P31": 52,
    "P33": 55, "P65": 90, "P166": 82,
}
# The reference week is 5–11 October 2026. Tours–Chinon is fully closed to
# trains from 14 September 2026 to 26 February 2027 for regeneration works;
# replacement coaches must be represented as bus service, never recreated by
# the geometric rail fallback.
SUSPENDED_RAIL_ROUTES = {
    "TER P21": {
        "status": "suspended",
        "from": "2026-09-14",
        "to": "2027-02-26",
        "reason": "Travaux Tours–Chinon ; substitution par autocars",
    }
}
COLOURS = ["#c13f34", "#2275a5", "#7a49a5", "#13816f", "#a96616", "#c34485", "#4759ba", "#698400", "#a14f31", "#007f96", "#935a9d", "#367245", "#bb6b00", "#5645a2", "#a93c5f", "#2d7f85", "#8b6b22", "#6a6bb0"]


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


def label_point(polygon):
    """Find a point inside a commune for its name, including concave shapes."""
    outer = polygon[0]
    min_x, max_x = min(p[0] for p in outer), max(p[0] for p in outer)
    min_y, max_y = min(p[1] for p in outer), max(p[1] for p in outer)
    center = ((min_x + max_x) / 2, (min_y + max_y) / 2)
    if point_in_ring(center, outer) and not any(point_in_ring(center, hole) for hole in polygon[1:]):
        return center
    for divisions in (5, 11, 21):
        choices = [((min_x + (col + 0.5) * (max_x - min_x) / divisions), (min_y + (row + 0.5) * (max_y - min_y) / divisions)) for row in range(divisions) for col in range(divisions)]
        valid = [p for p in choices if point_in_ring(p, outer) and not any(point_in_ring(p, hole) for hole in polygon[1:])]
        if valid:
            return min(valid, key=lambda p: math.dist(p, center))
    return outer[0]


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


def project_on_paths(point, paths):
    candidates = []
    for path in paths:
        for a, b in zip(path, path[1:]):
            dist, fraction = segment_distance(point, a, b)
            candidates.append((dist, (a[0] + fraction * (b[0]-a[0]), a[1] + fraction * (b[1]-a[1]))))
    return min(candidates, key=lambda item: item[0])


def read_remi_routes():
    root = ET.parse(NETWORK_KML).getroot()
    ns = {"k": "http://www.opengis.net/kml/2.2"}
    routes = {}
    for placemark in root.findall(".//k:Placemark", ns):
        lines = placemark.findall(".//k:LineString/k:coordinates", ns)
        if not lines:
            continue
        title = placemark.findtext("k:name", default="TER", namespaces=ns)
        match = re.match(r"^([KP]\d+\+?) - ", title)
        if not match and not title.startswith("Navette Tours"):
            continue
        route_id = "TER " + match.group(1) if match else "NAVETTE"
        paths = []
        for line in lines:
            if line.text:
                points = [xy(*[float(n) for n in token.split(",")[:2]]) for token in line.text.split()]
                paths.append(simplify(points, 170))
        if route_id not in routes:
            routes[route_id] = {"id": route_id, "title": title.split(" — via ", 1)[0], "paths": []}
        routes[route_id]["paths"].extend(paths)
    return list(routes.values())


def read_project_routes():
    root = ET.parse(NETWORK_KML).getroot()
    ns = {"k": "http://www.opengis.net/kml/2.2"}
    projects = {"TRAM B": {"stops": []}, "BHNS C": {"stops": []}}
    for placemark in root.findall(".//k:Placemark", ns):
        title = placemark.findtext("k:name", default="", namespaces=ns)
        route_id = "TRAM B" if title.startswith("Tram B (2028)") else "BHNS C" if title.startswith("BHNS (2028)") else None
        if not route_id:
            continue
        line = placemark.find(".//k:LineString/k:coordinates", ns)
        point = placemark.find(".//k:Point/k:coordinates", ns)
        if line is not None and line.text:
            projects[route_id]["title"] = title
            projects[route_id]["path"] = simplify([xy(*[float(n) for n in token.split(",")[:2]]) for token in line.text.split()], 35)
        elif point is not None and point.text:
            lon, lat = [float(n) for n in point.text.strip().split(",")[:2]]
            projects[route_id]["stops"].append((title.split(" - ", 1)[-1], xy(lon, lat)))
    return projects


def read_kml_rail_stops():
    root = ET.parse(NETWORK_KML).getroot()
    ns = {"k": "http://www.opengis.net/kml/2.2"}
    stops = []
    for placemark in root.findall(".//k:Placemark", ns):
        point = placemark.find(".//k:Point/k:coordinates", ns)
        description = placemark.findtext("k:description", default="", namespaces=ns)
        if point is None or not point.text or not re.search(r"\b[KP]\d+\+?\s*-", description):
            continue
        title = placemark.findtext("k:name", default="", namespaces=ns)
        lon, lat = [float(n) for n in point.text.strip().split(",")[:2]]
        stops.append((title, xy(lon, lat)))
    return stops


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
    commune_features = []
    for item in communes:
        largest = max(item["raw"], key=lambda polygon: abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(polygon[0], polygon[0][1:]))))
        points = [p for polygon in item["raw"] for p in polygon[0]]
        commune_features.append({
            "name": item["name"], "code": item["code"],
            "bbox": rounded((min(p[0] for p in points), min(p[1] for p in points))) + rounded((max(p[0] for p in points), max(p[1] for p in points))),
            "label": rounded(label_point(largest)),
            "polygons": [[[rounded(p) for p in simplify(ring, 75, closed=True)] for ring in polygon] for polygon in item["raw"]],
        })
    return epci, bounds, boroughs, commune_features


def build_stations_and_routes():
    stations = []
    for item in read_json("sncf_stations.json"):
        stations.append({"id": "SNCF:" + item["uic"], "name": item["name"], "point": xy(*item["point"]), "mode": "TER", "routes": set(), "planned": False, "terminal": False})
    # Match the timetable catalogue before KML halts: RFN and GTFS sometimes
    # use different UICs for the same station (e.g. Trélazé).
    for item in read_json("timetables.json").get("stations", []):
        sid = "SNCF:" + item["uic"]
        if any(s["id"] == sid for s in stations): continue
        point = xy(*item["point"])
        match = next((s for s in stations if s["name"] == item["name"] and math.dist(s["point"], point) < 1500), None)
        if match:
            match["id"] = sid
        else:
            stations.append({"id": sid, "name": item["name"], "point": point, "mode": "TER", "routes": set(), "planned": False, "terminal": False})
    for name, point in read_kml_rail_stops():
        if any(math.dist(point, station["point"]) <= 300 for station in stations):
            continue
        stations.append({"id": "KML:" + name, "name": name, "point": point, "mode": "TER", "routes": set(), "planned": False, "terminal": False})
    tram = read_json("filbleu_tram.json")
    bus = read_json("filbleu_bus.json")
    tram_paths = [[xy(*p) for p in shape["points"]] for shape in tram["shapes"]]
    tram_index = {}
    for stop_id, item in tram["stops"].items():
        tram_index[stop_id] = len(stations)
        point = xy(*item["point"])
        offset, draw_point = project_on_paths(point, tram_paths)
        stations.append({"id": "FILBLEU:" + stop_id, "name": item["name"], "point": point, "drawPoint": draw_point, "displayOffset": offset, "mode": "TRAM", "routes": {"TRAM A"}, "planned": False})
    station_ids = {station["id"]: index for index, station in enumerate(stations)}
    for stop_id, item in bus.get("stops", {}).items():
        sid = "FILBLEU:" + stop_id
        if sid in station_ids:
            continue
        station_ids[sid] = len(stations)
        stations.append({"id": sid, "name": item["name"], "point": xy(*item["point"]), "mode": "BUS", "routes": set(), "planned": False, "parentStop": item.get("parent", "")})
    route_waits = {"TRAM A": 4.0, "TRAM B": 4.0, "BHNS C": 3.25}
    route_info = {"TRAM A": {"title": "Tramway A — Vaucanson ↔ Lycée Jean Monnet", "mode": "TRAM", "color": tram["route"]["color"], "planned": False}}
    for route_id, item in bus.get("routes", {}).items():
        route_waits[route_id] = float(item.get("waitMinutes", 10.0))
        route_info[route_id] = {
            "title": item.get("title", route_id),
            "mode": "BUS",
            "color": item.get("color", "#3b6f8f"),
            "planned": False,
            "waitMinutes": route_waits[route_id],
        }
    edges = {}
    routes = []
    for i, item in enumerate(read_remi_routes()):
        route_id = item["id"]
        code = route_id.removeprefix("TER ")
        route_waits[route_id] = 5.0 if route_id == "NAVETTE" else 15.0
        colour = COLOURS[i % len(COLOURS)]
        route_info[route_id] = {"title": item["title"], "mode": "NAVETTE" if route_id == "NAVETTE" else "TER", "color": colour, "planned": False}
        if route_id in SUSPENDED_RAIL_ROUTES:
            route_info[route_id]["serviceStatus"] = SUSPENDED_RAIL_ROUTES[route_id]
        for path in item["paths"]:
            routes.append({"id": route_id, "title": item["title"], "color": colour, "mode": "TER", "points": [rounded(p) for p in path]})
            matches = []
            for index, station in enumerate(stations):
                if station["mode"] != "TER":
                    continue
                distance, progress = station_on_path(station["point"], path)
                if distance <= 450:
                    matches.append((progress, index))
                    station["routes"].add(route_id)
            matches.sort()
            if matches:
                stations[matches[0][1]]["terminal"] = True
                stations[matches[-1][1]]["terminal"] = True
            for (pa, a), (pb, b) in zip(matches, matches[1:]):
                if a == b or pb - pa > 150_000:
                    continue
                key = (min(a, b), max(a, b), route_id)
                commercial_kmh = 60 if route_id == "NAVETTE" else TER_SPEED_KMH[code]
                minutes = max(1.0, (pb - pa) / (commercial_kmh * 1000 / 60))
                edges[key] = min(edges.get(key, float("inf")), minutes)
    rail_base = []
    for feature in read_json("sncf_lines.json"):
        geometry = feature["geometry"]
        parts = geometry["coordinates"] if geometry["type"] == "MultiLineString" else [geometry["coordinates"]]
        for part in parts:
            points = simplify([xy(*p[:2]) for p in part], 170)
            if len(points) >= 2:
                rail_base.append({"id": "RFN " + feature["code"], "color": "#9cabb7", "mode": "RFN", "points": [rounded(p) for p in points]})
    routes = rail_base + routes
    for shape in bus.get("shapes", []):
        info = route_info.get(shape["routeId"], {})
        points = [xy(*p) for p in shape["points"]]
        if len(points) >= 2:
            routes.append({"id": shape["routeId"], "title": info.get("title", shape["routeId"]), "color": info.get("color", "#3b6f8f"), "mode": "BUS", "points": [rounded(p) for p in simplify(points, 45)]})
    for shape in tram["shapes"]:
        points = [xy(*p) for p in shape["points"]]
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
    for route_id, project in read_project_routes().items():
        mode = "TRAM" if route_id == "TRAM B" else "BHNS"
        colour = "#1d91b6" if route_id == "TRAM B" else "#e18529"
        route_info[route_id] = {"title": project["title"], "mode": mode, "color": colour, "planned": True}
        path = project["path"]
        routes.append({"id": route_id, "title": project["title"], "color": colour, "mode": mode, "planned": True, "points": [rounded(p) for p in path]})
        matches = []
        for number, (name, point) in enumerate(project["stops"]):
            index = len(stations)
            stations.append({"id": f"PROJECT:{route_id}:{number}", "name": name, "point": point, "mode": mode, "routes": {route_id}, "planned": True})
            _, progress = station_on_path(point, path)
            matches.append((progress, index))
        matches.sort()
        speed = PROJECT_SPEED_KMH[route_id] * 1000 / 60
        for (pa, a), (pb, b) in zip(matches, matches[1:]):
            key = (min(a, b), max(a, b), route_id)
            edges[key] = max(0.5, (pb - pa) / speed)
    return stations, routes, edges, route_waits, route_info


def build_graph(stations, edges, route_waits):
    schedules = read_json("timetables.json")
    bus = read_json("filbleu_bus.json")
    patterns = schedules["patterns"] + bus.get("patterns", [])
    scheduled_routes = {p["routeId"] for p in patterns}
    by_id = {s["id"]: i for i, s in enumerate(stations)}
    route_states, adjacency = [], []
    station_states = [[] for _ in stations]
    boarding_states = [[] for _ in stations]
    for station in stations:
        station["routes"] = set()
    def node(station, route, role, pattern=None):
        index = len(route_states)
        route_states.append({"stationIndex": station, "routeId": route, "role": role, "pattern": pattern})
        adjacency.append([])
        if route is not None:
            stations[station]["routes"].add(route)
        return index
    def add(a, b, minutes):
        if minutes < 0:
            raise ValueError("Negative graph edge")
        adjacency[a].append([b, round(minutes, 4)])
    audit_patterns = []
    for number, pattern in enumerate(patterns):
        arrivals, departures = [], []
        for pos, sid in enumerate(pattern["stops"]):
            station = by_id[sid]
            arr = node(station, pattern["routeId"], "arrival", number)
            dep = node(station, pattern["routeId"], "departure", number)
            arrivals.append(arr); departures.append(dep)
            add(arr, dep, pattern["departures"][pos] - pattern["arrivals"][pos])
            if pattern["dropoff"][pos]: station_states[station].append(arr)
            if pattern["pickup"][pos]: boarding_states[station].append(dep)
        for pos in range(len(arrivals)-1):
            add(departures[pos], arrivals[pos+1], pattern["arrivals"][pos+1]-pattern["departures"][pos])
        audit_patterns.append({"routeId": pattern["routeId"], "train": pattern["train"], "tripId": pattern["tripId"], "stops": [by_id[s] for s in pattern["stops"]], "arrivalNodes": arrivals, "departureNodes": departures, "arrivals": pattern["arrivals"], "departures": pattern["departures"]})
    # Only routes without an observed schedule retain a geometric estimate.
    # A rail route known to be suspended during the reference week is never
    # synthesized: its replacement coaches belong to the bus layer.
    # KML-only rail halts have no boarding link unless present in a timetable.
    fallback_nodes = {}
    for (a, b, route), minutes in edges.items():
        if route in scheduled_routes or route in SUSPENDED_RAIL_ROUTES: continue
        for station in (a, b):
            if (station, route) not in fallback_nodes:
                arr = node(station, route, "arrival")
                dep = node(station, route, "departure")
                add(arr, dep, 0)
                station_states[station].append(arr); boarding_states[station].append(dep)
                fallback_nodes[(station, route)] = (arr, dep)
        aa, ad = fallback_nodes[(a, route)]; ba, bd = fallback_nodes[(b, route)]
        add(ad, ba, minutes); add(bd, aa, minutes)
    # Compress transfers through two hubs per physical stop. Every arrival
    # reaches one alighting hub; every boarding state is reached from one
    # boarding hub. This preserves the same transfer/wait semantics without
    # materialising the Cartesian product of all arrival/departure states.
    alight_hubs = [None] * len(stations)
    board_hubs = [None] * len(stations)
    for i in range(len(stations)):
        if station_states[i]:
            alight_hubs[i] = node(i, None, "alight")
            for src in station_states[i]:
                add(src, alight_hubs[i], 0)
        if boarding_states[i]:
            board_hubs[i] = node(i, None, "board")
            for dst in boarding_states[i]:
                add(board_hubs[i], dst, route_waits[route_states[dst]["routeId"]])
        if alight_hubs[i] is not None and board_hubs[i] is not None:
            add(alight_hubs[i], board_hubs[i], 3.5)

    # Nearby-stop transfers keep the existing 650 m rule but connect hubs
    # instead of every route-state pair. The Euclidean walk remains temporary
    # until the prepared road graph replaces it.
    transfer_radius = 650.0
    buckets = {}
    for index, station in enumerate(stations):
        key = (math.floor(station["point"][0] / transfer_radius), math.floor(station["point"][1] / transfer_radius))
        buckets.setdefault(key, []).append(index)
    for i, station in enumerate(stations):
        bx, by = math.floor(station["point"][0] / transfer_radius), math.floor(station["point"][1] / transfer_radius)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for j in buckets.get((bx + dx, by + dy), []):
                    if j <= i:
                        continue
                    walk_distance = math.dist(station["point"], stations[j]["point"])
                    if walk_distance > transfer_radius:
                        continue
                    if alight_hubs[i] is not None and board_hubs[j] is not None:
                        add(alight_hubs[i], board_hubs[j], walk_distance / WALK_METRES_PER_MINUTE + 2)
                    if alight_hubs[j] is not None and board_hubs[i] is not None:
                        add(alight_hubs[j], board_hubs[i], walk_distance / WALK_METRES_PER_MINUTE + 2)
    return route_states, station_states, boarding_states, adjacency, audit_patterns


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
            mask[row * GRID_COLS + col] = len(cells)
            cells.append({"row": row, "col": col, "point": rounded(point)})
    return cells, mask


def main():
    epci, bounds, boroughs, communes = build_administration()
    stations, routes, edges, route_waits, route_info = build_stations_and_routes()
    route_states, station_states, boarding_states, adjacency, audit_patterns = build_graph(stations, edges, route_waits)
    cells, mask = build_grid(epci, stations, bounds)
    visible_points = [p for route in routes for p in route["points"]] + [rounded(s["point"]) for s in stations]
    explore_bounds = [min(p[0] for p in visible_points) - 20_000, min(p[1] for p in visible_points) - 20_000, max(p[0] for p in visible_points) + 20_000, max(p[1] for p in visible_points) + 20_000]
    output = {
        "meta": {"lat0": LAT0, "bounds": [round(x, 1) for x in bounds], "exploreBounds": [round(x, 1) for x in explore_bounds], "gridCols": GRID_COLS, "gridRows": GRID_ROWS, "walkMetersPerMinute": WALK_METRES_PER_MINUTE, "stationAccessPenalty": 1.8, "defaultBoardWait": 15.0, "filBleuBusSource": read_json("filbleu_bus.json").get("source", {})},
        "boroughs": boroughs, "communes": communes, "parks": [], "routes": routes,
        "stations": [{"id": s["id"], "name": s["name"], "point": rounded(s["point"]), "drawPoint": rounded(s.get("drawPoint", s["point"])), "displayOffset": round(s.get("displayOffset", 0), 2), "routes": sorted(s["routes"]), "mode": s["mode"], "planned": s["planned"], "terminal": s.get("terminal", False), "parentStop": s.get("parentStop", ""), "inSerm": point_in_polygons(s["point"], epci)} for s in stations],
        "routeInfo": route_info,
        "routeStates": route_states, "stationStates": station_states, "boardingStates": boarding_states, "timetablePatterns": audit_patterns, "routeWaits": route_waits, "adjacency": adjacency, "cells": cells, "mask": mask,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {OUTPUT}: {len(stations)} stations, {len(route_states)} route states, {len(routes)} line segments, {len(cells)} grid cells")


if __name__ == "__main__":
    main()
