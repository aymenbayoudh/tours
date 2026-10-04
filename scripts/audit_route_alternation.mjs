// Offline diagnostic: representative graph, not a dated timetable planner.
import fs from 'node:fs';
import {buildTravelModel,describeJourney} from '../site/routing.mjs';
const data=JSON.parse(fs.readFileSync(new URL('../site/data/commute_map_data.json',import.meta.url)));
const all=data.stations.map((_,i)=>i),rail=all.filter(i=>data.stations[i].mode==='TER');
const report={graph:{stations:all.length,railStations:rail.length,patterns:data.timetablePatterns.length},structural:{sameLineHubEdges:0,redundantRailCatchEdges:0},phases:{},repeatedRoutes:{},continuousCandidates:{},byRoute:{},examples:[]};
for(let n=0;n<data.routeStates.length;n++)for(const e of data.adjacency[n]){
 const a=data.routeStates[n],b=data.routeStates[e[0]];
 if(a.role!=='alight'||b.role!=='board')continue;
 if(a.routeId===b.routeId)report.structural.sameLineHubEdges++;
 if(a.stationIndex===b.stationIndex&&Number.isInteger(a.pattern)&&Number.isInteger(b.pattern)){
  const p=data.timetablePatterns[a.pattern],q=data.timetablePatterns[b.pattern];
  const prev=p.stops[p.stops.indexOf(a.stationIndex)-1];
  if(prev!==undefined&&q.stops.slice(0,q.stops.indexOf(b.stationIndex)).includes(prev))report.structural.redundantRailCatchEdges++;
 }
}
function inspect(j,origin,target,factor,phase){
 const legs=j.legs,seen=new Map();
 for(let k=0;k<legs.length;k++){
  const l=legs[k],prior=seen.get(l.routeId);
  if(prior!==undefined){
   const key=data.routeInfo[l.routeId]?.mode||'unknown';
   report.repeatedRoutes[key]=(report.repeatedRoutes[key]||0)+1;
   const first=legs[prior];
   const p=data.timetablePatterns.find(p=>p.routeId===l.routeId&&p.stops.indexOf(first.from)>=0&&p.stops.indexOf(l.to)>p.stops.indexOf(first.from));
   if(p)report.continuousCandidates[key]=(report.continuousCandidates[key]||0)+1;
   const row=report.byRoute[l.routeId]||(report.byRoute[l.routeId]={returns:0,continuousCandidates:0}); row.returns++;if(p)row.continuousCandidates++;
   // Evidence, not an assertion of a feasible same-day departure.
   if(report.examples.length<30 || p&&report.examples.filter(e=>e.continuousCandidate).length<20 || !report.examples.some(e=>e.repeated===l.routeId)){
    report.examples.push({phase,origin:data.stations[origin].name,target:data.stations[target].name,factor,minutes:j.minutes,repeated:l.routeId,consecutive:prior===k-1,continuousCandidate:Boolean(p),referenceTrip:p?.tripId,legs:legs.map(l=>({route:l.routeId,from:data.stations[l.from].name,to:data.stations[l.to].name,pattern:l.pattern,minutes:l.minutes}))});
   }
  }else seen.set(l.routeId,k);
 }
}
const mode=process.argv[2]||'rail';
const representative=new Set();
for(const p of data.timetablePatterns)for(const i of [0,Math.floor(p.stops.length/2),p.stops.length-1])representative.add(p.stops[i]);
for(const state of data.routeStates)if(state.role==='departure'&&state.pattern===null)representative.add(state.stationIndex);
const sampled=[...representative];
if(!['rail','network','full'].includes(mode))throw Error('Use rail, network or full');
const networkPhase=['network',sampled,all,[0,1]];
const railPhase=['rail',rail,rail,[0,.5,1]];
const phases=mode==='network'?[networkPhase]:mode==='full'?[railPhase,networkPhase]:[railPhase];
for(const [phase,origins,targets,factors]of phases){
 let journeys=0;const start=Date.now();
 for(const factor of factors)for(let ix=0;ix<origins.length;ix++){
  const origin=origins[ix],m=buildTravelModel(data,data.stations[origin].point,true,{terWaitFactor:factor,busWaitFactor:factor,tramWaitFactor:factor,navetteWaitFactor:factor});
  for(const target of targets){inspect(describeJourney(data,m,data.stations[target].point),origin,target,factor,phase);journeys++;}
  if(ix%100===0)fs.writeFileSync(`/private/tmp/tours-alternation-progress-${mode}.json`,JSON.stringify({phase,factor,originsDone:ix+1,originsTotal:origins.length,journeys,elapsedSeconds:(Date.now()-start)/1000}));
 }
 report.phases[phase]={origins:origins.length,targets:targets.length,factors,journeys,seconds:(Date.now()-start)/1000};
}
console.log(JSON.stringify(report,null,2));
