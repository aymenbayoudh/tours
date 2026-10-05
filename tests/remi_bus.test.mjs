import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildTravelModel, describeJourney} from '../site/routing.mjs';
const read=p=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url)));
const d=read('../site/data/commute_map_data.json'), source=read('../data/tours/remi_bus.json');
assert.equal(Object.keys(source.routes).length,27);
for(const code of ['TB','TH']) assert(Object.values(source.routes).some(r=>r.shortName===code));
let intervals=0, railPairs=0, busPairs=0;
const byId=new Map(d.stations.map((s,i)=>[s.id,i]));
for(const p of source.patterns){
 assert.equal(p.stops.length,p.arrivals.length);
 assert.equal(p.stops.length,p.departures.length);
 assert(p.sampleCount>0);
 for(let i=0;i<p.stops.length;i++){
  assert(byId.has(p.stops[i]));assert(p.arrivals[i]<=p.departures[i]);
  if(i){assert(p.arrivals[i]>=p.departures[i-1]);intervals++;}
 }
}
const table=read('../data/tours/walking_transfers.json');
const pairs=[...table.pairs,...table.manualPairs];
for(const id of ['REMI:REMI37:Quay:1130','REMI:REMI37:Quay:4822','REMI:REMI37:Quay:10113']) assert(pairs.some(p=>p.includes(id)&&p.some(v=>typeof v==='string'&&v.startsWith('SNCF:'))));
for(const [a,b,m] of pairs){
 const i=byId.get(a),j=byId.get(b);if(i===undefined||j===undefined)continue;
 const sa=d.stations[i],sb=d.stations[j];
 const remi=sa.id.startsWith('REMI:')?sa:sb.id.startsWith('REMI:')?sb:null;
 if(!remi)continue;
 const other=remi===sa?sb:sa;
 assert(m>=Math.hypot(sa.point[0]-sb.point[0],sa.point[1]-sb.point[1])-.2);
 if(other.mode==='TER'||other.mode==='NAVETTE')railPairs++;
 if(other.mode==='BUS'&&!other.id.startsWith('REMI:'))busPairs++;
}
assert(railPairs>0);assert(busPairs>0);
let railEdges=0, localEdges=0;
for(let i=0;i<d.routeStates.length;i++){
 const a=d.routeStates[i];
 if(a.role!=='alight'||d.routeInfo[a.routeId]?.network!=='remi')continue;
 for(const edge of d.adjacency[i]){
  const b=d.routeStates[edge[0]],info=d.routeInfo[b.routeId];
  if(b.role!=='board')continue;
  assert.notEqual(a.routeId,b.routeId,'No same-line reboarding');
  if(info?.mode==='TER'||info?.mode==='NAVETTE')railEdges++;
  if(info?.mode==='BUS'&&info.network!=='remi')localEdges++;
 }
}
assert(railEdges>0);assert(localEdges>0);
for(const p of d.timetablePatterns.filter(p=>d.routeInfo[p.routeId]?.network==='remi')){
 assert(p.stops.every(i=>d.stations[i].mode==='BUS'));
}
// Real, full scheduled coach leg, and network disable controls the calculation.
const p=d.timetablePatterns.find(p=>p.routeId==='BUS Cars Rémi 800'&&p.stops.length>10);
assert(p);
const from=d.stations[p.stops[0]].point,to=d.stations[p.stops.at(-1)].point;
const settings={busWaitFactor:0,busEntryPenalty:0,busExitPenalty:0};
const start=performance.now();
const journey=describeJourney(d,buildTravelModel(d,from,true,settings),to);
assert(journey.legs.some(l=>d.routeInfo[l.routeId]?.network==='remi'));
const off=describeJourney(d,buildTravelModel(d,from,true,{...settings,disabledBusNetworks:['remi']}),to);
assert(!off.legs.some(l=>d.routeInfo[l.routeId]?.network==='remi'));
console.log(JSON.stringify({routes:27,stops:Object.keys(source.stops).length,intervals,railPairs,busPairs,railEdges,localEdges,example:journey.legs,modelsMs:performance.now()-start}));
