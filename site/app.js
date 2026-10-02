const DATA_URL = new URL("./data/commute_map_data.json?v=2026-10-02c", import.meta.url).toString();
const MIN_VIEWPORT_SCALE = 0.12;
const MAX_VIEWPORT_SCALE = 12;
const VIEWPORT_ZOOM_STEP = 1.32;
const DEFAULT_VIEWPORT_SCALE = 1;
const PANEL_PADDING = 22;
const ROUTE_LINE_WIDTH = 3.6;
const HOVER_DEADBAND = 12;
const PIN_HIT_RADIUS = 32;
const PIN_TAP_SLOP = 8;
const REACHABILITY_THRESHOLD_MINUTES = 30;
const OUTLINE_OPTIONS = [15, 30, 45, 60];
const DEFAULT_OUTLINE_MINUTES = [15, 30, 60];
const OUTLINE_WIDTHS = { 15: 1.4, 30: 2.1, 45: 2, 60: 1.5 };
const OUTLINE_LABEL_DIRS = {
  15: [-0.92, -0.78],
  30: [0.72, -0.7],
  45: [-0.12, -1],
  60: [-0.88, -0.42],
};
const DEFAULT_MAX_TIME_MINUTES = 90;
const DEFAULT_INCLUDE_PROJECTS = true;
const DEFAULT_ORIGIN = {
  lat: 47.38915,
  lon: 0.69416,
  label: "Gare de Tours",
};
const SHARE_DECIMALS = 5;

const state = {
  data: null,
  ready: false,
  outlineMinutes: [...DEFAULT_OUTLINE_MINUTES],
  maxTransitTime: DEFAULT_MAX_TIME_MINUTES,
  includeProjects: DEFAULT_INCLUDE_PROJECTS,
  viewportScale: DEFAULT_VIEWPORT_SCALE,
  viewportCenter: null,
  handMode: false,
  panStartCenter: null,
  originPoint: null,
  originLabel: null,
  pinned: false,
  probePoint: null,
  probePinned: false,
  currentRender: null,
  dragTarget: null,
  dragPointerId: null,
  dragMoved: false,
  dragStartScreen: null,
  pinHits: { origin: null, probe: null },
  dirty: false,
};

const mapCanvas = document.getElementById("mapCanvas");
const mapStage = document.getElementById("mapStage");
const ctx = mapCanvas.getContext("2d");
const statusText = document.getElementById("statusText");
const reachText = document.getElementById("reachText");
const legend = document.getElementById("legend");
const legendMax = document.getElementById("legendMax");
const maxTimeInput = document.getElementById("maxTimeInput");
const maxTimeLabel = document.getElementById("maxTimeLabel");
const helpPanel = document.getElementById("helpPanel");
const sharePanel = document.getElementById("sharePanel");
const shareUrl = document.getElementById("shareUrl");
const settingsButton = document.getElementById("settingsButton");
const settingsPanel = document.getElementById("settingsPanel");
const settingsClose = document.getElementById("settingsClose");
const handButton = document.getElementById("handButton");
const projectsToggle = document.getElementById("projectsToggle");

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function closestOnSegment(point, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? clamp(((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared, 0, 1) : 0;
  return [a[0] + t * dx, a[1] + t * dy];
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0 || 1), 0, 1);
  return t * t * (3 - 2 * t);
}

function bilerpPoint(p00, p10, p01, p11, tx, ty) {
  return [
    lerp(lerp(p00[0], p10[0], tx), lerp(p01[0], p11[0], tx), ty),
    lerp(lerp(p00[1], p10[1], tx), lerp(p01[1], p11[1], tx), ty),
  ];
}

