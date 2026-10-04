// Incremental preparation on the exact contracted IGN graph served by the site.
// Existing validated pairs and manual station portals are preserved.
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import {WalkingNetwork} from '../site/walking.mjs';

const data = JSON.parse(fs.readFileSync(process.argv[2]));
const path = new URL('../data/tours/walking_transfers.json', import.meta.url);
const table = JSON.parse(fs.readFileSync(path));
const packed = fs.readFileSync(new URL('../site/data/point_walking.bin.gz', import.meta.url));
const bytes = zlib.gunzipSync(packed);
const network = new WalkingNetwork(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const snaps = network.stationSnaps(data.stations);
const covered = new Set(table.coveredStopIds);
const added = data.stations.map((s,i)=>[s,i]).filter(([s])=>s.inSerm&&!covered.has(s.id));
const pairs = new Map(table.pairs.map(p=>[p.slice(0,2).sort().join('\0'),p]));
let candidates=0, newPairs=0;
const missingSnaps=[];
for(const [station,i] of added){
  covered.add(station.id);
  if(!snaps[i]){missingSnaps.push(station.id);continue;}
  const targets=data.stations.map((s,j)=>[s,j]).filter(([s,j])=>j!==i&&s.inSerm&&snaps[j]&&Math.hypot(s.point[0]-station.point[0],s.point[1]-station.point[1])<=650);
  if(!targets.length)continue;
  const field=network.search([[snaps[i],0,-1]],false,65000);
  for(const [target,j] of targets){
    const ids=[station.id,target.id].sort(),key=ids.join('\0');
    if(pairs.has(key))continue;
    candidates++;
    const metres=network.at(field,snaps[j]).cost/100;
    const direct=Math.hypot(station.point[0]-target.point[0],station.point[1]-target.point[1]);
    if(Number.isFinite(metres)&&metres<=650){
      // Vertex rounding must never imply less than the straight-line distance.
      pairs.set(key,[...ids,Math.round(Math.max(direct,metres)*10)/10]);newPairs++;
    }
  }
}
table.coveredStopIds=[...covered].sort();
table.pairs=[...pairs.values()].sort((a,b)=>a[0].localeCompare(b[0])||a[1].localeCompare(b[1]));
table.source.localBuses=data.meta.localBusSources;
if (added.length) table.incrementalLocalBusPreparation={graphSha256:crypto.createHash('sha256').update(packed).digest('hex'),addedStops:added.length,candidatePairs:candidates,addedPairs:newPairs,unsnappedStopIds:missingSnaps,maxTransferMetres:650,maxSnapMetres:150};
table.stats.coveredStops=covered.size;
table.stats.roadWalkablePairs=table.pairs.length;
fs.writeFileSync(path,JSON.stringify(table));
console.log(JSON.stringify(table.incrementalLocalBusPreparation));
