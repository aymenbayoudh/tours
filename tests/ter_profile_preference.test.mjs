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
  const journey=describeJourney(d,model,d.stations[3].point);
  assert.equal(journey.preference,'pure','sub-60-minute journey must use fastest-time routing');
  assert.ok(journey.minutes<60,'fixture must stay below the one-hour threshold');
  assert.equal(journey.legs.length,2,'faster stitched P7 should remain allowed below one hour');
}

{
  const d=baseData();
  // Slower one-seat P7: 100 min.
  const directDep=node(d,0,'TER P7','departure',0);
  const directArr=node(d,3,'TER P7','arrival',0);
  edge(d,directDep,directArr,100);
  d.boardingStates[0].push(directDep); d.stationStates[3].push(directArr);

  // Faster P→K feeder pattern: 20 + 3.5 + 45 = 68.5 min. This is a useful
  // omnibus→Krono interchange and must carry ZERO comfort penalty.
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
  assert.equal(journey.preference,'comfort','fixture must remain in the 60+ minute comfort branch');
  assert.deepEqual(journey.legs.map(l=>l.routeId),['TER P7','TER KX'],'faster P→K interchange must beat a slower direct train');
  assert.equal(model.comfortStationArrivals[3].transferCount,0,'P→K must not consume a comfort penalty');
  assert.ok(journey.minutes<100);
}

{
  const d=baseData();
  // One P7 profile change: 80 min.
  const a1=node(d,0,'TER P7','departure',0), b1=node(d,1,'TER P7','arrival',0);
  const ah1=node(d,1,'TER P7','alight'), bh1=node(d,1,'TER P7','board');
  const b2=node(d,1,'TER P7','departure',1), d1=node(d,3,'TER P7','arrival',1);
  edge(d,a1,b1,30); edge(d,b1,ah1,0); edge(d,ah1,bh1,3.5,1); edge(d,bh1,b2,0); edge(d,b2,d1,46.5);
  d.boardingStates[0].push(a1); d.boardingStates[1].push(b2); d.stationStates[1].push(b1); d.stationStates[3].push(d1);

  // Two P7 profile changes: 70 min raw. It is faster, but both options are
  // long journeys, so the one-change itinerary should win on comfort.
  const a2=node(d,0,'TER P7','departure',2), b3=node(d,1,'TER P7','arrival',2);
  const ah2=node(d,1,'TER P7','alight'), bh2=node(d,1,'TER P7','board');
  const b4=node(d,1,'TER P7','departure',3), c1=node(d,2,'TER P7','arrival',3);
  const ah3=node(d,2,'TER P7','alight'), bh3=node(d,2,'TER P7','board');
  const c2=node(d,2,'TER P7','departure',4), d2=node(d,3,'TER P7','arrival',4);
  edge(d,a2,b3,20); edge(d,b3,ah2,0); edge(d,ah2,bh2,3.5,1); edge(d,bh2,b4,0); edge(d,b4,c1,20);
  edge(d,c1,ah3,0); edge(d,ah3,bh3,3.5,1); edge(d,bh3,c2,0); edge(d,c2,d2,23);
  d.boardingStates[0].push(a2); d.boardingStates[1].push(b4); d.boardingStates[2].push(c2);
  d.stationStates[1].push(b3); d.stationStates[2].push(c1); d.stationStates[3].push(d2);

  const model=buildTravelModel(d,d.stations[0].point,true,{terWaitFactor:0,stationEntryPenalty:0,stationExitPenalty:0,walkSpeedKmh:0.5});
  const journey=describeJourney(d,model,d.stations[3].point);
  assert.equal(journey.preference,'comfort','60+ minute journey must use comfort routing');
  assert.equal(journey.legs.length,2,'one TER change should beat two for a long journey');
  assert.equal(journey.minutes,80);
}


console.log('TER profile preference tests: ok');
