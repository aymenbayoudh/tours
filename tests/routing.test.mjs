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
const busPatterns=d.timetablePatterns.filter(p=>d.routeInfo?.[p.routeId]?.mode==='BUS');
check(busPatterns.length>=1,'No Fil Bleu bus pattern');
const busRoutes=Object.entries(d.routeInfo).filter(([,info])=>info.mode==='BUS');
check(busRoutes.length>=1,'No Fil Bleu bus route');
for(const [routeId,info] of busRoutes){
  check(Number.isFinite(info.waitMinutes)&&info.waitMinutes>=2&&info.waitMinutes<=30,`Invalid bus wait ${routeId}`);
}
const parentGroups=new Map();
d.stations.forEach((station,index)=>{
  if(station.mode!=='BUS'||!station.parentStop)return;
  const group=parentGroups.get(station.parentStop)||[];
  group.push(index); parentGroups.set(station.parentStop,group);
});
check([...parentGroups.values()].some(group=>group.length>=2),'Opposite/related physical bus stops were unexpectedly merged');
let sameCodeChanges=0,crossMode=0,terTransferPreferenceEdges=0,redundantSpToursPreferenceEdges=0;
const alightHub=Array.from({length:d.stations.length},()=>[]);
const boardHub=Array.from({length:d.stations.length},()=>[]);
d.routeStates.forEach((state,index)=>{
  if(state.role==='alight')alightHub[state.stationIndex].push(index);
  if(state.role==='board')boardHub[state.stationIndex].push(index);
});
const spdcIndex=d.stations.findIndex(s=>s.id==='SNCF:87571240');
const toursIndex=d.stations.findIndex(s=>s.id==='SNCF:87571000');
check(spdcIndex>=0&&toursIndex>=0,'Tours/Saint-Pierre rail fixtures missing');
const nextStopFor=(state,stationIndex)=>{
  if(!Number.isInteger(state?.pattern))return -1;
  const pattern=d.timetablePatterns[state.pattern];
  if(!pattern)return -1;
  const pos=pattern.stops.indexOf(stationIndex);
  return pos>=0&&pos+1<pattern.stops.length?pattern.stops[pos+1]:-1;
};
const matchesHub=(serviceState,hubState,stationIndex)=>{
  const mode=d.routeInfo?.[serviceState.routeId]?.mode;
  if(mode==='BUS')return hubState.routeId===null;
  if(stationIndex===spdcIndex&&Number.isInteger(serviceState.pattern)){
    return hubState.routeId===serviceState.routeId&&hubState.pattern===serviceState.pattern;
  }
  return hubState.routeId===serviceState.routeId;
};
const transferEdges=(fromStation,toStation)=>{
  const targets=new Set(boardHub[toStation]);
  const found=[];
  for(const first of alightHub[fromStation])for(const edge of d.adjacency[first]){
    if(targets.has(edge[0]))found.push(edge);
  }
  return found;
};
const transferEdge=(fromStation,toStation)=>transferEdges(fromStation,toStation)[0];

for(let i=0;i<d.stations.length;i++){
  for(const a of d.stationStates[i]){
    const source=d.routeStates[a];
    const hub=alightHub[i].find(h=>matchesHub(source,d.routeStates[h],i)&&d.adjacency[a].some(([n])=>n===h));
    check(Number.isInteger(hub),'Missing route/pattern-aware alighting hub');
  }
  for(const b of d.boardingStates[i]){
    const target=d.routeStates[b];
    const hub=boardHub[i].find(h=>matchesHub(target,d.routeStates[h],i)&&d.adjacency[h].some(([n])=>n===b));
    check(Number.isInteger(hub),'Missing route/pattern-aware boarding hub');
  }
  for(const first of alightHub[i])for(const second of boardHub[i]){
    const edge=d.adjacency[first].find(([n])=>n===second);
    check(Boolean(edge),'Missing same-stop route interchange');
    const a=d.routeStates[first],b=d.routeStates[second];
    const terToTer=Boolean(
      a.routeId&&b.routeId
      && d.routeInfo?.[a.routeId]?.mode==='TER'
      && d.routeInfo?.[b.routeId]?.mode==='TER'
    );
    const redundantSpTours=Boolean(
      i===spdcIndex
      && nextStopFor(a,i)===toursIndex
      && nextStopFor(b,i)===toursIndex
    );
    const expected=(terToTer||redundantSpTours)?1:0;
    check((Number(edge[3])||0)===expected,'Wrong artificial-transfer preference metadata');
    if(terToTer)terTransferPreferenceEdges++;
    if(redundantSpTours&&!terToTer)redundantSpToursPreferenceEdges++;
  }
  for(const a of d.stationStates[i])for(const b of d.boardingStates[i]){
    const x=d.routeStates[a],y=d.routeStates[b];
    if(x.pattern!==null&&x.pattern===y.pattern)continue;
    if(x.routeId===y.routeId&&x.pattern!==y.pattern)sameCodeChanges++;
  }
}
check(terTransferPreferenceEdges>0,'No TER interchange preference edges found');
check(redundantSpToursPreferenceEdges>0,'No redundant Saint-Pierre→Tours cross-route preference edges found');

