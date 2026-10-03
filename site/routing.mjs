// Pure routing core: directed, observed stopping patterns; estimated waiting.
// Runtime settings can scale in-vehicle timetable durations while preserving
// the observed stop sequence and relative segment times.
class MinHeap {
  constructor() { this.items = []; }
  push(item) {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= item[0]) break;
      a[i] = a[p];
      i = p;
    }
    a[i] = item;
  }
  pop() {
    const a = this.items;
    if (!a.length) return null;
    const first = a[0];
    const last = a.pop();
    if (a.length) {
      let i = 0;
      while (i * 2 + 1 < a.length) {
        let c = i * 2 + 1;
        if (c + 1 < a.length && a[c + 1][0] < a[c][0]) c += 1;
        if (a[c][0] >= last[0]) break;
        a[i] = a[c];
        i = c;
      }
      a[i] = last;
    }
    return first;
  }
  get length() { return this.items.length; }
}

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function numeric(value, fallback, min = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, number) : fallback;
}

function normalizeSettings(data, value = {}) {
  return {
    walkMetersPerMinute: data.meta.walkMetersPerMinute || 80,
    terWait: numeric(value.terWait, 15, 0),
    navetteWait: numeric(value.navetteWait, 5, 0),
    tramWait: numeric(value.tramWait, 4, 0),
    bhnsWait: numeric(value.bhnsWait, 3.25, 0),
    stationEntryPenalty: numeric(value.stationEntryPenalty, data.meta.stationAccessPenalty ?? 1.8, 0),
    stationExitPenalty: numeric(value.stationExitPenalty, data.meta.stationAccessPenalty ?? 1.8, 0),
    transferPenalty: numeric(value.transferPenalty, 3.5, 0),
    walkingTransferPenalty: numeric(value.walkingTransferPenalty, 2, 0),
  };
}

function routeMode(data, routeId) {
  const mode = data.routeInfo?.[routeId]?.mode;
  if (mode) return mode;
  if (routeId === "NAVETTE") return "NAVETTE";
  if (routeId?.startsWith("TRAM")) return "TRAM";
  if (routeId?.startsWith("BHNS")) return "BHNS";
  return "TER";
}

function waitForRoute(data, routeId, settings) {
  const mode = routeMode(data, routeId);
  if (mode === "NAVETTE") return settings.navetteWait;
  if (mode === "TRAM") return settings.tramWait;
  if (mode === "BHNS") return settings.bhnsWait;
  return settings.terWait;
}

function adjustedEdgeCost(data, fromNode, toNode, storedCost, settings) {
  const a = data.routeStates[fromNode];
  const b = data.routeStates[toNode];
  if (!a || !b) return storedCost;

  // In-vehicle durations are already encoded in the graph: representative
  // GTFS durations when available, otherwise the fixed geometric fallback
  // produced at build time for unscheduled/project routes.
  if (
    a.role === "departure" &&
    b.role === "arrival" &&
    a.routeId === b.routeId &&
    a.stationIndex !== b.stationIndex
  ) {
    return storedCost;
  }

  if (a.role === "arrival" && b.role === "departure") {
    const sameStation = a.stationIndex === b.stationIndex;
    const samePattern = a.pattern !== null && a.pattern === b.pattern;
    const fallbackStayAboard = a.routeId === b.routeId && a.pattern === null && b.pattern === null && storedCost === 0;

    // Dwell / staying aboard must not pay a second wait.
    if (sameStation && (samePattern || fallbackStayAboard)) return storedCost;

    const wait = waitForRoute(data, b.routeId, settings);
    if (sameStation) return settings.transferPenalty + wait;

    const walkDistance = distance(data.stations[a.stationIndex].point, data.stations[b.stationIndex].point);
    return walkDistance / settings.walkMetersPerMinute + settings.walkingTransferPenalty + wait;
  }

  return storedCost;
}

