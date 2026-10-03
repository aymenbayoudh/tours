#!/usr/bin/env python3
"""Build a compact pedestrian road graph from IGN BD TOPO WFS.

The raw national road layer is never shipped to the browser. We query the
14 SERM EPCI envelopes separately, deduplicate features, retain only geometry
intersecting the SERM, apply conservative pedestrian restrictions, and compact
geometry into graph edges no longer than roughly 140 m.
"""
from __future__ import annotations

import json
import math
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "tours"
OUTPUT = DATA / "road_graph.json"
WFS = "https://data.geopf.fr/wfs/ows"
TYPE_NAME = "BDTOPO_V3:troncon_de_route"
LAT0 = 47.4
COS_LAT = math.cos(math.radians(LAT0))
MAX_EDGE_METRES = 140.0
PAGE_SIZE = 5000
WALK_METRES_PER_MINUTE = 80.0


def xy(lon: float, lat: float) -> tuple[float, float]:
    return lon * 111_320 * COS_LAT, lat * 111_320


def lonlat(point: tuple[float, float]) -> tuple[float, float]:
    return point[0] / (111_320 * COS_LAT), point[1] / 111_320


def in_ring(point, ring):
    x, y = point
    inside = False
    for a, b in zip(ring, ring[1:]):
        x1, y1 = a[:2]
        x2, y2 = b[:2]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def polygon_parts(geometry):
    if geometry["type"] == "Polygon":
        return [geometry["coordinates"]]
    if geometry["type"] == "MultiPolygon":
        return geometry["coordinates"]
    return []


def point_in_geometry(point, geometry):
    for polygon in polygon_parts(geometry):
        if polygon and in_ring(point, polygon[0]) and not any(in_ring(point, hole) for hole in polygon[1:]):
            return True
    return False


def geometry_bbox(geometry):
    points = [p for polygon in polygon_parts(geometry) for ring in polygon for p in ring]
    return (
        min(p[0] for p in points), min(p[1] for p in points),
        max(p[0] for p in points), max(p[1] for p in points),
    )


def intersects_serm(points, epci):
    if not points:
        return False
    probes = [points[0], points[-1], points[len(points) // 2]]
    if len(points) > 6:
        probes.extend(points[1:-1:max(1, len(points) // 5)])
    return any(
        box[0] <= p[0] <= box[2] and box[1] <= p[1] <= box[3] and point_in_geometry(p, geom)
        for p in probes for box, geom in epci
    )


def pedestrian_allowed(properties):
    nature = str(properties.get("nature") or "")
    access = str(properties.get("acces_pieton") or "")
    restriction = str(properties.get("nature_de_la_restriction") or "")
    private = properties.get("prive")
    if access == "Restreint aux ayants droit":
        return False
    if private in (True, 1, "1", "Vrai", "true", "True") and access != "Libre":
        return False
    if nature in {"Type autoroutier", "Bretelle"} and access != "Libre":
        return False
    if nature == "Piste cyclable" and access != "Libre" and restriction not in {"Voie verte", "Aménagement mixte hors voie verte"}:
        return False
    return True


def request_page(bbox, start):
    params = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeNames": TYPE_NAME,
        "outputFormat": "application/json",
        "srsName": "EPSG:4326",
        "bbox": ",".join(str(round(x, 7)) for x in bbox) + ",EPSG:4326",
        "count": str(PAGE_SIZE),
        "startIndex": str(start),
    }
    url = WFS + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "tours-accessibility-map/2026"})
    last_error = None
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=90) as response:
                body = response.read()
            if not body.lstrip().startswith((b"{", b"[")):
                sample = body[:120].decode("utf-8", errors="replace")
                raise RuntimeError(f"WFS returned non-JSON content: {sample!r}")
            return json.loads(body)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, RuntimeError) as exc:
            last_error = exc
            if attempt == 4:
                raise
            delay = 2 ** attempt
            print(
                f"BD TOPO: transient WFS error at startIndex={start}; "
                f"retry {attempt + 2}/5 in {delay}s: {exc}",
                flush=True,
            )
            time.sleep(delay)
    raise last_error


def feature_lines(geometry):
    if not geometry:
        return []
    if geometry["type"] == "LineString":
        return [geometry["coordinates"]]
    if geometry["type"] == "MultiLineString":
        return geometry["coordinates"]
    return []


