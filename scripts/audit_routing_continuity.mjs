// Diagnostic only: samples journeys in straight-line access mode, not a departure-time planner.
import fs from 'node:fs';
import {buildTravelModel,describeJourney} from '../site/routing.mjs';
const d=JSON.parse(fs.readFileSync(new URL('../site/data/commute_map_data.json',import.meta.url)));
const counts={},edges=[];
d.adjacency.forEach((es,i)=>es.forEach(e=>{const a=d.routeStates[i],b=d.routeStates[e[0]];if(a.role==='alight'&&b.role==='board'&&a.routeId===b.routeId){const mode=d.routeInfo[a.routeId]?.mode||'unknown';counts[mode]=(counts[mode]||0)+1;if(edges.length<8&&mode!=='TER')edges.push({route:a.routeId,from:d.stations[a.stationIndex].name,to:d.stations[b.stationIndex].name,walk:e[2],comfort:e[3]});}}));
let withContinuousAlternative=0; const samples=[]; const sampleModes=new Set(); const repeatModes={}; let repeats=0,checks=0;
for(const origin of ['Tours','St-Pierre-des-Corps','La Bohalle','La Ménitré','Saumur','Fréteval-Morée','Gare de Tours','Liberté']){
 const s=d.stations.find(s=>s.name===origin);if(!s)continue;
 for(const factor of [0,1]){
  const m=buildTravelModel(d,s.point,true,{terWaitFactor:factor,busWaitFactor:factor,tramWaitFactor:factor,navetteWaitFactor:factor});
  for(const t of d.stations){const j=describeJourney(d,m,t.point);checks++;
   const repeat=j.legs.some((l,i)=>i&&j.legs[i-1].routeId===l.routeId);
   if(repeat){repeats++;const repeatLeg=j.legs.find((l,i)=>i&&j.legs[i-1].routeId===l.routeId); const previous=j.legs[j.legs.indexOf(repeatLeg)-1]; const continuous=d.timetablePatterns.some(p=>p.routeId===repeatLeg.routeId&&p.stops.indexOf(previous.from)>=0&&p.stops.indexOf(repeatLeg.to)>p.stops.indexOf(previous.from)); if(continuous)withContinuousAlternative++; const mode=d.routeInfo[repeatLeg.routeId]?.mode; repeatModes[mode]=(repeatModes[mode]||0)+1; if(!sampleModes.has(mode+continuous)){sampleModes.add(mode+continuous);samples.push({origin,to:t.name,continuousAlternative:continuous,waitFactor:factor,minutes:j.minutes,preference:j.preference,legs:j.legs.map(l=>({route:l.routeId,from:d.stations[l.from].name,to:d.stations[l.to].name,minutes:l.minutes}))});}}
  }
 }
}
console.log(JSON.stringify({counts,edgeExamples:edges,checks,repeats,withContinuousAlternative,repeatModes,samples},null,2));
