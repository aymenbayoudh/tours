import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { buildTravelModel, estimateTravel } from '../site/routing.mjs';

const data = JSON.parse(fs.readFileSync(new URL('../site/data/commute_map_data.json', import.meta.url)));
function exhaustiveVariant(model, destination, arrivals) {
  const speed = model.settings.walkMetersPerMinute;
  let bestActual = Math.hypot(model.origin[0] - destination[0], model.origin[1] - destination[1]) / speed;
  let bestScore = bestActual;
  for (let i = 0; i < data.stations.length; i++) {
    const arrival = arrivals[i];
    if (!Number.isFinite(arrival.minutes)) continue;
    const p = data.stations[i].point;
    const exit = data.stations[i].mode === "BUS" ? model.settings.busExitPenalty : model.settings.stationExitPenalty;
    const walk = Math.hypot(p[0] - destination[0], p[1] - destination[1]) / speed;
    const actual = arrival.minutes + exit + walk;
    const score = arrival.preferenceScore + exit + walk;
    if (score < bestScore || (score === bestScore && actual < bestActual)) {
      bestScore = score;
      bestActual = actual;
    }
  }
  return bestActual;
}
function exhaustive(model, destination) {
  const pure = exhaustiveVariant(model, destination, model.pureStationArrivals);
  return pure < model.shortTripFastestMinutes
    ? pure
    : exhaustiveVariant(model, destination, model.comfortStationArrivals);
}
let checks = 0, maximumError = 0;
for (const [name, projects, settings] of [
  ['Tours', true, {}], ['Rotière', false, {}], ['Orléans', true, { terWait: 0, stationExitPenalty: 0 }],
  ['Agrocampus', true, { busEntryPenalty: 0, busExitPenalty: 9, busTransferPenalty: 0, busWalkingTransferPenalty: 0 }],
  ['Tours', false, { tramWait: 20, walkingTransferPenalty: 10, stationExitPenalty: 8 }],
]) {
  const origin = data.stations.find(s => s.name === name).point;
  const model = buildTravelModel(data, origin, projects, settings);
  const destinations = [origin, ...data.stations.map(s => s.point),
    ...data.cells.filter((_, i) => name === 'Tours' && projects || i % 37 === 0).map(c => c.point),
    [origin[0] - 500000, origin[1] + 500000]];
  for (const point of destinations) {
    const expected = exhaustive(model, point);
    const actual = estimateTravel(data, model, point);
    maximumError = Math.max(maximumError, Math.abs(actual - expected));
    assert.ok(Math.abs(actual - expected) < 1e-9, `${name}: ${point}: ${actual} != ${expected}`);
    checks++;
  }
}
const model = buildTravelModel(data, data.stations.find(s => s.name === 'Tours').point);
// Exercise both paths on identical data in the same process; no timing assertion
// since CI hardware varies. The old path is still used for detailed itineraries.
const scanModel = { ...model, pureArrivalIndex: null, comfortArrivalIndex: null };
const measurements = [];
for (let pass = 0; pass < 3; pass++) {
  let start = performance.now();
  for (const c of data.cells) estimateTravel(data, scanModel, c.point);
  const scanMs = performance.now() - start;
  start = performance.now();
  for (const c of data.cells) estimateTravel(data, model, c.point);
  measurements.push({ scanMs: +scanMs.toFixed(1), indexedMs: +(performance.now() - start).toFixed(1) });
}
console.log(JSON.stringify({ checks, maximumError, measurements }, null, 2));
