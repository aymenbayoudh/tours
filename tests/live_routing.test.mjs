import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildTravelModel, estimateTravel, estimateTravelTimes, previewTravelModel, directModelSnapshot, restoreDirectModel} from '../site/routing.mjs';
import {DirectClient} from '../site/direct-client.mjs';
const data=JSON.parse(fs.readFileSync(new URL('../site/data/commute_map_data.json',import.meta.url)));
const station=name=>data.stations.find(s=>s.name===name).point;
let checks=0;
const near=(a,b)=>assert.ok(a===b || Math.abs(a-b)<1e-8,`${a} != ${b}`);
for(const [name,projects,settings] of [['Tours',true,{}],['Orléans',false,{terWaitFactor:0,busExitPenalty:9}],['Rotière',true,{walkSpeedKmh:4,tramWaitFactor:0,busWaitFactor:0,busEntryPenalty:0,busExitPenalty:0}]]) {
  const origin=station(name),full=buildTravelModel(data,origin,projects,settings);
  const slim=buildTravelModel(data,origin,projects,{...settings,routingVariant:'comfort'});
  assert.equal(slim.pureDistances,undefined);
  for(let n=0;n<data.routeStates.length;n++){near(full.comfortDistances[n],slim.comfortDistances[n]);near(full.comfortPreferenceScores[n],slim.comfortPreferenceScores[n]);checks+=2;}
  const points=[...data.stations.filter((_,i)=>i%17===0).map(s=>s.point),...data.cells.filter((_,i)=>i%71===0).map(c=>c.point)];
  const batch=estimateTravelTimes(data,slim,points);
  for(let i=0;i<points.length;i++){near(batch[i],estimateTravel(data,full,points[i]));checks++;}
  const anchor=restoreDirectModel(data,structuredClone(directModelSnapshot(slim)));
  const moved=[origin[0]+25,origin[1]-15],preview=previewTravelModel(data,anchor,moved);
  const exact=buildTravelModel(data,moved,projects,{...settings,routingVariant:'comfort'});
  const limit=2*Math.hypot(moved[0]-origin[0],moved[1]-origin[1])/exact.settings.walkMetersPerMinute;
  const pv=estimateTravelTimes(data,preview,points);
  for(let i=0;i<points.length;i++) {
    near(pv[i],estimateTravel(data,preview,points[i]));
    const a=estimateTravel(data,preview,points[i],true),b=estimateTravel(data,exact,points[i],true);
    assert.ok(a.score>=b.score-1e-8 && a.score<=b.score+limit+1e-8,'preview score exceeds displacement bound');checks+=2;
  }
  assert.deepEqual(anchor.origin,origin);assert.notDeepEqual(pv,batch,'surface must react before a worker response');
}
const sent=[],received=[],errors=[],worker={postMessage:m=>sent.push(m)};
const client=new DirectClient(worker,r=>received.push(r),e=>errors.push(e));
const req=key=>({key,origin:[Number(key),0]});
client.request(req('1'));client.request(req('2'));assert.equal(sent.length,0);
worker.onmessage({data:{type:'ready'}});assert.equal(sent[0].request.key,'2');
client.request(req('3'));client.request(req('4'));assert.equal(sent.length,1);
worker.onmessage({data:{type:'result',result:{key:'2'}}});assert.equal(sent[1].request.key,'4');
worker.onmessage({data:{type:'result',result:{key:'4'}}});client.request(req('4'));assert.equal(sent.length,2);
worker.onerror({message:'unavailable'});client.request(req('5'));assert.equal(sent.length,2);assert.deepEqual(errors,['unavailable']);
console.log(JSON.stringify({checks,workerCoalescing:true,previewBound:true}));
