import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { buildTravelModel, estimateTravel, describeJourney, reachability } from '../site/routing.mjs';
const d=JSON.parse(fs.readFileSync(new URL('../site/data/commute_map_data.json',import.meta.url)));
let checks=0;
const check=(condition,message)=>{assert.ok(condition,message);checks++;};
let intervals=0;
for(const p of d.timetablePatterns){
  for(let i=0;i<p.stops.length-1;i++){
    let minutes=0;
    for(let j=i+1;j<p.stops.length;j++){
      const edge=d.adjacency[p.departureNodes[j-1]].find(([n])=>n===p.arrivalNodes[j]);
      check(Boolean(edge),'Missing service segment'); minutes+=edge[1];
      check(Math.abs(minutes-(p.arrivals[j]-p.departures[i]))<.003,'Schedule interval mismatch'); intervals++;
      const dwell=d.adjacency[p.arrivalNodes[j]].find(([n])=>n===p.departureNodes[j]);minutes+=dwell[1];
    }
  }
}
for(const edges of d.adjacency)for(const [n,cost] of edges)check(n>=0&&n<d.routeStates.length&&Number.isFinite(cost)&&cost>=0,'Invalid edge');
let sameCodeChanges=0,crossMode=0;
for(let i=0;i<d.stations.length;i++)for(const a of d.stationStates[i])for(const b of d.boardingStates[i]){
  const x=d.routeStates[a],y=d.routeStates[b];
  if(x.pattern!==null&&x.pattern===y.pattern)continue;
  check(d.adjacency[a].some(([n])=>n===b),'Missing transfer at station');
  if(x.routeId===y.routeId&&x.pattern!==y.pattern)sameCodeChanges++;
}
for(let i=0;i<d.stations.length;i++)for(let j=i+1;j<d.stations.length;j++){
  if(Math.hypot(...d.stations[i].point.map((x,k)=>x-d.stations[j].point[k]))>650)continue;
  for(const a of d.stationStates[i])for(const b of d.boardingStates[j])check(d.adjacency[a].some(([n])=>n===b),'Missing nearby transfer');
  if(d.stations[i].mode!==d.stations[j].mode)crossMode++;
}
const station=(name,route)=>{const s=d.stations.find(s=>s.name===name&&(!route||s.routes.includes(route)));assert.ok(s,`Missing station ${name}`);return s;};
const names=['Tours','Blois-Chambord','Orléans','Paris-Austerlitz','Le Mans','Saumur','Rotière','Jean Jaurès'];
const examples=[];const start=performance.now();let maxModel=0;
for(const name of names){
  const source=station(name);const t=performance.now();const model=buildTravelModel(d,source.point,true);maxModel=Math.max(maxModel,performance.now()-t);
  const noProjects=buildTravelModel(d,source.point,false);
  d.routeStates.forEach((s,i)=>{if(d.routeInfo[s.routeId].planned)check(!Number.isFinite(noProjects.distances[i]),'Disabled project reachable');});
  let previous=0;
  for(const threshold of [15,30,45,60,90,120,180]){const r=reachability(d,model,threshold);check(r.reachable>=previous,'Nonmonotonic reachability');previous=r.reachable;}
  for(const target of d.stations){
    const v=estimateTravel(d,model,target.point),no=estimateTravel(d,noProjects,target.point);check(Number.isFinite(v)&&v>=0,'Invalid travel');check(no+1e-6>=v,'Removing projects improves time');
    const journey=describeJourney(d,model,target.point);
    check(Math.abs(journey.minutes-journey.walking-journey.waiting-journey.legs.reduce((n,l)=>n+l.minutes,0))<1e-5,'Journey breakdown mismatch');
  }
  if(name==='Tours'||name==='Rotière')for(const target of (name==='Tours'?['Blois-Chambord','Orléans','Le Mans','Paris-Austerlitz']:['Jean Jaurès'])){
    const result=describeJourney(d,model,station(target).point);examples.push({from:name,to:target,minutes:+result.minutes.toFixed(2),walking:+result.walking.toFixed(2),waiting:+result.waiting.toFixed(2),legs:result.legs.map(l=>({route:l.routeId,from:d.stations[l.from].name,to:d.stations[l.to].name,minutes:+l.minutes.toFixed(2)}))});
  }
}
const model=buildTravelModel(d,station('Tours').point);const gridStart=performance.now();for(const c of d.cells)estimateTravel(d,model,c.point);const gridMs=performance.now()-gridStart;
// Independent O(V²) shortest-path oracle. Recompute the current transfer/wait
// semantics here instead of trusting the stored transfer costs.
const reference=Array(d.routeStates.length).fill(Infinity),visited=Array(d.routeStates.length).fill(false);
const src=station('Tours').point;
const refWalk=d.meta.walkMetersPerMinute||80;
const refEntry=d.meta.stationAccessPenalty??1.8;
const refRouteMode=(routeId)=>d.routeInfo?.[routeId]?.mode||(routeId==='NAVETTE'?'NAVETTE':routeId?.startsWith('TRAM')?'TRAM':routeId?.startsWith('BHNS')?'BHNS':'TER');
const refWait=(routeId)=>({NAVETTE:5,TRAM:4,BHNS:3.25,TER:15})[refRouteMode(routeId)]??15;
const refAllowed=d.routeStates.map(s=>d.routeInfo?.[s.routeId]?.serviceStatus?.status!=='suspended');
const refEdgeCost=(fromNode,toNode,storedCost)=>{
  const a=d.routeStates[fromNode],b=d.routeStates[toNode];
  if(!a||!b)return storedCost;
  if(a.role==='departure'&&b.role==='arrival'&&a.routeId===b.routeId&&a.stationIndex!==b.stationIndex)return storedCost;
  if(a.role==='arrival'&&b.role==='departure'){
    const sameStation=a.stationIndex===b.stationIndex;
    const samePattern=a.pattern!==null&&a.pattern===b.pattern;
    const fallbackStayAboard=a.routeId===b.routeId&&a.pattern===null&&b.pattern===null&&storedCost===0;
    if(sameStation&&(samePattern||fallbackStayAboard))return storedCost;
    const wait=refWait(b.routeId);
    if(sameStation)return 3.5+wait;
    const aPoint=d.stations[a.stationIndex].point,bPoint=d.stations[b.stationIndex].point;
    return Math.hypot(aPoint[0]-bPoint[0],aPoint[1]-bPoint[1])/refWalk+2+wait;
  }
  return storedCost;
};
d.stations.forEach((s,i)=>{for(const n of d.boardingStates[i])if(refAllowed[n])reference[n]=Math.hypot(s.point[0]-src[0],s.point[1]-src[1])/refWalk+refEntry+refWait(d.routeStates[n].routeId);});
for(let k=0;k<reference.length;k++){
  let node=-1,value=Infinity;
  for(let n=0;n<reference.length;n++)if(!visited[n]&&reference[n]<value){value=reference[n];node=n;}
  if(node<0)break;visited[node]=true;
  for(const [next,cost] of d.adjacency[node])if(refAllowed[next])reference[next]=Math.min(reference[next],value+refEdgeCost(node,next,cost));
}
// 0.001 minute = 0.06 s: enough for coordinate-rounding noise, far below any user-facing precision.
reference.forEach((v,n)=>check(v===model.distances[n]||Math.abs(v-model.distances[n])<1e-3,'Heap/shortest-path oracle mismatch'));
for(const [n,state] of d.routeStates.entries())if(state.routeId==='TER P21')check(!Number.isFinite(model.distances[n]),'Suspended P21 must not be routable');
const output={checks,patterns:d.timetablePatterns.length,intervals,sameCodeChanges,crossModeNearbyPairs:crossMode,stations:d.stations.length,noBoarding:d.stations.filter((s,i)=>!d.boardingStates[i].length).map(s=>s.name),tramMaxDisplayOffsetMetres:Math.max(...d.stations.filter(s=>s.mode==='TRAM'&&!s.planned).map(s=>s.displayOffset)),maxModelMs:+maxModel.toFixed(1),gridCells:d.cells.length,gridMs:+gridMs.toFixed(1),suiteMs:+(performance.now()-start).toFixed(1),examples};
console.log(JSON.stringify(output,null,2));
