#!/usr/bin/env python3
"""Precompute SERM stop-to-stop walking transfers on the IGN BD TOPO graph.

This is deliberately an offline preparation step. The browser receives only a
small sparse table of walkable transfer pairs, never the ~500k-node road graph.
"""
from __future__ import annotations

import argparse
import heapq
import json
import math
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ROAD = ROOT / "data" / "tours" / "road_graph.json"
DEFAULT_TRANSIT = ROOT / "site" / "data" / "commute_map_data.json"
OUTPUT = ROOT / "data" / "tours" / "walking_transfers.json"
MAX_TRANSFER_METRES = 650.0
MAX_SNAP_METRES = 150.0
ROAD_BUCKET_METRES = 100.0
STOP_BUCKET_METRES = MAX_TRANSFER_METRES
WALK_METRES_PER_MINUTE = 80.0


def nearest_road_node(point, nodes, buckets):
    bx = math.floor(point[0] / ROAD_BUCKET_METRES)
    by = math.floor(point[1] / ROAD_BUCKET_METRES)
    radius = math.ceil(MAX_SNAP_METRES / ROAD_BUCKET_METRES) + 1
    best = None
    best_distance = float("inf")
    for dx in range(-radius, radius + 1):
        for dy in range(-radius, radius + 1):
            for node_index in buckets.get((bx + dx, by + dy), ()):
                node = nodes[node_index]
                distance = math.hypot(point[0] - node[0], point[1] - node[1])
                if distance < best_distance:
                    best = node_index
                    best_distance = distance
    return best, best_distance


def limited_distances(source, adjacency, targets, limit):
    if source in targets and len(targets) == 1:
        return {source: 0.0}
    remaining = set(targets)
    found = {}
    distances = {source: 0.0}
    queue = [(0.0, source)]
    while queue and remaining:
        value, node = heapq.heappop(queue)
        if value != distances.get(node):
            continue
        if value > limit:
            break
        if node in remaining:
            remaining.remove(node)
            found[node] = value
            if not remaining:
                break
        for neighbour, metres in adjacency[node]:
            candidate = value + metres
            if candidate <= limit and candidate < distances.get(neighbour, float("inf")):
                distances[neighbour] = candidate
                heapq.heappush(queue, (candidate, neighbour))
    return found


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--road", type=Path, default=DEFAULT_ROAD)
    parser.add_argument("--transit", type=Path, default=DEFAULT_TRANSIT)
    args = parser.parse_args()

    road = json.loads(args.road.read_text(encoding="utf-8"))
    transit = json.loads(args.transit.read_text(encoding="utf-8"))
    nodes = road.get("nodes", [])
    edges = road.get("edges", [])
    if not nodes or not edges:
        raise RuntimeError("Road graph is empty; build scripts/prepare_road_graph.py first")

    road_buckets = defaultdict(list)
    for index, node in enumerate(nodes):
        road_buckets[(math.floor(node[0] / ROAD_BUCKET_METRES), math.floor(node[1] / ROAD_BUCKET_METRES))].append(index)

    stops = [station for station in transit["stations"] if station.get("inSerm")]
    snaps = []
    for station in stops:
        node, gap = nearest_road_node(station["point"], nodes, road_buckets)
        if node is None or gap > MAX_SNAP_METRES:
            raise RuntimeError(f"No plausible BD TOPO snap for {station['id']} {station['name']}: {gap:.1f} m")
        snaps.append((node, gap))

    adjacency = [[] for _ in nodes]
    for edge in edges:
        a, b, minutes = edge[:3]
        metres = float(minutes) * WALK_METRES_PER_MINUTE
        adjacency[a].append((b, metres))
        adjacency[b].append((a, metres))

    # Record topology health explicitly. A sudden rise in road/stop components
    # is a useful signal that bridge/tunnel endpoint handling or a source change
    # has broken continuity even if local transfer tests still happen to pass.
    components = [-1] * len(nodes)
    component_sizes = []
    for start in range(len(nodes)):
        if components[start] >= 0:
            continue
        component_id = len(component_sizes)
        stack = [start]
        components[start] = component_id
        size = 0
        while stack:
            current = stack.pop()
            size += 1
            for neighbour, _ in adjacency[current]:
                if components[neighbour] < 0:
                    components[neighbour] = component_id
                    stack.append(neighbour)
        component_sizes.append(size)
    stop_component_counts = Counter(components[node] for node, _ in snaps)
    top_stop_components = [
        [component_id, component_sizes[component_id], stop_count]
        for component_id, stop_count in stop_component_counts.most_common(10)
    ]

    stop_buckets = defaultdict(list)
    for index, station in enumerate(stops):
        point = station["point"]
        stop_buckets[(math.floor(point[0] / STOP_BUCKET_METRES), math.floor(point[1] / STOP_BUCKET_METRES))].append(index)

    candidates = defaultdict(list)
    candidate_count = 0
    for i, station in enumerate(stops):
        point = station["point"]
        bx = math.floor(point[0] / STOP_BUCKET_METRES)
        by = math.floor(point[1] / STOP_BUCKET_METRES)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for j in stop_buckets.get((bx + dx, by + dy), ()):
                    if j <= i:
                        continue
                    other = stops[j]["point"]
                    if math.hypot(point[0] - other[0], point[1] - other[1]) <= MAX_TRANSFER_METRES:
                        candidates[i].append(j)
                        candidate_count += 1

    pairs = []
    for i, targets in candidates.items():
        source_node, source_gap = snaps[i]
        target_nodes = {snaps[j][0] for j in targets}
        road_distances = limited_distances(source_node, adjacency, target_nodes, MAX_TRANSFER_METRES)
        for j in targets:
            target_node, target_gap = snaps[j]
            road_metres = road_distances.get(target_node)
            if road_metres is None:
                continue
            total = source_gap + road_metres + target_gap
            if total <= MAX_TRANSFER_METRES + 1e-7:
                pairs.append([stops[i]["id"], stops[j]["id"], round(total, 1)])

    snap_gaps = [gap for _, gap in snaps]
    output = {
        "generated": True,
        "source": {
            "road": road.get("source", {}),
            "transit": transit.get("meta", {}).get("filBleuBusSource", {}),
        },
        "coverage": "SERM de Touraine only",
        "maxTransferMetres": MAX_TRANSFER_METRES,
        "maxSnapMetres": MAX_SNAP_METRES,
        "walkMetresPerMinute": WALK_METRES_PER_MINUTE,
        "coveredStopIds": [station["id"] for station in stops],
        "pairs": sorted(pairs),
        "stats": {
            "coveredStops": len(stops),
            "candidateEuclideanPairs": candidate_count,
            "roadWalkablePairs": len(pairs),
            "snapMedianMetres": round(sorted(snap_gaps)[len(snap_gaps) // 2], 1),
            "snapMaxMetres": round(max(snap_gaps), 1),
            "roadComponents": len(component_sizes),
            "largestRoadComponentNodes": max(component_sizes),
            "stopComponents": len(stop_component_counts),
            "largestStopComponentStops": max(stop_component_counts.values()),
            "topStopComponents": top_stop_components,
        },
    }
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(
        f"Wrote {OUTPUT}: {len(stops)} covered stops, {len(pairs)}/{candidate_count} "
        f"nearby pairs remain within {MAX_TRANSFER_METRES:.0f} m on BD TOPO; "
        f"snap max {max(snap_gaps):.1f} m; "
        f"{len(stop_component_counts)} stop components across {len(component_sizes)} road components"
    )


if __name__ == "__main__":
    main()
