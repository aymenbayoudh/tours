// Pure routing core: directed, observed stopping patterns; estimated waiting.
// Runtime settings can scale in-vehicle timetable durations while preserving
// the observed stop sequence and relative segment times.
// One heap entry per state: decrease-key avoids allocating tuples for every
// relaxation and processing obsolete queue entries on a moving origin.
class MinHeap {
  constructor(scores, values) {
    this.scores = scores; this.values = values;
    this.nodes = new Int32Array(scores.length);
    this.positions = new Int32Array(scores.length).fill(-1);
    this.length = 0;
  }
  before(a, b) {
    return this.scores[a] < this.scores[b] || (this.scores[a] === this.scores[b] && this.values[a] < this.values[b]);
  }
  push(node) {
    let i = this.positions[node];
    if (i < 0) i = this.length++;
    while (i > 0) {
      const p = (i - 1) >> 1, parent = this.nodes[p];
      if (!this.before(node, parent)) break;
      this.nodes[i] = parent; this.positions[parent] = i; i = p;
    }
    this.nodes[i] = node; this.positions[node] = i;
  }
  pop() {
    const first = this.nodes[0], last = this.nodes[--this.length];
    this.positions[first] = -1;
    if (this.length) {
      let i = 0;
      while (i * 2 + 1 < this.length) {
        let c = i * 2 + 1;
        if (c + 1 < this.length && this.before(this.nodes[c + 1], this.nodes[c])) c++;
        const child = this.nodes[c];
        if (!this.before(child, last)) break;
        this.nodes[i] = child; this.positions[child] = i; i = c;
      }
      this.nodes[i] = last; this.positions[last] = i;
    }
    return first;
  }
}

const distance = (a, b) => { const dx = a[0] - b[0], dy = a[1] - b[1]; return Math.sqrt(dx * dx + dy * dy); };
const TRANSFER_PREFERENCE_MINUTES = 30;
function numeric(value, fallback, min = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, number) : fallback;
}

