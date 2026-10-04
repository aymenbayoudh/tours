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
    navetteWaitFactor: numeric(value.navetteWaitFactor, 1, 0),
    terWaitFactor: numeric(value.terWaitFactor, 1, 0),
    tramWaitFactor: numeric(value.tramWaitFactor, 1, 0),
    terWait: numeric(value.terWait, 15, 0),
    navetteWait: numeric(value.navetteWait, 5, 0),
    tramWait: numeric(value.tramWait, 4, 0),
    busWaitFactor: numeric(value.busWaitFactor, 1, 0),
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
  if (mode === "NAVETTE") return settings.navetteWaitFactor * (settings.navetteWait !== 5 ? settings.navetteWait : numeric(data.routeInfo?.[routeId]?.waitMinutes, settings.navetteWait));
  if (mode === "TRAM") return settings.tramWaitFactor * (settings.tramWait !== 4 ? settings.tramWait : numeric(data.routeInfo?.[routeId]?.waitMinutes, settings.tramWait));
  if (mode === "BHNS") return settings.bhnsWait;
  if (mode === "BUS") return settings.busWaitFactor * numeric(data.routeInfo?.[routeId]?.waitMinutes, data.routeWaits?.[routeId] ?? 10, 0);
  return settings.terWaitFactor * (settings.terWait !== 15 ? settings.terWait : numeric(data.routeInfo?.[routeId]?.waitMinutes, settings.terWait));
}

function adjustedEdgeCost(data, fromNode, toNode, storedCost, settings, walkingMetres = null) {
  const a = data.routeStates[fromNode];
  const b = data.routeStates[toNode];
  if (!a || !b) return storedCost;

  // Transfer hubs avoid a Cartesian product of route states at dense bus stops.
  // The stored costs use defaults; recompute them here so shared/custom settings
  // keep exactly the same semantics as direct transfer edges.
  if (a.role === "board" && b.role === "departure") {
    return waitForRoute(data, b.routeId, settings);
  }
  if (a.role === "alight" && b.role === "board") {
    if (a.stationIndex === b.stationIndex) return settings.transferPenalty;
    const walkDistance = Number.isFinite(walkingMetres)
      ? walkingMetres
      : distance(data.stations[a.stationIndex].point, data.stations[b.stationIndex].point);
    return walkDistance / settings.walkMetersPerMinute + settings.walkingTransferPenalty;
  }

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

// Geometry is immutable for the lifetime of a loaded dataset. Reuse its spatial
// partition across origins; only minimum arrival times depend on the model.
const spatialTrees = new WeakMap();
function stationTree(data) {
  if (spatialTrees.has(data)) return spatialTrees.get(data);
  let count = 0;
  function split(indices) {
    if (!indices.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const i of indices) {
      const [x, y] = data.stations[i].point;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    const node = { id: count++, minX, minY, maxX, maxY };
    if (indices.length <= 8) node.indices = indices;
    else {
      const axis = maxX - minX >= maxY - minY ? 0 : 1;
      indices.sort((a, b) => data.stations[a].point[axis] - data.stations[b].point[axis]);
      const middle = Math.floor(indices.length / 2);
      node.left = split(indices.slice(0, middle));
      node.right = split(indices.slice(middle));
    }
    return node;
  }
  const root = split(data.stations.map((_, i) => i));
  const tree = { root, count };
  spatialTrees.set(data, tree);
  return tree;
}

function arrivalIndex(data, arrivals) {
  const tree = stationTree(data);
  const minimum = new Float64Array(tree.count).fill(Infinity);
  function visit(node) {
    if (!node) return Infinity;
    let best = Infinity;
    if (node.indices) {
      for (const i of node.indices) best = Math.min(best, arrivals[i].minutes);
    } else best = Math.min(visit(node.left), visit(node.right));
    minimum[node.id] = best;
    return best;
  }
  visit(tree.root);
  return { root: tree.root, minimum };
}

function indexedEstimate(data, model, destination, walk, exitPenalty, best) {
  const { root, minimum } = model.arrivalIndex;
  const [x, y] = destination;
  // Minimum arrival in a box + distance to that box is a lower bound on
  // every stop in it. No fixed nearest-stop limit, and no approximate pruning.
  function bound(node) {
    if (!node) return Infinity;
    const dx = Math.max(node.minX - x, 0, x - node.maxX);
    const dy = Math.max(node.minY - y, 0, y - node.maxY);
    return minimum[node.id] + exitPenalty + Math.hypot(dx, dy) / walk;
  }
  function visit(node, lower) {
    if (!node || lower > best + 1e-10) return;
    if (node.indices) {
      for (const i of node.indices) {
        const arrival = model.stationArrivals[i].minutes + exitPenalty;
        if (arrival >= best) continue;
        best = Math.min(best, arrival + distance(data.stations[i].point, destination) / walk);
      }
    } else {
      const left = bound(node.left), right = bound(node.right);
      if (left <= right) { visit(node.left, left); visit(node.right, right); }
      else { visit(node.right, right); visit(node.left, left); }
    }
  }
  visit(root, bound(root));
  return best;
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
    for (const [next, storedCost, walkingMetres] of data.adjacency[node]) {
      if (!allowed[next]) continue;
      const cost = adjustedEdgeCost(data, node, next, storedCost, settings, walkingMetres);
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
  const stationOrder = stationArrivals
    .map((arrival, index) => [arrival.minutes, index])
    .filter(([minutes]) => Number.isFinite(minutes))
    .sort((a, b) => a[0] - b[0])
    .map(([, index]) => index);
  return { origin, includeProjects, distances, previous, stationArrivals, activeStations, stationOrder, settings,
    arrivalIndex: arrivalIndex(data, stationArrivals) };
}

export function estimateTravel(data, model, destination, details = false) {
  const walk = model.settings?.walkMetersPerMinute || data.meta.walkMetersPerMinute;
  const exitPenalty = model.settings?.stationExitPenalty ?? data.meta.stationAccessPenalty;
  let best = distance(model.origin, destination) / walk;
  // Keep the stable, time-sorted scan for journey details and tie selection.
  if (!details && model.arrivalIndex) return indexedEstimate(data, model, destination, walk, exitPenalty, best);
  let bestStation = -1;
  const candidates = model.stationOrder || data.stations.map((_, index) => index);
  for (const i of candidates) {
    const arrival = model.stationArrivals[i].minutes + exitPenalty;
    if (arrival >= best) break;
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
    if (
      ((a.role === "arrival" && b.role === "departure") || (a.role === "alight" && b.role === "board")) &&
      a.stationIndex !== b.stationIndex
    ) {
      const edge = data.adjacency[nodes[i - 1]]?.find(([next]) => next === nodes[i]);
      const walkMetres = Number.isFinite(edge?.[2])
        ? edge[2]
        : distance(data.stations[a.stationIndex].point, data.stations[b.stationIndex].point);
      walking += walkMetres / walkSpeed;
    }
  }
  return {
    minutes: result.minutes,
    legs,
    walking,
    waiting: Math.max(0, result.minutes - walking - legs.reduce((sum, l) => sum + l.minutes, 0)),
  };
}

export function routeWaitingMinutes(data, routeId, settings = {}) {
  return waitForRoute(data, routeId, normalizeSettings(data, settings));
}
