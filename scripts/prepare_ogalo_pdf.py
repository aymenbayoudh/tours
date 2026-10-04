#!/usr/bin/env python3
"""Rebuild regular Ogalo courses from current official PDFs, never stale GTFS times.
PDF table extraction and reviewed stop aliases are versioned alongside the sources.
The historical GTFS is used solely for stop coordinates and display shapes.
"""
import csv,io,json,zipfile,re,hashlib,statistics,unicodedata,math
from collections import defaultdict
from pathlib import Path
from prepare_timetables import representative
from prepare_filbleu_bus import simplify
ROOT=Path(__file__).resolve().parents[1];DATA=ROOT/'data/tours';SRC=DATA/'local-networks-2026-10-04'

def prepare():
 tables=json.loads((SRC/'prepared/ogalo-pdf-tables.json').read_text());matches=json.loads((SRC/'prepared/ogalo-stop-matches.json').read_text())
 with zipfile.ZipFile(SRC/'ogalo.zip') as z:
  rows=lambda f:list(csv.DictReader(io.TextIOWrapper(z.open(f),encoding='utf-8-sig')))
  stops={s['stop_id']:s for s in rows('stops.txt')};routes={r['route_id']:r for r in rows('routes.txt')};trips=rows('trips.txt');shape_points=defaultdict(list)
  for p in rows('shapes.txt'):shape_points[p['shape_id']].append((int(p['shape_pt_sequence']),[float(p['shape_pt_lon']),float(p['shape_pt_lat'])]))
  source_shapes={sid:simplify([p for _,p in sorted(pp)]) for sid,pp in shape_points.items()}
  trip_stops=defaultdict(list)
  for s in rows('stop_times.txt'):trip_stops[s['trip_id']].append(s)
  geometry_candidates=defaultdict(dict)
  for t in trips:
   geometry_candidates[t['route_id']][t['shape_id']]={stops[s['stop_id']].get('parent_station') or s['stop_id'] for s in trip_stops[t['trip_id']]}
 out={'sources':[],'stops':{},'routes':{},'patterns':[],'shapes':[]};groups=defaultdict(list);audit=[];used_shapes={};departures=defaultdict(list);shape_distance_cache={}
 fixed={'CV Portail Louis':'E4654','GENNES Place 19 mars 1962':'E4242','GENNES Place du 19 mars 1962':'E4242','LES ROSIERS-SUR-LOIRE Rue Nationale RD952':'E42449','LES ROSIERS-SUR-LOIRE Rue de Saumur':'E4303',"COURLÉON Place de l'Eglise":'E4157','ST-LAMBERT-DES -LEVÉES Ecoparc':'E4568','ZA du Pigeonnier':'E4881','CONCOURSON-S/LAYON Centre':'E4148','CONCOURSON/LAYON Centre':'E4148'}
 new={'Frères Lumière':[-0.077578,47.238979],'Grange Couronne':[-0.069314,47.274387],
      'La Perrière':[-0.069167,47.199604],
      'Collège Pierre Mendès France':[-0.077201,47.246086],
      'Place de l’Europe - Eglise':[-0.069,47.212]}
 for filename,pages in tables.items():
  rawid=matches[filename]['routeId'];r=routes[rawid];code=r['route_short_name'].split('(')[0];code='L3' if code=='L3A' else code;rid='BUS Ogalo '+code;aliases=matches[filename]['labels'];aliases.update(fixed)
  if code=='L8':
   audit.append({'file':filename,'sha256':hashlib.sha256((SRC/filename).read_bytes()).hexdigest(),'excludedRegionalLine':'Rémi SO14; regional interurban coach lot deferred by scope'})
   continue
  kept=conditional=nonmonotonic=geometry_mismatch=implausible=0;filegroups=[];implausible_examples=[]
  for page in pages:
   blocks=[];block=[]
   for row in page['rows']:
    if block and row['label']==block[0]['label']:blocks.append(block);block=[]
    block.append(row)
   if block:blocks.append(block)
   for block in blocks:
    for column in page['columns']:
     course=[(row,row['values'][str(column)]) for row in block if str(column) in row['values']]
     if len(course)<2:continue
     if code in {'L2','L9'}:
      def norm(value):
       return re.sub(r'[^A-Z0-9]+',' ',unicodedata.normalize('NFKD',value).encode('ascii','ignore').decode().upper()).strip()
      candidates=sorted(set(aliases)|set(fixed)|set(new),key=len,reverse=True)
      cleaned=[]
      for row,value in course:
       label=row['label'];normal=norm(label)
       match=next((candidate for candidate in candidates if len(norm(candidate))>3 and norm(candidate) in normal),None)
       cleaned.append(({**row,'label':match} if match else row,value))
      course=cleaned
     # Keep only complete real courses. A label absent from the reviewed
     # current-to-GTFS matching table is not silently skipped mid-route.
     if any(row['label'] not in aliases and row['label'] not in fixed and row['label'] not in new for row,_ in course):continue
     if any(v['conditional'] for _,v in course):conditional+=1
     times=[int(v['time'][:2])*60+int(v['time'][3:]) for _,v in course]
     # Reject an inconsistent printed column rather than invent an order or times.
     if any(a>b for a,b in zip(times,times[1:])):nonmonotonic+=1;continue
     if times[0]<300 or times[0]>=1320:continue
     ss=[];town='';unknown=[]
     permissions=[]
     for row,v in course:
      label=row['label']
      if label.startswith('PARNAY '):town='PARNAY'
      elif label.startswith('DAMPIERRE '):town='DAMPIERRE'
      elif label.startswith('SOUZAY-CH. '):town='SOUZAY'
      if label in new:
       sid='OGALO:NEW:'+label;point=new[label];name=label;parent='';quality='official NeTEx 2025-09-26 F.LUMIERE' if label=='Frères Lumière' else 'IGN/BAN street location; approximate stop position'
      else:
       raw=fixed.get(label,aliases.get(label))
       if label=='Mairie' and code=='L1':
        # Include unserved printed rows when resolving the municipality.
        preceding=block[:block.index(row)+1];localtown=''
        for rr in preceding:
         for prefix in ['PARNAY','SOUZAY-CH.','DAMPIERRE','TURQUANT','FONTEVRAUD','MONTSOREAU']:
          if rr['label'].startswith(prefix+' '):localtown=prefix
        raw={'PARNAY':'E4480','SOUZAY-CH.':'E4739'}.get(localtown,'E4160')
       if label=='Eglise' and code=='L15':raw='E4472'
       if not raw:unknown.append(label);break
       s=stops[raw];parent=s.get('parent_station') or raw;s=stops.get(parent,s);sid='OGALO:'+parent;point=[float(s['stop_lon']),float(s['stop_lat'])];name=s['stop_name'];quality='historical official GTFS, stop identity checked against current PDF'
      out['stops'].setdefault(sid,{'name':name,'point':point,'parent':'','network':'ogalo','displayRoutes':[],'coordinateMethod':quality})
      if rid not in out['stops'][sid]['displayRoutes']:out['stops'][sid]['displayRoutes'].append(rid)
      ss.append(sid)
      permissions.append((not v['conditional'],not v['conditional']))
     if unknown:raise ValueError(f'Unresolved current regular stop in {filename}: {unknown}')
     if len(ss)!=len(times):continue
     dedup=[i for i in range(len(ss)) if i==0 or ss[i]!=ss[i-1] or times[i]!=times[i-1]]
     ss=[ss[i] for i in dedup];times=[times[i] for i in dedup];permissions=[permissions[i] for i in dedup]
     # Reject a whole PDF column if its printed times imply a physically
     # implausible bus speed. The extra minute allows for timetable rounding.
     too_fast=False
     for i in range(len(ss)-1):
      a=out['stops'][ss[i]]['point'];lat1=math.radians(a[1])
      for j in range(i+1,len(ss)):
       b=out['stops'][ss[j]]['point'];lat2=math.radians(b[1])
       dlat=lat2-lat1;dlon=math.radians(b[0]-a[0])
       h=math.sin(dlat/2)**2+math.cos(lat1)*math.cos(lat2)*math.sin(dlon/2)**2
       metres=12742000*math.asin(min(1,math.sqrt(h)))
       if metres/(times[j]-times[i]+1)*.06>100:
        too_fast=True
        if len(implausible_examples)<4:implausible_examples.append({'from':out['stops'][ss[i]]['name'],'to':out['stops'][ss[j]]['name'],'metres':round(metres),'minutes':times[j]-times[i]})
        break
      if too_fast:break
     if too_fast:implausible+=1;continue
     # Some current PDF columns are branches that the old line-wide shape
     # does not serve. Never attach those stops to a distant branch: retain
     # only complete profiles whose every stop lies on the displayed route.
     wanted={s.removeprefix('OGALO:') for s in ss}
     candidates=geometry_candidates[rawid]
     best=max(candidates,key=lambda sid:len(wanted&candidates[sid])/max(1,len(wanted))+len(wanted&candidates[sid])/max(1,len(candidates[sid])))
     geometry=source_shapes[best]
     def near(pt,shape):
      result=float('inf')
      for a,b in zip(shape,shape[1:]):
       dx=(b[0]-a[0])*75600;dy=(b[1]-a[1])*111200;den=dx*dx+dy*dy
       t=max(0,min(1,((pt[0]-a[0])*75600*dx+(pt[1]-a[1])*111200*dy)/den)) if den else 0
       result=min(result,((pt[0]-a[0])*75600-t*dx)**2+((pt[1]-a[1])*111200-t*dy)**2)
      return result**.5
     def cached_distance(key,point,shapes):
      if key not in shape_distance_cache:
       shape_distance_cache[key]=min(near(point,shape) for shape in shapes)
      return shape_distance_cache[key]
     road_override=SRC/'prepared/ogalo-road-shapes.json'
     if road_override.exists():
      roads=json.loads(road_override.read_text())
      if rid in roads['replacedRoutes']:
       route_shapes=[x['points'] for x in roads['shapes'] if x['routeId']==rid]
       if not route_shapes or any(cached_distance((rid,sid),out['stops'][sid]['point'],route_shapes)>100 for sid in ss):
        geometry_mismatch+=1
        continue
      else:
       if any(cached_distance((best,sid),out['stops'][sid]['point'],[geometry])>100 for sid in ss):
        geometry_mismatch+=1
        continue
     sequence=tuple(ss);permission=tuple(permissions);zero=times[0]
     rec={'train':rid,'tripId':f'PDF:{filename}:{page["page"]}:{block[0]["y"]}:{column}','arrivals':[t-zero for t in times],'departures':[t-zero for t in times],'requiresReservation':False,'sourcePdf':filename,'sourcePage':page['page']+1}
     groups[(rid,sequence,permission)].append(rec);kept+=1;departures[rid].append(zero)
     used_shapes[(rid,best)]=source_shapes[best]
  audit.append({'file':filename,'sha256':hashlib.sha256((SRC/filename).read_bytes()).hexdigest(),'retainedRegularColumns':kept,'coursesContainingConditionalCells':conditional,'excludedNonMonotonicColumns':nonmonotonic,'excludedOffShapeColumns':geometry_mismatch,'excludedImplausibleSpeedColumns':implausible,'implausibleExamples':implausible_examples,'policy':'retain complete regular PDF columns whose stops match the displayed road shape and timetable speed; conditional reservation cells are not boardable'})
  if kept:
   ds=sorted(set(departures[rid]));gaps=[b-a for a,b in zip(ds,ds[1:]) if b>a]
   out['routes'][rid]={'title':f'Ogalo {code} — {r["route_long_name"]}','network':'ogalo','networkName':'Ogalo','shortName':code,'color':'#'+r['route_color'],'waitMinutes':round(min(30,max(2,statistics.median(gaps)/2 if gaps else 30)),2),'waitMethod':'half-median-current-PDF-departure-gap-bounded-2-30','calculationAvailable':True,'excludedConditionalTrips':conditional,'geometryMethod':'historical official GTFS shapes matched to current regular courses'}
 out['patterns']=representative(groups)
 # A profile rejected above must not leave its unserved branch stops in the
 # route-level display metadata.
 used={sid for p in out['patterns'] for sid in p['stops']}
 out['stops']={sid:s for sid,s in out['stops'].items() if sid in used}
 for sid,stop in out['stops'].items():
  stop['displayRoutes']=[rid for rid in stop['displayRoutes'] if any(p['routeId']==rid and sid in p['stops'] for p in out['patterns'])]
 out['shapes']=[{'routeId':rid,'shapeId':'ogalo:'+sid,'points':pts} for (rid,sid),pts in used_shapes.items()]
 override=SRC/'prepared/ogalo-road-shapes.json'
 if override.exists():
  roads=json.loads(override.read_text())
  out['shapes']=[s for s in out['shapes'] if s['routeId'] not in roads['replacedRoutes']]+roads['shapes']
  for rid in roads['replacedRoutes']:out['routes'][rid]['geometryMethod']='OSM road reconstruction through current official course stops'
 # Small GTFS parent/quay offsets: retain official stop positions and align
 # the nearest display segment. Large deviations must have a reviewed road override.
 for sid,stop in out['stops'].items():
  point=stop['point']
  for rid in stop['displayRoutes']:
   best=None
   for shape in out['shapes']:
    if shape['routeId']!=rid:continue
    pp=shape['points']
    for i,(a,b) in enumerate(zip(pp,pp[1:])):
     dx=(b[0]-a[0])*75600;dy=(b[1]-a[1])*111200;den=dx*dx+dy*dy
     t=max(0,min(1,((point[0]-a[0])*75600*dx+(point[1]-a[1])*111200*dy)/den)) if den else 0
     gap=((point[0]-a[0])*75600-t*dx)**2+((point[1]-a[1])*111200-t*dy)**2
     if best is None or gap<best[0]:best=(gap,pp,i)
   if best is None or best[0]>100**2:raise ValueError(f'Current stop off displayed line: {rid} {sid}')
   if best[0]>0.01:best[1].insert(best[2]+1,point)
 out['routes']={rid:info for rid,info in out['routes'].items() if any(p['routeId']==rid for p in out['patterns'])}
 out['sources']=[{'id':'ogalo','name':'Ogalo','url':'https://ogalo-saumurvaldeloire.fr/ogalo-bus/fiches-horaires/','license':'ODbL GTFS; current official PDF schedules','referenceWeek':['2026-10-05','2026-10-11'],'currentPdfAudit':audit,'expiredGtfsPolicy':'coordinates and display geometry only; NO historical arrival/departure times or extended calendar'}]
 return out
if __name__=='__main__':
 out=prepare();(DATA/'ogalo_bus.json').write_text(json.dumps(out,ensure_ascii=False,separators=(',',':')));print(len(out['routes']),'routes',len(out['stops']),'stops',len(out['patterns']),'patterns')