function normalizeSettings(data, value = {}) {
  return {
    disabledBusNetworks: Array.isArray(value.disabledBusNetworks) ? value.disabledBusNetworks : [],
    walkMetersPerMinute: numeric(value.walkSpeedKmh, (data.meta.walkMetersPerMinute || 80) * 60 / 1000, 0.5) * 1000 / 60,
    navetteWaitFactor: numeric(value.navetteWaitFactor, 1, 0),
    terWaitFactor: numeric(value.terWaitFactor, 1, 0),
    tramWaitFactor: numeric(value.tramWaitFactor, 1, 0),
    terWait: numeric(value.terWait, 15, 0),
    navetteWait: numeric(value.navetteWait, 5, 0),
    tramWait: numeric(value.tramWait, 4, 0),
    busWaitFactor: numeric(value.busWaitFactor, 1, 0),
    bhnsWait: numeric(value.bhnsWait, 3.25, 0),
    busEntryPenalty: numeric(value.busEntryPenalty, 1.8, 0),
    busExitPenalty: numeric(value.busExitPenalty, 1.8, 0),
    busTransferPenalty: numeric(value.busTransferPenalty, 3.5, 0),
    busWalkingTransferPenalty: numeric(value.busWalkingTransferPenalty, 2, 0),
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

function exitMargin(data, settings, index) {
  return data.stations[index].mode === "BUS" ? settings.busExitPenalty : settings.stationExitPenalty;
}
function transferMargin(data, settings, a, b) {
  return data.stations[a].mode === "BUS" && data.stations[b].mode === "BUS" ? settings.busTransferPenalty : settings.transferPenalty;
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
    if (a.stationIndex === b.stationIndex) return transferMargin(data, settings, a.stationIndex, b.stationIndex);
    const walkDistance = Number.isFinite(walkingMetres)
      ? walkingMetres
      : distance(data.stations[a.stationIndex].point, data.stations[b.stationIndex].point);
    return walkDistance / settings.walkMetersPerMinute + (data.stations[a.stationIndex].mode === "BUS" && data.stations[b.stationIndex].mode === "BUS" ? settings.busWalkingTransferPenalty : settings.walkingTransferPenalty);
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
    const samePattern = Number.isInteger(a.pattern) && a.pattern === b.pattern;
    const fallbackStayAboard = a.routeId === b.routeId && a.pattern === null && b.pattern === null && storedCost === 0;

    // A real train dwell is in-vehicle time, never a second boarding.
    // Different profiles are separate vehicles, including at a line terminus.
    if (sameStation && (samePattern || fallbackStayAboard)) return storedCost;

    const wait = waitForRoute(data, b.routeId, settings);
    if (sameStation) return transferMargin(data, settings, a.stationIndex, b.stationIndex) + wait;

    const walkDistance = distance(data.stations[a.stationIndex].point, data.stations[b.stationIndex].point);
    return walkDistance / settings.walkMetersPerMinute + (data.stations[a.stationIndex].mode === "BUS" && data.stations[b.stationIndex].mode === "BUS" ? settings.busWalkingTransferPenalty : settings.walkingTransferPenalty) + wait;
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
    return minimum[node.id] + Math.sqrt(dx * dx + dy * dy) / walk;
  }
  function visit(node, lower) {
    if (!node || lower > best + 1e-10) return;
    if (node.indices) {
      for (const i of node.indices) {
        const arrival = model.stationArrivals[i].minutes + exitMargin(data, model.settings, i);
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

const preparedGraphs = new WeakMap();
function prepareRoutingGraph(data, includeProjects, settings) {
  const key = JSON.stringify([includeProjects, settings]);
  const cached = preparedGraphs.get(data);
  if (cached?.key === key) return cached;
  const allowed = data.routeStates.map(s => {
    const info = data.routeInfo?.[s.routeId];
    if (info?.serviceStatus?.status === "suspended") return false;
    if (info?.mode === "BUS" && settings.disabledBusNetworks.includes(info.network || "filbleu")) return false;
    return includeProjects || !info?.planned;
  });
  const offsets = new Uint32Array(data.routeStates.length + 1);
  for (let n = 0; n < data.adjacency.length; n++) offsets[n + 1] = offsets[n] + data.adjacency[n].length;
  const targets = new Uint32Array(offsets.at(-1));
  const costs = new Float64Array(targets.length);
  const transfers = new Uint16Array(targets.length);
  for (let n = 0; n < data.adjacency.length; n++) {
    let e = offsets[n];
    for (const edge of data.adjacency[n]) {
      targets[e] = edge[0]; costs[e] = adjustedEdgeCost(data, n, edge[0], edge[1], settings, edge[2]);
      transfers[e++] = Number(edge[3]) || 0;
    }
  }
  const waits = Float64Array.from(data.routeStates, s => waitForRoute(data, s.routeId, settings));
  const activeStations = data.boardingStates.map(nodes => nodes.some(n => allowed[n]));
  const graph = {key, allowed, offsets, targets, costs, transfers, waits, activeStations};
  preparedGraphs.set(data, graph);
  return graph;
}

function runRoutingVariant(data, graph, accessMinutes, settings, preferenceMinutes) {
  const { allowed, offsets, targets, costs, transfers, waits } = graph;
  const distances = new Float64Array(data.routeStates.length).fill(Infinity);
  const preferenceScores = new Float64Array(data.routeStates.length).fill(Infinity);
  const transferCounts = new Uint16Array(data.routeStates.length);
  transferCounts.fill(65535);
  const previous = new Int32Array(data.routeStates.length).fill(-1);
  const seedStations = new Int32Array(data.routeStates.length).fill(-1);
  const queue = new MinHeap(preferenceScores, distances);

  data.stations.forEach((station, index) => {
    const access = accessMinutes[index] + (station.mode === "BUS" ? settings.busEntryPenalty : settings.stationEntryPenalty);
    for (const node of data.boardingStates[index] || []) {
      if (!allowed[node]) continue;
      const value = access + waits[node];
      if (value < preferenceScores[node]) {
        distances[node] = value;
        preferenceScores[node] = value;
        transferCounts[node] = 0;
        seedStations[node] = index;
        queue.push(node);
      }
    }
  });

  while (queue.length) {
    const node = queue.pop(), value = distances[node];
    for (let e = offsets[node]; e < offsets[node + 1]; e++) {
      const next = targets[e];
      if (!allowed[next]) continue;
      const candidate = value + costs[e];
      const candidateTransfers = transferCounts[node] + transfers[e];
      const candidateScore = candidate + candidateTransfers * preferenceMinutes;
      if (
        candidateScore < preferenceScores[next]
        || (candidateScore === preferenceScores[next] && candidate < distances[next])
      ) {
        distances[next] = candidate;
        preferenceScores[next] = candidateScore;
        transferCounts[next] = candidateTransfers;
        previous[next] = node;
        seedStations[next] = seedStations[node];
        queue.push(next);
      }
    }
  }

  const stationArrivals = data.stationStates.map((nodes) => {
    let best = Infinity, bestScore = Infinity, bestTransfers = 65535, node = -1;
    for (const n of nodes) {
      if (!allowed[n]) continue;
      if (preferenceScores[n] < bestScore || (preferenceScores[n] === bestScore && distances[n] < best)) {
        best = distances[n];
        bestScore = preferenceScores[n];
        bestTransfers = transferCounts[n];
        node = n;
      }
    }
    return { minutes: best, node, transferCount: bestTransfers, preferenceScore: bestScore, seedStation: node >= 0 ? seedStations[node] : -1 };
  });
  const stationOrder = stationArrivals
    .map((arrival, index) => [arrival.minutes, index])
    .filter(([minutes]) => Number.isFinite(minutes))
    .sort((a, b) => a[0] - b[0])
    .map(([, index]) => index);
  return { distances, preferenceScores, transferCounts, previous, stationArrivals, stationOrder };
}

function indexedVariantEstimate(data, model, destination, variant, bestActual, bestScore) {
  const walk = model.settings.walkMetersPerMinute;
  const arrivals = variant === "comfort" ? model.comfortStationArrivals : model.pureStationArrivals;
  const index = variant === "comfort" ? model.comfortArrivalIndex : model.pureArrivalIndex;
  let station = -1;

  const consider = (i) => {
    const arrival = arrivals[i];
    if (!Number.isFinite(arrival.minutes)) return;
    const finalWalk = distance(data.stations[i].point, destination) / walk;
    const actual = arrival.minutes + exitMargin(data, model.settings, i) + finalWalk;
    const score = arrival.preferenceScore + exitMargin(data, model.settings, i) + finalWalk;
    if (score < bestScore || (score === bestScore && actual < bestActual)) {
      bestScore = score;
      bestActual = actual;
      station = i;
    }
  };

  if (!index) {
    for (let i = 0; i < data.stations.length; i++) consider(i);
    return { minutes: bestActual, score: bestScore, station };
  }

  const { root, minimum } = index;
  const [x, y] = destination;
  function bound(node) {
    if (!node) return Infinity;
    const dx = Math.max(node.minX - x, 0, x - node.maxX);
    const dy = Math.max(node.minY - y, 0, y - node.maxY);
    return minimum[node.id] + Math.sqrt(dx * dx + dy * dy) / walk;
  }
  function visit(node, lower) {
    if (!node || lower > bestScore + 1e-10) return;
    if (node.indices) {
      for (const i of node.indices) consider(i);
    } else {
      const left = bound(node.left), right = bound(node.right);
      if (left <= right) { visit(node.left, left); visit(node.right, right); }
      else { visit(node.right, right); visit(node.left, left); }
    }
  }
  visit(root, bound(root));
  return { minutes: bestActual, score: bestScore, station };
}

function roadVariantEstimate(data, model, destination, variant) {
  const road = data.walkingNetwork;
  const walk = model.settings.walkMetersPerMinute;
  const field = variant === "comfort" ? model.comfortWalkingField : model.pureWalkingField;
  const arrivals = variant === "comfort" ? model.comfortStationArrivals : model.pureStationArrivals;
  if (distance(model.origin, destination) < 0.1) {
    return {minutes:0, score:0, station:-1, finalWalkMinutes:0, walkingApproximation:false, variant};
  }
  const snap = road.freeSnap(destination);
  const point = snap && field ? road.at(field, snap) : {cost:Infinity, owner:-1};
  let score = point.cost / (walk * 100);
  let station = point.owner;
  let minutes = score;
  let finalWalkMinutes = minutes;

  if (station >= 0 && Number.isFinite(score)) {
    const arrival = arrivals[station];
    const baseScore = arrival.preferenceScore + exitMargin(data, model.settings, station);
    finalWalkMinutes = Math.max(0, score - baseScore);
    minutes = arrival.minutes + exitMargin(data, model.settings, station) + finalWalkMinutes;
  }

  for (const coincident of road.stationsAt(destination)) {
    const arrival = arrivals[coincident];
    if (!Number.isFinite(arrival.minutes)) continue;
    const finalWalk = distance(destination, data.stations[coincident].point) / walk;
    const actual = arrival.minutes + exitMargin(data, model.settings, coincident) + finalWalk;
    const candidateScore = arrival.preferenceScore + exitMargin(data, model.settings, coincident) + finalWalk;
    if (
      candidateScore < score
      || (candidateScore === score && actual < minutes)
    ) {
      score = candidateScore;
      minutes = actual;
      station = coincident;
      finalWalkMinutes = finalWalk;
    }
  }
  return {
    minutes, score, station, finalWalkMinutes,
    walkingApproximation:!model.sourceCovered,
    roadUnavailable:!Number.isFinite(minutes),
    variant,
  };
}

function offRoadVariantEstimate(data, model, destination, variant, details) {
  const walk = model.settings.walkMetersPerMinute;
  const direct = distance(model.origin, destination) / walk;
  const result = indexedVariantEstimate(data, model, destination, variant, direct, direct);
  if (!details) return result;
  return {
    ...result,
    finalWalkMinutes: result.station >= 0 ? distance(data.stations[result.station].point, destination) / walk : result.minutes,
    walkingApproximation:Boolean(data.walkingNetwork),
    variant,
  };
}

function variantEstimate(data, model, destination, variant, details = false) {
  if (data.walkingNetwork && data.walkingNetwork.coverage(destination)) return roadVariantEstimate(data, model, destination, variant);
  return offRoadVariantEstimate(data, model, destination, variant, details);
}

export function buildTravelModel(data, origin, includeProjects = true, customSettings = {}) {
  const settings = normalizeSettings(data, customSettings);
  const graph = prepareRoutingGraph(data, includeProjects, settings);
  const {allowed, activeStations} = graph;
  const road = data.walkingNetwork;
  const speedCm = settings.walkMetersPerMinute * 100;
  const limit = (customSettings.walkingLimitMinutes ?? Infinity) * speedCm;
  const accessMinutes = new Float64Array(data.stations.length);
  const sourceCovered = road?.coverage(origin) || false;
  let sourceSnap = sourceCovered ? road.freeSnap(origin) : undefined;
  if (sourceCovered) {
    const coincident = road.stationsAt(origin).find(i => road.stops[i]) ?? -1;
    if (coincident >= 0 && road.stops[coincident]) sourceSnap = road.stops[coincident];
  }
  const sourceField = sourceSnap ? road.search([[sourceSnap, 0, -1]], false, limit) : null;
  data.stations.forEach((station, index) => {
    let walking = distance(origin, station.point) / settings.walkMetersPerMinute;
    if (sourceCovered) {
      walking = sourceField && road.stops[index] ? road.at(sourceField, road.stops[index]).cost / speedCm : Infinity;
      if (distance(origin, station.point) <= 2) walking = distance(origin, station.point) / settings.walkMetersPerMinute;
    }
    accessMinutes[index] = walking;
  });

  const comfort = runRoutingVariant(data, graph, accessMinutes, settings, TRANSFER_PREFERENCE_MINUTES);
  // The direct UI only consumes comfort. Keep both variants by default for
  // diagnostics and the road surface, whose fallback needs pure-time arrivals.
  const pure = customSettings.routingVariant === "comfort" && !road
    ? null : runRoutingVariant(data, graph, accessMinutes, settings, 0);
  let pureWalkingField = null, comfortWalkingField = null;
  if (road) {
    const pureSeeds = sourceSnap ? [[sourceSnap, 0, -1]] : [];
    const comfortSeeds = sourceSnap ? [[sourceSnap, 0, -1]] : [];
    data.stations.forEach((station, i) => {
      if (!road.stops[i]) return;
      const pureArrival = pure?.stationArrivals[i];
      if (Number.isFinite(pureArrival.minutes)) {
        pureSeeds.push([road.stops[i], (pureArrival.minutes + exitMargin(data, settings, i)) * speedCm, i]);
      }
      const comfortArrival = comfort.stationArrivals[i];
      if (Number.isFinite(comfortArrival.minutes)) {
        comfortSeeds.push([road.stops[i], (comfortArrival.preferenceScore + exitMargin(data, settings, i)) * speedCm, i]);
      }
    });
    pureWalkingField = road.search(pureSeeds, true, limit);
    const comfortLimit = Number.isFinite(limit) ? limit + 4 * TRANSFER_PREFERENCE_MINUTES * speedCm : Infinity;
    comfortWalkingField = road.search(comfortSeeds, true, comfortLimit);
  }

  const stationArrivals = comfort.stationArrivals;
  return {
    origin, includeProjects, settings, allowed, accessMinutes, activeStations,
    pureDistances:pure?.distances, purePrevious:pure?.previous, pureTransferCounts:pure?.transferCounts, purePreferenceScores:pure?.preferenceScores,
    pureStationArrivals:pure?.stationArrivals, pureStationOrder:pure?.stationOrder,
    comfortDistances:comfort.distances, comfortPrevious:comfort.previous, comfortTransferCounts:comfort.transferCounts, comfortPreferenceScores:comfort.preferenceScores,
    comfortStationArrivals:comfort.stationArrivals, comfortStationOrder:comfort.stationOrder,
    pureWalkingField, comfortWalkingField,
    pureArrivalIndex:pure ? arrivalIndex(data, pure.stationArrivals.map((a,i)=>({minutes:a.preferenceScore + exitMargin(data,settings,i)}))) : null,
    comfortArrivalIndex:arrivalIndex(data, comfort.stationArrivals.map((a,i)=>({minutes:a.preferenceScore + exitMargin(data,settings,i)}))),
    // Compatibility aliases for code that only needs reachability/diagnostics.
    distances:comfort.distances,
    previous:comfort.previous,
    sameRouteChanges:comfort.transferCounts,
    preferenceScores:comfort.preferenceScores,
    stationArrivals,
    stationOrder:comfort.stationOrder,
    walkingField:comfortWalkingField,
    sourceCovered, sourceSnap,
    walkingLimitMinutes:customSettings.walkingLimitMinutes ?? Infinity,
    shortTripFastestMinutes:0, // compatibility for diagnostic consumers; no threshold
    comfortTransferPreferenceMinutes:TRANSFER_PREFERENCE_MINUTES,
  };
}

export function estimateTravel(data, model, destination, details = false) {
  const comfort = variantEstimate(data, model, destination, "comfort", details);
  return details ? comfort : comfort.minutes;
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
  if (result.station < 0) return { minutes: result.minutes, legs: [], walking: result.minutes, waiting: 0, walkingApproximation:result.walkingApproximation, roadUnavailable:result.roadUnavailable };
  const comfort = result.variant === "comfort";
  const arrivals = comfort ? model.comfortStationArrivals : model.pureStationArrivals;
  const previous = comfort ? model.comfortPrevious : model.purePrevious;
  const distances = comfort ? model.comfortDistances : model.pureDistances;
  const nodes = [];
  let n = arrivals[result.station].node;
  while (n >= 0) {
    nodes.push(n);
    n = previous[n];
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
      last.end = distances[nodes[i]];
      last.minutes = last.end - last.start;
    } else {
      legs.push({
        routeId: a.routeId,
        pattern: a.pattern,
        from: a.stationIndex,
        to: b.stationIndex,
        start: distances[nodes[i - 1]],
        end: distances[nodes[i]],
        minutes: distances[nodes[i]] - distances[nodes[i - 1]],
      });
    }
  }

  for (const leg of legs) {
    const profile = data.timetablePatterns?.[leg.pattern];
    const from = profile?.stops.indexOf(leg.from), to = profile?.stops.indexOf(leg.to);
    leg.requiresReservation = profile?.reservationStops?.length
      ? Boolean(profile.reservationStops[from] || profile.reservationStops[to])
      : Boolean(profile?.requiresReservation);
  }

  const first = data.routeStates[nodes[0]].stationIndex;
  let walking = (model.accessMinutes?.[first] ?? distance(model.origin,data.stations[first].point)/walkSpeed) + (result.finalWalkMinutes ?? distance(destination,data.stations[result.station].point)/walkSpeed);
  for (let i = 1; i < nodes.length; i += 1) {
    const a = data.routeStates[nodes[i - 1]];
    const b = data.routeStates[nodes[i]];
    if (
      ((a.role === "arrival" && b.role === "departure") || (a.role === "alight" && b.role === "board"))
      && a.stationIndex !== b.stationIndex
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
    walkingApproximation:result.walkingApproximation,
    legs,
    walking,
    waiting: Math.max(0, result.minutes - walking - legs.reduce((sum, l) => sum + l.minutes, 0)),
    preference: result.variant,
  };
}

export function routeWaitingMinutes(data, routeId, settings = {}) {
  return waitForRoute(data, routeId, normalizeSettings(data, settings));
}

// Re-evaluate the entry walks of the last optimal paths at the current pointer.
// These are valid paths, not a translated old raster. A worker refreshes the
// topology continuously; the settled calculation always solves it exactly.
// Each score differs from the new optimum by at most 2 * origin displacement /
// walking speed (triangle inequality), independently of the transport network.
export function previewTravelModel(data, anchor, origin) {
  if (anchor.origin[0] === origin[0] && anchor.origin[1] === origin[1]) return anchor;
  const walk = anchor.settings.walkMetersPerMinute;
  const deltas = Float64Array.from(data.stations, (s, i) => distance(origin, s.point) / walk - anchor.accessMinutes[i]);
  const comfortStationArrivals = anchor.comfortStationArrivals.map(a => {
    const delta = a.seedStation >= 0 ? deltas[a.seedStation] : 0;
    return {...a, minutes: a.minutes + delta, preferenceScore: a.preferenceScore + delta};
  });
  return {...anchor, origin, comfortStationArrivals,
    comfortArrivalIndex: arrivalIndex(data, comfortStationArrivals.map((a,i)=>({minutes:a.preferenceScore + exitMargin(data,anchor.settings,i)}))),
    preview: true,
  };
}

export function directModelSnapshot(model) {
  return {origin:model.origin, settings:model.settings, accessMinutes:model.accessMinutes.slice(),
    activeStations:model.activeStations, comfortStationArrivals:model.comfortStationArrivals,
    comfortTransferPreferenceMinutes:model.comfortTransferPreferenceMinutes};
}

export function restoreDirectModel(data, snapshot) {
  return {...snapshot, comfortArrivalIndex:arrivalIndex(data, snapshot.comfortStationArrivals.map((a,i)=>({minutes:a.preferenceScore + exitMargin(data,snapshot.settings,i)})))};
}

// Numeric batch path for raster samples. Geometry and exit costs are loaded once
// per batch; no destination objects, per-pixel closures or result objects.
export function estimateTravelTimes(data, model, points, out = new Float64Array(points.length)) {
  if (data.walkingNetwork || !model.comfortArrivalIndex) {
    for (let i = 0; i < points.length; i++) out[i] = estimateTravel(data, model, points[i]);
    return out;
  }
  const {root, minimum} = model.comfortArrivalIndex;
  const arrivals = model.comfortStationArrivals, walk = model.settings.walkMetersPerMinute;
  const scores = new Float64Array(arrivals.length), actuals = new Float64Array(arrivals.length);
  for (let i = 0; i < arrivals.length; i++) {
    const exit = exitMargin(data, model.settings, i);
    scores[i] = arrivals[i].preferenceScore + exit; actuals[i] = arrivals[i].minutes + exit;
  }
  let x, y, bestScore, bestActual;
  function lower(node) {
    const dx = x < node.minX ? node.minX - x : x > node.maxX ? x - node.maxX : 0;
    const dy = y < node.minY ? node.minY - y : y > node.maxY ? y - node.maxY : 0;
    return minimum[node.id] + Math.sqrt(dx * dx + dy * dy) / walk;
  }
  function visit(node, bound) {
    if (bound > bestScore + 1e-10) return;
    if (node.indices) {
      for (let j = 0; j < node.indices.length; j++) {
        const i = node.indices[j];
        if (scores[i] > bestScore) continue;
        const point = data.stations[i].point, dx = point[0] - x, dy = point[1] - y;
        const lastWalk = Math.sqrt(dx * dx + dy * dy) / walk;
        const score = scores[i] + lastWalk, actual = actuals[i] + lastWalk;
        if (score < bestScore || (score === bestScore && actual < bestActual)) { bestScore = score; bestActual = actual; }
      }
    } else {
      const a = lower(node.left), b = lower(node.right);
      if (a <= b) { visit(node.left, a); visit(node.right, b); }
      else { visit(node.right, b); visit(node.left, a); }
    }
  }
  for (let i = 0; i < points.length; i++) {
    x = points[i][0]; y = points[i][1];
    const dx = model.origin[0] - x, dy = model.origin[1] - y;
    bestScore = bestActual = Math.sqrt(dx * dx + dy * dy) / walk;
    if (root) visit(root, lower(root));
    out[i] = bestActual;
  }
  return out;
}
