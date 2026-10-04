import assert from 'node:assert/strict';
import {snapToRailStation} from '../site/placement.mjs';
const stations = [
 {mode:'BUS',point:[1,0],routes:['bus']},
 {mode:'TER',point:[10,0],routes:['suspended']},
 {mode:'TER',point:[20,0],routes:[]},
 {mode:'TER',point:[800,0],drawPoint:[799,2],routes:['ter']},
 {mode:'TER',point:[900,0],routes:['ter']},
];
const info={bus:{mode:'BUS'},ter:{mode:'TER'},suspended:{mode:'TER',serviceStatus:{status:'suspended'}}};
const point=[0,0];
assert.deepEqual(snapToRailStation(point,stations,info,1000),[800,0]);
assert.equal(snapToRailStation(point,stations,info,500),point);
assert.equal(snapToRailStation(point,stations,info,0),point);
assert.deepEqual(point,[0,0]);
console.log('TER placement: nearest serviced station, radius, physical coordinates and exclusions verified');
