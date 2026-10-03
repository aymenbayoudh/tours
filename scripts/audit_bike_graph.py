#!/usr/bin/env python3
"""Measure a prepared directed cycling graph without modifying it."""
from __future__ import annotations

import argparse
import heapq
import json
import math
import time
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BIKE = ROOT / "data" / "tours" / "bike_graph.json"
DEFAULT_TRANSIT = ROOT / "site" / "data" / "commute_map_data.json"
BUCKET = 200.0


def nearest_node(point, nodes, buckets, max_radius=1000.0):
    bx, by = math.floor(point[0] / BUCKET), math.floor(point[1] / BUCKET)
    rings = max(1, math.ceil(max_radius / BUCKET))
    best = None
    best_distance = float("inf")
    for r in range(rings + 1):
        found_in_ring = False
        for dx in range(-r, r + 1):
            for dy in range(-r, r + 1):
                if r and abs(dx) != r and abs(dy) != r:
                    continue
                for index in buckets.get((bx + dx, by + dy), ()):
                    found_in_ring = True
                    x, y = nodes[index][:2]
                    value = math.hypot(point[0] - x, point[1] - y)
                    if value < best_distance:
                        best = index
                        best_distance = value
        if best is not None and best_distance <= max(0.0, (r - 1) * BUCKET):
            break
        if not found_in_ring and r * BUCKET > best_distance:
            break
    return best, best_distance


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bike", type=Path, default=DEFAULT_BIKE)
    parser.add_argument("--transit", type=Path, default=DEFAULT_TRANSIT)
    args = parser.parse_args()

    bike = json.loads(args.bike.read_text(encoding="utf-8"))
    transit = json.loads(args.transit.read_text(encoding="utf-8"))
    nodes = bike["nodes"]
    edges = bike["edges"]
    n = len(nodes)

    parent = list(range(n))
    size = [1] * n

    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(a, b):
        a, b = root(a), root(b)
        if a == b:
            return
        if size[a] < size[b]:
            a, b = b, a
        parent[b] = a
        size[a] += size[b]

    adjacency = [[] for _ in range(n)]
    edge_set = set()
    indegree = [0] * n
    outdegree = [0] * n
    for a, b, metres in edges:
        adjacency[a].append((b, float(metres)))
        outdegree[a] += 1
        indegree[b] += 1
        edge_set.add((a, b))
        union(a, b)

    reciprocal = sum(1 for a, b in edge_set if (b, a) in edge_set)
    components = defaultdict(int)
    for index in range(n):
        components[root(index)] += 1
    component_sizes = sorted(components.values(), reverse=True)

    buckets = defaultdict(list)
    for index, node in enumerate(nodes):
        buckets[(math.floor(node[0] / BUCKET), math.floor(node[1] / BUCKET))].append(index)

    stops = [s for s in transit.get("stations", []) if s.get("inSerm")]
    snap_gaps = []
    stop_nodes = []
    for stop in stops:
        node, gap = nearest_node(stop["point"], nodes, buckets)
        if node is not None:
            stop_nodes.append(node)
            snap_gaps.append(gap)

    tours = next((s for s in transit.get("stations", []) if s.get("name") == "Tours"), None)
    tours_node = None
    tours_gap = None
    reachable = 0
    dijkstra_ms = None
    if tours:
        tours_node, tours_gap = nearest_node(tours["point"], nodes, buckets)
    if tours_node is not None:
        started = time.perf_counter()
        distances = [float("inf")] * n
        distances[tours_node] = 0.0
        queue = [(0.0, tours_node)]
        while queue:
            value, node = heapq.heappop(queue)
            if value != distances[node]:
                continue
            for neighbour, metres in adjacency[node]:
                candidate = value + metres
                if candidate < distances[neighbour]:
                    distances[neighbour] = candidate
                    heapq.heappush(queue, (candidate, neighbour))
        dijkstra_ms = (time.perf_counter() - started) * 1000
        reachable = sum(math.isfinite(x) for x in distances)

    output = {
        "nodes": n,
        "directedEdges": len(edges),
        "reciprocalDirectedEdges": reciprocal,
        "oneWayDirectedEdges": len(edges) - reciprocal,
        "weakComponents": len(component_sizes),
        "largestWeakComponentNodes": component_sizes[0] if component_sizes else 0,
        "nodesWithNoOutgoing": sum(v == 0 for v in outdegree),
        "nodesWithNoIncoming": sum(v == 0 for v in indegree),
        "coveredTransitStops": len(stop_nodes),
        "transitStops": len(stops),
        "stopSnapMedianMetres": round(sorted(snap_gaps)[len(snap_gaps)//2], 1) if snap_gaps else None,
        "stopSnapMaxMetres": round(max(snap_gaps), 1) if snap_gaps else None,
        "toursSnapMetres": round(tours_gap, 1) if tours_gap is not None else None,
        "reachableFromTours": reachable,
        "dijkstraFromToursMs": round(dijkstra_ms, 1) if dijkstra_ms is not None else None,
        "speedMetresPerMinute": bike.get("speedMetresPerMinute"),
        "parkingPenaltyMinutes": bike.get("parkingPenaltyMinutes"),
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
