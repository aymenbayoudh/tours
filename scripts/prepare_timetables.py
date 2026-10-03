#!/usr/bin/env python3
"""Extract representative, actually scheduled stopping patterns for the map.

Each retained pattern uses one real trip's full timing vector (the median-runtime
trip for that stop sequence). It is not a departure-time journey planner.
"""
import argparse, csv, datetime as dt, io, json, math, re, statistics, zipfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data' / 'tours'
START = dt.date(2026, 10, 5)
DAYS = [START + dt.timedelta(days=i) for i in range(7)]

def rows(z, name):
    return csv.DictReader(io.TextIOWrapper(z.open(name), encoding='utf-8-sig'))

def seconds(value):
    h,m,s = map(int,value.split(':')); return h*3600+m*60+s

def active_services(z):
    active = defaultdict(set)
    if 'calendar.txt' in z.namelist():
        names=['monday','tuesday','wednesday','thursday','friday','saturday','sunday']
        for r in rows(z,'calendar.txt'):
            for d in DAYS:
                key=d.strftime('%Y%m%d')
                if r['start_date']<=key<=r['end_date'] and r[names[d.weekday()]]=='1':active[r['service_id']].add(key)
    if 'calendar_dates.txt' in z.namelist():
        allowed={d.strftime('%Y%m%d') for d in DAYS}
        for r in rows(z,'calendar_dates.txt'):
            if r['date'] in allowed:
                if r['exception_type']=='1':active[r['service_id']].add(r['date'])
                else:active[r['service_id']].discard(r['date'])
    return {s for s,dates in active.items() if dates}

def representative(groups):
    result=[]
    for (route, sequence, permissions), trips in sorted(groups.items()):
        target=statistics.median(t['arrivals'][-1]-t['departures'][0] for t in trips)
        chosen=min(trips,key=lambda t:abs(t['arrivals'][-1]-t['departures'][0]-target))
        result.append({'routeId':route,'stops':list(sequence),'pickup':[p[0] for p in permissions], 'dropoff':[p[1] for p in permissions],**chosen,'sampleCount':len(trips)})
    return result

def rail(path):
    current=json.loads((ROOT/'site/data/commute_map_data.json').read_text())
    allowed={s['id'].split(':',1)[1] for s in current['stations'] if s['id'].startswith('SNCF:')}
    codes={r.removeprefix('TER ') for r in current['routeInfo'] if r.startswith('TER ')}
    with zipfile.ZipFile(path) as z:
        active=active_services(z); route_map={}
        all_stops={r['stop_id']:r for r in rows(z,'stops.txt')}
        for r in rows(z,'routes.txt'):
            code=r['route_short_name']; name=r['route_long_name']
            if r['route_type']!='2' or not ('Tours' in name or ('Orléans' in name and code=='K1')):continue
            if code=='A01':base='NAVETTE'
            elif code=='K16+':base='TER K16'
            elif code=='F11':base='TER P11'
            elif code in codes:base='TER '+code
            else:continue
            route_map[r['route_id']]=base
        trips={r['trip_id']:r for r in rows(z,'trips.txt') if r['route_id'] in route_map and r['service_id'] in active}
        by_trip=defaultdict(list); bus_trips=set(); station_meta={}
        for r in rows(z,'stop_times.txt'):
            if r['trip_id'] not in trips:continue
            match=re.search(r'(\d{8})$',r['stop_id']); uic=match.group(1) if match else ''
            if 'Car ' in r['stop_id']:bus_trips.add(r['trip_id'])
            st=all_stops[r['stop_id']]
            station_meta[uic]={'uic':uic,'name':st['stop_name'],'point':[float(st['stop_lon']),float(st['stop_lat'])]}
            by_trip[r['trip_id']].append((int(r['stop_sequence']),uic,seconds(r['arrival_time']),seconds(r['departure_time']),r.get('pickup_type','0')!='1',r.get('drop_off_type','0')!='1'))
        groups=defaultdict(list)
        for tid,stops in by_trip.items():
            stops.sort()
            if tid in bus_trips or sum(s[1] in allowed for s in stops)<2:continue
            if any(b[2]<a[3] for a,b in zip(stops,stops[1:])):continue
            r=trips[tid];zero=stops[0][3]
            groups[(route_map[r['route_id']],tuple('SNCF:'+s[1] for s in stops),tuple((s[4],s[5]) for s in stops))].append({'arrivals':[(s[2]-zero)/60 for s in stops],'departures':[(s[3]-zero)/60 for s in stops],'tripId':tid,'train':r['trip_headsign']})
        patterns=representative(groups)
        feed=list(rows(z,'feed_info.txt'))[0]
    return {'source':'https://eu.ftp.opendatasoft.com/sncf/plandata/Export_OpenData_SNCF_GTFS_NewTripId.zip','feedVersion':feed['feed_version'],'referenceWeek':[d.isoformat() for d in (DAYS[0],DAYS[-1])],'stations':[station_meta[uic] for uic in sorted({sid.split(':')[1] for p in patterns for sid in p['stops']})],'excludedCarTrips':len(bus_trips),'patterns':patterns}

