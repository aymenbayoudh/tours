import pathlib,json,gzip,hashlib,xml.etree.ElementTree as ET,heapq,math,sys,os
# Optional rebuild from public OSM extracts; the reviewed output is versioned.
OSM_DIR=pathlib.Path(os.environ.get('TOURS_OSM_DIR','/private/tmp'))
ROOT=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
from prepare_filbleu_bus import simplify
SRC=ROOT/'data/tours/local-networks-2026-10-04';out={'sources':[],'stops':{},'routes':{},'patterns':[],'shapes':[]};audit=[]
def metres(a,b):return math.hypot((a[0]-b[0])*75600,(a[1]-b[1])*111200)
def roads(name):
 cache=SRC/'prepared'/('display-roads-'+name+'.json.gz')
 if cache.exists():
  record=json.loads(gzip.decompress(cache.read_bytes()));return record['nodes'],record['adj'],set(record['active'])
 nodes={};ways={}
 files=list(OSM_DIR.glob(name+'??-osm.xml')) if name!='chateau-renault' else [OSM_DIR/'chateau-renault-osm.xml']
 for f in files:
  r=ET.parse(f).getroot();nodes.update({n.get('id'):[float(n.get('lon')),float(n.get('lat'))] for n in r.findall('node')})
  for w in r.findall('way'):
   t={a.get('k'):a.get('v') for a in w.findall('tag')}
   if t.get('highway') in ['primary','primary_link','secondary','secondary_link','tertiary','tertiary_link','residential','living_street','unclassified','service','trunk','trunk_link'] and t.get('access')!='private':ways[w.get('id')]=(t,[a.get('ref') for a in w.findall('nd')])
 adj={}
 for t,nn in ways.values():
  for a,b in zip(nn,nn[1:]):
   if a not in nodes or b not in nodes:continue
   l=metres(nodes[a],nodes[b]);ow=t.get('oneway');roundabout=t.get('junction')=='roundabout'
   if ow!='-1':adj.setdefault(a,[]).append((b,l))
   if ow not in ['yes','1','true'] and not roundabout:adj.setdefault(b,[]).append((a,l))
 active=set(adj)|{n for es in adj.values() for n,_ in es}
 nodes={n:nodes[n] for n in active}
 record={'nodes':nodes,'adj':adj,'active':sorted(active),'license':'© OpenStreetMap contributors, ODbL','files':[{'name':f.name,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in files]}
 cache.write_bytes(gzip.compress(json.dumps(record,separators=(',',':')).encode(),mtime=0))
 return nodes,adj,active

def course(network,label,short,stop_data,order,offsets,start,wait,color,road_name):
 rid='BUS '+label+' '+short;nodes,adj,active=graphs[road_name]
 for key,(name,point,method) in stop_data.items():
  sid=network.upper()+':'+key
  out['stops'].setdefault(sid,{'name':name,'point':point,'parent':'','network':network,'displayRoutes':[],'coordinateMethod':method})
  if rid not in out['stops'][sid]['displayRoutes']:out['stops'][sid]['displayRoutes'].append(rid)
 ss=[network.upper()+':'+key for key in order]
 out['routes'][rid]={'title':label+' '+short,'network':network,'networkName':label,'shortName':short,'color':color,'waitMinutes':wait,'waitMethod':'current official PDF/image departure intervals, bounded at 30 minutes','calculationAvailable':True,'geometryMethod':'display route reconstructed on OSM motor-vehicle roads between documented stop locations; not an official operator trace'}
 out['patterns'].append({'routeId':rid,'stops':ss,'pickup':[True]*len(ss),'dropoff':[True]*len(ss),'train':rid,'tripId':network+':official:'+start,'arrivals':offsets,'departures':offsets,'sampleCount':1,'requiresReservation':False})
 # Split each road segment at the projected stop. This retains one-way rules
 # and makes the displayed path pass exactly through every prepared stop.
 snapids=[]
 for sid in ss:
  if sid in projected[road_name]:snapids.append(projected[road_name][sid]);continue
  original=out['stops'][sid]['point']
  candidates=[]
  for a,es in list(adj.items()):
   for b,l in list(es):
    pa,pb=nodes[a],nodes[b];dx=(pb[0]-pa[0])*75600;dy=(pb[1]-pa[1])*111200
    den=dx*dx+dy*dy
    t=max(0,min(1,(((original[0]-pa[0])*75600)*dx+((original[1]-pa[1])*111200)*dy)/den)) if den else 0
    point=[pa[k]+t*(pb[k]-pa[k]) for k in (0,1)]
    candidates.append((metres(original,point),a,b,point))
  distance,a,b,point=min(candidates)
  n='STOP:'+sid;nodes[n]=point;adj[n]=[]
  # Keep the original edge and add equivalent splits; several stops can lie on it.
  for u,v in [(a,b),(b,a)]:
   if any(w==v for w,_ in adj.get(u,[])):
    adj[u]=[(w,l) for w,l in adj[u] if w!=v]
    adj[u].append((n,metres(nodes[u],point)));adj[n].append((v,metres(point,nodes[v])))
  projected[road_name][sid]=n;out['stops'][sid]['point']=point;snapids.append(n)
  audit.append({'stop':sid,'originalPoint':original,'point':point,'displayRoadProjectionMetres':round(distance,1)})
 path=[]
 for a,b in zip(snapids,snapids[1:]):
  costs={a:0};prev={};q=[(0,a)]
  while q:
   d,n=heapq.heappop(q)
   if d!=costs[n]:continue
   if n==b:break
   for v,l in adj.get(n,[]):
    nd=d+l
    if nd<costs.get(v,math.inf):costs[v]=nd;prev[v]=n;heapq.heappush(q,(nd,v))
  if b not in costs:raise ValueError(f'Disconnected display road path {rid}: {a} → {b}')
  ns=[b]
  while ns[-1]!=a:ns.append(prev[ns[-1]])
  pp=[nodes[n] for n in reversed(ns)]
  # Simplify legs separately so no stop vertex is removed.
  pp=simplify(pp);path+=pp if not path else pp[1:]
 out['shapes'].append({'routeId':rid,'shapeId':network+':'+short+':'+start,'points':path})

street='Location digitised from official named place/plan and IGN/BAN address; approximate stop, not surveyed pole'
osm='OSM bus stop corresponding to official stop name'
graphs={name:roads(name) for name in ['loches','blere','chateau-renault','saumurzi','saumur']}
projected={name:{} for name in graphs}
# Loches: actual one-vehicle course traverses loop 1 then loop 2; boundary times match in all five columns.
ls={
 'gare':('Gare de Loches',[1.0001887,47.1302381],osm),
 'verdun':('Place Verdun',[0.994764,47.128736],street),
 'chauvellerie':('Rue de la Chauvellerie',[0.9887,47.13105],street),
 'superu':('Super U',[0.98149,47.13529],street),
 'saucier':('Rond-point du Pré Saucier',[0.988036,47.136065],street),
 'miroiterie':('Miroiterie Tourangelle',[0.992988,47.138593],street),
 'pompiers':('Caserne de pompiers',[1.0010,47.1386048],street),
 'stjacques':('Saint-Jacques',[0.9996,47.13717],street),
 'mairie':('Mairie de Beaulieu',[1.0124996,47.1281164],street),
 'aquilon':('Centre Aquilon',[1.007516,47.129282],street),
 'hopital':('Hôpital',[1.0025043,47.1288188],osm),
 'associations':('Maison des associations',[1.002056,47.122244],street),
 'confiserie':('Confiserie Hallard',[1.002343,47.116332],street),
 'leclerc':('E. Leclerc',[1.00578,47.10923],street),
 'natureo':('Naturéo',[0.9838573,47.1223917],street),
 'puygibault':('Puygibault',[0.9766674,47.1167986],street),
 'basclos':('Bas-Clos',[0.988832,47.122207],street),
 'cite':('Cité scolaire',[0.9814578,47.1272472],osm),
 'social':('Pôle social',[0.991114,47.126725],street)}
l1=['gare','verdun','chauvellerie','superu','saucier','miroiterie','pompiers','stjacques','gare'];l2=['mairie','aquilon','hopital','associations','confiserie','leclerc','natureo','puygibault','basclos','cite','social','gare']
course('loches','Le Lien Loches','1/2',ls,l1+l2,[0,4,7,9,11,13,17,20,25]+[30,33,35,40,43,46,52,55,60,64,68,72],'08:09',30,'#249b83','loches')
out['sources'].append({'id':'loches','name':'Le Lien Loches','url':'https://www.ville-loches.fr/stationnement-et-transport-article-2-6-17.html','timetableFiles':['loches-horaires-boucle1.png','loches-horaires-boucle2.png'],'days':'Monday–Friday, without reservation','referenceWeek':['2026-10-05','2026-10-11'],'coursePolicy':'five full 72-minute courses combining loop 1 (25 min) and immediately following loop 2 (47 min), as published; stop coordinates approximate except existing mapped bus stops'})
bs={
 'gare':('Gare de Bléré–La Croix',[0.9878877,47.337601],osm),
 'quai':('Quai Bellevue',[0.9900269,47.3302062],osm),
 'piscine':('Piscine',[0.99502,47.3268095],osm),
 'ehpad':('EHPAD L’Auverdière',[0.99578,47.319401],street),
 'emergence':('ZA Saint-Julien — BVC Émergence',[1.017608,47.324567],street),
 'nobel1':('ZA Bois Pataud 1 — Rue Alfred Nobel',[1.01724,47.32354],street),
 'nobel2':('ZA Bois Pataud 2 — Rue Alfred Nobel',[1.0231495,47.323037],street),
 'gendarmerie':('Gendarmerie–Gymnase–Collège',[0.9913316,47.3171975],street),
 'gaulpied':('ZA Sublaines Bois Gaulpied — Rue Gérard Cordier',[0.985849,47.291013],street),
 'covoiturage':('Aire de covoiturage A85',[0.988306,47.286574],street)}
order=list(bs)
course('blere','Le Lien Bléré','Navette',bs,order,[0,4,7,9,15,17,20,26,34,37],'07:20',30,'#7bb52d','blere')
course('blere','Le Lien Bléré','Navette',bs,order[::-1],[0,3,11,17,20,22,28,30,33,40],'15:45',30,'#7bb52d','blere')
out['sources'].append({'id':'blere','name':'Le Lien Bléré','url':'https://www.cc-autourdechenonceaux.fr/actualites/navette-le-lien/','timetableFiles':['blere-horaires.png'],'days':'Monday–Friday, without reservation','referenceWeek':['2026-10-05','2026-10-11'],'coursePolicy':'three forward courses with identical offsets and actual first reverse 40-minute course; no stitching with second reverse 37-minute course','coordinatePolicy':'approximate named place/address positions where no official stop GIS is published'})
# Fil Rouge current annual Tuesday morning columns; do not activate the future 2 November sheet.
fs={};pointcache=SRC/'prepared/filrouge-osm-stop-points.json'
if pointcache.exists():points=json.loads(pointcache.read_text())
else:
 r=ET.parse(OSM_DIR/'chateau-renault-osm.xml').getroot();points={}
 for n in r.findall('node'):
  t={a.get('k'):a.get('v') for a in n.findall('tag')}
  if t.get('highway')=='bus_stop' and t.get('name'):points[t['name']]=[float(n.get('lon')),float(n.get('lat'))]
 pointcache.write_text(json.dumps(points,ensure_ascii=False))
fm={'saint':('Saint-Exupéry','ELAn Coluche'),'ruau':('Ruau','Ruau'),'zola':('Émile Zola','Émile Zola'),'gendarmerie':('Gendarmerie','Gendarmerie'),'8mai':('8 Mai','8 Mai'),'stade':('Stade J. Renard','Champ de Foire'),'jaurès':('Jean Jaurès','Château-Renault − Place Jean Jaurès'),'hugo':('Victor Hugo','Victor Hugo'),'joran':('Joran (Saint-Malo)','Saint-Malo'),'hopital':('Hôpital','Château-Renault − Hôpital'),'delamotte':('Delamotte','Delamotte'),'beauregard':('Beauregard','Beauregard'),'michelet':('Michelet','Michelet'),'tannerie':('Tannerie','La Tannerie'),'cc':('Communauté de communes','Communauté de Communes'),'maine':('Le Maine','Le Maine'),'boulevard':('Boulevard National','Château-Renault − Gare SNCF - Boulevard National'),'gare':('Gare','Château-Renault − Gare SNCF - Cour de la Gare'),'commerce':('Centre commercial','Centre Commercial'),'bizet':('Georges Bizet','Georges Bizet'),'curie':('Marie Curie','Marie Curie'),'belair':('Bel-Air','Bel-Air'),'fosse':('Fosse Monette','Fosse Monette'),'boisniere':('Boisnière','Boisnière'),'foulerie':('Foulerie','Foulerie'),'mairie':('Mairie–Le Château','Mairie-Le Château'),'gaulle':('Général de Gaulle','Général de Gaulle'),'colette':('Colette','Colette')}
for k,(label,name) in fm.items():fs[k]=(label,points[name],osm+'; identity cross-checked with current municipal map')
fwd=['saint','ruau','zola','gendarmerie','8mai','stade','jaurès','hugo','joran','hopital','delamotte','beauregard','michelet','tannerie','cc','maine','boulevard','gare','commerce','bizet','curie','belair']
course('filrouge','Fil Rouge','Navette',fs,fwd,[0,3,4,5,6,9,11,13,14,15,16,17,19,21,23,24,25,26,27,31,32,33],'10:00',30,'#d02e50','chateau-renault')
rev=['belair','curie','bizet','fosse','boisniere','commerce','boulevard','maine','cc','tannerie','foulerie','beauregard','delamotte','hopital','joran','hugo','jaurès','mairie','gaulle','stade','8mai','colette','ruau','saint']
course('filrouge','Fil Rouge','Navette',fs,rev,[0,1,2,5,6,9,10,11,12,14,16,17,18,19,20,21,23,25,26,27,31,33,34,37],'09:20',30,'#d02e50','chateau-renault')

for k,label in [('petit','Petit Versailles'),('malraux','Malraux-Mandela')]:
 fs[k]=(label,{'petit':[0.897302,47.590097],'malraux':[0.905824,47.58855]}[k],street)
course('filrouge','Fil Rouge','Navette',fs,['saint','ruau','zola','gendarmerie','8mai','stade','jaurès','hugo','joran','hopital','delamotte','beauregard','michelet','tannerie','belair'],[0,3,4,5,6,8,10,12,13,14,15,16,18,20,24],'07:50',30,'#d02e50','chateau-renault')
course('filrouge','Fil Rouge','Navette',fs,['saint','ruau','zola','gendarmerie','8mai','stade','jaurès','hugo','joran','hopital','delamotte','beauregard','malraux','belair'],[0,3,4,5,6,8,10,12,13,14,15,16,19,25],'16:20',30,'#d02e50','chateau-renault')
course('filrouge','Fil Rouge','Navette',fs,['belair','curie','bizet','petit','commerce','malraux','maine','tannerie','jaurès','ruau','saint'],[0,1,2,4,6,8,10,12,15,19,24],'08:14',30,'#d02e50','chateau-renault')
course('filrouge','Fil Rouge','Navette',fs,['belair','curie','bizet','petit','commerce','boulevard','beauregard','delamotte','hopital','joran','hugo','jaurès','stade','8mai','colette','ruau','saint'],[0,1,2,4,6,7,9,10,11,12,13,15,17,19,21,22,25],'16:45',30,'#d02e50','chateau-renault')

out['sources'].append({'id':'filrouge','name':'Fil Rouge','url':'https://www.ville-chateau-renault.fr/mon-quotidien/se-deplacer/bus-urbain-municipal/','timetableFiles':['fil-rouge-actuel.pdf'],'effectiveUntil':'2026-10-30','referenceWeek':['2026-10-05','2026-10-11'],'coursePolicy':'ordinary public weekday courses in term time and annual Tuesday morning courses; not restricted school services. Untimed on-request stops are not assigned invented times. Future 2026-11-02 timetable kept separately.'})

# Clos Bonnet–Chacé: regular weekday industrial service (not a school shuttle).
zstop={
'gare':('Gare de Saumur',[-0.07167,47.26918],street),
'ponts':('Les Ponts',[-0.07465,47.26379],street),
'portail':('CV Portail Louis',[-0.07621,47.25605],street),
'orleans':('CV Orléans',[-0.07694,47.25738],street),
'balzac':('Pôle Balzac',[-0.07338,47.24904],street),
'bonnet':('ZI Clos Bonnet',[-0.070164,47.241066],street),
'moulin':('ZI Bd Jean Moulin',[-0.070046,47.23808],street),
'poirier':('ZI Carrefour Poirier',[-0.054501,47.207922],street),
'weiss':('ZI Dr Weiss',[-0.058877,47.209299],street),
'champigny':('ZI Route de Champigny',[-0.066701,47.214118],street),
'lisiere':('La Lisière',[-0.070572, 47.209391],street),
'vignes':('Les Vignes',[-0.06947,47.204447],street),
'perriere':('La Perrière',[-0.070857,47.199563],street)}
# Join both adjoining extracts to ensure connectivity across the boundary.
n1,a1,v1=graphs['saumur'];n2,a2,v2=graphs['saumurzi'];n2.update(n1)
for n,edges in a1.items():a2.setdefault(n,[]).extend(edges)
v2.update(v1)
# Use official parent-stop locations for shared Saumur stops.
import zipfile,csv,io
with zipfile.ZipFile(SRC/'ogalo.zip') as z:
 zs={r['stop_id']:r for r in csv.DictReader(io.TextIOWrapper(z.open('stops.txt'),encoding='utf-8-sig'))}
 for key,needle in [('gare','GARE SNCF'),('ponts','LES PONTS'),('portail','CV PORTAIL LOUIS'),('orleans','ORLEANS'),('balzac','POLE BALZAC')]:
  found=[r for r in zs.values() if needle in r['stop_name'].upper()]
  if found:
   r=found[0];r=zs.get(r.get('parent_station'),r);zstop[key]=(zstop[key][0],[float(r['stop_lon']),float(r['stop_lat'])],osm)
 zstop['balzac']=('Pôle Balzac',[-0.080112,47.251698],osm)
 zstop['portail']=('CV Portail Louis',[-0.078504,47.259243],osm)
 zstop['ponts']=('Les Ponts',[-0.072848,47.264591],osm)
f=['gare','ponts','portail','balzac','bonnet','moulin','poirier','weiss','champigny','lisiere','vignes','perriere']
course('ogalozi','Ogalo','ZI Clos Bonnet',zstop,f,[0,2,5,9,13,14,20,21,22,24,26,28],'07:45',30,'#9872ac','saumurzi')
f=['perriere','vignes','lisiere','champigny','poirier','weiss','moulin','bonnet','balzac','orleans','ponts','gare']
course('ogalozi','Ogalo','ZI Clos Bonnet',zstop,f,[0,2,4,6,12,13,19,20,24,28,29,34],'16:30',30,'#9872ac','saumurzi')
# One Ogalo network switch, namespaced stop IDs still avoid collisions.
for r in out['routes'].values():
 if r['network']=='ogalozi':r['network']='ogalo';r['networkName']='Ogalo'
out['sources'].append({'id':'ogalozi','name':'Ogalo ZI Clos Bonnet–Chacé','url':'https://ogalo-saumurvaldeloire.fr/fiches_horaires/horaires-des-navettes-zones-industrielles/','timetableFiles':['1-NAVETTES-Ogalo-ZI-CLOS-BONNET-CHACE_2024.pdf'],'referenceWeek':['2026-10-05','2026-10-11'],'coursePolicy':'two weekday departures per direction, whole actual 28- and 34-minute representative courses'})

(SRC/'prepared/local-shuttles.json').write_text(json.dumps(out,ensure_ascii=False,indent=2));(SRC/'prepared/local-shuttles-position-audit.json').write_text(json.dumps(audit,indent=2));print(len(out['routes']),'routes',len(out['stops']),'stops',len(out['patterns']),'patterns',len(out['shapes']),'shapes')
