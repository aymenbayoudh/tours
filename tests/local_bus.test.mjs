import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import {performance} from 'node:perf_hooks';
import {WalkingNetwork} from '../site/walking.mjs';
import {buildTravelModel,describeJourney} from '../site/routing.mjs';
const read=p=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url)));
const data=read('../site/data/commute_map_data.json'), source=read('../data/tours/local_bus.json');
const additions=new Set(['ogalo','filrouge','loches','blere']);
let spans=0,maxOffset=0,forbidden=0;
const segmentDistance=(p,a,b)=>{const x=b[0]-a[0],y=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*x+(p[1]-a[1])*y)/(x*x+y*y)||0));return Math.hypot(p[0]-a[0]-t*x,p[1]-a[1]-t*y);};
for(const p of data.timetablePatterns.filter(p=>additions.has(data.routeInfo[p.routeId]?.network))){
 for(let i=0;i<p.stops.length;i++)for(let j=i+1;j<p.stops.length;j++){
  const a=data.stations[p.stops[i]].point,b=data.stations[p.stops[j]].point,minutes=p.arrivals[j]-p.departures[i];
  assert(minutes>=0);assert(Math.hypot(a[0]-b[0],a[1]-b[1])/(minutes+1)*.06<=100,`${p.routeId} ${i}-${j}`);spans++;
 }
}
for(const station of data.stations.filter(s=>s.displayRoutes.some(r=>additions.has(data.routeInfo[r]?.network)))){
 for(const id of station.displayRoutes.filter(r=>additions.has(data.routeInfo[r]?.network))){
  const shapes=data.routes.filter(r=>r.id===id);let offset=Infinity;
  for(const shape of shapes)for(let i=1;i<shape.points.length;i++)offset=Math.min(offset,segmentDistance(station.point,shape.points[i-1],shape.points[i]));
  maxOffset=Math.max(maxOffset,offset);assert(offset<2,`${station.id} off ${id}: ${offset}m`);
 }
}
for(let i=0;i<data.routeStates.length;i++){
 const a=data.routeStates[i];if(a.role!=='alight'||data.routeInfo[a.routeId]?.mode!=='BUS')continue;
 for(const edge of data.adjacency[i]){const b=data.routeStates[edge[0]];if(b.role==='board'&&a.routeId===b.routeId)forbidden++;}
}
assert.equal(forbidden,0);
const table=read('../data/tours/walking_transfers.json');assert.deepEqual(table.incrementalLocalBusPreparation.unsnappedStopIds,[]);
const stationById=new Map(data.stations.map(s=>[s.id,s]));const connections={};
for(const [a,b] of table.pairs){const aa=stationById.get(a),bb=stationById.get(b);if(!aa||!bb)continue;for(const [bus,rail] of [[aa,bb],[bb,aa]])if(rail.mode==='TER'||rail.mode==='NAVETTE')for(const r of bus.displayRoutes){const n=data.routeInfo[r]?.network;if(additions.has(n))connections[n]=(connections[n]||0)+1;}}
for(const n of additions)assert(connections[n]>0,`No bus→rail walking pair for ${n}`);
const binary=zlib.gunzipSync(fs.readFileSync(new URL('../site/data/point_walking.bin.gz',import.meta.url)));
data.walkingNetwork=new WalkingNetwork(binary.buffer.slice(binary.byteOffset,binary.byteOffset+binary.byteLength),()=>true);data.walkingNetwork.stationSnaps(data.stations);
const settings={busWaitFactor:0,busEntryPenalty:0,busExitPenalty:0};const examples=[];let maxModelMs=0;
for(const n of additions){
 let found=false;
 for(const pattern of data.timetablePatterns.filter(p=>data.routeInfo[p.routeId]?.network===n)){
  const origin=data.stations[pattern.stops[0]].point,start=performance.now(),model=buildTravelModel(data,origin,true,settings);maxModelMs=Math.max(maxModelMs,performance.now()-start);
  for(const index of pattern.stops.slice(1)){
   const destination=data.stations[index].point,journey=describeJourney(data,model,destination);
   if(!journey.legs.some(l=>data.routeInfo[l.routeId]?.network===n))continue;
   const off=describeJourney(data,buildTravelModel(data,origin,true,{...settings,disabledBusNetworks:[n]}),destination);
   assert(!off.legs.some(l=>data.routeInfo[l.routeId]?.network===n));assert(off.minutes>=journey.minutes-1e-7);
   examples.push({network:n,from:data.stations[pattern.stops[0]].name,to:data.stations[index].name,minutes:journey.minutes,disabledMinutes:off.minutes});found=true;break;
  }
  if(found)break;
 }
 assert(found,`Network never used: ${n}`);
}
console.log(JSON.stringify({routes:Object.keys(source.routes).length,localStops:Object.keys(source.stops).length,checkedSpans:spans,maxDisplayOffsetMetres:maxOffset,forbiddenSameBusTransfers:forbidden,railConnections:connections,maxModelMs,examples},null,2));
