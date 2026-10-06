import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {buildTravelModel,previewTravelModel,estimateTravelTimes} from '../site/routing.mjs';
const beforeSource=execFileSync('git',['show','75d550ea74b357007d0b03ac3254f026e4294713:site/routing.mjs'],{encoding:'utf8'});
const before=await import('data:text/javascript;base64,'+Buffer.from(beforeSource).toString('base64'));
const data=JSON.parse(fs.readFileSync(new URL('../site/data/commute_map_data.json',import.meta.url)));
const settings={walkSpeedKmh:4,navetteWaitFactor:0,terWaitFactor:0,tramWaitFactor:0,bhnsWait:0,busWaitFactor:0,busEntryPenalty:0,busExitPenalty:0,busTransferPenalty:1,busWalkingTransferPenalty:1,stationEntryPenalty:.5,stationExitPenalty:.5,transferPenalty:3,walkingTransferPenalty:1.5};
const origin=[.69348*111320*Math.cos(data.meta.lat0*Math.PI/180),47.37870*111320];
const points=[];for(let r=0;r<64;r++)for(let c=0;c<64;c++)points.push([origin[0]+(c-32)*100,origin[1]+(r-32)*100]);
let anchor=buildTravelModel(data,origin,true,{...settings,routingVariant:'comfort'});
const rows=[];
for(let n=0;n<25;n++) {
  const p=[origin[0]+n*8,origin[1]+n*3];
  let start=performance.now();before.buildTravelModel(data,p,true,settings);const beforeModel=performance.now()-start;
  start=performance.now();const model=buildTravelModel(data,p,true,{...settings,routingVariant:'comfort'});const afterModel=performance.now()-start;
  // Simulate an exact route-topology refresh every three pointer positions.
  if(n%3===0)anchor=model;
  start=performance.now();const preview=previewTravelModel(data,anchor,p);const previewModel=performance.now()-start;
  start=performance.now();estimateTravelTimes(data,preview,points);const previewGrid=performance.now()-start;
  if(n>=5)rows.push({beforeModel,afterModel,previewModel,previewGrid,liveCalculation:previewModel+previewGrid});
}
const stats={};for(const key of Object.keys(rows[0])){const a=rows.map(r=>r[key]).sort((a,b)=>a-b);stats[key]={medianMs:a[Math.floor(a.length/2)],p95Ms:a[Math.ceil(.95*a.length)-1]};}
console.log(JSON.stringify({node:process.version,iterations:rows.length,warmup:5,samples:points.length,settings,stats,rows},null,2));
