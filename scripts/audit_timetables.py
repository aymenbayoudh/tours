#!/usr/bin/env python3
"""Verify every retained time vector against the original official GTFS files."""
import argparse, csv, io, json, re, zipfile
from collections import defaultdict
from pathlib import Path
from prepare_timetables import seconds
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--sncf',type=Path,required=True);p.add_argument('--filbleu',type=Path,required=True);a=p.parse_args()
data=json.loads((ROOT/'data/tours/timetables.json').read_text());checked=0;omitted=set();examples=[]
for path,rail in [(a.sncf,True),(a.filbleu,False)]:
    patterns=[p for p in data['patterns'] if (p['routeId']!='TRAM A')==rail]
    selected={p['tripId'] for p in patterns}
    with zipfile.ZipFile(path) as z:
        rows=lambda name:csv.DictReader(io.TextIOWrapper(z.open(name),encoding='utf-8-sig'))
        stops={s['stop_id']:s for s in rows('stops.txt')};times=defaultdict(list)
        for r in rows('stop_times.txt'):
            if r['trip_id'] not in selected:continue
            if rail:assert 'Car ' not in r['stop_id'], 'Coach trip mislabeled as train'
            sid=('SNCF:'+re.search(r'(\d{8})$',r['stop_id']).group(1)) if rail else 'FILBLEU:'+(stops[r['stop_id']]['parent_station'] or r['stop_id'])
            times[r['trip_id']].append((int(r['stop_sequence']),sid,seconds(r['arrival_time'])/60,seconds(r['departure_time'])/60,r))
        for pattern in patterns:
            full=sorted(times[pattern['tripId']]);ref=[r for r in full if r[1] in pattern['stops']]
            assert [r[1] for r in ref]==pattern['stops']
            zero=ref[0][3]
            for i,row in enumerate(ref):
                assert abs(row[2]-zero-pattern['arrivals'][i])<1e-7
                assert abs(row[3]-zero-pattern['departures'][i])<1e-7
                assert (row[4].get('pickup_type','0')!='1')==pattern['pickup'][i]
                assert (row[4].get('drop_off_type','0')!='1')==pattern['dropoff'][i]
                checked+=1
            for row in full:
                if row[1] not in pattern['stops']:omitted.add(stops[row[4]['stop_id']]['stop_name'])
print(json.dumps({'patterns':len(data['patterns']),'verifiedStopTimes':checked,'omittedStopsInSelectedTrips':sorted(omitted)},ensure_ascii=False,indent=2))
