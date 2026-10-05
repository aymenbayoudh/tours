import assert from 'node:assert/strict';
import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { WalkingEngine } from '../site/walking-engine.mjs';
import { buildTravelModel, describeJourney } from '../site/routing.mjs';

const data = JSON.parse(fs.readFileSync(new URL('../site/data/commute_map_data.json', import.meta.url)));
const packed = fs.readFileSync(new URL('../site/data/point_walking.bin.gz', import.meta.url));
const unpacked = gunzipSync(packed);
new WalkingEngine(data, unpacked.buffer.slice(unpacked.byteOffset, unpacked.byteOffset + unpacked.byteLength));

const station = name => {
  const result = data.stations.find(item => item.name === name);
  assert.ok(result, `Missing station ${name}`);
  return result;
};
// Isolate the original local feeders from the newly added interurban network.
const settings = { walkSpeedKmh: 4.8, busWaitFactor: 0, terWaitFactor: 1, tramWaitFactor: 1, disabledBusNetworks: ["remi"] };

for (const { from, to, feeder } of [
  { from: 'EHPAD L’Auverdière', to: 'Blois-Chambord', feeder: 'BUS Le Lien Bléré Navette' },
  { from: "L'Amasse", to: 'Blois-Chambord', feeder: 'BUS Le Bus Amboise Nav1' },
]) {
  const source = station(from), destination = station(to);
  const model = buildTravelModel(data, source.point, true, settings);
  const journey = describeJourney(data, model, destination.point);
  assert.ok(journey.legs.some(leg => leg.routeId === feeder), `${from}→${to} should use its local bus feeder; got ${journey.legs.map(leg => leg.routeId).join(', ')}`);
  assert.ok(journey.walking < 10, `${from}→${to} should not replace the local bus feeder with a long walk (${journey.walking.toFixed(1)} min)`);
}

console.log('Intermodal feeder tests: ok');
