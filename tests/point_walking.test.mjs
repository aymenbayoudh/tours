import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { WalkingNetwork } from '../site/walking.mjs';
import { buildTravelModel, estimateTravel, describeJourney } from '../site/routing.mjs';

function fixture(nodes,edges) {
  const ends=[],lengths=[],shapes=[0],coords=[],along=[],adj=nodes.map(()=>[]);
  edges.forEach(([a,b,length],e)=>{ends.push(a,b);lengths.push(length*100);shapes.push(shapes.at(-1)+2);coords.push(...nodes[a].map(n=>n*10),...nodes[b].map(n=>n*10));along.push(0,length*100);adj[a].push(e);adj[b].push(e);});
  const offsets=[0],ids=[];for(const row of adj){ids.push(...row);offsets.push(ids.length);}
  const blocks=[new Uint32Array([0x32574B54,nodes.length,edges.length,edges.length*2,0,0,0,0]),new Uint32Array(ends),new Uint32Array(lengths),new Uint32Array(shapes),new Int32Array(coords),new Uint32Array(along),new Uint32Array(offsets),new Uint32Array(ids)];
  const raw=Buffer.concat(blocks.map(a=>Buffer.from(a.buffer)));return new WalkingNetwork(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));
}
const road=fixture([[0,0],[1000,0],[1100,0]],[[0,1,1000],[1,2,100]]);
const snap=road.snap([25,0]),field=road.search([[snap,0,-1]],true);
assert.equal(road.at(field,road.snap([75,0])).cost,5000,'A short same-chain walk must not go via a junction');
assert.equal(road.at(field,road.snap([1025,0])).cost,100000);
assert.equal(road.snap([500,100]),null,'Do not invent long off-road links');
const disconnected=fixture([[0,0],[100,0],[50,10],[50,110]],[[0,1,100],[2,3,100]]);
const separate=disconnected.search([[disconnected.snap([0,0]),0,-1]]);
assert.equal(disconnected.at(separate,disconnected.snap([50,110])).cost,Infinity,'A geometric crossing must not become a junction');
const d={meta:{walkMetersPerMinute:80,stationAccessPenalty:0},stations:[{id:'A',name:'A',point:[0,0],inSerm:true},{id:'B',name:'B',point:[1000,0],inSerm:true}],routeStates:[{stationIndex:0,routeId:'TER X',role:'departure',pattern:0},{stationIndex:1,routeId:'TER X',role:'arrival',pattern:0}],routeInfo:{'TER X':{mode:'TER',waitMinutes:0}},boardingStates:[[0],[]],stationStates:[[],[1]],adjacency:[[[1,1]],[]],walkingNetwork:road};
road.stationSnaps(d.stations);
const model=buildTravelModel(d,[25,0],true,{stationEntryPenalty:0,stationExitPenalty:0});
assert.equal(estimateTravel(d,model,[1025,0]),1.625,'Include both initial and final road walking');
const journey=describeJourney(d,model,[1025,0]);assert.equal(journey.walking,0.625);assert.equal(journey.legs[0].minutes,1);assert.equal(journey.waiting,0);
assert.equal(estimateTravel(d,model,[25,0]),0);
const faster=buildTravelModel(d,[25,0],true,{stationEntryPenalty:0,stationExitPenalty:0,walkSpeedKmh:8});
assert(Math.abs(estimateTravel(d,faster,[1025,0])-1.375)<1e-9,'Walking speed must affect both road access legs');
const limited=buildTravelModel(d,[25,0],true,{stationEntryPenalty:0,stationExitPenalty:0,walkingLimitMinutes:2});
assert.equal(estimateTravel(d,limited,[1025,0]),1.625,'Bounding the search must preserve every time within the bound');
assert.equal(estimateTravel(d,model,[500,100]),Infinity,'Inside coverage, unsnappable points must not silently use straight-line walking');

const binary=zlib.gunzipSync(fs.readFileSync(new URL('../site/data/point_walking.bin.gz',import.meta.url)));
const data=JSON.parse(fs.readFileSync(new URL('../site/data/commute_map_data.json',import.meta.url)));
// A simple mask is sufficient for these interior fixtures; the UI uses exact polygons.
const covered=p=>{const m=data.meta,c=Math.floor((p[0]-m.bounds[0])/(m.bounds[2]-m.bounds[0])*m.gridCols),r=Math.floor((p[1]-m.bounds[1])/(m.bounds[3]-m.bounds[1])*m.gridRows);return c>=0&&r>=0&&c<m.gridCols&&r<m.gridRows&&data.mask[r*m.gridCols+c]!==-1};
const network=new WalkingNetwork(binary.buffer.slice(binary.byteOffset,binary.byteOffset+binary.byteLength),covered);data.walkingNetwork=network;network.stationSnaps(data.stations);
const named=name=>data.stations.map((s,i)=>({s,i})).filter(x=>x.s.name===name);
const pairs=[['Jumeaux','Jumeaux'],['Porte de Loire','Place Choiseul'],['Ile Aucard','Place Choiseul']];
const measured=[];
for(const [a,b] of pairs){const aa=named(a),bb=named(b);assert(aa.length&&bb.length);const first=aa[0],second=a===b?aa.find(x=>x.i!==first.i):bb[0];const f=network.search([[network.stops[first.i],0,-1]]);const metres=network.at(f,network.stops[second.i]).cost/100;const direct=Math.hypot(first.s.point[0]-second.s.point[0],first.s.point[1]-second.s.point[1]);assert(metres>=direct-1);if(a==='Jumeaux')assert(metres>500);if(a==='Ile Aucard')assert(metres>650);measured.push({from:a,to:b,roadMetres:Math.round(metres),straightMetres:Math.round(direct)});}
const portal=data.stations.findIndex(s=>s.id==='FILBLEU:TTR:PODLB-1'),bridge=data.stations.findIndex(s=>s.id==='FILBLEU:TTR:CHONB-2A');
const bridgeField=network.search([[network.stops[portal],0,-1]]);assert(Math.abs(network.at(bridgeField,network.stops[bridge]).cost/100-610.2)<1,'Preserve the audited Loire bridge path');
const origin=named('Tours')[0].s.point;
let start=performance.now();const full=buildTravelModel(data,origin);const fullMs=performance.now()-start;
start=performance.now();const bounded=buildTravelModel(data,origin,true,{walkingLimitMinutes:90});const boundedMs=performance.now()-start;
let checked=0;
for(const point of [...data.cells.filter((_,i)=>i%37===0).map(c=>c.point),...data.stations.map(s=>s.point)]){const a=estimateTravel(data,full,point),b=estimateTravel(data,bounded,point);if(a<=90){assert(Math.abs(a-b)<1e-7);checked++;}}
const rail=describeJourney(data,full,named('Orléans')[0].s.point);assert(rail.legs.length);assert(rail.walkingApproximation,'Outside coverage must be labelled approximate');
console.log(JSON.stringify({measured,withinBoundComparisons:checked,fullModelMs:Math.round(fullMs),boundedModelMs:Math.round(boundedMs),decodedBytes:binary.length},null,2));