// The exception must remain possible: a train terminating at Saint-Pierre (or
// heading elsewhere) may legitimately connect to the NAVETTE/another TER for Tours.
const navetteToTours=d.timetablePatterns.findIndex(p=>p.routeId==='NAVETTE'&&p.stops[0]===spdcIndex&&p.stops[1]===toursIndex);
check(navetteToTours>=0,'Saint-Pierre→Tours navette pattern missing');
const endingAtSpdc=d.timetablePatterns.findIndex(p=>p.stops.at(-1)===spdcIndex&&p.routeId!=='NAVETTE');
check(endingAtSpdc>=0,'No train terminating at Saint-Pierre fixture');
const endingAlight=alightHub[spdcIndex].find(h=>d.routeStates[h].pattern===endingAtSpdc);
const navetteBoard=boardHub[spdcIndex].find(h=>d.routeStates[h].pattern===navetteToTours);
check(Number.isInteger(endingAlight)&&Number.isInteger(navetteBoard),'Saint-Pierre exception hubs missing');
const exceptionEdge=d.adjacency[endingAlight].find(([n])=>n===navetteBoard);
check(Boolean(exceptionEdge)&&(Number(exceptionEdge[3])||0)===0,'Train ending at Saint-Pierre must keep an ordinary navette transfer to Tours');
const roadWalking=Boolean(d.meta?.walkingTransferSource?.generated);
let roadTransferEdges=0;
for(let i=0;i<d.stations.length;i++){
  if(!alightHub[i].length)continue;
  for(const first of alightHub[i])for(const edge of d.adjacency[first]){
    const [next,,walkMetres]=edge;
    const state=d.routeStates[next];
    if(state?.role!=='board'||state.stationIndex===i)continue;
    if(Number.isFinite(walkMetres)){
      check(walkMetres>=0&&walkMetres<=650+1e-7,'Invalid walking-transfer distance');
      if(walkMetres===0){
        const other=d.stations[state.stationIndex];
        const direct=Math.hypot(d.stations[i].point[0]-other.point[0],d.stations[i].point[1]-other.point[1]);
        check(direct<=0.2,'Zero-distance transfer between non-colocated stops');
      }
      if(d.stations[i].inSerm&&d.stations[state.stationIndex].inSerm)roadTransferEdges++;
    }
  }
}
for(let i=0;i<d.stations.length;i++)for(let j=i+1;j<d.stations.length;j++){
  if(Math.hypot(...d.stations[i].point.map((x,k)=>x-d.stations[j].point[k]))>650)continue;
  const bothInSerm=d.stations[i].inSerm&&d.stations[j].inSerm;
  if(!roadWalking||!bothInSerm){
    if(alightHub[i].length&&boardHub[j].length)check(transferEdges(i,j).length>0,'Missing nearby fallback transfer');
    if(alightHub[j].length&&boardHub[i].length)check(transferEdges(j,i).length>0,'Missing reverse nearby fallback transfer');
  }
  if(d.stations[i].mode!==d.stations[j].mode)crossMode++;
}
if(roadWalking){
  check(roadTransferEdges>0,'No BD TOPO walking transfers found in SERM');
  const byId=(id)=>d.stations.findIndex(s=>s.id===id);
  const j1=byId('FILBLEU:TTR:JUMEB-1'),j2=byId('FILBLEU:TTR:JUMEB-2');
  check(j1>=0&&j2>=0,'Missing Jumeaux physical stop fixtures');
  const jumeauxDirect=Math.hypot(d.stations[j1].point[0]-d.stations[j2].point[0],d.stations[j1].point[1]-d.stations[j2].point[1]);
  const jumeauxEdge=transferEdge(j1,j2);
  check(jumeauxDirect<50,'Jumeaux fixture is no longer geometrically close');
  check(Boolean(jumeauxEdge)&&Number.isFinite(jumeauxEdge[2])&&jumeauxEdge[2]>500,'BD TOPO detour between Jumeaux stops was lost');

  const island=byId('FILBLEU:TTR:ILAUB-1'),loire=byId('FILBLEU:TTR:LOIRB-1');
  check(island>=0&&loire>=0,'Missing Loire barrier fixtures');
  const loireDirect=Math.hypot(d.stations[island].point[0]-d.stations[loire].point[0],d.stations[island].point[1]-d.stations[loire].point[1]);
  check(loireDirect<300,'Loire barrier fixture is no longer geometrically close');
  check(transferEdges(island,loire).length===0,'Short straight-line Loire crossing incorrectly became a walking transfer');

  const porteLoire=byId('FILBLEU:TTR:PODLB-1'),choiseul=byId('FILBLEU:TTR:CHONB-2A');
  check(porteLoire>=0&&choiseul>=0,'Missing allowed Loire bridge fixtures');
  const bridgeEdge=transferEdge(porteLoire,choiseul);
  check(Boolean(bridgeEdge)&&Number.isFinite(bridgeEdge[2])&&bridgeEdge[2]>550&&bridgeEdge[2]<=650,'Allowed Loire bridge walking transfer was lost');

  const toursRail=byId('SNCF:87571000'),toursForecourt=byId('FILBLEU:TTR:AC-GATO');
  check(toursRail>=0&&toursForecourt>=0,'Missing Tours station access fixtures');
  const toursAccess=transferEdge(toursRail,toursForecourt);
  check(Boolean(toursAccess)&&Number.isFinite(toursAccess[2])&&toursAccess[2]<120,'Tours station road access is missing or implausible');

  const stPierreRail=byId('SNCF:87571240'),stPierreForecourt=byId('FILBLEU:TTR:SPGAB-1A');
  check(stPierreRail>=0&&stPierreForecourt>=0,'Missing St-Pierre-des-Corps station access fixtures');
  const stPierreAccess=transferEdge(stPierreRail,stPierreForecourt);
  check(Boolean(stPierreAccess)&&Number.isFinite(stPierreAccess[2])&&stPierreAccess[2]>150&&stPierreAccess[2]<250,'Documented St-Pierre-des-Corps station access is missing or implausible');
}
const station=(name,route)=>{const s=d.stations.find(s=>s.name===name&&(!route||s.routes.includes(route)));assert.ok(s,`Missing station ${name}`);return s;};
const names=['Tours','Blois-Chambord','Orléans','Paris-Austerlitz','Le Mans','Saumur','Rotière','Jean Jaurès'];
const examples=[];const start=performance.now();let maxModel=0;
for(const name of names){
  const source=station(name);const t=performance.now();const model=buildTravelModel(d,source.point,true);maxModel=Math.max(maxModel,performance.now()-t);
  const noProjects=buildTravelModel(d,source.point,false);
  d.routeStates.forEach((s,i)=>{if(d.routeInfo?.[s.routeId]?.planned)check(!Number.isFinite(noProjects.distances[i]),'Disabled project reachable');});
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
const src=station('Tours').point;
const refWalk=d.meta.walkMetersPerMinute||80;
const refEntry=d.meta.stationAccessPenalty??1.8;
const refRouteMode=(routeId)=>d.routeInfo?.[routeId]?.mode||(routeId==='NAVETTE'?'NAVETTE':routeId?.startsWith('TRAM')?'TRAM':routeId?.startsWith('BHNS')?'BHNS':'TER');
const refWait=(routeId)=>d.routeInfo?.[routeId]?.waitMinutes ?? (({BUS:10,NAVETTE:5,TRAM:4,BHNS:3.25,TER:15})[refRouteMode(routeId)]??15);
const refAllowed=d.routeStates.map(s=>d.routeInfo?.[s.routeId]?.serviceStatus?.status!=='suspended');
const refEdgeCost=(fromNode,toNode,storedCost,walkingMetres)=>{
  const a=d.routeStates[fromNode],b=d.routeStates[toNode];
  if(!a||!b)return storedCost;
  if(a.role==='board'&&b.role==='departure')return refWait(b.routeId);
  if(a.role==='alight'&&b.role==='board'){
    if(a.stationIndex===b.stationIndex)return 3.5;
    const aPoint=d.stations[a.stationIndex].point,bPoint=d.stations[b.stationIndex].point;
    const metres=Number.isFinite(walkingMetres)?walkingMetres:Math.hypot(aPoint[0]-bPoint[0],aPoint[1]-bPoint[1]);
    return metres/refWalk+2;
  }
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
function referenceRun(preferenceMinutes){
  const value=Array(d.routeStates.length).fill(Infinity);
  const score=Array(d.routeStates.length).fill(Infinity);
  const changes=Array(d.routeStates.length).fill(Infinity);
  const visited=Array(d.routeStates.length).fill(false);
  d.stations.forEach((s,i)=>{for(const n of d.boardingStates[i])if(refAllowed[n]){
    const v=Math.hypot(s.point[0]-src[0],s.point[1]-src[1])/refWalk+refEntry+refWait(d.routeStates[n].routeId);
    value[n]=v;score[n]=v;changes[n]=0;
  }});
  for(let k=0;k<value.length;k++){
    let node=-1,bestScore=Infinity,bestValue=Infinity;
    for(let n=0;n<value.length;n++)if(!visited[n]&&(
      score[n]<bestScore||(score[n]===bestScore&&value[n]<bestValue)
    )){node=n;bestScore=score[n];bestValue=value[n];}
    if(node<0)break;
    visited[node]=true;
    for(const edge of d.adjacency[node]){
      const [next,cost,walkingMetres]=edge;
      if(!refAllowed[next])continue;
      const nextChanges=changes[node]+(Number(edge[3])||0);
      const nextValue=value[node]+refEdgeCost(node,next,cost,walkingMetres);
      const nextScore=nextValue+nextChanges*preferenceMinutes;
      if(nextScore<score[next]||(nextScore===score[next]&&nextValue<value[next])){
        changes[next]=nextChanges;value[next]=nextValue;score[next]=nextScore;
      }
    }
  }
  return {value,score,changes};
}
const pureReference=referenceRun(0);
const comfortReference=referenceRun(model.comfortTransferPreferenceMinutes);
// 0.001 minute = 0.06 s: enough for coordinate-rounding noise, far below user-facing precision.
pureReference.value.forEach((v,n)=>{
  const modelChanges=model.pureTransferCounts[n]===65535?Infinity:model.pureTransferCounts[n];
  check(pureReference.changes[n]===modelChanges,'Pure-time transfer-count oracle mismatch');
  check(v===model.pureDistances[n]||Math.abs(v-model.pureDistances[n])<1e-3,'Pure-time shortest-path oracle mismatch');
});
comfortReference.value.forEach((v,n)=>{
  const modelChanges=model.comfortTransferCounts[n]===65535?Infinity:model.comfortTransferCounts[n];
  check(comfortReference.changes[n]===modelChanges,'Comfort transfer-count oracle mismatch');
  check(comfortReference.score[n]===model.comfortPreferenceScores[n]||Math.abs(comfortReference.score[n]-model.comfortPreferenceScores[n])<1e-3,'Comfort preference-score oracle mismatch');
  check(v===model.comfortDistances[n]||Math.abs(v-model.comfortDistances[n])<1e-3,'Comfort shortest-path oracle mismatch');
});
const p21States=d.routeStates.map((state,n)=>[state,n]).filter(([state])=>state.routeId==='TER P21').map(([,n])=>n);
check(p21States.length>0,'P21 fallback route states missing');
check(p21States.some(n=>Number.isFinite(model.distances[n])),'P21 must be routable from Tours');
const chinonIndex=d.stations.findIndex(s=>s.name==='Chinon');
check(chinonIndex>=0,'Chinon station missing');
check(d.boardingStates[chinonIndex].some(n=>d.routeStates[n].routeId==='TER P21'),'P21 boarding missing at Chinon');

for(const routeId of ['TER P14','TER P16','TER P10','TER K5+','TER K15','TER P5','TER P15']){
  check(d.routeStates.some(state=>state.routeId===routeId), `Complementary TER route missing: ${routeId}`);
}
check((d.routeInfo?.['TER P10']?.title||'').includes('Paris - Châteaudun - Vendôme'),'Wrong regional P10 selected');
check((d.routeInfo?.['TER P14']?.title||'').includes('Orléans - Nevers'),'Wrong regional P14 selected');
const mehunIndex=d.stations.findIndex(s=>s.name==='Mehun-sur-Yèvre');
const vierzonIndex=d.stations.findIndex(s=>s.name==='Vierzon-Ville');
check(mehunIndex>=0&&vierzonIndex>=0,'Mehun/Vierzon stations missing');
check(d.timetablePatterns.some(pattern=>{
  if(pattern.routeId!=='TER P14')return false;
  const a=pattern.stops.indexOf(mehunIndex),b=pattern.stops.indexOf(vierzonIndex);
  return a>=0&&b>=0&&a!==b;
}),'P14 direct Mehun–Vierzon pattern missing');

const chartres=station('Chartres');
const chartresModel=buildTravelModel(d,chartres.point,true);
const chartresTours=describeJourney(d,chartresModel,station('Tours').point);
check(chartresTours.legs.length===1,'Chartres→Tours should prefer a one-seat train');
check(chartresTours.legs[0].routeId==='TER P33','Chartres→Tours should use direct P33');
check(chartresTours.legs[0].from===d.stations.indexOf(chartres),'Chartres→Tours direct leg should start at Chartres');
check(d.stations[chartresTours.legs[0].to].name==='Tours','Chartres→Tours direct leg should end at Tours');

const output={checks,patterns:d.timetablePatterns.length,intervals,sameCodeChanges,terTransferPreferenceEdges,redundantSpToursPreferenceEdges,crossModeNearbyPairs:crossMode,roadWalking,roadTransferEdges,stations:d.stations.length,routeStates:d.routeStates.length,adjacencyEdges:d.adjacency.reduce((n,a)=>n+a.length,0),noBoarding:d.stations.filter((s,i)=>!d.boardingStates[i].length).map(s=>s.name),tramMaxDisplayOffsetMetres:Math.max(...d.stations.filter(s=>s.mode==='TRAM'&&!s.planned).map(s=>s.displayOffset)),maxModelMs:+maxModel.toFixed(1),gridCells:d.cells.length,gridMs:+gridMs.toFixed(1),suiteMs:+(performance.now()-start).toFixed(1),examples};
console.log(JSON.stringify(output,null,2));

// Multipliers apply to each boarding, while observed in-vehicle times stay intact.
const { routeWaitingMinutes } = await import('../site/routing.mjs');
for (const [id, info] of Object.entries(d.routeInfo)) {
  const key = {TER:'terWaitFactor',TRAM:'tramWaitFactor',BUS:'busWaitFactor',NAVETTE:'navetteWaitFactor'}[info.mode];
  if (!key) continue;
  const base = routeWaitingMinutes(d,id);
  check(routeWaitingMinutes(d,id,{[key]:0})===0, `Zero wait ${id}`);
  check(Math.abs(routeWaitingMinutes(d,id,{[key]:2})-2*base)<1e-9, `Double wait ${id}`);
  if (info.waitMinutes !== undefined) check(Math.abs(base-info.waitMinutes)<1e-9, `GTFS wait ${id}`);
}
