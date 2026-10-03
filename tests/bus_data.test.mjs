import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildTravelModel, describeJourney } from '../site/routing.mjs';

const data = JSON.parse(fs.readFileSync(new URL('../site/data/commute_map_data.json', import.meta.url)));
const bus = JSON.parse(fs.readFileSync(new URL('../data/tours/filbleu_bus.json', import.meta.url)));
const plannedRoutes = new Set(bus.patterns.map(p => p.routeId));
let intervals = 0;
for (const p of bus.patterns) {
  assert.equal(p.requiresReservation, false, `Conditional service imported: ${p.tripId}`);
}
for (const [id, info] of Object.entries(bus.routes)) {
  assert.equal(info.calculationAvailable, plannedRoutes.has(id), `Availability mismatch ${id}`);
  if (!info.calculationAvailable) {
    assert(!data.routeStates.some(s => s.routeId === id), `Excluded route remains routable: ${id}`);
  }
}
// A GTFS time rounded to a minute can give adjacent stops the same timestamp.
// Allow one minute of quantisation, but reject fast long jumps over ANY span.
// This caught zonal R4's fictitious instantaneous cross-zone journeys.
for (const p of data.timetablePatterns) {
  if (data.routeInfo[p.routeId].mode !== 'BUS') continue;
  for (let i = 0; i < p.stops.length - 1; i++) for (let j = i + 1; j < p.stops.length; j++) {
    const a = data.stations[p.stops[i]].point, b = data.stations[p.stops[j]].point;
    const metres = Math.hypot(a[0] - b[0], a[1] - b[1]);
    const minutes = p.arrivals[j] - p.departures[i];
    assert(minutes >= 0, `Negative interval ${p.routeId}`);
    assert(metres / (minutes + 1) * .06 <= 100, `Implausible bus span ${p.routeId} ${i}-${j}`);
    intervals++;
  }
}
assert.equal(bus.routes['BUS R4'].calculationAvailable, false);
assert.equal(bus.routes['BUS R5'].calculationAvailable, false);
const origin = data.stations.find(s => s.id === 'FILBLEU:TTR:LEMOB-1').point;
assert(data.stations.find(s => s.id === 'FILBLEU:TTR:LEMOB-1').displayRoutes.includes('BUS R4'),
  'Excluded reservation service missing from display metadata');
const target = data.stations.find(s => s.name === 'Baillardière').point;
const trip = describeJourney(data, buildTravelModel(data, origin), target);
assert(trip.minutes > 15, 'Les Montils–Baillardière still has a fictitious 15-minute shortcut');
assert(!trip.legs.some(l => l.routeId === 'BUS R4'));
console.log(JSON.stringify({ routes: Object.keys(bus.routes).length, fixedPatterns: bus.patterns.length,
  checkedBusIntervals: intervals, montilsBaillardiereMinutes: trip.minutes }, null, 2));
