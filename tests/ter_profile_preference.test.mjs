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
function edge(d,a,b,minutes,changes=0){
  const e=[b,minutes];
  if(changes){e.push(null,changes);}
  d.adjacency[a].push(e);
}
function directVsStitched(withCrossRoute=false){
  const d=baseData();

  // Continuous P7: deliberately slower in raw minutes.
  const directDep=node(d,0,'TER P7','departure',0);
  const directArr=node(d,3,'TER P7','arrival',0);
  edge(d,directDep,directArr,100);
  d.boardingStates[0].push(directDep); d.stationStates[3].push(directArr);

  // Artificially stitched P7: much faster in raw minutes but requires one
  // profile change at B.
  const pDep1=node(d,0,'TER P7','departure',1);
  const pArrB=node(d,1,'TER P7','arrival',1);
  const pAlight=node(d,1,'TER P7','alight');
  const pBoard=node(d,1,'TER P7','board');
  const pDep2=node(d,1,'TER P7','departure',2);
  const pArrD=node(d,3,'TER P7','arrival',2);
  edge(d,pDep1,pArrB,20); edge(d,pArrB,pAlight,0);
  edge(d,pAlight,pBoard,3.5,1); edge(d,pBoard,pDep2,0); edge(d,pDep2,pArrD,20);
  d.boardingStates[0].push(pDep1); d.boardingStates[1].push(pDep2);
  d.stationStates[1].push(pArrB); d.stationStates[3].push(pArrD);

  if(withCrossRoute){
    // A legitimate P7 → KX transfer at B has NO artificial-change count.
    const kBoard=node(d,1,'TER KX','board');
    const kDep=node(d,1,'TER KX','departure',3);
    const kArr=node(d,3,'TER KX','arrival',3);
    edge(d,pAlight,kBoard,3.5,0); edge(d,kBoard,kDep,0); edge(d,kDep,kArr,45);
    d.boardingStates[1].push(kDep); d.stationStates[3].push(kArr);
  }
  return d;
}

{
  const d=directVsStitched(false);
  const model=buildTravelModel(d,d.stations[0].point,true,{terWaitFactor:0,stationEntryPenalty:0,stationExitPenalty:0,walkSpeedKmh:0.5});
  const arrival=model.stationArrivals[3];
  assert.equal(model.sameRouteChanges[arrival.node],0,'continuous P7 must beat stitched P7');
  assert.equal(arrival.node,1,'continuous P7 arrival should be selected despite slower raw stitched minutes');
  assert.equal(arrival.minutes,100);
}

{
  const d=directVsStitched(true);
  const model=buildTravelModel(d,d.stations[0].point,true,{terWaitFactor:0,stationEntryPenalty:0,stationExitPenalty:0,walkSpeedKmh:0.5});
  const journey=describeJourney(d,model,d.stations[3].point);
  assert.equal(model.sameRouteChanges[model.stationArrivals[3].node],0);
  assert.deepEqual(journey.legs.map(l=>l.routeId),['TER P7','TER KX'],'cross-route TER interchange must remain available');
  assert.ok(journey.minutes<100,'faster P7→KX interchange should beat slower continuous P7');
}

{
  const d=baseData();
  // One P7 profile change: 80 min.
  const a1=node(d,0,'TER P7','departure',0), b1=node(d,1,'TER P7','arrival',0);
  const ah1=node(d,1,'TER P7','alight'), bh1=node(d,1,'TER P7','board');
  const b2=node(d,1,'TER P7','departure',1), d1=node(d,3,'TER P7','arrival',1);
  edge(d,a1,b1,30); edge(d,b1,ah1,0); edge(d,ah1,bh1,3.5,1); edge(d,bh1,b2,0); edge(d,b2,d1,46.5);
  d.boardingStates[0].push(a1); d.boardingStates[1].push(b2); d.stationStates[1].push(b1); d.stationStates[3].push(d1);

  // Two P7 profile changes: only 50 min raw.
  const a2=node(d,0,'TER P7','departure',2), b3=node(d,1,'TER P7','arrival',2);
  const ah2=node(d,1,'TER P7','alight'), bh2=node(d,1,'TER P7','board');
  const b4=node(d,1,'TER P7','departure',3), c1=node(d,2,'TER P7','arrival',3);
  const ah3=node(d,2,'TER P7','alight'), bh3=node(d,2,'TER P7','board');
  const c2=node(d,2,'TER P7','departure',4), d2=node(d,3,'TER P7','arrival',4);
  edge(d,a2,b3,10); edge(d,b3,ah2,0); edge(d,ah2,bh2,3.5,1); edge(d,bh2,b4,0); edge(d,b4,c1,10);
  edge(d,c1,ah3,0); edge(d,ah3,bh3,3.5,1); edge(d,bh3,c2,0); edge(d,c2,d2,23);
  d.boardingStates[0].push(a2); d.boardingStates[1].push(b4); d.boardingStates[2].push(c2);
  d.stationStates[1].push(b3); d.stationStates[2].push(c1); d.stationStates[3].push(d2);

  const model=buildTravelModel(d,d.stations[0].point,true,{terWaitFactor:0,stationEntryPenalty:0,stationExitPenalty:0,walkSpeedKmh:0.5});
  const arrival=model.stationArrivals[3];
  assert.equal(model.sameRouteChanges[arrival.node],1,'one same-route profile change must beat two');
  assert.equal(arrival.node,d1);
}

console.log('TER profile preference tests: ok');
