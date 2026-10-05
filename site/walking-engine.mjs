import { WalkingNetwork } from './walking.mjs';
import { buildTravelModel, estimateTravel, describeJourney, reachability } from './routing.mjs?v=2026-10-05f';

function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [a, b] = ring[i], [c, d] = ring[j];
    if ((b > y) !== (d > y) && x < (c - a) * (y - b) / (d - b) + a) inside = !inside;
  }
  return inside;
}
export function coverageFor(data) {
  const polygons = data.boroughs.flatMap(b => b.polygons).map(p => {
    const xs = p[0].map(v => v[0]), ys = p[0].map(v => v[1]);
    return { p, bounds: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
  });
  return point => polygons.some(({p, bounds: [a, b, c, d]}) => point[0] >= a && point[0] <= c && point[1] >= b && point[1] <= d && inRing(point, p[0]) && !p.slice(1).some(h => inRing(point, h)));
}

// Finite values outside the displayed time range are essential for marching
// squares: Infinity must not remove a quad or produce a NaN intersection.
export function surfaceValue(network, model, point, snap, ceiling) {
  if (!snap || !model.pureWalkingField) return ceiling;
  const speedCm = model.settings.walkMetersPerMinute * 100;
  const pure = network.at(model.pureWalkingField, snap);
  const pureMinutes = pure.cost / speedCm;
  if (!Number.isFinite(pureMinutes)) return ceiling;
  if (!model.comfortWalkingField) return Math.min(ceiling, pureMinutes);

  const comfort = network.at(model.comfortWalkingField, snap);
  if (!Number.isFinite(comfort.cost)) return Math.min(ceiling, pureMinutes);
  const transfers = comfort.owner >= 0 ? (model.comfortStationArrivals[comfort.owner]?.transferCount || 0) : 0;
  const actualMinutes = comfort.cost / speedCm - transfers * model.comfortTransferPreferenceMinutes;
  return Math.min(ceiling, actualMinutes);
}

export class WalkingEngine {
  constructor(data, buffer) {
    this.data = data;
    this.covered = coverageFor(data);
    this.network = new WalkingNetwork(buffer, this.covered);
    this.network.stationSnaps(data.stations);
    data.walkingNetwork = this.network;
    this.grids = new Map();
  }
  grid(spec) {
    const key = JSON.stringify(spec);
    if (this.grids.has(key)) return this.grids.get(key);
    const { bounds, cols, rows } = spec;
    const cellW = (bounds[2] - bounds[0]) / cols, cellH = (bounds[3] - bounds[1]) / rows;
    const points = [], snaps = [], validMask = Array.from({length: rows}, () => Array(cols).fill(false));
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const point = [bounds[0] + (col + .5) * cellW, bounds[1] + (row + .5) * cellH];
      if (!this.covered(point)) continue;
      validMask[row][col] = true;
      points.push([row, col, point]);
      // Display only: spread the road field over its immediate surroundings.
      // This does not create edges, and is NEVER used for a selected point.
      snaps.push(this.network.snap(point, 350));
    }
    const grid = { points, snaps, validMask, bounds, cellW, cellH, rows, cols };
    if (this.grids.size >= 3) this.grids.delete(this.grids.keys().next().value);
    this.grids.set(key, grid);
    return grid;
  }
  calculate(request) {
    const start = performance.now();
    const { origin, probe, includeProjects, settings, threshold, maxTime, preview, spec } = request;
    const walkingLimitMinutes = preview ? Math.max(threshold, maxTime) + 15 : Infinity;
    const modelKey = JSON.stringify([origin, includeProjects, settings, walkingLimitMinutes]);
    if (this.modelKey !== modelKey) {
      this.model = buildTravelModel(this.data, origin, includeProjects, {...settings, walkingLimitMinutes});
      this.modelKey = modelKey;
    }
    const model = this.model, modelMs = performance.now() - start;
    const grid = this.grid(spec), ceiling = Math.max(threshold, maxTime) + 15;
    const minutes = Array.from({length: grid.rows}, () => Array(grid.cols).fill(ceiling));
    for (let i = 0; i < grid.points.length; i++) {
      const [row, col, point] = grid.points[i];
      // A departure outside the IGN coverage retains the stated fallback;
      // railway arrivals still seed the road field inside the SERM.
      minutes[row][col] = surfaceValue(this.network, model, point, grid.snaps[i], ceiling);
    }
    const stationMinutes = this.data.stations.map(s => estimateTravel(this.data, model, s.point));
    const probeDetails = probe ? estimateTravel(this.data, model, probe, true) : null;
    const journey = probe && !preview ? describeJourney(this.data, model, probe) : null;
    return {
      key: request.key, origin, probe, preview, settingsKey: request.settingsKey,
      warp: {minutes, validMask: grid.validMask, bounds: grid.bounds, cellW: grid.cellW, cellH: grid.cellH},
      activeStations: model.activeStations, stationMinutes, probeDetails, journey,
      reach: reachability(this.data, model, threshold), sourceCovered: model.sourceCovered,
      sourceConnected: Boolean(model.sourceSnap), modelMs, totalMs: performance.now() - start,
    };
  }
}