export function buildTravelModel(data, origin, includeProjects = true, customSettings = {}) {
  const settings = normalizeSettings(data, customSettings);
  const distances = new Float64Array(data.routeStates.length).fill(Infinity);
  const previous = new Int32Array(data.routeStates.length).fill(-1);
  const allowed = data.routeStates.map((s) => {
    const info = data.routeInfo?.[s.routeId];
    if (info?.serviceStatus?.status === "suspended") return false;
    return includeProjects || !info?.planned;
  });
  const queue = new MinHeap();

  // Consider every possible boarding stop, not just the closest handful.
  data.stations.forEach((station, index) => {
    const access = distance(origin, station.point) / settings.walkMetersPerMinute + settings.stationEntryPenalty;
    for (const node of data.boardingStates[index] || []) {
      if (!allowed[node]) continue;
      const value = access + waitForRoute(data, data.routeStates[node].routeId, settings);
      if (value < distances[node]) {
        distances[node] = value;
        queue.push([value, node]);
      }
    }
  });

  while (queue.length) {
    const [value, node] = queue.pop();
    if (value !== distances[node]) continue;
    for (const [next, storedCost] of data.adjacency[node]) {
      if (!allowed[next]) continue;
      const cost = adjustedEdgeCost(data, node, next, storedCost, settings);
      const candidate = value + cost;
      if (candidate < distances[next]) {
        distances[next] = candidate;
        previous[next] = node;
        queue.push([candidate, next]);
      }
    }
  }

  const stationArrivals = data.stationStates.map((nodes) => {
    let best = Infinity;
    let node = -1;
    for (const n of nodes) {
      if (allowed[n] && distances[n] < best) {
        best = distances[n];
        node = n;
      }
    }
    return { minutes: best, node };
  });
  const activeStations = data.boardingStates.map((nodes) => nodes.some((n) => allowed[n]));
  return { origin, includeProjects, distances, previous, stationArrivals, activeStations, settings };
}

export function estimateTravel(data, model, destination, details = false) {
  const walk = model.settings?.walkMetersPerMinute || data.meta.walkMetersPerMinute;
  const exitPenalty = model.settings?.stationExitPenalty ?? data.meta.stationAccessPenalty;
  let best = distance(model.origin, destination) / walk;
  let bestStation = -1;
  for (let i = 0; i < data.stations.length; i += 1) {
    const arrival = model.stationArrivals[i].minutes + exitPenalty;
    if (arrival >= best) continue;
    const point = data.stations[i].point;
    const remaining = (best - arrival) * walk;
    if (Math.abs(point[0] - destination[0]) >= remaining || Math.abs(point[1] - destination[1]) >= remaining) continue;
    const value = arrival + distance(point, destination) / walk;
    if (value < best) {
      best = value;
      bestStation = i;
    }
  }
  return details ? { minutes: best, station: bestStation } : best;
}

export function reachability(data, model, threshold) {
  let reachable = 0;
  let total = 0;
  data.stations.forEach((station, i) => {
    if (!model.activeStations[i]) return;
    total += 1;
    if (estimateTravel(data, model, station.point) <= threshold + 1e-7) reachable += 1;
  });
  return { reachable, total };
}

export function describeJourney(data, model, destination) {
  const result = estimateTravel(data, model, destination, true);
  const walkSpeed = model.settings?.walkMetersPerMinute || data.meta.walkMetersPerMinute;
  if (result.station < 0) return { minutes: result.minutes, legs: [], walking: result.minutes, waiting: 0 };
  const nodes = [];
  let n = model.stationArrivals[result.station].node;
  while (n >= 0) {
    nodes.push(n);
    n = model.previous[n];
  }
  nodes.reverse();

  const legs = [];
  for (let i = 1; i < nodes.length; i += 1) {
    const a = data.routeStates[nodes[i - 1]];
    const b = data.routeStates[nodes[i]];
    if (a.role !== "departure" || b.role !== "arrival" || a.stationIndex === b.stationIndex) continue;
    const last = legs.at(-1);
    if (last && last.pattern === a.pattern && last.routeId === a.routeId && last.to === a.stationIndex) {
      last.to = b.stationIndex;
      last.end = model.distances[nodes[i]];
      last.minutes = last.end - last.start;
    } else {
      legs.push({
        routeId: a.routeId,
        pattern: a.pattern,
        from: a.stationIndex,
        to: b.stationIndex,
        start: model.distances[nodes[i - 1]],
        end: model.distances[nodes[i]],
        minutes: model.distances[nodes[i]] - model.distances[nodes[i - 1]],
      });
    }
  }

  const first = data.routeStates[nodes[0]].stationIndex;
  let walking = (distance(model.origin, data.stations[first].point) + distance(destination, data.stations[result.station].point)) / walkSpeed;
  for (let i = 1; i < nodes.length; i += 1) {
    const a = data.routeStates[nodes[i - 1]];
    const b = data.routeStates[nodes[i]];
    if (a.role === "arrival" && b.role === "departure" && a.stationIndex !== b.stationIndex) {
      walking += distance(data.stations[a.stationIndex].point, data.stations[b.stationIndex].point) / walkSpeed;
    }
  }
  return {
    minutes: result.minutes,
    legs,
    walking,
    waiting: Math.max(0, result.minutes - walking - legs.reduce((sum, l) => sum + l.minutes, 0)),
  };
}
