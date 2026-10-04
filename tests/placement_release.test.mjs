import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {snapToRailStation} from '../site/placement.mjs';
const source=fs.readFileSync(new URL('../site/app.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('function settleOutsideStation('),source.indexOf('function parsePair('));
const state={originPoint:[5000,0],probePoint:null,dragTarget:'origin',dragMoved:true,data:{stations:[{mode:'TER',point:[6000,0],routes:['ter']}],routeInfo:{ter:{mode:'TER'}}}};
const context={state,snapToRailStation,pointInLand:p=>p[0]<1000,mapCanvas:{hasPointerCapture:()=>false},syncUrl(){},requestDraw(){},syncCursor(){}};
vm.createContext(context);vm.runInContext(code,context);
assert.deepEqual(state.originPoint,[5000,0]); // Free intermediate position during the gesture.
vm.runInContext('endDrag({type:"pointerup",pointerId:1})',context);
assert.deepEqual(state.originPoint,[6000,0]);
state.originPoint=[5000,0];state.dragTarget='pan';state.dragMoved=true;
vm.runInContext('endDrag({type:"pointerup",pointerId:1})',context);
assert.deepEqual(state.originPoint,[5000,0]); // Panning cannot relocate an existing point.
state.originPoint=[100,0];state.dragTarget='origin';state.dragMoved=true;
vm.runInContext('endDrag({type:"pointerup",pointerId:1})',context);
assert.deepEqual(state.originPoint,[100,0]); // No compulsory snap within the SERM.
console.log('Outside SERM: snap on release only; panning and inside points preserved');
