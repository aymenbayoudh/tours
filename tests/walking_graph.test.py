#!/usr/bin/env python3
"""Small topology regression tests for pedestrian graph traversal."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.prepare_walking_transfers import limited_distances


def main():
    # Two dead-end branches can be geometrically close without sharing an edge.
    # A proximity-based connector must never turn this into a walkable path.
    adjacency = [
        [(1, 120.0)],
        [(0, 120.0)],
        [(3, 80.0)],
        [(2, 80.0)],
    ]
    result = limited_distances(0, adjacency, {2}, 650.0)
    assert 2 not in result, "Disconnected dead ends were incorrectly connected"

    # Once a real graph edge exists, the same search must find the path and
    # preserve the accumulated network distance.
    connected = [
        [(1, 120.0)],
        [(0, 120.0), (2, 210.0)],
        [(1, 210.0), (3, 80.0)],
        [(2, 80.0)],
    ]
    result = limited_distances(0, connected, {2}, 650.0)
    assert abs(result[2] - 330.0) < 1e-9, "Graph walking distance is incorrect"

    print("walking topology tests: ok")


if __name__ == "__main__":
    main()
