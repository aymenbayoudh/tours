import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Worker} from 'node:worker_threads';
import {buildTravelModel,estimateTravel,reachability} from '../site/routing.mjs';
const data=JSON.parse(fs.readFileSync(new URL('../site/data/commute_map_data.json',import.meta.url)));
const origin=data.stations.find(s=>s.name==='Tours').point,probe=data.stations.find(s=>s.name==='Rotière').point;
const routingURL=new URL('../site/routing.mjs',import.meta.url).href;
const source=fs.readFileSync(new URL('../site/direct-worker.mjs',import.meta.url),'utf8').replace(/\.\/routing\.mjs\?v=[^']+/,routingURL);
const worker=new Worker(`const {parentPort}=require('node:worker_threads');globalThis.self={postMessage:(value,transfers)=>parentPort.postMessage(value,transfers)};import(${JSON.stringify('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))}).then(()=>parentPort.on('message',data=>self.onmessage({data})));`,{eval:true});
async function send(message) {
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{worker.terminate();reject(Error('Worker timeout'));},20000);
    const onError=e=>{clearTimeout(timeout);reject(e);};
    worker.once('error',onError);worker.once('message',result=>{clearTimeout(timeout);worker.off('error',onError);if(result.type==='error')reject(Error(result.message));else resolve(result);});
    worker.postMessage(message);
  });
}
try {
  assert.equal((await send({type:'init',data})).type,'ready');
  const spec={bounds:[origin[0]-1000,origin[1]-1000,origin[0]+1000,origin[1]+1000],cols:12,rows:12};
  const base={origin,probe,settings:{walkSpeedKmh:4},includeProjects:true,settingsKey:'settings',threshold:30};
  const preview=(await send({type:'calculate',request:{...base,key:'moving',preview:true,spec:null}})).result;
  assert.equal(preview.warp,undefined);
  const rasterKey=JSON.stringify([origin,base.settingsKey,spec]);
  const exact=(await send({type:'calculate',request:{...base,key:'settled',preview:false,spec,rasterKey}})).result;
  const model=buildTravelModel(data,origin,true,{...base.settings,routingVariant:'comfort'});
  assert.deepEqual(exact.reach,reachability(data,model,30));
  assert.ok(Math.abs(exact.journey.minutes-estimateTravel(data,model,probe))<1e-8);
  for(let r=0;r<spec.rows;r++)for(let c=0;c<spec.cols;c++) {
    if(!exact.warp.validMask[r][c])continue;
    const p=[spec.bounds[0]+(c+.5)*exact.warp.cellW,spec.bounds[1]+(r+.5)*exact.warp.cellH];
    assert.ok(Math.abs(exact.warp.minutes[r][c]-estimateTravel(data,model,p))<1e-8);
  }
  const nextProbe=data.stations.find(s=>s.name==='Orléans').point;
  const next=(await send({type:'calculate',request:{...base,probe:nextProbe,threshold:45,key:'probe',preview:false,spec,rasterKey}})).result;
  assert.deepEqual(next.warp,exact.warp,'reusing a model must preserve its transferred raster');
  assert.deepEqual(next.snapshot.accessMinutes,exact.snapshot.accessMinutes,'snapshot transfers must not detach the cached model');
  assert.deepEqual(next.reach,reachability(data,model,45));
  assert.ok(Math.abs(next.journey.minutes-estimateTravel(data,model,nextProbe))<1e-8);
  console.log('Direct worker: live snapshot, exact settled raster, cached probe update and transfers verified');
} finally {await worker.terminate();}
