#!/usr/bin/env python3
"""Audit rail coverage against static SNCF GTFS without changing runtime data."""
import argparse, csv, io, json, math, re, zipfile
from collections import defaultdict
from pathlib import Path
from prepare_timetables import active_service_dates, seconds
ROOT = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser(); p.add_argument('--sncf', type=Path, required=True); p.add_argument('--output', type=Path, required=True); args = p.parse_args()
data = json.loads((ROOT/'site/data/commute_map_data.json').read_text())
schedules = json.loads((ROOT/'data/tours/timetables.json').read_text())
loaded = {s['id']:s for s in data['stations'] if s['id'].startswith('SNCF:')}
retained = {s['tripId'] for s in schedules['patterns'] if s['routeId'] != 'TRAM A'}
covered = set()
for ptn in schedules['patterns']:
 if ptn['routeId']=='TRAM A': continue
 for i,a in enumerate(ptn['stops']):
  for j in range(i+1,len(ptn['stops'])):
   if ptn['pickup'][i] and ptn['dropoff'][j]: covered.add((a,ptn['stops'][j]))
with zipfile.ZipFile(args.sncf) as z:
 def rows(n):return csv.DictReader(io.TextIOWrapper(z.open(n),encoding='utf-8-sig'))
 routes={r['route_id']:r for r in rows('routes.txt') if r['route_type']=='2' and re.match(r'^[A-Z]\d',r['route_short_name'])}
 active=active_service_dates(z)
 trips={t['trip_id']:t for t in rows('trips.txt') if t['route_id'] in routes and t['service_id'] in active}
 stops={r['stop_id']:r for r in rows('stops.txt')}; times=defaultdict(list)
 for r in rows('stop_times.txt'):
  if r['trip_id'] not in trips:continue
  m=re.search(r'(\d{8})$',r['stop_id']); sid='SNCF:'+m.group(1) if m else ''
  times[r['trip_id']].append((int(r['stop_sequence']),sid,r))
 source_pairs=defaultdict(list); source_lines=defaultdict(lambda:{'trips':0,'retainedTrips':0,'loadedStops':set(),'outsideStops':set()})
 for tid,seq in times.items():
  seq.sort(); relevant=[s for s in seq if s[1] in loaded]
  if len(relevant)<2 or any('Car ' in s[2]['stop_id'] for s in seq):continue
  route=routes[trips[tid]['route_id']]; label=route['route_short_name']+' — '+route['route_long_name']
  entry=source_lines[label];entry['trips']+=1;entry['retainedTrips']+=int(tid in retained)
  for _,sid,r in seq:
   if sid in loaded:entry['loadedStops'].add(loaded[sid]['name'])
   else:entry['outsideStops'].add(stops[r['stop_id']]['stop_name'])
  for i,a in enumerate(relevant):
   for b in relevant[i+1:]:
    if a[2].get('pickup_type','0')=='1' or b[2].get('drop_off_type','0')=='1':continue
    source_pairs[(a[1],b[1])].append({'line':label,'train':trips[tid]['trip_headsign'],'minutes':(seconds(b[2]['arrival_time'])-seconds(a[2]['departure_time']))/60,'tripId':tid})
 missing=[]
 for pair, examples in sorted(source_pairs.items()):
  if pair in covered:continue
  sample=min(examples,key=lambda e:e['minutes'])
  missing.append({'from':loaded[pair[0]]['name'],'to':loaded[pair[1]]['name'],'fromId':pair[0],'toId':pair[1],'sample':sample,'sourceTripCount':len(examples)})
 result={'feed':list(rows('feed_info.txt'))[0],'referenceWeek':schedules['referenceWeek'],'loadedRailStations':len(loaded),'retainedRailPatterns':len(retained),'officialDirectPairsAmongLoadedStations':len(source_pairs),'directPairsNotRepresented':len(missing),'missingDirectPairs':missing,'sourceLinesWithAtLeastTwoLoadedStations':{k:{**v,'loadedStops':sorted(v['loadedStops']),'outsideStops':sorted(v['outsideStops'])} for k,v in sorted(source_lines.items())},'railStationsWithoutScheduledBoarding':[s['name'] for sid,s in loaded.items() if not any(p['pickup'][i] for p in schedules['patterns'] for i,x in enumerate(p['stops']) if x==sid)],'caveat':'Coverage of direct pairs is not a departure-time timetable audit; a missing direct pair may still be reachable with transfers. OutsideStops are outside current map station inventory, not necessarily errors.'}
 points=defaultdict(list)
 for sid,st in stops.items():
  match=re.search(r'(\d{8})$',sid)
  if match and 'Car ' not in sid:
   try:points['SNCF:'+match.group(1)].append([float(st['stop_lon'])*111320*math.cos(math.radians(data['meta']['lat0'])),float(st['stop_lat'])*111320])
   except (ValueError,KeyError):pass
 coordinate_errors=[]
 for sid,station in loaded.items():
  if sid in points:coordinate_errors.append({'station':station['name'],'distanceMetres':round(min(math.dist(station['point'],p) for p in points[sid]),1)})
 result['coordinateAudit']={'matchedStations':len(coordinate_errors),'over250m':[e for e in coordinate_errors if e['distanceMetres']>250],'maxMetres':max(e['distanceMetres'] for e in coordinate_errors)}
 counts=defaultdict(int)
 for item in missing:counts[item['sample']['line']]+=1
 result['missingPairCountByExampleLine']=dict(counts)
 args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({k:v for k,v in result.items() if k not in ['missingDirectPairs','sourceLinesWithAtLeastTwoLoadedStations']},ensure_ascii=False,indent=2))
 print('Missing involving Mehun:',[(r['from'],r['to'],r['sample']['line']) for r in missing if 'Mehun' in r['from'] or 'Mehun' in r['to']])
 print('Relevant source lines:',[(k,v['trips'],v['retainedTrips']) for k,v in result['sourceLinesWithAtLeastTwoLoadedStations'].items()])