function triangleArea(a, b, c) {
  return ((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
}

function quadArea(p00, p10, p11, p01) {
  return Math.abs(triangleArea(p00, p10, p11) + triangleArea(p00, p11, p01));
}

function barycentricWeights(point, a, b, c) {
  const area = triangleArea(a, b, c);
  if (Math.abs(area) < 1e-6) return null;
  const wA = triangleArea(point, b, c) / area;
  const wB = triangleArea(a, point, c) / area;
  const wC = triangleArea(a, b, point) / area;
  if (wA < -1e-4 || wB < -1e-4 || wC < -1e-4) return null;
  return [wA, wB, wC];
}

function interpolateTriangle(weights, a, b, c) {
  return [
    weights[0] * a[0] + weights[1] * b[0] + weights[2] * c[0],
    weights[0] * a[1] + weights[1] * b[1] + weights[2] * c[1],
  ];
}

function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0; i < ring.length; i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    const intersects = y1 > point[1] !== y2 > point[1] && point[0] < ((x2 - x1) * (point[1] - y1)) / ((y2 - y1) || 1e-12) + x1;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point, polygon) {
  if (!polygon.length || !pointInRing(point, polygon[0])) return false;
  return polygon.slice(1).every((hole) => !pointInRing(point, hole));
}

function pointInLand(point) {
  return state.data.boroughs.some((borough) => borough.polygons.some((polygon) => pointInPolygon(point, polygon)));
}

function communeAt(point) {
  if (!point) return null;
  for (const commune of state.data.communes || []) {
    const [minX, minY, maxX, maxY] = commune.bbox;
    if (point[0] < minX || point[0] > maxX || point[1] < minY || point[1] > maxY) continue;
    if (commune.polygons.some((polygon) => pointInPolygon(point, polygon))) return commune.name;
  }
  return null;
}

function worldToLonLat(point) {
  const lat0 = state.data.meta.lat0;
  const metersPerDegLat = 111320;
  const metersPerDegLon = metersPerDegLat * Math.cos((lat0 * Math.PI) / 180);
  return { lon: point[0] / metersPerDegLon, lat: point[1] / metersPerDegLat };
}

function lonLatToWorld(lon, lat) {
  const lat0 = state.data.meta.lat0;
  const metersPerDegLat = 111320;
  const metersPerDegLon = metersPerDegLat * Math.cos((lat0 * Math.PI) / 180);
  return [lon * metersPerDegLon, lat * metersPerDegLat];
}

function formatMinutes(minutes) {
  if (!Number.isFinite(minutes)) return "—";
  if (minutes < 1) return "< 1 min";
  return `${Math.round(minutes)} min`;
}

function formatCoord(value) {
  return Number(value).toFixed(SHARE_DECIMALS);
}

function heatmapColor(minutes, alpha = 0.58) {
  const t = clamp(minutes / state.maxTransitTime, 0, 1);
  const stops = [
    { t: 0, color: [220, 69, 37] },
    { t: 0.2, color: [244, 127, 46] },
    { t: 0.4, color: [255, 196, 79] },
    { t: 0.62, color: [248, 232, 156] },
    { t: 0.8, color: [149, 188, 211] },
    { t: 1, color: [74, 103, 141] },
  ];
  let left = stops[0];
  let right = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i += 1) {
    if (t >= stops[i].t && t <= stops[i + 1].t) {
      left = stops[i];
      right = stops[i + 1];
      break;
    }
  }
  const mix = (t - left.t) / (right.t - left.t || 1);
  const rgb = left.color.map((value, i) => Math.round(value + (right.color[i] - value) * mix));
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

function boundsCenter(bounds) {
  return [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
}

function viewBounds() {
  return state.data.meta.bounds;
}

function defaultCenter() {
  return boundsCenter(viewBounds());
}

function fitScaleFor(bounds, width, height) {
  const [minX, minY, maxX, maxY] = bounds;
  return Math.min((width - PANEL_PADDING * 2) / (maxX - minX), (height - PANEL_PADDING * 2) / (maxY - minY));
}

function minViewportScale(width, height) {
  const fitFocus = fitScaleFor(viewBounds(), width, height);
  const fitAll = fitScaleFor(state.data.meta.exploreBounds || viewBounds(), width, height);
  return clamp(fitAll / fitFocus, MIN_VIEWPORT_SCALE, 1);
}

function buildTransform(bounds, width, height, zoom, centerPoint) {
  const [minX, minY, maxX, maxY] = bounds;
  const scale = Math.min((width - PANEL_PADDING * 2) / (maxX - minX), (height - PANEL_PADDING * 2) / (maxY - minY)) * zoom;
  const [centerX, centerY] = centerPoint || defaultCenter();
  return {
    scale,
    toScreen(point) {
      return [width / 2 + (point[0] - centerX) * scale, height / 2 - (point[1] - centerY) * scale];
    },
    toWorld(x, y) {
      return [centerX + (x - width / 2) / scale, centerY - (y - height / 2) / scale];
    },
  };
}

function nearestStations(point, count, includePlanned = true) {
  const nearest = [];
  state.data.stations.forEach((station, index) => {
    if (!includePlanned && station.planned) return;
    const item = {
      index,
      name: station.name,
      walkMinutes: distance(point, station.point) / state.data.meta.walkMetersPerMinute + state.data.meta.stationAccessPenalty,
    };
    if (nearest.length === count && item.walkMinutes >= nearest[nearest.length - 1].walkMinutes) return;
    nearest.push(item);
    nearest.sort((a, b) => a.walkMinutes - b.walkMinutes);
    if (nearest.length > count) nearest.pop();
  });
  return nearest;
}

function runDijkstra(origin) {
  const { routeStates, stationStates, adjacency, routeWaits, meta } = state.data;
  const distances = new Array(routeStates.length).fill(Infinity);
  const visited = new Array(routeStates.length).fill(false);
  const seeds = nearestStations(origin, meta.originStationCount, state.includeProjects);

  for (const seed of seeds) {
    for (const routeStateIndex of stationStates[seed.index] || []) {
      const wait = routeWaits[routeStates[routeStateIndex].routeId] ?? meta.defaultBoardWait;
      distances[routeStateIndex] = Math.min(distances[routeStateIndex], seed.walkMinutes + wait);
    }
  }

  for (let step = 0; step < routeStates.length; step += 1) {
    let current = -1;
    let best = Infinity;
    for (let i = 0; i < distances.length; i += 1) {
      if (!visited[i] && distances[i] < best) {
        best = distances[i];
        current = i;
      }
    }
    if (current === -1) break;
    visited[current] = true;
    for (const [toIndex, weight] of adjacency[current]) {
      if (!state.includeProjects && state.data.routeInfo?.[routeStates[toIndex].routeId]?.planned) continue;
      const candidate = distances[current] + weight;
      if (candidate < distances[toIndex]) distances[toIndex] = candidate;
    }
  }
  return { distances, seeds };
}

function estimateTravel(origin, distances, destination, nearby = null) {
  const walk = state.data.meta.walkMetersPerMinute;
  const access = state.data.meta.stationAccessPenalty;
  let best = distance(origin, destination) / walk;
  const stations = nearby && state.includeProjects ? nearby : nearestStations(destination, state.data.meta.cellNearestStations, state.includeProjects);
  for (const station of stations) {
    const index = station.index ?? station[0];
    const walkMinutes =
      station.walkMinutes ?? distance(destination, state.data.stations[index].point) / walk + access;
    for (const routeStateIndex of state.data.stationStates[index] || []) {
      best = Math.min(best, distances[routeStateIndex] + walkMinutes);
    }
  }
  return best;
}

function summarizeReachability(origin, distances) {
  const access = state.data.meta.stationAccessPenalty;
  const walk = state.data.meta.walkMetersPerMinute;
  let reachable = 0;
  for (let index = 0; index < state.data.stations.length; index += 1) {
    if (!state.includeProjects && state.data.stations[index].planned) continue;
    let best = distance(origin, state.data.stations[index].point) / walk + access;
    for (const routeStateIndex of state.data.stationStates[index] || []) {
      best = Math.min(best, distances[routeStateIndex] + access);
    }
    if (best <= REACHABILITY_THRESHOLD_MINUTES) reachable += 1;
  }
  return { reachable, total: state.data.stations.filter((station) => state.includeProjects || !station.planned).length };
}

function computeWarp(origin, { fast = false } = {}) {
  const { distances, seeds } = runDijkstra(origin);
  const { gridCols, gridRows, bounds } = state.data.meta;
  const [minX, minY, maxX, maxY] = bounds;
  const cellW = (maxX - minX) / gridCols;
  const cellH = (maxY - minY) / gridRows;
  const minuteGrid = Array.from({ length: gridRows }, () => new Array(gridCols).fill(Infinity));
  const validMask = Array.from({ length: gridRows }, () => new Array(gridCols).fill(false));

  for (const cellIndex of state.data.mask) {
    if (cellIndex === -1) continue;
    const cell = state.data.cells[cellIndex];
    minuteGrid[cell.row][cell.col] = estimateTravel(origin, distances, cell.point, cell.access);
    validMask[cell.row][cell.col] = true;
  }

  return {
    distances,
    seeds,
    reachability: fast ? null : summarizeReachability(origin, distances),
    minutes: minuteGrid,
    validMask,
    cellW,
    cellH,
    bounds,
  };
}

function pointInStaticGrid(point) {
  const { bounds, gridCols, gridRows } = state.data.meta;
  const col = Math.floor(((point[0] - bounds[0]) / (bounds[2] - bounds[0])) * gridCols);
  const row = Math.floor(((point[1] - bounds[1]) / (bounds[3] - bounds[1])) * gridRows);
  return col >= 0 && row >= 0 && col < gridCols && row < gridRows && state.data.mask[row * gridCols + col] !== -1;
}

function computeOutsideWarp(origin, distances, transform, width, height) {
  const topLeft = transform.toWorld(0, 0);
  const bottomRight = transform.toWorld(width, height);
  const bounds = [topLeft[0], bottomRight[1], bottomRight[0], topLeft[1]];
  const gridCols = 160;
  const gridRows = Math.max(80, Math.round((gridCols * height) / width));
  const cellW = (bounds[2] - bounds[0]) / gridCols;
  const cellH = (bounds[3] - bounds[1]) / gridRows;
  const minutes = Array.from({ length: gridRows }, () => new Array(gridCols).fill(Infinity));
  const validMask = Array.from({ length: gridRows }, () => new Array(gridCols).fill(false));
  for (let row = 0; row < gridRows; row += 1) {
    for (let col = 0; col < gridCols; col += 1) {
      const point = [bounds[0] + (col + 0.5) * cellW, bounds[1] + (row + 0.5) * cellH];
      if (pointInStaticGrid(point)) continue;
      const travel = estimateTravel(origin, distances, point);
      if (travel > state.maxTransitTime + 15) continue;
      minutes[row][col] = travel;
      validMask[row][col] = true;
    }
  }
  return { minutes, validMask, bounds, cellW, cellH, reachability: null };
}

function createCanvasBacking(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { width: rect.width, height: rect.height };
}

function tracePolygon(drawCtx, polygon, projectPoint) {
  for (const ring of polygon) {
    drawCtx.moveTo(...projectPoint(ring[0]));
    for (let i = 1; i < ring.length; i += 1) drawCtx.lineTo(...projectPoint(ring[i]));
    drawCtx.closePath();
  }
}

function drawPolyline(drawCtx, points, projectPoint) {
  if (points.length < 2) return;
  drawCtx.beginPath();
  drawCtx.moveTo(...projectPoint(points[0]));
  for (let i = 1; i < points.length; i += 1) drawCtx.lineTo(...projectPoint(points[i]));
  drawCtx.stroke();
}

function drawBasemap(drawCtx, projectPoint) {
  drawCtx.fillStyle = "#c5d0db";
  for (const borough of state.data.boroughs) {
    for (const polygon of borough.polygons) {
      drawCtx.beginPath();
      tracePolygon(drawCtx, polygon, projectPoint);
      drawCtx.fill();
    }
  }

  for (const polygon of state.data.parks) {
    drawCtx.beginPath();
    tracePolygon(drawCtx, polygon, projectPoint);
    drawCtx.fillStyle = "#d4e4c6";
    drawCtx.strokeStyle = "#a9c49a";
    drawCtx.lineWidth = 0.5;
    drawCtx.fill();
    drawCtx.stroke();
  }

}

function drawRoutes(drawCtx, projectPoint) {
  for (const route of state.data.routes) {
    drawCtx.strokeStyle = route.color;
    drawCtx.lineWidth = route.mode === "RFN" ? 1.1 : route.mode === "TRAM" ? 4.2 : route.mode === "BHNS" ? 3.4 : ROUTE_LINE_WIDTH;
    drawCtx.lineCap = "round";
    drawCtx.lineJoin = "round";
    drawCtx.setLineDash(route.mode === "BHNS" ? [7, 5] : []);
    drawPolyline(drawCtx, route.points, projectPoint);
  }
  drawCtx.setLineDash([]);
}

function drawDepartmentLimits(drawCtx, projectPoint) {
  drawCtx.strokeStyle = state.viewportScale >= 2 ? "rgba(62,84,108,0.48)" : "rgba(77,101,128,0.26)";
  drawCtx.lineWidth = state.viewportScale >= 2 ? 0.9 : 0.55;
  for (const commune of state.data.communes || []) {
    for (const polygon of commune.polygons) {
      for (const ring of polygon) {
        if (ring.length < 2) continue;
        drawPolyline(drawCtx, ring, projectPoint);
      }
    }
  }
  drawCtx.lineJoin = "round";
  drawCtx.lineCap = "round";
  for (const borough of state.data.boroughs) {
    drawCtx.strokeStyle = borough.code === "243700754" ? "#294f6f" : "rgba(57,80,102,0.7)";
    drawCtx.lineWidth = borough.code === "243700754" ? 2.2 : 1.25;
    const rings = borough.outline?.length ? borough.outline : [];
    for (const ring of rings) {
      if (ring.length < 2) continue;
      drawCtx.beginPath();
      drawCtx.moveTo(...projectPoint(ring[0]));
      for (let i = 1; i < ring.length; i += 1) drawCtx.lineTo(...projectPoint(ring[i]));
      drawCtx.closePath();
      drawCtx.stroke();
    }
  }
}

function drawCommuneLabels(drawCtx, projectPoint) {
  if (state.viewportScale < 2.4) return;
  const occupied = [];
  const width = mapCanvas.clientWidth;
  const height = mapCanvas.clientHeight;
  for (const commune of state.data.communes || []) {
    if (state.data.stations.some((station) => station.mode === "TER" && station.name === commune.name && station.terminal && distance(station.point, commune.label) < 3500)) continue;
    const [minX, minY, maxX, maxY] = commune.bbox;
    const [left, bottom] = projectPoint([minX, minY]);
    const [right, top] = projectPoint([maxX, maxY]);
    if (right - left < 75 || bottom - top < 25) continue;
    const [x, y] = projectPoint(commune.label);
    if (x < 20 || y < 14 || x > width - 20 || y > height - 14) continue;
    drawCtx.font = "600 11px Outfit, sans-serif";
    const textWidth = drawCtx.measureText(commune.name).width;
    const box = [x - textWidth / 2 - 5, y - 10, x + textWidth / 2 + 5, y + 5];
    if (occupied.some(([a, b, c, d]) => box[0] < c && box[2] > a && box[1] < d && box[3] > b)) continue;
    occupied.push(box);
    drawCtx.textAlign = "center";
    drawCtx.lineWidth = 3;
    drawCtx.strokeStyle = "rgba(255,252,247,0.92)";
    drawCtx.strokeText(commune.name, x, y);
    drawCtx.fillStyle = "#445e73";
    drawCtx.fillText(commune.name, x, y);
  }
  drawCtx.textAlign = "left";
}

function drawStations(drawCtx, projectPoint) {
  const major = /^(Tours|Saint-Pierre-des-Corps|Blois-Chambord|Saumur|Vendôme-Villiers-sur-Loir|Orléans|Paris-Austerlitz|Caen|Nantes|Poitiers|Le Mans|Vierzon|Loches|Amboise)$/i;
  const labels = [];
  for (const station of state.data.stations) {
    const [x, y] = projectPoint(station.point);
    if (x < -8 || y < -8 || x > mapCanvas.clientWidth + 8 || y > mapCanvas.clientHeight + 8) continue;
    drawCtx.beginPath();
    drawCtx.arc(x, y, station.mode === "TRAM" ? 2.6 : station.mode === "BHNS" ? 2.3 : 2, 0, Math.PI * 2);
    drawCtx.fillStyle = "#fff";
    drawCtx.fill();
    drawCtx.lineWidth = 0.55;
    drawCtx.strokeStyle = station.mode === "TRAM" ? (station.planned ? "#1d91b6" : "#bd074e") : station.mode === "BHNS" ? "#e18529" : "#345c77";
    drawCtx.stroke();
    if (station.mode !== "TER") continue;
    const terminal = station.terminal || major.test(station.name);
    const show = terminal ? state.viewportScale >= 0.55 : !station.inSerm && state.viewportScale >= 0.8;
    if (show) labels.push({ station, x, y, terminal });
  }
  const occupied = [];
  labels.sort((a, b) => Number(b.terminal) - Number(a.terminal) || a.station.name.localeCompare(b.station.name, "fr"));
  for (const { station, x, y, terminal } of labels) {
    const fontSize = terminal ? 12 : 10;
    drawCtx.font = `${terminal ? 700 : 500} ${fontSize}px Outfit, sans-serif`;
    const textWidth = drawCtx.measureText(station.name).width;
    const candidates = [[x + 6, y - 5], [x - textWidth - 6, y - 5], [x + 6, y + 13], [x - textWidth - 6, y + 13]];
    const place = candidates.find(([tx, ty]) => {
      const box = [tx - 3, ty - fontSize - 3, tx + textWidth + 3, ty + 3];
      return box[0] >= 3 && box[2] <= mapCanvas.clientWidth - 3 && box[1] >= 3 && box[3] <= mapCanvas.clientHeight - 3 && !occupied.some(([a, b, c, d]) => box[0] < c && box[2] > a && box[1] < d && box[3] > b);
    });
    if (!place) continue;
    const [tx, ty] = place;
    occupied.push([tx - 3, ty - fontSize - 3, tx + textWidth + 3, ty + 3]);
    drawCtx.textAlign = "left";
    drawCtx.lineWidth = terminal ? 3.8 : 3;
    drawCtx.strokeStyle = "rgba(255,255,255,0.96)";
    drawCtx.strokeText(station.name, tx, ty);
    drawCtx.fillStyle = terminal ? "#1d3951" : "#36536a";
    drawCtx.fillText(station.name, tx, ty);
  }
}

function drawHeatmap(drawCtx, warp, projectPoint) {
  const { minutes, validMask } = warp;
  for (let row = 0; row < minutes.length; row += 1) {
    for (let col = 0; col < minutes[row].length; col += 1) {
      if (!validMask[row][col]) continue;
      const p00 = projectPoint([warp.bounds[0] + col * warp.cellW, warp.bounds[1] + row * warp.cellH]);
      const p10 = projectPoint([warp.bounds[0] + (col + 1) * warp.cellW, warp.bounds[1] + row * warp.cellH]);
      const p11 = projectPoint([warp.bounds[0] + (col + 1) * warp.cellW, warp.bounds[1] + (row + 1) * warp.cellH]);
      const p01 = projectPoint([warp.bounds[0] + col * warp.cellW, warp.bounds[1] + (row + 1) * warp.cellH]);
      drawCtx.beginPath();
      drawCtx.moveTo(...p00);
      drawCtx.lineTo(...p10);
      drawCtx.lineTo(...p11);
      drawCtx.lineTo(...p01);
      drawCtx.closePath();
      drawCtx.fillStyle = heatmapColor(minutes[row][col]);
      drawCtx.fill();
    }
  }
}

function cellValue(minutes, validMask, row, col, threshold) {
  if (row < 0 || col < 0 || row >= minutes.length || col >= minutes[0].length || !validMask[row][col]) {
    return threshold + 1;
  }
  return minutes[row][col];
}

function interpolateThreshold(a, va, b, vb, threshold) {
  const t = clamp((threshold - va) / (vb - va || 1e-9), 0, 1);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function contourSegments(warp, threshold) {
  const { minutes, validMask, bounds, cellW, cellH } = warp;
  const center = (row, col) => [bounds[0] + (col + 0.5) * cellW, bounds[1] + (row + 0.5) * cellH];
  const segments = [];
  for (let row = 0; row < minutes.length - 1; row += 1) {
    for (let col = 0; col < minutes[row].length - 1; col += 1) {
      const bl = center(row, col);
      const br = center(row, col + 1);
      const tr = center(row + 1, col + 1);
      const tl = center(row + 1, col);
      const vbl = cellValue(minutes, validMask, row, col, threshold);
      const vbr = cellValue(minutes, validMask, row, col + 1, threshold);
      const vtr = cellValue(minutes, validMask, row + 1, col + 1, threshold);
      const vtl = cellValue(minutes, validMask, row + 1, col, threshold);
      const code =
        (vbl <= threshold ? 1 : 0) |
        (vbr <= threshold ? 2 : 0) |
        (vtr <= threshold ? 4 : 0) |
        (vtl <= threshold ? 8 : 0);
      if (code === 0 || code === 15) continue;
      const bottom = () => interpolateThreshold(bl, vbl, br, vbr, threshold);
      const right = () => interpolateThreshold(br, vbr, tr, vtr, threshold);
      const top = () => interpolateThreshold(tl, vtl, tr, vtr, threshold);
      const left = () => interpolateThreshold(bl, vbl, tl, vtl, threshold);
      const pairs = {
        1: [left, bottom],
        2: [bottom, right],
        3: [left, right],
        4: [right, top],
        5: [left, top, bottom, right],
        6: [bottom, top],
        7: [left, top],
        8: [left, top],
        9: [bottom, top],
        10: [left, bottom, right, top],
        11: [right, top],
        12: [left, right],
        13: [bottom, right],
        14: [left, bottom],
      }[code];
      for (let i = 0; i < pairs.length; i += 2) {
        segments.push([pairs[i](), pairs[i + 1]()]);
      }
    }
  }
  return segments;
}

function pointKey(point) {
  return `${point[0].toFixed(1)},${point[1].toFixed(1)}`;
}

function ringLength(ring) {
  let length = 0;
  for (let i = 1; i < ring.length; i += 1) length += distance(ring[i - 1], ring[i]);
  return length;
}

function chainContourRings(segments) {
  const adjacency = new Map();
  const addEdge = (a, b) => {
    const ka = pointKey(a);
    const kb = pointKey(b);
    if (ka === kb) return;
    if (!adjacency.has(ka)) adjacency.set(ka, []);
    adjacency.get(ka).push([ka, a, kb, b]);
  };
  for (const [a, b] of segments) {
    addEdge(a, b);
    addEdge(b, a);
  }
  const used = new Set();
  const edgeKey = (ka, kb) => (ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`);
  const rings = [];
  for (const [startKey, edges] of adjacency.entries()) {
    for (const [, startPoint, firstKey, firstPoint] of edges) {
      if (used.has(edgeKey(startKey, firstKey))) continue;
      const ring = [startPoint];
      let currentKey = firstKey;
      let currentPoint = firstPoint;
      used.add(edgeKey(startKey, firstKey));
      while (currentKey !== startKey) {
        ring.push(currentPoint);
        const next = (adjacency.get(currentKey) || []).find(([, , nextKey]) => !used.has(edgeKey(currentKey, nextKey)));
        if (!next) break;
        used.add(edgeKey(currentKey, next[2]));
        currentKey = next[2];
        currentPoint = next[3];
      }
      if (ring.length >= 14) rings.push(ring);
    }
  }
  rings.sort((a, b) => ringLength(b) - ringLength(a));
  return rings;
}

function contourLabelSite(ring, origin, dir, projectPoint, width, height) {
  let best = null;
  let bestScore = -Infinity;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const from = ring[i];
    const to = ring[i + 1];
    const mid = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
    const [x, y] = projectPoint(mid);
    if (x < 36 || y < 28 || x > width - 36 || y > height - 28) continue;
    const align = (mid[0] - origin[0]) * dir[0] + (mid[1] - origin[1]) * dir[1];
    const score = align + distance(from, to) * 0.2;
    if (score > bestScore) {
      bestScore = score;
      const screenFrom = projectPoint(from);
      const screenTo = projectPoint(to);
      best = { world: mid, screen: [x, y], tangent: [screenTo[0] - screenFrom[0], screenTo[1] - screenFrom[1]] };
    }
  }
  return best;
}

function drawContourLabel(drawCtx, site, text) {
  let angle = Math.atan2(site.tangent[1], site.tangent[0]);
  if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;
  drawCtx.save();
  drawCtx.translate(site.screen[0], site.screen[1]);
  drawCtx.rotate(angle);
  drawCtx.font = "700 12px Outfit, sans-serif";
  drawCtx.textAlign = "center";
  drawCtx.textBaseline = "middle";
  drawCtx.strokeStyle = "rgba(255,252,247,0.94)";
  drawCtx.lineWidth = 5;
  drawCtx.lineJoin = "round";
  drawCtx.strokeText(text, 0, 0);
  drawCtx.fillStyle = "#111111";
  drawCtx.fillText(text, 0, 0);
  drawCtx.restore();
}

function drawOutline(drawCtx, warp, projectPoint) {
  const rect = mapCanvas.getBoundingClientRect();
  const origin = heatmapSourcePoint() || defaultCenter();
  const labels = [];
  drawCtx.strokeStyle = "#111111";
  drawCtx.lineJoin = "round";
  drawCtx.lineCap = "round";
  for (const threshold of [...state.outlineMinutes].sort((a, b) => a - b)) {
    const segments = contourSegments(warp, threshold);
    if (!segments.length) continue;
    const rings = chainContourRings(segments);
    drawCtx.lineWidth = OUTLINE_WIDTHS[threshold] || 2;
    drawCtx.beginPath();
    for (const [a, b] of segments) {
      drawCtx.moveTo(...projectPoint(a));
      drawCtx.lineTo(...projectPoint(b));
    }
    drawCtx.stroke();
    const mainRing = rings[0];
    if (!mainRing) continue;
    const site = contourLabelSite(mainRing, origin, OUTLINE_LABEL_DIRS[threshold] || [1, 0], projectPoint, rect.width, rect.height);
    if (site) labels.push({ site, text: `${threshold} min` });
  }
  for (const label of labels) drawContourLabel(drawCtx, label.site, label.text);
}

function drawMarker(drawCtx, screen, color, radius = 6) {
  drawCtx.beginPath();
  drawCtx.arc(screen[0], screen[1], radius + 7, 0, Math.PI * 2);
  drawCtx.fillStyle = `${color}33`;
  drawCtx.fill();
  drawCtx.beginPath();
  drawCtx.arc(screen[0], screen[1], radius, 0, Math.PI * 2);
  drawCtx.fillStyle = color;
  drawCtx.fill();
  drawCtx.lineWidth = 2;
  drawCtx.strokeStyle = "#fff";
  drawCtx.stroke();
}

function drawLabelBubble(drawCtx, screen, lines, color, below = false) {
  const padX = 12;
  const padY = 8;
  const items = lines.map((line) => typeof line === "string" ? { text: line, small: false } : line);
  drawCtx.textAlign = "center";
  drawCtx.textBaseline = "middle";
  const canvasWidth = mapCanvas.getBoundingClientRect().width;
  const canvasHeight = mapCanvas.getBoundingClientRect().height;
  const maxTextWidth = Math.min(360, canvasWidth - padX * 2 - 16);
  for (const item of items) {
    drawCtx.font = item.small ? "500 11px Outfit, sans-serif" : "600 13px Outfit, sans-serif";
    while (item.text.length > 8 && drawCtx.measureText(item.text).width > maxTextWidth) {
      item.text = `${item.text.slice(0, -2)}…`;
    }
  }
  const width = Math.ceil(Math.max(...items.map((item) => {
    drawCtx.font = item.small ? "500 11px Outfit, sans-serif" : "600 13px Outfit, sans-serif";
    return drawCtx.measureText(item.text).width;
  }))) + padX * 2;
  const height = padY * 2 + items.reduce((sum, item) => sum + (item.small ? 14 : 16), 0);
  const desiredX = screen[0] > canvasWidth * 0.55 ? screen[0] - width - 14 : screen[0] + 14;
  const x = clamp(desiredX, 8, canvasWidth - width - 8);
  const y = clamp(below ? screen[1] + 12 : screen[1] - height - 10, 8, canvasHeight - height - 8);
  drawCtx.fillStyle = "rgba(255,252,247,0.94)";
  drawCtx.strokeStyle = color;
  drawCtx.lineWidth = 1.2;
  drawCtx.beginPath();
  if (typeof drawCtx.roundRect === "function") {
    drawCtx.roundRect(x, y, width, height, 10);
  } else {
    drawCtx.rect(x, y, width, height);
  }
  drawCtx.fill();
  drawCtx.stroke();
  drawCtx.fillStyle = "#1c2f42";
  let lineY = y + padY;
  for (const item of items) {
    const lineHeight = item.small ? 14 : 16;
    drawCtx.font = item.small ? "500 11px Outfit, sans-serif" : "600 13px Outfit, sans-serif";
    drawCtx.fillStyle = item.small ? "#52687a" : "#1c2f42";
    drawCtx.fillText(item.text, x + width / 2, lineY + lineHeight / 2);
    lineY += lineHeight;
  }
  drawCtx.textAlign = "left";
  drawCtx.textBaseline = "alphabetic";
  return { x, y, width, height };
}

function placeName(point) {
  const commune = communeAt(point);
  if (commune) return commune;
  const station = nearestStations(point, 1)[0];
  if (!station) return "Lieu inconnu";
  const outsideNames = { "Paris-Austerlitz": "Paris", "Blois-Chambord": "Blois", "Les Aubrais-Orléans": "Fleury-les-Aubrais" };
  return outsideNames[station.name] || station.name;
}

function stationModeLines(point) {
  const nearest = nearestStations(point, 1)[0];
  if (!nearest) return [];
  const station = state.data.stations[nearest.index];
  const kind = station.id.startsWith("KML:") ? "Halte" : station.mode === "TER" ? "Gare" : "Arrêt";
  const lines = [{ text: `${kind} ${station.name}`, small: true }];
  const ordered = [...station.routes].sort((a, b) => Number(b.startsWith("TER ")) - Number(a.startsWith("TER ")) || a.localeCompare(b, "fr"));
  if (!ordered.length) return lines;
  const routeId = ordered[0];
  if (routeId === "TRAM A") lines.push({ text: "Tramway A", small: true });
  else if (routeId === "TRAM B") lines.push({ text: "Tramway B · projet 2028", small: true });
  else if (routeId === "BHNS C") lines.push({ text: "BHNS C · projet 2028", small: true });
  else if (routeId === "NAVETTE") lines.push({ text: "Navette Tours ↔ Saint-Pierre-des-Corps", small: true });
  else {
    const title = state.data.routeInfo?.[routeId]?.title || "";
    const endpoints = title.includes(" - ") ? title.slice(title.indexOf(" - ") + 3) : title;
    lines.push({ text: `${routeId} · ${endpoints}`, small: true });
  }
  if (ordered.length > 1) lines.push({ text: `+ ${ordered.length - 1} autre${ordered.length > 2 ? "s" : ""} ligne${ordered.length > 2 ? "s" : ""}`, small: true });
  return lines;
}

function heatmapSourcePoint() {
  return state.originPoint;
}

function heatmapOtherPoint() {
  return state.originPoint ? state.probePoint : null;
}

function syncStatus(warp, travelMinutes) {
  const source = heatmapSourcePoint();
  if (!source) {
    statusText.textContent = "Survolez la carte pour choisir un départ.";
    reachText.textContent = "Choisissez un point pour voir la part du réseau joignable en 30 minutes.";
    return;
  }
  const sourceName = placeName(source);
  const other = heatmapOtherPoint();
  if (Number.isFinite(travelMinutes) && other) {
    statusText.textContent = `${formatMinutes(travelMinutes)} entre ${sourceName} et ${placeName(other)}`;
  } else {
    const prefix = state.pinned ? "Carte depuis" : "Près de";
    statusText.textContent = `${prefix} ${sourceName}`;
  }
  if (warp?.reachability) {
    const { reachable, total } = warp.reachability;
    const percent = Math.round((reachable / total) * 100);
    const percentText = reachable > 0 && percent === 0 ? "Moins de 1 %" : `${percent} %`;
    reachText.textContent = `${percentText} des gares et arrêts du réseau sélectionné sont joignables en ${REACHABILITY_THRESHOLD_MINUTES} minutes depuis ce point (estimation).`;
  }
}

function nearestLandPoint(point) {
  if (!point) return null;
  if (pointInLand(point)) return point;
  let best = null;
  let bestDistance = Infinity;
  const tolerance = Math.min(8000, Math.max(1500, 8 / (state.currentRender?.transform.scale || 0.004)));
  for (const route of state.data.routes) {
    if (route.mode === "RFN") continue;
    for (let i = 1; i < route.points.length; i += 1) {
      const a = route.points[i - 1];
      const b = route.points[i];
      if (point[0] < Math.min(a[0], b[0]) - tolerance || point[0] > Math.max(a[0], b[0]) + tolerance) continue;
      if (point[1] < Math.min(a[1], b[1]) - tolerance || point[1] > Math.max(a[1], b[1]) + tolerance) continue;
      const candidate = closestOnSegment(point, a, b);
      const gap = distance(point, candidate);
      if (gap < bestDistance) {
        bestDistance = gap;
        best = candidate;
      }
    }
  }
  return bestDistance <= tolerance ? best : null;
}

function screenHitsPin(screen, hit) {
  if (!hit) return false;
  if (distance(screen, hit.screen) <= PIN_HIT_RADIUS) return true;
  const { x, y, width, height } = hit.label;
  return screen[0] >= x - 6 && screen[0] <= x + width + 6 && screen[1] >= y - 6 && screen[1] <= y + height + 6;
}

function syncCursor(screen = null) {
  if (state.handMode) {
    mapCanvas.style.cursor = state.dragTarget === "pan" ? "grabbing" : "grab";
    return;
  }
  if (state.dragTarget) {
    mapCanvas.style.cursor = "grabbing";
    return;
  }
  if (screen && hitPin(screen)) {
    mapCanvas.style.cursor = "grab";
    return;
  }
  mapCanvas.style.cursor = "crosshair";
}

function drawMap() {
  if (!state.ready) return;
  const { width, height } = createCanvasBacking(mapCanvas);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#efe6d6";
  ctx.fillRect(0, 0, width, height);

  const source = heatmapSourcePoint();
  const other = heatmapOtherPoint();
  const focusBounds = viewBounds();
  const scaleMul = clamp(state.viewportScale, minViewportScale(width, height), MAX_VIEWPORT_SCALE);
  const focus = state.viewportCenter || (scaleMul > 1.02 ? (state.probePoint && state.originPoint ? [(state.originPoint[0] + state.probePoint[0]) / 2, (state.originPoint[1] + state.probePoint[1]) / 2] : source || defaultCenter()) : defaultCenter());
  const transform = buildTransform(focusBounds, width, height, scaleMul, focus);
  const projectPoint = (point) => transform.toScreen(point);
  const panning = state.dragTarget === "pan" && state.currentRender;
  const warp = source ? (panning && state.currentRender.warp ? state.currentRender.warp : computeWarp(source, { fast: Boolean(state.dragTarget) })) : null;
  const showOutsideWarp = source && (!pointInLand(source) || !pointInLand(focus));
  const outsideWarp = showOutsideWarp ? (panning && state.currentRender.outsideWarp ? state.currentRender.outsideWarp : computeOutsideWarp(source, warp.distances, transform, width, height)) : null;

  drawBasemap(ctx, projectPoint);
  if (warp) drawHeatmap(ctx, warp, projectPoint);
  if (outsideWarp) drawHeatmap(ctx, outsideWarp, projectPoint);
  drawDepartmentLimits(ctx, projectPoint);
  drawRoutes(ctx, projectPoint);
  drawCommuneLabels(ctx, projectPoint);
  drawStations(ctx, projectPoint);
  if (warp && state.outlineMinutes.length) drawOutline(ctx, warp, projectPoint);
  if (outsideWarp && state.outlineMinutes.length) drawOutline(ctx, outsideWarp, projectPoint);

  let travelMinutes = null;
  if (warp && other) travelMinutes = estimateTravel(source, warp.distances, other);
  state.pinHits = { origin: null, probe: null };

  if (state.probePoint) {
    const probeScreen = projectPoint(state.probePoint);
    const originScreen = state.originPoint ? projectPoint(state.originPoint) : null;
    const nearOrigin = originScreen && Math.abs(originScreen[0] - probeScreen[0]) < 280 && Math.abs(originScreen[1] - probeScreen[1]) < 130;
    drawMarker(ctx, probeScreen, "#1c2f42", state.dragTarget === "probe" ? 7 : 5);
    const probeLines = ["Arrivée", placeName(state.probePoint)];
    if (Number.isFinite(travelMinutes)) probeLines.unshift(formatMinutes(travelMinutes));
    probeLines.push(...stationModeLines(state.probePoint));
    const probeLabel = drawLabelBubble(ctx, probeScreen, probeLines, "#1c2f42", nearOrigin && probeScreen[1] >= originScreen[1]);
    state.pinHits.probe = { screen: probeScreen, label: probeLabel };
  }
  if (state.originPoint) {
    const originScreen = projectPoint(state.originPoint);
    drawMarker(ctx, originScreen, "#c44b2b", state.pinned || state.dragTarget === "origin" ? 7 : 6);
    const originName = placeName(state.originPoint);
    const originLines = ["Départ", originName];
    originLines.push(...stationModeLines(state.originPoint));
    const probeScreen = state.probePoint ? projectPoint(state.probePoint) : null;
    const nearProbe = probeScreen && Math.abs(originScreen[0] - probeScreen[0]) < 280 && Math.abs(originScreen[1] - probeScreen[1]) < 130;
    const originLabel = drawLabelBubble(ctx, originScreen, originLines, "#c44b2b", nearProbe && originScreen[1] >= probeScreen[1]);
    state.pinHits.origin = { screen: originScreen, label: originLabel };
  }

  state.currentRender = { warp, outsideWarp, transform, focus };
  legend.hidden = !warp;
  legendMax.textContent = `${state.maxTransitTime} min`;
  syncStatus(warp, travelMinutes);
  state.dirty = false;
}

function requestDraw() {
  if (state.dirty) return;
  state.dirty = true;
  requestAnimationFrame(drawMap);
}

function pointerToWorld(event) {
  const rect = mapCanvas.getBoundingClientRect();
  const screen = [event.clientX - rect.left, event.clientY - rect.top];
  if (!state.currentRender) return { screen, world: null };
  const world = state.currentRender.transform.toWorld(screen[0], screen[1]);
  return { screen, world };
}

function hitPin(screen) {
  const originHit = state.pinned && screenHitsPin(screen, state.pinHits.origin);
  const probeHit = state.probePoint && screenHitsPin(screen, state.pinHits.probe);
  if (originHit && probeHit) {
    return distance(screen, state.pinHits.origin.screen) <= distance(screen, state.pinHits.probe.screen) ? "origin" : "probe";
  }
  if (originHit) return "origin";
  if (probeHit) return "probe";
  return null;
}

function setOrigin(world, { pin = false, label = null, silent = false } = {}) {
  const snapped = nearestLandPoint(world);
  if (!snapped) return;
  state.originPoint = snapped;
  state.originLabel = label;
  state.pinned = pin;
  requestDraw();
  if (!silent) syncUrl();
}

function setProbe(world, pinned = false, { silent = false } = {}) {
  const snapped = nearestLandPoint(world);
  if (!snapped) return;
  state.probePoint = snapped;
  state.probePinned = pinned;
  requestDraw();
  if (!silent) syncUrl();
}

function endDrag(event) {
  if (!state.dragTarget) return;
  const moved = state.dragMoved;
  const target = state.dragTarget;
  state.dragTarget = null;
  state.dragPointerId = null;
  state.dragMoved = false;
  state.dragStartScreen = null;
  state.panStartCenter = null;
  try {
    if (event && mapCanvas.hasPointerCapture(event.pointerId)) mapCanvas.releasePointerCapture(event.pointerId);
  } catch {
    /* already released */
  }
  if (!moved && target === "origin") {
    /* keep the pin; a click without drag just selects it */
  }
  syncUrl();
  requestDraw();
  syncCursor();
}

function parsePair(value) {
  if (!value) return null;
  const match = String(value).match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  return lonLatToWorld(Number(match[2]), Number(match[1]));
}

function syncUrl() {
  const params = new URLSearchParams();
  if (state.originPoint) {
    const { lat, lon } = worldToLonLat(state.originPoint);
    params.set("origin", `${formatCoord(lat)},${formatCoord(lon)}`);
  }
  if (state.probePoint) {
    const { lat, lon } = worldToLonLat(state.probePoint);
    params.set("distance", `${formatCoord(lat)},${formatCoord(lon)}`);
  }
  const outline = [...state.outlineMinutes].sort((a, b) => a - b);
  const defaultOutline = DEFAULT_OUTLINE_MINUTES.join(",");
  if (!outline.length) params.set("outline", "0");
  else if (outline.join(",") !== defaultOutline) params.set("outline", outline.join(","));
  if (state.maxTransitTime !== DEFAULT_MAX_TIME_MINUTES) params.set("max", String(state.maxTransitTime));
  if (state.includeProjects !== DEFAULT_INCLUDE_PROJECTS) params.set("projects", state.includeProjects ? "1" : "0");
  if (state.handMode) params.set("hand", "1");
  if (state.viewportCenter) {
    const { lat, lon } = worldToLonLat(state.viewportCenter || defaultCenter());
    params.set("view", `${formatCoord(lat)},${formatCoord(lon)}`);
    params.set("zoom", state.viewportScale.toFixed(2));
  }
  const query = params.toString();
  history.replaceState(null, "", query ? `?${query}` : location.pathname);
}

function restoreUrl() {
  const params = new URLSearchParams(location.search);
  const origin = parsePair(params.get("origin"));
  const probe = parsePair(params.get("distance"));
  const outlineParam = params.get("outline");
  if (outlineParam === "0") {
    state.outlineMinutes = [];
  } else if (outlineParam === "1") {
    state.outlineMinutes = [...DEFAULT_OUTLINE_MINUTES];
  } else if (outlineParam) {
    state.outlineMinutes = outlineParam
      .split(",")
      .map(Number)
      .filter((value) => OUTLINE_OPTIONS.includes(value));
  }
  syncOutlineToggles();
  const max = Number(params.get("max"));
  if (Number.isFinite(max) && max >= 20 && max <= 90) {
    state.maxTransitTime = max;
    maxTimeInput.value = String(max);
    maxTimeLabel.textContent = `Temps max. ${max} min`;
  }
  state.includeProjects = params.get("projects") === "1" ? true : params.get("projects") === "0" ? false : DEFAULT_INCLUDE_PROJECTS;
  projectsToggle.checked = state.includeProjects;
  if (origin) {
    setOrigin(origin, { pin: true, silent: true });
  } else {
    setOrigin(lonLatToWorld(DEFAULT_ORIGIN.lon, DEFAULT_ORIGIN.lat), {
      pin: true,
      label: DEFAULT_ORIGIN.label,
      silent: true,
    });
  }
  if (probe) setProbe(probe, true, { silent: true });
  if (params.get("view") || params.get("hand") === "1") {
    state.handMode = params.get("hand") === "1";
    state.viewportCenter = parsePair(params.get("view")) || defaultCenter();
    const zoom = Number(params.get("zoom"));
    if (Number.isFinite(zoom) && zoom > 0) state.viewportScale = clamp(zoom, MIN_VIEWPORT_SCALE, MAX_VIEWPORT_SCALE);
    handButton.setAttribute("aria-pressed", state.handMode ? "true" : "false");
    handButton.title = state.handMode ? "Revenir à la sélection" : "Déplacer librement la carte";
    syncCursor();
  }
  syncUrl();
}

mapCanvas.addEventListener("pointermove", (event) => {
  const { screen, world } = pointerToWorld(event);
  if (!world) return;
  if (state.dragTarget && state.dragPointerId === event.pointerId) {
    if (state.dragTarget === "pan") {
      const dx = screen[0] - state.dragStartScreen[0];
      const dy = screen[1] - state.dragStartScreen[1];
      const scale = state.currentRender.transform.scale;
      state.viewportCenter = [state.panStartCenter[0] - dx / scale, state.panStartCenter[1] + dy / scale];
      requestDraw();
      return;
    }
    if (state.dragStartScreen && distance(screen, state.dragStartScreen) > PIN_TAP_SLOP) {
      state.dragMoved = true;
    }
    if (state.dragTarget === "origin") {
      setOrigin(world, { pin: true, label: null, silent: true });
    } else {
      setProbe(world, true, { silent: true });
    }
    syncCursor(screen);
    return;
  }
  syncCursor(screen);
  if (state.handMode) return;
  if (!state.pinned) {
    if (state.originPoint && distance(state.originPoint, world) < HOVER_DEADBAND) return;
    setOrigin(world, { silent: true });
    return;
  }
  if (!state.probePinned && !hitPin(screen)) {
    if (state.probePoint && distance(state.probePoint, world) < HOVER_DEADBAND) return;
    setProbe(world, false, { silent: true });
  }
});

mapCanvas.addEventListener("pointerdown", (event) => {
  const { screen, world } = pointerToWorld(event);
  if (!world) return;
  if (state.handMode) {
    event.preventDefault();
    state.dragTarget = "pan";
    state.dragPointerId = event.pointerId;
    state.dragStartScreen = screen;
    state.panStartCenter = [...(state.viewportCenter || defaultCenter())];
    mapCanvas.setPointerCapture(event.pointerId);
    syncCursor(screen);
    return;
  }
  const hit = hitPin(screen);
  const target = hit || (state.pinned ? "probe" : "origin");
  event.preventDefault();
  state.dragTarget = target;
  state.dragPointerId = event.pointerId;
  state.dragMoved = false;
  state.dragStartScreen = screen;
  mapCanvas.setPointerCapture(event.pointerId);
  if (hit) {
    requestDraw();
  } else if (target === "origin") {
    setOrigin(world, { pin: true, label: null, silent: true });
  } else {
    setProbe(world, true, { silent: true });
  }
  syncCursor(screen);
});

mapCanvas.addEventListener("pointerup", endDrag);
mapCanvas.addEventListener("pointercancel", endDrag);

mapCanvas.addEventListener("dblclick", (event) => {
  if (state.handMode) return;
  const { screen } = pointerToWorld(event);
  const hit = hitPin(screen);
  if (hit === "probe") {
    state.probePoint = null;
    state.probePinned = false;
    requestDraw();
    syncUrl();
  } else if (hit === "origin") {
    state.originPoint = null;
    state.originLabel = null;
    state.pinned = false;
    state.probePoint = null;
    state.probePinned = false;
    requestDraw();
    syncUrl();
  }
});

function setSettingsOpen(open) {
  settingsPanel.hidden = !open;
  settingsButton.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) sharePanel.hidden = true;
}

settingsButton.addEventListener("click", (event) => {
  event.stopPropagation();
  setSettingsOpen(settingsPanel.hidden);
});
settingsClose.addEventListener("click", () => setSettingsOpen(false));
document.addEventListener("click", (event) => {
  if (settingsPanel.hidden) return;
  if (settingsPanel.contains(event.target) || settingsButton.contains(event.target)) return;
  setSettingsOpen(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !settingsPanel.hidden) setSettingsOpen(false);
});

function syncOutlineToggles() {
  for (const minutes of OUTLINE_OPTIONS) {
    const input = document.querySelector(`[data-outline="${minutes}"]`);
    if (input) input.checked = state.outlineMinutes.includes(minutes);
  }
}

document.getElementById("outlineOptions").addEventListener("change", () => {
  state.outlineMinutes = OUTLINE_OPTIONS.filter((minutes) => {
    const input = document.querySelector(`[data-outline="${minutes}"]`);
    return Boolean(input?.checked);
  });
  requestDraw();
  syncUrl();
});
projectsToggle.addEventListener("change", () => {
  state.includeProjects = projectsToggle.checked;
  requestDraw();
  syncUrl();
});
maxTimeInput.addEventListener("input", (event) => {
  state.maxTransitTime = Number(event.target.value);
  maxTimeLabel.textContent = `Temps max. ${state.maxTransitTime} min`;
  requestDraw();
  syncUrl();
});
document.getElementById("helpButton").addEventListener("click", () => {
  helpPanel.hidden = !helpPanel.hidden;
});
document.getElementById("zoomInButton").addEventListener("click", () => {
  const { width, height } = mapCanvas.getBoundingClientRect();
  state.viewportScale = clamp(state.viewportScale * VIEWPORT_ZOOM_STEP, minViewportScale(width, height), MAX_VIEWPORT_SCALE);
  requestDraw();
  syncUrl();
});
document.getElementById("zoomOutButton").addEventListener("click", () => {
  const { width, height } = mapCanvas.getBoundingClientRect();
  state.viewportScale = clamp(state.viewportScale / VIEWPORT_ZOOM_STEP, minViewportScale(width, height), MAX_VIEWPORT_SCALE);
  requestDraw();
  syncUrl();
});
handButton.addEventListener("click", () => {
  state.handMode = !state.handMode;
  if (state.handMode) state.viewportCenter = state.currentRender?.focus || defaultCenter();
  handButton.setAttribute("aria-pressed", state.handMode ? "true" : "false");
  handButton.title = state.handMode ? "Revenir à la sélection" : "Déplacer librement la carte";
  state.viewportScale = Math.max(state.viewportScale, minViewportScale(mapCanvas.clientWidth, mapCanvas.clientHeight));
  syncCursor();
  requestDraw();
  syncUrl();
});
document.getElementById("fullscreenButton").addEventListener("click", () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else mapStage.requestFullscreen();
});
document.getElementById("shareButton").addEventListener("click", () => {
  sharePanel.hidden = !sharePanel.hidden;
  shareUrl.textContent = location.href;
  if (!sharePanel.hidden) setSettingsOpen(false);
});
document.getElementById("copyLinkButton").addEventListener("click", async () => {
  await navigator.clipboard.writeText(location.href);
  document.getElementById("copyLinkButton").textContent = "Copié";
  setTimeout(() => {
    document.getElementById("copyLinkButton").textContent = "Copier le lien";
  }, 1400);
});
document.getElementById("locateButton").addEventListener("click", () => {
  if (!navigator.geolocation) {
    statusText.textContent = "Géolocalisation indisponible.";
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const world = lonLatToWorld(position.coords.longitude, position.coords.latitude);
      if (!nearestLandPoint(world)) {
        statusText.textContent = "Votre position est hors du périmètre et des lignes affichées.";
        return;
      }
      setOrigin(world, { pin: true, label: "Ma position" });
    },
    () => {
      statusText.textContent = "Impossible de lire la position.";
    },
  );
});
window.addEventListener("resize", requestDraw);

async function init() {
  const response = await fetch(DATA_URL);
  state.data = await response.json();
  state.ready = true;
  restoreUrl();
  state.dirty = false;
  requestDraw();
}

init();