def tram(path):
    with zipfile.ZipFile(path) as z:
        active=active_services(z)
        route=next(r for r in rows(z,'routes.txt') if r['route_short_name']=='A' and r['route_type']=='0')
        trips={r['trip_id']:r for r in rows(z,'trips.txt') if r['route_id']==route['route_id'] and r['service_id'] in active}
        all_stops={r['stop_id']:r for r in rows(z,'stops.txt')}
        by_trip=defaultdict(list);used_children=set()
        for r in rows(z,'stop_times.txt'):
            if r['trip_id'] not in trips:continue
            child=all_stops[r['stop_id']];parent=child['parent_station'] or child['stop_id'];used_children.add(r['stop_id'])
            by_trip[r['trip_id']].append((int(r['stop_sequence']),parent,seconds(r['arrival_time']),seconds(r['departure_time']),r.get('pickup_type','0')!='1',r.get('drop_off_type','0')!='1'))
        groups=defaultdict(list);shape_ids=set();shape_stops={}
        for tid,stops in by_trip.items():
            stops.sort()
            if len(stops)<2 or any(b[2]<a[3] for a,b in zip(stops,stops[1:])):continue
            zero=stops[0][3];t=trips[tid];shape_ids.add(t['shape_id']);shape_stops[t['shape_id']]=[s[1] for s in stops]
            groups[('TRAM A',tuple('FILBLEU:'+s[1] for s in stops),tuple((s[4],s[5]) for s in stops))].append({'arrivals':[(s[2]-zero)/60 for s in stops],'departures':[(s[3]-zero)/60 for s in stops],'tripId':tid,'train':'Tram A'})
        shapes=defaultdict(list)
        for r in rows(z,'shapes.txt'):
            if r['shape_id'] in shape_ids:shapes[r['shape_id']].append((int(r['shape_pt_sequence']),[float(r['shape_pt_lon']),float(r['shape_pt_lat'])]))
        children=defaultdict(list)
        for sid in used_children:
            s=all_stops[sid];children[s['parent_station'] or sid].append([float(s['stop_lon']),float(s['stop_lat'])])
        stops={pid:{'name':all_stops[pid]['stop_name'],'point':[statistics.mean(p[i] for p in pp) for i in (0,1)],'platforms':pp} for pid,pp in children.items()}
        data={'route':{'id':'TRAM A','name':route['route_long_name'],'color':'#'+route['route_color']},'stops':stops,'shapes':[{'id':sid,'points':[p for _,p in sorted(points)],'stops':shape_stops[sid]} for sid,points in shapes.items()],'source':route['route_url'],'referenceWeek':[DAYS[0].isoformat(),DAYS[-1].isoformat()]}
    return data, representative(groups)

def main():
    p=argparse.ArgumentParser();p.add_argument('--sncf',type=Path,required=True);p.add_argument('--filbleu',type=Path,required=True);args=p.parse_args()
    schedules=rail(args.sncf);t,patterns=tram(args.filbleu);schedules['patterns']+=patterns
    (DATA/'timetables.json').write_text(json.dumps(schedules,ensure_ascii=False,separators=(',',':')))
    (DATA/'filbleu_tram.json').write_text(json.dumps(t,ensure_ascii=False,separators=(',',':')))
    print('Patterns:',len(schedules['patterns']),'Tram shapes:',len(t['shapes']),'Stops:',len(t['stops']))
    print('Scheduled routes:',sorted(set(p['routeId'] for p in schedules['patterns'])))
if __name__=='__main__':main()
