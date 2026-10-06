import assert from 'node:assert/strict';
import {createSettingsFile,parseSettingsFile} from '../site/settings-file.mjs';
const state={originPoint:[77000,5270000],probePoint:null,viewportCenter:[77001,5270001],viewportScale:9.55,outlineMinutes:[30],maxTransitTime:30,includeProjects:true,walkingOnRoads:false,data:{secret:'excluded'},dragTarget:'origin'};
const display={routeColors:{TER:'#123456'},isochroneStops:[{t:0,color:'#abcdef',alpha:.5}],labelScale:1.2};
const travel={walkSpeedKmh:4,disabledBusNetworks:['move'],busWaitFactor:0};
const text=createSettingsFile(display,travel,state), restored=parseSettingsFile(text);
assert.deepEqual(restored.display,display);assert.deepEqual(restored.travel,travel);
for(const key of Object.keys(restored.map)) assert.deepEqual(restored.map[key],state[key]);
assert(!text.includes('secret'));assert(!text.includes('dragTarget'));
for(const mutate of [v=>v.version=2,v=>v.map.viewportScale=0,v=>v.map.originPoint=[null,0],v=>v.map.maxTransitTime=1000,v=>v.map.walkingOnRoads='false',v=>v.map.outlineMinutes=[42],v=>delete v.display]){
 const v=JSON.parse(text);mutate(v);assert.throws(()=>parseSettingsFile(JSON.stringify(v)));
}
assert.throws(()=>parseSettingsFile('bad'));
console.log('Settings file: full round trip and invalid imports passed');