def main():
    admin = json.loads((DATA / "admin_2026.geojson").read_text(encoding="utf-8"))
    geoms = [f["geometry"] for f in admin["features"] if f["properties"].get("level") == "epci"]
    epci = [(geometry_bbox(g), g) for g in geoms]
    bbox = (
        min(b[0] for b, _ in epci), min(b[1] for b, _ in epci),
        max(b[2] for b, _ in epci), max(b[3] for b, _ in epci),
    )

    nodes = []
    node_index = {}
    edges = []
    edge_seen = {}
    fetched = retained = rejected = 0
    sample_properties = None

    def node(point_xy, internal_key=None):
        # BD TOPO road continuity is represented by shared feature endpoints.
        # Grade-separated crossings are not topologically split by IGN, so they
        # must NOT be connected merely because their geometries cross.
        #
        # Our own ~140 m cut points are therefore private to one source line;
        # only real BD TOPO line endpoints are merged by XY coordinate.
        x, y = round(point_xy[0], 1), round(point_xy[1], 1)
        key = ("internal", internal_key) if internal_key is not None else ("endpoint", x, y)
        index = node_index.get(key)
        if index is None:
            index = len(nodes)
            node_index[key] = index
            nodes.append([x, y])
        return index

    def add_edge(a_point, b_point, metres, a_internal=None, b_internal=None):
        if metres <= 0.05:
            return
        a, b = node(a_point, a_internal), node(b_point, b_internal)
        if a == b:
            return
        key = (min(a, b), max(a, b))
        minutes = round(metres / WALK_METRES_PER_MINUTE, 4)
        previous = edge_seen.get(key)
        if previous is None:
            edge_seen[key] = len(edges)
            edges.append([a, b, minutes])
        elif minutes < edges[previous][2]:
            edges[previous][2] = minutes

    seen_features = set()
    requests = 0
    for epci_number, (epci_bbox, _) in enumerate(epci, 1):
        start = 0
        while True:
            page = request_page(epci_bbox, start)
            requests += 1
            features = page.get("features", [])
            if not features:
                break
            fetched += len(features)
            for feature in features:
                props = feature.get("properties") or {}
                geometry = feature.get("geometry")
                feature_key = feature.get("id") or props.get("cleabs")
                if not feature_key:
                    feature_key = json.dumps(geometry, sort_keys=True, separators=(",", ":"))
                if feature_key in seen_features:
                    continue
                seen_features.add(feature_key)
                if sample_properties is None:
                    sample_properties = sorted(props)
                if not pedestrian_allowed(props):
                    rejected += 1
                    continue
                for line_number, line in enumerate(feature_lines(geometry)):
                    line = [p[:2] for p in line if len(p) >= 2]
                    if len(line) < 2 or not intersects_serm(line, epci):
                        continue
                    retained += 1
                    current = xy(*line[0])
                    current_internal = None  # a real BD TOPO endpoint
                    cut_number = 0
                    accumulated = 0.0
                    for raw_a, raw_b in zip(line, line[1:]):
                        a = xy(*raw_a[:2])
                        b = xy(*raw_b[:2])
                        seg = math.dist(a, b)
                        if seg <= 0:
                            continue
                        cursor = a
                        remaining = seg
                        while accumulated + remaining >= MAX_EDGE_METRES:
                            need = MAX_EDGE_METRES - accumulated
                            t = need / remaining
                            cut = (cursor[0] + (b[0] - cursor[0]) * t, cursor[1] + (b[1] - cursor[1]) * t)
                            cut_internal = (feature_key, line_number, cut_number)
                            add_edge(current, cut, MAX_EDGE_METRES, current_internal, cut_internal)
                            cut_number += 1
                            current = cut
                            current_internal = cut_internal
                            cursor = cut
                            remaining -= need
                            accumulated = 0.0
                        accumulated += remaining
                    end = xy(*line[-1])
                    if math.dist(current, end) > 0.05:
                        add_edge(current, end, accumulated, current_internal, None)
            if len(features) < PAGE_SIZE:
                break
            start += len(features)
            if start > 150_000:
                raise RuntimeError(f"Unexpectedly large BD TOPO WFS result for EPCI {epci_number}")
        print(
            f"BD TOPO: EPCI {epci_number}/{len(epci)}; "
            f"{len(seen_features)} unique features ({fetched} returned)...",
            flush=True,
        )

    output = {
        "source": {
            "name": "IGN BD TOPO v3 — Tronçons de route",
            "url": WFS,
            "typeName": TYPE_NAME,
            "retrievedAtBuild": True,
            "bbox": [round(x, 7) for x in bbox],
            "walkSpeedMetresPerMinute": WALK_METRES_PER_MINUTE,
            "notes": "Accès piéton BD TOPO respecté lorsqu’il est renseigné ; autoroutes/bretelles et accès privés non explicitement libres exclus ; seuls les vrais endpoints BD TOPO sont fusionnés, les découpes artificielles internes restent propres à leur tronçon afin de ne pas connecter les franchissements sans nœud topologique.",
        },
        "nodes": nodes,
        "edges": edges,
        "stats": {
            "featuresReturned": fetched,
            "uniqueFeaturesFetched": len(seen_features),
            "wfsRequests": requests,
            "linePartsRetained": retained,
            "featuresRejectedByPedestrianRules": rejected,
            "propertyNames": sample_properties or [],
        },
    }
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(
        f"Wrote {OUTPUT}: {len(nodes)} road nodes, {len(edges)} walking edges, "
        f"{retained} retained line parts from {len(seen_features)} unique features "
        f"({fetched} returned across {requests} WFS requests)"
    )


if __name__ == "__main__":
    main()
