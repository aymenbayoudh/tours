import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { WalkingEngine, surfaceValue } from '../site/walking-engine.mjs';
import { WalkingClient } from '../site/walking-client.mjs';
import { contourSegments } from '../site/isochrone.mjs';

const messages = [], results = [];
const fake = {postMessage: m => messages.push(m)};
const client = new WalkingClient(fake, r => results.push(r), () => {}, e => {throw Error(e)});
client.request({key:'a'}); client.request({key:'b'});
assert.equal(messages.length, 0);
fake.onmessage({data:{type:'ready'}});
assert.equal(messages[0].request.key, 'b');
client.request({key:'c'}); client.request({key:'d'});
assert.equal(messages.length, 1, 'Only one calculation may be in flight');
fake.onmessage({data:{type:'result', result:{key:'b'}}});
assert.equal(messages[1].request.key, 'd', 'Discard obsolete queued origins');
fake.onmessage({data:{type:'result', result:{key:'d'}}});
client.request({key:'d'}); assert.equal(messages.length, 2);

const data = JSON.parse(fs.readFileSync(new URL('../site/data/commute_map_data.json', import.meta.url)));
const raw = zlib.gunzipSync(fs.readFileSync(new URL('../site/data/point_walking.bin.gz', import.meta.url)));
const engine = new WalkingEngine(data, raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
const origin = data.stations.find(s => s.name === 'Tours').point;
const spec = {bounds:[origin[0]-16000,origin[1]-10000,origin[0]+16000,origin[1]+12000],cols:100,rows:80};
const base = {origin,probe:null,includeProjects:true,settings:{busWaitFactor:0},threshold:30,maxTime:45,spec,settingsKey:'test'};
const first = engine.calculate({...base,key:'1',preview:false});
let checks=0;
for(let r=0;r<spec.rows;r++) for(let c=0;c<spec.cols;c++) if(first.warp.validMask[r][c]) {
  assert(Number.isFinite(first.warp.minutes[r][c]), 'Every land sample must have a finite contour value'); checks++;
}
const grid = engine.grid(spec);
const degrees = new Map();
for (const pair of contourSegments(first.warp,30)) for (const point of pair) {
  assert(point.every(Number.isFinite), 'Contour intersections must never be NaN');
  const key=point.map(n=>n.toFixed(5)).join(','); degrees.set(key,(degrees.get(key)||0)+1);
}
// This viewport lies wholly inside the SERM apart from one distant corner;
// contours must close or leave the viewport/coverage boundary intentionally.
let interiorEnds=0;
for(const [key,count] of degrees) if(count===1) {
  const [x,y]=key.split(',').map(Number), c=(x-spec.bounds[0])/grid.cellW-.5,r=(y-spec.bounds[1])/grid.cellH-.5;
  const i=Math.floor(r),j=Math.floor(c);
  const boundary = i<=0 || j<=0 || i>=spec.rows-2 || j>=spec.cols-2 || [-1,0,1].some(dy=>[-1,0,1].some(dx=>!grid.validMask[i+dy]?.[j+dx]));
  if(!boundary) interiorEnds++;
}
assert.equal(interiorEnds,0,'There must be no isolated contour ends inside covered land');
assert.equal(grid, engine.grid(spec), 'Reuse all street snaps when moving the origin');
assert.equal(surfaceValue(engine.network,engine.model,origin,null,60),60,'Missing roads are above the displayed thresholds, never holes');
const preview=engine.calculate({...base,key:'preview',preview:true});
for(let r=0;r<spec.rows;r++) for(let c=0;c<spec.cols;c++) if(first.warp.validMask[r][c]) {
  assert(Math.abs(first.warp.minutes[r][c]-preview.warp.minutes[r][c])<1e-6,'Drag bounds must preserve the entire displayed surface');
}
const faster=engine.calculate({...base,settings:{...base.settings,walkSpeedKmh:6},key:'speed',preview:false});
for(let r=0;r<spec.rows;r++) for(let c=0;c<spec.cols;c++) if(first.warp.validMask[r][c]) {
  assert(faster.warp.minutes[r][c]<=first.warp.minutes[r][c]+1e-6,'Increasing walk speed must not slow down a displayed trip');
}
const warm=[];
for(let i=0;i<5;i++) {
  const result=engine.calculate({...base,origin:[origin[0]+i*4,origin[1]],key:`warm${i}`,preview:true});
  warm.push({modelMs:Math.round(result.modelMs),totalMs:Math.round(result.totalMs)});
}
const jumeaux=data.stations.filter(s=>s.name==='Jumeaux');
const walking=engine.calculate({...base,origin:jumeaux[0].point,probe:jumeaux[1].point,settings:{busWaitFactor:0,stationEntryPenalty:20,stationExitPenalty:20},key:'detour',preview:false});
assert(walking.journey.walking>6,'Selected points must preserve the Jumeaux street detour');
assert.equal(walking.journey.walkingApproximation,false,'Surface extension must never replace the exact selected-point calculation');
const unavailable=engine.calculate({...base,origin:[origin[0]+500000,origin[1]+500000],key:'outside',preview:false});
assert.equal(unavailable.sourceCovered,false);
console.log(JSON.stringify({finiteSurfaceChecks:checks,interiorContourEnds:interiorEnds,coldTotalMs:Math.round(first.totalMs),warm,selectedPointDetourMinutes:walking.journey.walking},null,2));
