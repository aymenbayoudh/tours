#!/usr/bin/env python3
"""Prepare namespaced local bus data from official GTFS snapshots, offline."""
import hashlib
import json
import re
import statistics
import zipfile
from collections import defaultdict
from pathlib import Path

from prepare_filbleu_bus import simplify, valid_time
from prepare_timetables import active_service_dates, representative, rows, seconds

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data' / 'tours'
SOURCES = DATA / 'local-networks-2026-10-04'
LABELS = {'move': 'MOVE', 'azalys': 'Azalys', 'cvl': 'CVL Mobilité', 'amboise': 'Le Bus Amboise'}


def prepare(network):
    ident, label = network['id'], LABELS[network['id']]
    path = SOURCES / network['originalFile']
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != network['sha256']:
        raise ValueError(f'Source snapshot changed: {ident}')
    selected = {r['routeId'] for r in network['routeDecisions'] if r['decision'] == 'candidate'}
    if ident == 'move':
        selected.add('LIGNE M')
    with zipfile.ZipFile(path) as z:
        dates = active_service_dates(z)
        routes = {r['route_id']: r for r in rows(z, 'routes.txt') if r['route_id'] in selected}
        stops = {s['stop_id']: s for s in rows(z, 'stops.txt')}
        trips = {t['trip_id']: t for t in rows(z, 'trips.txt') if t['route_id'] in routes and t['service_id'] in dates}
        times = defaultdict(list)
        for s in rows(z, 'stop_times.txt'):
            if s['trip_id'] not in trips or s['stop_id'] not in stops:
                continue
            if not valid_time(s.get('arrival_time', '')) or not valid_time(s.get('departure_time', '')):
                raise ValueError(f'Uninterpolated time in {ident}: {s}')
            times[s['trip_id']].append(s)
        groups, departures = defaultdict(list), defaultdict(lambda: defaultdict(list))
        excluded = defaultdict(int)
        runtime = {k: f'BUS {label} {(r.get("route_short_name") or k).strip()}' for k, r in routes.items()}
        selected_shapes, stop_routes = {}, defaultdict(set)
        for tid, records in times.items():
            records.sort(key=lambda s: int(s['stop_sequence']))
            t = trips[tid]
            rid = runtime[t['route_id']]
            # M: only the annual, unreserved columns of the 09/09/2026 official PDF.
            # The GTFS calendar names SCOLAIRE are normal term-time variants, not a service ban.
            if ident == 'move' and t['route_id'] == 'LIGNE M':
                departure = records[0]['departure_time']
                direction = t.get('direction_id', '0')
                if departure not in ({'06:19:00', '09:30:00'} if direction == '0' else {'12:18:00', '18:13:00'}):
                    excluded[rid] += 1
                    continue
            conditional = any(s.get('pickup_type') in {'2', '3'} or s.get('drop_off_type') in {'2', '3'} or s.get('pickup_booking_rule_id') or s.get('drop_off_booking_rule_id') for s in records)
            if conditional or len(records) < 2:
                excluded[rid] += 1
                continue
            if ident == 'move' and t['route_id'] == 'LIGNE M' and t.get('direction_id') == '1':
                # Pink cells at the two schools are absent in holidays on these annual courses.
                records = [s for s in records if not any(name in stops[s['stop_id']]['stop_name'].casefold() for name in ['ronsard', 'emond'])]
            start = seconds(records[0]['departure_time']) / 60
            if start < 300 or start >= 1320:
                excluded[rid] += 1
                continue
            arrivals = [seconds(s['arrival_time']) / 60 - start for s in records]
            dep = [seconds(s['departure_time']) / 60 - start for s in records]
            if any(a > b for a, b in zip(arrivals, dep)) or any(arrivals[i+1] < dep[i] for i in range(len(dep)-1)):
                raise ValueError(f'Non-monotonic trip: {ident} {tid}')
            sequence = tuple(f'{ident.upper()}:{s["stop_id"]}' for s in records)
            permissions = tuple((s.get('pickup_type', '0') != '1', s.get('drop_off_type', '0') != '1') for s in records)
            groups[(rid, sequence, permissions)].append({'train': rid, 'tripId': tid, 'arrivals': arrivals, 'departures': dep, 'shapeId': t.get('shape_id'), 'directionId': t.get('direction_id', '0'), 'requiresReservation': False})
            for s in records:
                stop_routes[s['stop_id']].add(rid)
            if t.get('shape_id'):
                selected_shapes[t['shape_id']] = rid
            for date in dates[t['service_id']]:
                departures[rid][(date, t.get('direction_id', '0'), records[0]['stop_id'])].append(start)
        patterns = representative(groups)
        route_info = {}
        for key, r in routes.items():
            rid = runtime[key]
            if not any(p['routeId'] == rid for p in patterns):
                continue
            intervals = []
            for values in departures[rid].values():
                values = sorted(set(values))
                if len(values) >= 4:
                    intervals += [b-a for a,b in zip(values, values[1:]) if b>a]
                elif values:
                    intervals.append(60)
            color = r.get('route_color') or '356E91'
            if not re.fullmatch(r'#?[0-9a-fA-F]{6}', color):
                color = '356E91'
            route_info[rid] = {'title': f'{label} {(r.get("route_short_name") or key)} — {r.get("route_long_name") or ""}', 'network': ident, 'networkName': label, 'shortName': r.get('route_short_name') or key, 'color': '#' + color.lstrip('#'), 'waitMinutes': round(min(30, max(2, statistics.median(intervals)/2 if intervals else 30)), 2), 'calculationAvailable': True, 'gtfsRouteId': key, 'excludedConditionalTrips': excluded[rid], 'waitMethod': 'half-median-headway-per-day-direction-origin-bounded-2-30'}
        reduced_stops = {}
        for sid, ids in stop_routes.items():
            s = stops[sid]
            reduced_stops[f'{ident.upper()}:{sid}'] = {'name': s['stop_name'], 'point': [float(s['stop_lon']), float(s['stop_lat'])], 'parent': f'{ident.upper()}:{s["parent_station"]}' if s.get('parent_station') else '', 'network': ident, 'displayRoutes': sorted(ids)}
        shape_points = defaultdict(list)
        if 'shapes.txt' in z.namelist():
            for s in rows(z, 'shapes.txt'):
                if s['shape_id'] in selected_shapes:
                    shape_points[s['shape_id']].append((int(s['shape_pt_sequence']), [float(s['shape_pt_lon']), float(s['shape_pt_lat'])]))
        shapes = [{'routeId': selected_shapes[sid], 'shapeId': f'{ident}:{sid}', 'points': simplify([p for _,p in sorted(points)])} for sid,points in shape_points.items()]
        missing = {p['routeId'] for p in patterns} - {s['routeId'] for s in shapes}
        if missing:
            raise ValueError(f'Missing official geometry: {ident} {missing}')
        return {'source': {'id': ident, 'name': label, 'url': network['url'], 'license': network['license'], 'sha256': digest, 'referenceWeek': ['2026-10-05', '2026-10-11'], 'routeDecisions': network['routeDecisions'], 'regularCoursePolicy': 'MOVE M: PDF 09/09/2026 annual unreserved columns only; others: official GTFS selected regular lines' if ident == 'move' else 'manifest selected regular lines' }, 'stops': reduced_stops, 'routes': route_info, 'patterns': patterns, 'shapes': shapes}


def main():
    inventory = json.loads((SOURCES / 'inventory.json').read_text())
    out = {'sources': [], 'stops': {}, 'routes': {}, 'patterns': [], 'shapes': []}
    for network in inventory['networks']:
        if network['id'] not in LABELS:
            continue
        prepared = prepare(network)
        out['sources'].append(prepared['source'])
        for key in ('stops', 'routes'):
            if set(out[key]) & set(prepared[key]):
                raise ValueError(f'Duplicate namespaced {key}')
            out[key].update(prepared[key])
        for key in ('patterns', 'shapes'):
            out[key].extend(prepared[key])
        print(network['id'], len(prepared['routes']), 'routes', len(prepared['stops']), 'stops', len(prepared['patterns']), 'patterns')
    (DATA / 'local_bus.json').write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')))


if __name__ == '__main__':
    main()
