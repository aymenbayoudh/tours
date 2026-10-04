import assert from 'node:assert/strict';
import { buildTravelModel, describeJourney } from '../site/routing.mjs';

function baseData() {
  return {
    meta:{walkMetersPerMinute:80,stationAccessPenalty:0},
    stations:[
      {name:'A',point:[0,0],mode:'TER'},
      {name:'B',point:[100000,0],mode:'TER'},
      {name:'C',point:[200000,0],mode:'TER'},
      {name:'D',point:[300000,0],mode:'TER'},
    ],
    routeInfo:{
      'TER P7':{mode:'TER',waitMinutes:0,planned:false},
      'TER P8':{mode:'TER',waitMinutes:0,planned:false},
      'TER KX':{mode:'TER',waitMinutes:0,planned:false},
    },
    routeStates:[],
    adjacency:[],
    stationStates:[[],[],[],[]],
    boardingStates:[[],[],[],[]],
  };
}
function node(d,station,routeId,role,pattern=null){
  const n=d.routeStates.length;
  d.routeStates.push({stationIndex:station,routeId,role,pattern});
  d.adjacency.push([]);
  return n;
}
function edge(d,a,b,minutes,weight=0){
  const e=[b,minutes];
  if(weight){e.push(null,weight);}
  d.adjacency[a].push(e);
}

{
  const d=baseData();
  // Two representative P7 profiles form one continuous P7 line. Switching
  // profile at B is zero-cost line continuity, not a correspondence/re-boarding.
  const a=node(d,0,'TER P7','departure',0);
  const bArr=node(d,1,'TER P7','arrival',0);
  const bDep=node(d,1,'TER P7','departure',1);
  const dArr=node(d,3,'TER P7','arrival',1);
  edge(d,a,bArr,35); edge(d,bArr,bDep,0); edge(d,bDep,dArr,40);
  d.boardingStates[0].push(a); d.stationStates[1].push(bArr);
  d.boardingStates[1].push(bDep); d.stationStates[3].push(dArr);

  const model=buildTravelModel(d,d.stations[0].point,true,{terWaitFactor:0,stationEntryPenalty:0,stationExitPenalty:0,walkSpeedKmh:0.5});
  const journey=describeJourney(d,model,d.stations[3].point);
  assert.equal(journey.preference,'comfort');
  assert.deepEqual(journey.legs.map(l=>l.routeId),['TER P7'],'same TER profiles must render as one continuous line');
  assert.equal(journey.minutes,75);
  assert.equal(model.comfortStationArrivals[3].transferCount,0,'same-line profile continuity must not consume comfort weight');
}

{
  const d=baseData();
  // Slower one-seat P7: 100 min.
  const directDep=node(d,0,'TER P7','departure',0);
  const directArr=node(d,3,'TER P7','arrival',0);
  edge(d,directDep,directArr,100);
  d.boardingStates[0].push(directDep); d.stationStates[3].push(directArr);

  // Faster P→K feeder: 20 + 3.5 + 45 = 68.5 min. P↔K remains neutral.
  const pDep=node(d,0,'TER P7','departure',1);
  const pArr=node(d,1,'TER P7','arrival',1);
  const pAlight=node(d,1,'TER P7','alight');
  const kBoard=node(d,1,'TER KX','board');
  const kDep=node(d,1,'TER KX','departure',2);
  const kArr=node(d,3,'TER KX','arrival',2);
  edge(d,pDep,pArr,20); edge(d,pArr,pAlight,0); edge(d,pAlight,kBoard,3.5,0); edge(d,kBoard,kDep,0); edge(d,kDep,kArr,45);
  d.boardingStates[0].push(pDep); d.stationStates[1].push(pArr); d.boardingStates[1].push(kDep); d.stationStates[3].push(kArr);

  const model=buildTravelModel(d,d.stations[0].point,true,{terWaitFactor:0,stationEntryPenalty:0,stationExitPenalty:0,walkSpeedKmh:0.5});
  const journey=describeJourney(d,model,d.stations[3].point);
  assert.equal(journey.preference,'comfort');
  assert.deepEqual(journey.legs.map(l=>l.routeId),['TER P7','TER KX'],'P→K must remain a useful faster feeder even beyond 60 min');
  assert.equal(model.comfortStationArrivals[3].transferCount,0,'P→K must stay neutral');
  assert.ok(journey.minutes<100);
}

{
  const d=baseData();
  // Direct P7 takes 100 min.
  const directDep=node(d,0,'TER P7','departure',0);
  const directArr=node(d,3,'TER P7','arrival',0);
  edge(d,directDep,directArr,100);
  d.boardingStates[0].push(directDep); d.stationStates[3].push(directArr);

  // P7→P8 is 70 min raw but carries 2 comfort units (2×30 min).
  const p7Dep=node(d,0,'TER P7','departure',1);
  const p7Arr=node(d,1,'TER P7','arrival',1);
  const p7Alight=node(d,1,'TER P7','alight');
  const p8Board=node(d,1,'TER P8','board');
  const p8Dep=node(d,1,'TER P8','departure',2);
  const p8Arr=node(d,3,'TER P8','arrival',2);
  edge(d,p7Dep,p7Arr,30); edge(d,p7Arr,p7Alight,0); edge(d,p7Alight,p8Board,3.5,2); edge(d,p8Board,p8Dep,0); edge(d,p8Dep,p8Arr,36.5);
  d.boardingStates[0].push(p7Dep); d.stationStates[1].push(p7Arr); d.boardingStates[1].push(p8Dep); d.stationStates[3].push(p8Arr);

  const model=buildTravelModel(d,d.stations[0].point,true,{terWaitFactor:0,stationEntryPenalty:0,stationExitPenalty:0,walkSpeedKmh:0.5});
  const journey=describeJourney(d,model,d.stations[3].point);
  assert.equal(journey.preference,'comfort');
  assert.deepEqual(journey.legs.map(l=>l.routeId),['TER P7'],'long-trip comfort should reject artificial P→P stitching when a through line exists');
  assert.equal(journey.minutes,100);
}

console.log('TER profile preference tests: ok');
