#!/usr/bin/env python3
"""Build display-only TER route shapes on the official SNCF Réseau RFN graph.

The timetable decides which services/stops exist. This script only reconstructs
missing visual polylines so the map can draw and slide along the real railway
alignment instead of inventing straight station-to-station segments.
"""
from __future__ import annotations

import argparse
import heapq
import json
import math
from collections import defaultdict
from pathlib import Path

LAT0 = 47.4
COS_LAT = math.cos(math.radians(LAT0))
METRES_X = 111_320 * COS_LAT
METRES_Y = 111_320


def xy(lon, lat):
    return lon * METRES_X, lat * METRES_Y


def point_segment_distance(point, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    size = dx * dx + dy * dy
    if not size:
        return math.dist(point, a)
    t = max(0.0, min(1.0, ((point[0]-a[0])*dx + (point[1]-a[1])*dy) / size))
    q = (a[0] + t*dx, a[1] + t*dy)
    return math.dist(point, q)


def geometry_lines(geometry):
    if not geometry:
        return []
    if geometry.get("type") == "LineString":
        return [geometry.get("coordinates", [])]
    if geometry.get("type") == "MultiLineString":
        return geometry.get("coordinates", [])
    return []


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--rfn", type=Path, required=True, help="Official SNCF RFN GeoJSON export")
    p.add_argument("--timetables", type=Path, default=Path("data/tours/timetables.json"))
    p.add_argument("--output", type=Path, default=Path("data/tours/ter_route_shapes.json"))
    args = p.parse_args()

    timetables = json.loads(args.timetables.read_text())
    station_ll = {"SNCF:"+s["uic"]: s["point"] for s in timetables.get("stations", [])}
    used_station_ids = {sid for pat in timetables.get("patterns", []) if pat["routeId"] != "TRAM A" for sid in pat["stops"] if sid in station_ll}
    if not used_station_ids:
        raise RuntimeError("No rail timetable stations")

    used_points = [station_ll[s] for s in used_station_ids]
    min_lon = min(p[0] for p in used_points) - 0.35
    max_lon = max(p[0] for p in used_points) + 0.35
    min_lat = min(p[1] for p in used_points) - 0.25
    max_lat = max(p[1] for p in used_points) + 0.25

    source = json.loads(args.rfn.read_text())
    nodes = []              # [x,y,lon,lat]
    adjacency = []
    endpoint_nodes = {}
    segments = []
    retained_features = 0

    def new_node(lon, lat):
        x, y = xy(lon, lat)
        idx = len(nodes)
        nodes.append([x, y, lon, lat])
        adjacency.append([])
        return idx

    def endpoint_node(lon, lat):
        x, y = xy(lon, lat)
        # Merge only official feature endpoints. Internal vertices stay private,
        # preventing false graph connections where railway geometries cross.
        key = (round(x / 3), round(y / 3))
        idx = endpoint_nodes.get(key)
        if idx is None:
            idx = new_node(lon, lat)
            endpoint_nodes[key] = idx
        return idx

    for feature_no, feature in enumerate(source.get("features", [])):
        props = feature.get("properties") or {}
        if str(props.get("mnemo", "")).upper() != "EXPLOITE":
            continue
        for part_no, coords in enumerate(geometry_lines(feature.get("geometry"))):
            coords = [c[:2] for c in coords if len(c) >= 2]
            if len(coords) < 2:
                continue
            part_min_lon=min(c[0] for c in coords); part_max_lon=max(c[0] for c in coords)
            part_min_lat=min(c[1] for c in coords); part_max_lat=max(c[1] for c in coords)
            if part_max_lon < min_lon or part_min_lon > max_lon or part_max_lat < min_lat or part_min_lat > max_lat:
                continue
            retained_features += 1
            ids = []
            for i, (lon, lat) in enumerate(coords):
                if i == 0 or i == len(coords)-1:
                    ids.append(endpoint_node(lon, lat))
                else:
                    ids.append(new_node(lon, lat))
            for a, b in zip(ids, ids[1:]):
                metres = math.dist(nodes[a][:2], nodes[b][:2])
                if metres <= 0.1:
                    continue
                adjacency[a].append((b, metres))
                adjacency[b].append((a, metres))
                segments.append((a, b))

    if not segments:
        raise RuntimeError("No exploited RFN segments retained")

    # 10 km buckets for station snapping.
    buckets = defaultdict(list)
    cell = 10_000
    for seg_index, (a, b) in enumerate(segments):
        ax, ay = nodes[a][:2]; bx, by = nodes[b][:2]
        min_bx, max_bx = math.floor(min(ax,bx)/cell), math.floor(max(ax,bx)/cell)
        min_by, max_by = math.floor(min(ay,by)/cell), math.floor(max(ay,by)/cell)
        for cx in range(min_bx, max_bx+1):
            for cy in range(min_by, max_by+1):
                buckets[(cx,cy)].append(seg_index)

    station_nodes = {}
    snap_metres = {}
    for sid in used_station_ids:
        lon, lat = station_ll[sid]
        pxy = xy(lon, lat)
        cx, cy = math.floor(pxy[0]/cell), math.floor(pxy[1]/cell)
        best = (float("inf"), None)
        seen = set()
        for radius in (0,1,2):
            for dx in range(-radius, radius+1):
                for dy in range(-radius, radius+1):
                    for seg_index in buckets.get((cx+dx,cy+dy), []):
                        if seg_index in seen: continue
                        seen.add(seg_index)
                        a,b=segments[seg_index]
                        # For routing, snapping to the nearer endpoint is enough;
                        # the displayed geometry itself stays on official RFN.
                        da=math.dist(pxy,nodes[a][:2]); db=math.dist(pxy,nodes[b][:2])
                        if min(da,db) < best[0]:
                            best=(min(da,db), a if da<=db else b)
            if best[1] is not None and best[0] < (radius+1)*cell:
                break
        if best[1] is None or best[0] > 3000:
            continue
        station_nodes[sid]=best[1]
        snap_metres[sid]=best[0]

    pair_cache = {}
    def shortest_path(first_sid, second_sid):
        key=(first_sid,second_sid)
        rev=(second_sid,first_sid)
        if key in pair_cache: return pair_cache[key]
        if rev in pair_cache:
            path=pair_cache[rev]
            return list(reversed(path)) if path else None
        src=station_nodes.get(first_sid); dst=station_nodes.get(second_sid)
        if src is None or dst is None:
            pair_cache[key]=None; return None
        if src==dst:
            pair_cache[key]=[src]; return [src]
        direct=math.dist(nodes[src][:2],nodes[dst][:2])
        max_distance=max(35_000, direct*2.8+12_000)
        dist={src:0.0}; prev={}; heap=[(0.0,src)]
        while heap:
            value,node=heapq.heappop(heap)
            if value!=dist.get(node): continue
            if node==dst: break
            if value>max_distance: break
            for nxt,cost in adjacency[node]:
                candidate=value+cost
                if candidate<dist.get(nxt,float("inf")) and candidate<=max_distance:
                    dist[nxt]=candidate; prev[nxt]=node; heapq.heappush(heap,(candidate,nxt))
        if dst not in dist:
            pair_cache[key]=None; return None
        path=[dst]
        while path[-1]!=src: path.append(prev[path[-1]])
        path.reverse()
        pair_cache[key]=path
        return path

    route_shapes = defaultdict(list)
    route_seen = defaultdict(set)
    missing_pairs = []
    routed_pairs = 0
    for pattern in timetables.get("patterns", []):
        route=pattern["routeId"]
        if route=="TRAM A": continue
        stops=[s for s in pattern["stops"] if s in station_ll]
        if len(stops)<2: continue
        merged=[]
        failed=False
        for a,b in zip(stops,stops[1:]):
            path=shortest_path(a,b)
            if not path:
                missing_pairs.append([route,a,b])
                failed=True
                break
            routed_pairs += 1
            if merged: merged.extend(path[1:])
            else: merged.extend(path)
        if failed or len(merged)<2: continue
        points=[[round(nodes[n][2],7),round(nodes[n][3],7)] for n in merged]
        # Compact exact repeats and identify equivalent variants.
        compact=[points[0]]
        for q in points[1:]:
            if q!=compact[-1]: compact.append(q)
        signature=(compact[0][0],compact[0][1],compact[-1][0],compact[-1][1],len(compact))
        if signature in route_seen[route]: continue
        route_seen[route].add(signature)
        route_shapes[route].append(compact)

    result={
        "source":"https://data.sncf.com/explore/dataset/formes-des-lignes-du-rfn/",
        "sourceDataset":"formes-des-lignes-du-rfn",
        "license":"ODbL",
        "purpose":"display-only railway alignment; timetable remains authoritative for service and travel times",
        "routes":dict(sorted(route_shapes.items())),
        "stats":{
            "retainedRfnFeatures":retained_features,
            "graphNodes":len(nodes),
            "graphEdges":sum(len(v) for v in adjacency)//2,
            "stationsRequested":len(used_station_ids),
            "stationsSnapped":len(station_nodes),
            "snapMedianMetres":round(sorted(snap_metres.values())[len(snap_metres)//2],1) if snap_metres else None,
            "snapMaxMetres":round(max(snap_metres.values()),1) if snap_metres else None,
            "routedAdjacentPairs":routed_pairs,
            "missingAdjacentPairs":len(missing_pairs),
            "routesBuilt":len(route_shapes),
        },
        "missingPairs":missing_pairs[:200],
    }
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(result,ensure_ascii=False,separators=(",",":"))+"\n")
    print(json.dumps(result["stats"],ensure_ascii=False,indent=2))
    if missing_pairs:
        print("Missing sample:",missing_pairs[:20])


if __name__=="__main__":
    main()
