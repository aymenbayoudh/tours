#!/usr/bin/env python3
"""Build pedestrian and cycling road graphs from IGN BD TOPO WFS.

The raw national road layer is never shipped to the browser. We query the
14 SERM EPCI envelopes separately, deduplicate features, retain only geometry
intersecting the SERM, and build separate walking and cycling profiles. Walking
is undirected; cycling is directed from road and cycle-facility attributes.
Geometry is cut into graph edges no longer than roughly 140 m.
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
BIKE_OUTPUT = DATA / "bike_graph.json"
WFS = "https://data.geopf.fr/wfs/ows"
TYPE_NAME = "BDTOPO_V3:troncon_de_route"
LAT0 = 47.4
COS_LAT = math.cos(math.radians(LAT0))
MAX_EDGE_METRES = 140.0
PAGE_SIZE = 5000
WALK_METRES_PER_MINUTE = 80.0
BIKE_METRES_PER_MINUTE = 250.0  # 15 km/h, explicit first-version assumption
BIKE_PARKING_PENALTY_MINUTES = 2.0


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


def _direction_values(value):
    value = str(value or "").strip()
    if value == "Double sens":
        return {1, -1}
    if value == "Sens direct":
        return {1}
    if value == "Sens inverse":
        return {-1}
    return set()


def bicycle_directions(properties):
    """Return legal cycling directions relative to feature digitisation.

    1 means geometry order, -1 means the reverse. This is intentionally
    conservative: motorway-like roads, ramps, stairs and private/restricted
    motor roads are excluded unless a cycle-specific facility establishes a
    legal cycle movement. Dedicated cycle facilities remain usable even when
    light-vehicle access is physically impossible.
    """
    nature = str(properties.get("nature") or "").strip()
    restriction = str(properties.get("nature_de_la_restriction") or "").strip()
    access = str(properties.get("acces_vehicule_leger") or "").strip()
    traffic = str(properties.get("sens_de_circulation") or "").strip()
    state = str(properties.get("etat_de_l_objet") or "").strip()
    private = properties.get("prive") in (True, 1, "1", "Vrai", "true", "True")

    if state and state != "En service":
        return set()
    if private or restriction == "Entrée avec gardien":
        return set()
    if nature in {"Type autoroutier", "Bretelle", "Escalier", "Bac ou liaison maritime"}:
        return set()

    cycle_left = str(properties.get("amenagement_cyclable_gauche") or "").strip()
    cycle_right = str(properties.get("amenagement_cyclable_droit") or "").strip()
    cycle_sense_left = str(properties.get("sens_amenagement_cyclable_gauche") or "").strip()
    cycle_sense_right = str(properties.get("sens_amenagement_cyclable_droit") or "").strip()

    dedicated_cycle = nature == "Piste cyclable" or restriction in {
        "Piste cyclable",
        "Voie verte",
        "Aménagement mixte hors voie verte",
    }
    cycle_friendly_restriction = restriction in {
        "Double sens cyclable non matérialisé",
        "Vélorue",
        "Chaussée à voie centrale banalisée",
    }
    has_cycle_facility = bool(
        cycle_left
        or cycle_right
        or cycle_sense_left
        or cycle_sense_right
        or dedicated_cycle
        or cycle_friendly_restriction
    )

    base_allowed = access not in {"Physiquement impossible", "Restreint aux ayants droit"}
    directions = _direction_values(traffic) if base_allowed else set()

    cycle_directions = _direction_values(cycle_sense_left) | _direction_values(cycle_sense_right)
    if restriction == "Double sens cyclable non matérialisé":
        cycle_directions |= {1, -1}
    elif dedicated_cycle and not cycle_directions:
        cycle_directions |= {1, -1}
    elif (cycle_left or cycle_right or cycle_friendly_restriction) and not cycle_directions:
        # When a side facility exists but its own direction is missing, use the
        # roadway direction rather than inventing a contra-flow.
        cycle_directions |= _direction_values(traffic)

    if not base_allowed and not has_cycle_facility:
        return set()
    return directions | cycle_directions


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
    bike_nodes = []
    bike_node_index = {}
    bike_edges = []
    bike_edge_seen = {}
    fetched = retained = rejected = 0
    bike_retained = bike_rejected = 0
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

    def bike_node(point_xy, internal_key=None):
        x, y = round(point_xy[0], 1), round(point_xy[1], 1)
        key = ("internal", internal_key) if internal_key is not None else ("endpoint", x, y)
        index = bike_node_index.get(key)
        if index is None:
            index = len(bike_nodes)
            bike_node_index[key] = index
            bike_nodes.append([x, y])
        return index

    def add_bike_edge(a_point, b_point, metres, directions, a_internal=None, b_internal=None):
        if metres <= 0.05 or not directions:
            return
        a, b = bike_node(a_point, a_internal), bike_node(b_point, b_internal)
        if a == b:
            return
        metres = round(metres, 1)
        for start, end in ((a, b), (b, a)):
            direction = 1 if start == a else -1
            if direction not in directions:
                continue
            key = (start, end)
            previous = bike_edge_seen.get(key)
            if previous is None:
                bike_edge_seen[key] = len(bike_edges)
                bike_edges.append([start, end, metres])
            elif metres < bike_edges[previous][2]:
                bike_edges[previous][2] = metres

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
                walk_allowed = pedestrian_allowed(props)
                bike_directions = bicycle_directions(props)
                if not walk_allowed:
                    rejected += 1
                if not bike_directions:
                    bike_rejected += 1
                if not walk_allowed and not bike_directions:
                    continue
                for line_number, line in enumerate(feature_lines(geometry)):
                    line = [p[:2] for p in line if len(p) >= 2]
                    if len(line) < 2 or not intersects_serm(line, epci):
                        continue
                    if walk_allowed:
                        retained += 1
                    if bike_directions:
                        bike_retained += 1
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
                            if walk_allowed:
                                add_edge(current, cut, MAX_EDGE_METRES, current_internal, cut_internal)
                            if bike_directions:
                                add_bike_edge(current, cut, MAX_EDGE_METRES, bike_directions, current_internal, cut_internal)
                            cut_number += 1
                            current = cut
                            current_internal = cut_internal
                            cursor = cut
                            remaining -= need
                            accumulated = 0.0
                        accumulated += remaining
                    end = xy(*line[-1])
                    if math.dist(current, end) > 0.05:
                        if walk_allowed:
                            add_edge(current, end, accumulated, current_internal, None)
                        if bike_directions:
                            add_bike_edge(current, end, accumulated, bike_directions, current_internal, None)
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

    bike_output = {
        "source": {
            "name": "IGN BD TOPO v3 — Tronçons de route",
            "url": WFS,
            "typeName": TYPE_NAME,
            "retrievedAtBuild": True,
            "bbox": [round(x, 7) for x in bbox],
            "license": "Licence Ouverte Etalab 2.0",
            "profile": "Vélo dirigé : sens VL + sens/aménagements cyclables documentés ; autoroutes, bretelles, escaliers et accès privés non cyclables exclus.",
        },
        "speedMetresPerMinute": BIKE_METRES_PER_MINUTE,
        "parkingPenaltyMinutes": BIKE_PARKING_PENALTY_MINUTES,
        "nodes": bike_nodes,
        "edges": bike_edges,
        "stats": {
            "featuresReturned": fetched,
            "uniqueFeaturesFetched": len(seen_features),
            "wfsRequests": requests,
            "linePartsRetained": bike_retained,
            "featuresRejectedByBikeProfile": bike_rejected,
            "propertyNames": sample_properties or [],
        },
    }
    BIKE_OUTPUT.write_text(json.dumps(bike_output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(
        f"Wrote {BIKE_OUTPUT}: {len(bike_nodes)} bike nodes, {len(bike_edges)} directed bike edges, "
        f"{bike_retained} retained line parts"
    )


if __name__ == "__main__":
    main()
