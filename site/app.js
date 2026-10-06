import { SITE_DEFAULTS } from "./default-settings.mjs?v=2026-10-06-defaults1";
import { parseSettingsFile, createSettingsFile } from "./settings-file.mjs?v=2026-10-06-settings1";
import { DirectClient } from "./direct-client.mjs?v=2026-10-06-live2";
import { snapToRailStation } from "./placement.mjs?v=2026-10-06-live2";
import { contourSegments } from "./isochrone.mjs?v=2026-10-06-live2";
import { WalkingClient } from "./walking-client.mjs?v=2026-10-06-live2";
import { buildTravelModel, estimateTravel as routeEstimate, reachability, describeJourney, routeWaitingMinutes, previewTravelModel, restoreDirectModel, estimateTravelTimes } from "./routing.mjs?v=2026-10-06-live2";
const DATA_URL = new URL("./data/commute_map_data.json?v=2026-10-06-live2", import.meta.url).toString();
const MIN_VIEWPORT_SCALE = 0.12;
const MAX_VIEWPORT_SCALE = 120;
const VIEWPORT_ZOOM_STEP = 1.32;
const DEFAULT_VIEWPORT_SCALE = SITE_DEFAULTS.map.viewportScale;
const PANEL_PADDING = 22;
const ROUTE_LINE_WIDTH = 3.6;
const DISPLAY_SETTINGS_STORAGE_KEY = "tours-display-settings-v2";
const TRAVEL_SETTINGS_STORAGE_KEY = "tours-travel-settings-v1";
const DEFAULT_ISOCHRONE_STOPS = SITE_DEFAULTS.display.isochroneStops;
const DEFAULT_DISPLAY_SETTINGS = Object.freeze(SITE_DEFAULTS.display);
const DEFAULT_TRAVEL_SETTINGS = Object.freeze(SITE_DEFAULTS.travel);
const PRIORITY_STATIONS = new Set(["Tours", "Blois-Chambord", "Saumur", "Vendôme", "Amboise", "Chinon", "Loches", "Château-Renault", "Bléré-la-Croix", "Montlouis", "Neuillé-Pont-Pierre", "Langeais", "Monts", "Ste-Maure-Noyant"]);
const PRIORITY_TOWNS = new Set(["Tours", "Blois", "Saumur", "Vendôme", "Amboise", "Chinon", "Loches", "Château-Renault", "Bléré", "Montlouis-sur-Loire", "Neuillé-Pont-Pierre", "Langeais", "Monts", "Sainte-Maure-de-Touraine"]);
const HOVER_DEADBAND = 12;
const PIN_HIT_RADIUS = 32;
const PIN_TAP_SLOP = 8;
const MAX_TIME_MINUTES = 180;
const OUTLINE_OPTIONS = [15, 30, 45, 60, 90, 120];
const DEFAULT_OUTLINE_MINUTES = [...SITE_DEFAULTS.map.outlineMinutes];
const OUTLINE_WIDTHS = { 15: 1.4, 30: 2.1, 45: 2, 60: 1.5 };
const DEFAULT_MAX_TIME_MINUTES = SITE_DEFAULTS.map.maxTransitTime;
const DEFAULT_INCLUDE_PROJECTS = SITE_DEFAULTS.map.includeProjects;
const SHARE_DECIMALS = 5;
const SHARE_CALC_VERSION = "2";
const TRAVEL_QUERY_PARAMS = Object.freeze({
  walkSpeedKmh: "walkspeed",
  navetteWaitFactor: "navfactor",
  terWaitFactor: "terfactor",
  tramWaitFactor: "tramfactor",
  terWait: "terw",
  tramWait: "tramw",
  bhnsWait: "bhnsw",
  navetteWait: "navw",
  railMagnetRadiusKm: "magnetradius",
  busWaitFactor: "busfactor",
  busEntryPenalty: "busentry",
  busExitPenalty: "busexit",
  busTransferPenalty: "bustransfer",
  busWalkingTransferPenalty: "buswalktransfer",
  stationEntryPenalty: "entry",
  stationExitPenalty: "exit",
  transferPenalty: "transfer",
  walkingTransferPenalty: "walktransfer",
});

function freshDisplaySettings() {
  return {
    ...DEFAULT_DISPLAY_SETTINGS,
    routeColors: { ...DEFAULT_DISPLAY_SETTINGS.routeColors },
    epciColors: { ...DEFAULT_DISPLAY_SETTINGS.epciColors },
    isochroneStops: DEFAULT_ISOCHRONE_STOPS.map((stop) => ({ ...stop })),
  };
}

function validHexColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || ""));
}

function normalizeDisplaySettings(value) {
  const source = { ...DEFAULT_DISPLAY_SETTINGS, ...(value && typeof value === "object" ? value : {}) };
  const numeric = (key, min, max) => {
    const number = Number(source[key]);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : DEFAULT_DISPLAY_SETTINGS[key];
  };
  const colorMap = (value) => {
    const result = {};
    if (value && typeof value === "object") {
      for (const [key, color] of Object.entries(value)) {
        if (validHexColor(color)) result[key] = color.toLowerCase();
      }
    }
    return result;
  };
  const savedStops = Array.isArray(source.isochroneStops) && source.isochroneStops.length >= 2
    ? source.isochroneStops.slice(0, 24) : DEFAULT_ISOCHRONE_STOPS;
  const isochroneStops = savedStops.map((stop, index) => ({
    t: Number.isFinite(Number(stop.t)) ? clamp(Number(stop.t), 0, 1) : index / (savedStops.length - 1),
    color: validHexColor(stop.color) ? stop.color.toLowerCase() : DEFAULT_ISOCHRONE_STOPS[0].color,
    alpha: Number.isFinite(Number(stop.alpha)) ? clamp(Number(stop.alpha), 0, 1) : 1,
  })).sort((a,b) => a.t - b.t);
  isochroneStops[0].t = 0; isochroneStops.at(-1).t = 1;
  return {
    railMagnetMaxScale: (() => {
      const direct = Number(source.railMagnetMaxScale);
      if (Number.isFinite(direct)) return Math.max(50000, Math.min(5000000, direct));
      const legacyZoom = Number(source.railMagnetMinZoom);
      return Number.isFinite(legacyZoom) && legacyZoom > 0
        ? Math.max(50000, Math.min(5000000, 500000 / legacyZoom))
        : DEFAULT_DISPLAY_SETTINGS.railMagnetMaxScale;
    })(),
    isochronePocketScale: numeric("isochronePocketScale", 0.5, 3),
    railMagnetism: source.railMagnetism !== false,
    showBusLabels: source.showBusLabels !== false,
    busEpciColors: source.busEpciColors === true,
    busEpciTone: numeric("busEpciTone", -0.8, 0.8),
    terWidth: numeric("terWidth", 0.5, 10),
    tramWidth: numeric("tramWidth", 0.5, 10),
    bhnsWidth: numeric("bhnsWidth", 0.5, 10),
    stationRadius: numeric("stationRadius", 0, Infinity),
    railStationRadius: numeric("railStationRadius", 0, Infinity),
    labelScale: numeric("labelScale", 0.6, 1.8),
    communeBorderWidth: numeric("communeBorderWidth", 0.1, 6),
    epciBorderWidth: numeric("epciBorderWidth", 0.2, 8),
    isochroneOpacity: numeric("isochroneOpacity", 0, 1),
    communeFillOpacity: numeric("communeFillOpacity", 0, 1),
    epciFillOpacity: numeric("epciFillOpacity", 0, 1),
    communeColor: validHexColor(source.communeColor) ? source.communeColor.toLowerCase() : DEFAULT_DISPLAY_SETTINGS.communeColor,
    backgroundColor: validHexColor(source.backgroundColor) ? source.backgroundColor.toLowerCase() : DEFAULT_DISPLAY_SETTINGS.backgroundColor,
    routeColors: colorMap(source.routeColors),
    epciColors: colorMap(source.epciColors),
    isochroneStops,
  };
}

function loadDisplaySettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(DISPLAY_SETTINGS_STORAGE_KEY) || "null");
    if (stored) return normalizeDisplaySettings(stored);
    // Migrate the first display-settings version automatically.
    return normalizeDisplaySettings(JSON.parse(localStorage.getItem("tours-display-settings-v1") || "null"));
  } catch {
    return freshDisplaySettings();
  }
}

function normalizeTravelSettings(value) {
  const source = { ...DEFAULT_TRAVEL_SETTINGS, ...(value && typeof value === "object" ? value : {}) };
  const numeric = (key, min, max) => {
    const number = Number(source[key]);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : DEFAULT_TRAVEL_SETTINGS[key];
  };
  const factor = (key, legacy, base) => {
    if (source[key] === undefined && Number.isFinite(Number(source[legacy]))) {
      return Math.max(0, Math.min(3, Number(source[legacy]) / base));
    }
    return numeric(key, 0, 3);
  };
  return {
    walkSpeedKmh: numeric("walkSpeedKmh", 1, 8),
    navetteWaitFactor: factor("navetteWaitFactor", "navetteWait", 5),
    terWaitFactor: factor("terWaitFactor", "terWait", 15),
    tramWaitFactor: factor("tramWaitFactor", "tramWait", 4),
    terWait: 15,
    tramWait: 4,
    bhnsWait: numeric("bhnsWait", 0, 30),
    navetteWait: 5,
    railMagnetRadiusKm: numeric("railMagnetRadiusKm", 0.1, 3),
    disabledBusNetworks: Array.isArray(source.disabledBusNetworks) ? [...new Set(source.disabledBusNetworks.filter(v => typeof v === "string" && /^[a-z0-9_-]+$/.test(v)))] : [],
    busWaitFactor: numeric("busWaitFactor", 0, 3),
    busEntryPenalty: numeric("busEntryPenalty", 0, 30),
    busExitPenalty: numeric("busExitPenalty", 0, 30),
    busTransferPenalty: numeric("busTransferPenalty", 0, 30),
    busWalkingTransferPenalty: numeric("busWalkingTransferPenalty", 0, 30),
    stationEntryPenalty: numeric("stationEntryPenalty", 0, 20),
    stationExitPenalty: numeric("stationExitPenalty", 0, 20),
    transferPenalty: numeric("transferPenalty", 0, 30),
    walkingTransferPenalty: numeric("walkingTransferPenalty", 0, 30),
  };
}

function loadTravelSettings() {
  try {
    return normalizeTravelSettings(JSON.parse(localStorage.getItem(TRAVEL_SETTINGS_STORAGE_KEY) || "null"));
  } catch {
    return { ...DEFAULT_TRAVEL_SETTINGS };
  }
}

const displaySettings = loadDisplaySettings();
const travelSettings = loadTravelSettings();

const state = {
  data: null,
  ready: false,
  outlineMinutes: [...DEFAULT_OUTLINE_MINUTES],
  maxTransitTime: DEFAULT_MAX_TIME_MINUTES,
  includeProjects: DEFAULT_INCLUDE_PROJECTS,
  walkingOnRoads: SITE_DEFAULTS.map.walkingOnRoads,
  viewportScale: DEFAULT_VIEWPORT_SCALE,
  viewportCenter: [...SITE_DEFAULTS.map.viewportCenter],
  handMode: true,
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
const mapScale = document.getElementById("mapScale");
const mapScaleBar = document.getElementById("mapScaleBar");
const mapScaleDistance = document.getElementById("mapScaleDistance");
const mapScaleRatio = document.getElementById("mapScaleRatio");
const maxTimeInput = document.getElementById("maxTimeInput");
const maxTimeLabel = document.getElementById("maxTimeLabel");
const helpPanel = document.getElementById("helpPanel");
const settingsPanel = document.getElementById("settingsPanel");
const displaySettingsButton = document.getElementById("displaySettingsButton");
const displaySettingsPanel = document.getElementById("displaySettingsPanel");
const displaySettingsScrim = document.getElementById("displaySettingsScrim");
const displaySettingsClose = document.getElementById("displaySettingsClose");
const displaySettingsDone = document.getElementById("displaySettingsDone");
const displayResetAll = document.getElementById("displayResetAll");
const displayRouteColors = document.getElementById("displayRouteColors");
const displayEpciColors = document.getElementById("displayEpciColors");
const isochroneGradientControls = document.getElementById("isochroneGradientControls");
const isochroneGradientPreview = document.getElementById("isochroneGradientPreview");
const projectsToggle = document.getElementById("projectsToggle");
const roadWalkingToggle = document.getElementById("roadWalkingToggle");
const walkingNote = document.getElementById("walkingNote");
const mapCard = document.querySelector(".map-card");
const journeyPanel = document.getElementById("journeyPanel");
const journeyContent = document.getElementById("journeyContent");
const mapBackdrop = document.createElement("canvas");
const staticBase = document.createElement("canvas");
const staticNetwork = document.createElement("canvas");
let staticLayersKey = "";
let backdropKey = "";

function saveDisplaySettings() {
  try {
    localStorage.setItem(DISPLAY_SETTINGS_STORAGE_KEY, JSON.stringify(displaySettings));
  } catch {
    // The map remains usable when storage is disabled.
  }
}

function saveTravelSettings() {
  try {
    localStorage.setItem(TRAVEL_SETTINGS_STORAGE_KEY, JSON.stringify(travelSettings));
  } catch {
    // The map remains usable when storage is disabled.
  }
}

function invalidateVisualSettings() {
  backdropKey = "";
  requestDraw();
}

function invalidateTravelSettings() {
  cachedModel = null;
  cachedModelKey = "";
  cachedWarp = null;
  cachedWarpKey = "";
  backdropKey = "";
  lastJourneyKey = "";
  requestDraw();
}

function defaultRouteColor(routeId) {
  if (DEFAULT_DISPLAY_SETTINGS.routeColors[routeId]) return DEFAULT_DISPLAY_SETTINGS.routeColors[routeId];
  const info = state.data?.routeInfo?.[routeId];
  if (validHexColor(info?.color)) return info.color.toLowerCase();
  const route = state.data?.routes?.find((item) => item.id === routeId && validHexColor(item.color));
  return route?.color?.toLowerCase() || "#345c77";
}

const busReferenceEpcis = new Map();
const NETWORK_EPCIS = {filbleu: "243700754", azalys: "200030385", move: "200072072", cvl: "200043081", amboise: "200043065", ogalo: "200071876", filrouge: "243700499", loches: "200071587", blere: "243700820"};
function referenceEpci(route) {
  const info = state.data.routeInfo?.[route.id];
  const fixed = NETWORK_EPCIS[info?.network || (route.mode === "BHNS" ? "filbleu" : "")];
  if (fixed) return state.data.boroughs.find(b => b.code === fixed);
  if (!busReferenceEpcis.has(route.id)) {
    const votes = new Map();
    const stops = state.data.stations.filter(s => s.displayRoutes.includes(route.id));
    for (const station of stops) {
      const epci = state.data.boroughs.find(b => b.polygons.some(p => pointInPolygon(station.point, p)));
      if (epci) votes.set(epci.code, (votes.get(epci.code) || 0) + 1);
    }
    busReferenceEpcis.set(route.id, [...votes].sort((a,b) => b[1] - a[1])[0]?.[0] || null);
  }
  return state.data.boroughs.find(b => b.code === busReferenceEpcis.get(route.id));
}
function routeDisplayColor(route) {
  if (displaySettings.busEpciColors && ["BUS", "BHNS"].includes(route.mode)) {
    if (state.data.routeInfo?.[route.id]?.network === "remi") return "#ffffff";
    const epci = referenceEpci(route);
    if (epci) {
      const tone = displaySettings.busEpciTone;
      const rgb = hexToRgb(epciDisplayColor(epci));
      return "#" + rgb.map(v => Math.round(tone < 0 ? v * (1 + tone) : v + (255 - v) * tone).toString(16).padStart(2,"0")).join("");
    }
  }
  return displaySettings.routeColors[route.id] || defaultRouteColor(route.id);
}

function hexToRgb(hex) {
  const value = String(hex || "").replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(value)) return [255, 196, 79];
  return [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16));
}

function gradientCss() {
  return `linear-gradient(90deg, ${displaySettings.isochroneStops.map((stop) => {
    const [r, g, b] = hexToRgb(stop.color);
    const alpha = clamp(stop.alpha * displaySettings.isochroneOpacity, 0, 1);
    return `rgba(${r}, ${g}, ${b}, ${alpha}) ${Math.round(stop.t * 100)}%`;
  }).join(", ")})`;
}

function epciDisplayColor(borough) {
  return displaySettings.epciColors[borough.code] || DEFAULT_DISPLAY_SETTINGS.epciColors[borough.code] || displaySettings.communeColor;
}

function setDisplaySettingsOpen(open) {
  displaySettingsPanel.hidden = !open;
  displaySettingsScrim.hidden = !open;
  displaySettingsButton.setAttribute("aria-expanded", String(open));
  if (open) {
    syncDisplaySettingsControls();
  }
}

function setColorControl(key, value) {
  const color = validHexColor(value) ? value.toLowerCase() : DEFAULT_DISPLAY_SETTINGS[key];
  const picker = displaySettingsPanel.querySelector('[data-display-color="' + key + '"]');
  const code = displaySettingsPanel.querySelector('[data-display-color-code="' + key + '"]');
  if (picker) picker.value = color;
  if (code) code.value = color.toUpperCase();
}

function syncDisplaySettingsControls() {
  displaySettingsPanel.querySelectorAll("[data-display-toggle]").forEach(input => { input.checked = displaySettings[input.dataset.displayToggle]; });
  displaySettingsPanel.querySelectorAll("[data-display-number]").forEach((input) => {
    const key = input.dataset.displayNumber;
    input.value = String(displaySettings[key]);
    const percent = displaySettingsPanel.querySelector('[data-display-percent="' + key + '"]');
    if (percent) percent.textContent = Math.round(Number(displaySettings[key]) * 100) + "%";
  });
  displaySettingsPanel.querySelectorAll("[data-travel-number]").forEach((input) => {
    const key = input.dataset.travelNumber;
    input.value = String(travelSettings[key]);
  });
  setColorControl("communeColor", displaySettings.communeColor);
  setColorControl("backgroundColor", displaySettings.backgroundColor);

  displaySettingsPanel.querySelectorAll("[data-bus-network]").forEach(input => { input.checked = !travelSettings.disabledBusNetworks.includes(input.dataset.busNetwork); });
  displaySettingsPanel.querySelectorAll(".route-color-row").forEach((row) => {
    const routeId = row.dataset.routeId;
    const color = (displaySettings.routeColors[routeId] || defaultRouteColor(routeId)).toLowerCase();
    const picker = row.querySelector("[data-route-color]");
    const code = row.querySelector("[data-route-color-code]");
    if (picker) picker.value = color;
    if (code) code.value = color.toUpperCase();
  });

  displayEpciColors?.querySelectorAll(".epci-color-row").forEach((row) => {
    const epciCode = row.dataset.epciCode;
    const color = (displaySettings.epciColors[epciCode] || DEFAULT_DISPLAY_SETTINGS.epciColors[epciCode] || displaySettings.communeColor).toLowerCase();
    const picker = row.querySelector("[data-epci-color]");
    const code = row.querySelector("[data-epci-color-code]");
    if (picker) picker.value = color;
    if (code) code.value = color.toUpperCase();
  });

  isochroneGradientControls?.querySelectorAll("[data-isochrone-stop]").forEach((row) => {
    const index = Number(row.dataset.isochroneStop);
    const stop = displaySettings.isochroneStops[index];
    if (!stop) return;
    const picker = row.querySelector("[data-isochrone-color]");
    const alpha = row.querySelector("[data-isochrone-alpha]");
    const alphaValue = row.querySelector("[data-isochrone-alpha-value]");
    const track = row.querySelector(".isochrone-alpha-track");
    if (picker) picker.value = stop.color;
    if (alpha) alpha.value = String(Math.round(stop.alpha * 100));
    if (alphaValue) alphaValue.textContent = Math.round(stop.alpha * 100) + "%";
    if (track) {
      const [r, g, b] = hexToRgb(stop.color);
      track.style.background = `linear-gradient(90deg, rgba(${r},${g},${b},0), rgba(${r},${g},${b},1))`;
    }
  });
  legend?.querySelector(".legend-bar")?.style.setProperty("background", gradientCss());
  isochroneGradientPreview?.style.setProperty("background", gradientCss());
}

const MY_MAPS_ROUTE_GROUPS = Object.freeze({
  Tours: ["TRAM A", "TRAM B", "BHNS C", "NAVETTE"],
  Nord: ["TER K39", "TER K30", "TER P30", "TER P33", "TER P34", "TER P10"],
  Ouest: ["TER K1", "TER P1", "TER P65", "TER P101", "TER K15", "TER P5", "TER P15"],
  Est: ["TER K1", "TER K16", "TER K6+", "TER P6", "TER P7", "TER P17", "TER P166", "TER P14", "TER P16", "TER K5+", "TER P2"],
  Sud: ["TER P11", "TER P31", "TER P21"],
});
const ROUTE_GROUP_ORDER = ["Tours", "Nord", "Ouest", "Est", "Sud"];

function hslToHex(h, s, l) {
  const saturation = s / 100;
  const lightness = l / 100;
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rgb = [0, 0, 0];
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const m = lightness - c / 2;
  return "#" + rgb.map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("");
}

function stringHash(value) {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash;
}

let paletteSequence = 0;
function applyPaletteToGroup(group) {
  const section = [...displayRouteColors.querySelectorAll("[data-route-group]")]
    .find((item) => item.dataset.routeGroup === group);
  if (!section) return;
  const rows = [...section.querySelectorAll(".route-color-row")];
  const baseHue = (stringHash(group) + (++paletteSequence * 71)) % 360;
  const hueOffsets = [-12, -7, -3, 0, 4, 8, 12, -9, 6, 2];
  const saturations = [82, 62, 74, 48, 88, 56, 70, 42, 78, 66];
  const lightnesses = [34, 48, 61, 72, 42, 56, 29, 66, 51, 39];
  rows.forEach((row, index) => {
    const routeId = row.dataset.routeId;
    const hue = (baseHue + hueOffsets[index % hueOffsets.length] + 360) % 360;
    const saturation = saturations[(index + paletteSequence) % saturations.length];
    const lightness = lightnesses[(index * 3 + paletteSequence) % lightnesses.length];
    displaySettings.routeColors[routeId] = hslToHex(hue, saturation, lightness);
  });
  syncDisplaySettingsControls();
  saveDisplaySettings();
  invalidateVisualSettings();
}

function busNetworkEnabled(routeId) {
  return !travelSettings.disabledBusNetworks.includes(state.data.routeInfo?.[routeId]?.network || "filbleu");
}

function buildBusNetworkSettings() {
  const container = document.getElementById("busNetworkSettings");
  container.replaceChildren();
  const groups = new Map();
  for (const [id, info] of Object.entries(state.data.routeInfo || {})) {
    if (info.mode !== "BUS") continue;
    const network = info.network || "filbleu";
    if (!groups.has(network)) groups.set(network, []);
    groups.get(network).push({id, ...info});
  }
  for (const [network, items] of groups) {
    const section = document.createElement("details");
    section.className = "settings-collapse";
    const summary = document.createElement("summary");
    summary.textContent = `${items[0].networkName || "Fil Bleu"} · ${items.length} ${items.length === 1 ? "ligne" : "lignes"}`;
    section.append(summary);
    const body = document.createElement("div");
    body.className = "settings-collapse-body";
    const enable = document.createElement("label"), checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.busNetwork = network;
    enable.append(checkbox, document.createTextNode(" Inclure ce réseau dans la carte et les calculs"));
    body.append(enable);
    for (const info of items.sort((a,b)=>a.id.localeCompare(b.id, "fr", {numeric:true}))) {
      const row = document.createElement("div");
      row.className = "route-color-row"; row.dataset.routeId = info.id;
      const label = document.createElement("div"); label.className = "route-color-label";
      const name = document.createElement("strong"), title = document.createElement("small");
      name.textContent = info.shortName || info.id; title.textContent = info.title;
      label.append(name, title);
      const controls = document.createElement("div"); controls.className = "display-color-control";
      const color = document.createElement("input"); color.type = "color"; color.dataset.routeColor = info.id;
      color.setAttribute("aria-label", "Couleur de " + info.id);
      const reset = document.createElement("button"); reset.type = "button"; reset.className = "display-row-reset";
      reset.dataset.resetRoute = info.id; reset.textContent = "↺"; reset.setAttribute("aria-label", "Rétablir la couleur de " + info.id);
      controls.append(color, reset); row.append(label, controls); body.append(row);
    }
    section.append(body); container.append(section);
  }
}

function buildRouteColorSettings() {
  if (!state.data) return;

  const unique = new Map();
  for (const route of state.data.routes) {
    if (route.mode === "RFN" || route.mode === "BUS" || state.data.routeInfo?.[route.id]?.serviceStatus?.status === "suspended" || unique.has(route.id)) continue;
    const info = state.data.routeInfo?.[route.id] || {};
    unique.set(route.id, {
      id: route.id,
      mode: info.mode || route.mode,
      title: info.title || route.title || route.id,
    });
  }
  for (const [id, info] of Object.entries(state.data.routeInfo || {})) {
    if (unique.has(id) || info?.mode === "BUS" || info?.serviceStatus?.status === "suspended") continue;
    if (!["TER", "NAVETTE", "TRAM", "BHNS"].includes(info?.mode)) continue;
    unique.set(id, { id, mode: info.mode, title: info.title || id });
  }

  displayRouteColors.replaceChildren();
  const groupedIds = new Set();

  for (const group of ROUTE_GROUP_ORDER) {
    const ids = MY_MAPS_ROUTE_GROUPS[group];
    const items = ids.map((id) => unique.get(id)).filter(Boolean);
    if (!items.length) continue;
    items.forEach((route) => groupedIds.add(route.id));

    const section = document.createElement("details");
    section.className = "route-color-group settings-collapse";
    section.dataset.routeGroup = group;

    const summary = document.createElement("summary");
    summary.className = "route-color-group-header";
    const title = document.createElement("strong");
    title.textContent = group;
    const tools = document.createElement("span");
    tools.className = "route-group-tools";
    const palette = document.createElement("button");
    palette.type = "button";
    palette.className = "display-palette-button";
    palette.dataset.paletteGroup = group;
    palette.textContent = "🎨";
    palette.title = "Nouvelle palette dans une même famille de couleur";
    palette.setAttribute("aria-label", "Générer une palette monochrome pour " + group);
    tools.append(palette);
    summary.append(title, tools);
    section.append(summary);

    const body = document.createElement("div");
    body.className = "route-color-group-body";
    for (const route of items) {
      const row = document.createElement("div");
      row.className = "route-color-row";
      row.dataset.routeId = route.id;

      const label = document.createElement("div");
      label.className = "route-color-label";
      const strong = document.createElement("strong");
      strong.textContent = route.id;
      const small = document.createElement("small");
      small.textContent = route.title;
      label.append(strong, small);

      const control = document.createElement("div");
      control.className = "display-color-control";
      const picker = document.createElement("input");
      picker.type = "color";
      picker.dataset.routeColor = route.id;
      picker.setAttribute("aria-label", "Couleur de " + route.id);
      const code = document.createElement("input");
      code.type = "text";
      code.maxLength = 7;
      code.dataset.routeColorCode = route.id;
      code.setAttribute("aria-label", "Code couleur de " + route.id);
      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "display-row-reset";
      reset.dataset.resetRoute = route.id;
      reset.setAttribute("aria-label", "Rétablir la couleur de " + route.id);
      reset.textContent = "↺";
      control.append(picker, code, reset);
      row.append(label, control);
      body.append(row);
    }
    section.append(body);
    displayRouteColors.append(section);
  }

  // Keep newly discovered routes visible without misclassifying them under
  // Tours. Unknown rail routes receive a neutral "Autres TER" section until
  // their corridor is explicitly classified.
  const ungrouped = [...unique.values()].filter((route) => !groupedIds.has(route.id));
  if (ungrouped.length) {
    const section = document.createElement("details");
    section.className = "route-color-group settings-collapse";
    section.dataset.routeGroup = "Autres TER";
    const summary = document.createElement("summary");
    summary.className = "route-color-group-header";
    const title = document.createElement("strong");
    title.textContent = "Autres TER";
    summary.append(title);
    section.append(summary);
    const tours = document.createElement("div");
    tours.className = "route-color-group-body";
    section.append(tours);
    displayRouteColors.append(section);
    for (const route of ungrouped) {
      const row = document.createElement("div");
      row.className = "route-color-row";
      row.dataset.routeId = route.id;
      const label = document.createElement("div");
      label.className = "route-color-label";
      const strong = document.createElement("strong");
      strong.textContent = route.id;
      const small = document.createElement("small");
      small.textContent = route.title;
      label.append(strong, small);
      const control = document.createElement("div");
      control.className = "display-color-control";
      const picker = document.createElement("input");
      picker.type = "color";
      picker.dataset.routeColor = route.id;
      const code = document.createElement("input");
      code.type = "text";
      code.maxLength = 7;
      code.dataset.routeColorCode = route.id;
      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "display-row-reset";
      reset.dataset.resetRoute = route.id;
      reset.textContent = "↺";
      control.append(picker, code, reset);
      row.append(label, control);
      tours?.append(row);
    }
  }

  syncDisplaySettingsControls();
}

let epciPaletteSequence = 0;
function applyPaletteToEpcis() {
  if (!state.data) return;
  const boroughs = [...state.data.boroughs].sort((a, b) => {
    if (a.code === "243700754") return -1;
    if (b.code === "243700754") return 1;
    return a.name.localeCompare(b.name, "fr");
  });

  // Deliberately span the spectrum, with close variants inside several
  // families (reds/pinks/oranges, blues/cyans, greens) instead of assigning
  // one unrelated random colour to each EPCI.
  const families = [
    { hue: 4, sats: [76, 62], lights: [48, 64] },      // rouge
    { hue: 338, sats: [72, 58], lights: [50, 68] },    // rose
    { hue: 27, sats: [82, 68], lights: [52, 67] },     // orange
    { hue: 44, sats: [78, 60], lights: [52, 69] },     // ambre
    { hue: 210, sats: [74, 58], lights: [48, 66] },    // bleu
    { hue: 231, sats: [66, 52], lights: [49, 67] },    // bleu violacé
    { hue: 187, sats: [70, 54], lights: [45, 64] },    // bleu-vert
    { hue: 157, sats: [68, 52], lights: [43, 62] },    // vert
    { hue: 118, sats: [58, 46], lights: [46, 64] },    // vert franc
  ];
  const offset = (++epciPaletteSequence * 3) % families.length;

  boroughs.forEach((borough, index) => {
    const family = families[(index + offset) % families.length];
    const variant = Math.floor((index + epciPaletteSequence) / families.length) % 2;
    const hueJitter = ((index * 7 + epciPaletteSequence * 5) % 11) - 5;
    const saturation = family.sats[variant];
    const lightness = family.lights[(index + epciPaletteSequence) % family.lights.length];
    displaySettings.epciColors[borough.code] = hslToHex(family.hue + hueJitter, saturation, lightness);
  });

  syncDisplaySettingsControls();
  saveDisplaySettings();
  invalidateVisualSettings();
}

function buildIsochroneGradientControls() {
  if (!isochroneGradientControls) return;
  isochroneGradientControls.replaceChildren();
  displaySettings.isochroneStops.forEach((stop, index) => {
    const row = document.createElement("div");
    row.className = "isochrone-stop-row";
    row.dataset.isochroneStop = String(index);

    const label = document.createElement("div");
    label.className = "isochrone-stop-label";
    const strong = document.createElement("strong");
    strong.textContent = Math.round((1 - stop.t) * 100) + "%";
    const small = document.createElement("small");
    small.textContent = index === 0 ? "départ" : index === displaySettings.isochroneStops.length - 1 ? "temps maximal" : "étape";
    label.append(strong, small);

    const control = document.createElement("div");
    control.className = "isochrone-stop-picker";

    const picker = document.createElement("input");
    picker.type = "color";
    picker.dataset.isochroneColor = String(index);
    picker.setAttribute("aria-label", "Couleur du dégradé à " + Math.round((1 - stop.t) * 100) + "%");

    const alphaTrack = document.createElement("div");
    alphaTrack.className = "isochrone-alpha-track";
    const alpha = document.createElement("input");
    alpha.type = "range";
    alpha.min = "0";
    alpha.max = "100";
    alpha.step = "1";
    alpha.dataset.isochroneAlpha = String(index);
    alpha.setAttribute("aria-label", "Transparence du dégradé à " + Math.round((1 - stop.t) * 100) + "%");
    alphaTrack.append(alpha);

    const alphaValue = document.createElement("span");
    alphaValue.className = "isochrone-alpha-value";
    alphaValue.dataset.isochroneAlphaValue = String(index);

    control.append(picker, alphaTrack, alphaValue);
    row.append(label, control);
    isochroneGradientControls.append(row);
  });
  syncDisplaySettingsControls();
}

function buildEpciColorSettings() {
  if (!state.data || !displayEpciColors) return;
  displayEpciColors.replaceChildren();
  const boroughs = [...state.data.boroughs].sort((a, b) => {
    if (a.code === "243700754") return -1;
    if (b.code === "243700754") return 1;
    return a.name.localeCompare(b.name, "fr");
  });
  for (const borough of boroughs) {
    const row = document.createElement("div");
    row.className = "route-color-row epci-color-row";
    row.dataset.epciCode = borough.code;

    const label = document.createElement("div");
    label.className = "route-color-label";
    const strong = document.createElement("strong");
    strong.textContent = borough.name;
    const small = document.createElement("small");
    small.textContent = borough.code === "243700754" ? "Tours Métropole" : "EPCI";
    label.append(strong, small);

    const control = document.createElement("div");
    control.className = "display-color-control";
    const picker = document.createElement("input");
    picker.type = "color";
    picker.dataset.epciColor = borough.code;
    picker.setAttribute("aria-label", "Couleur de " + borough.name);
    const code = document.createElement("input");
    code.type = "text";
    code.maxLength = 7;
    code.dataset.epciColorCode = borough.code;
    code.setAttribute("aria-label", "Code couleur de " + borough.name);
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "display-row-reset";
    reset.dataset.resetEpci = borough.code;
    reset.setAttribute("aria-label", "Rétablir la couleur de " + borough.name);
    reset.textContent = "↺";
    control.append(picker, code, reset);
    row.append(label, control);
    displayEpciColors.append(row);
  }
  syncDisplaySettingsControls();
}

function applyDisplayNumber(input) {
  const key = input.dataset.displayNumber;
  const fallback = DEFAULT_DISPLAY_SETTINGS[key];
  const min = input.min === "" ? -Infinity : Number(input.min);
  const max = input.max === "" ? Infinity : Number(input.max);
  let value = Number(input.value);
  if (!Number.isFinite(value)) value = fallback;
  value = Math.max(min, Math.min(max, value));
  displaySettings[key] = value;
  input.value = String(value);
  const percent = displaySettingsPanel.querySelector('[data-display-percent="' + key + '"]');
  if (percent) percent.textContent = Math.round(value * 100) + "%";
  saveDisplaySettings();
  if (key === "railMagnetMaxScale") syncUrl();
  if (key === "isochroneOpacity") syncDisplaySettingsControls();
  invalidateVisualSettings();
}

function applyTravelNumber(input) {
  const key = input.dataset.travelNumber;
  const fallback = DEFAULT_TRAVEL_SETTINGS[key];
  const min = Number(input.min);
  const max = Number(input.max);
  let value = Number(input.value);
  if (!Number.isFinite(value)) value = fallback;
  value = Math.max(min, Math.min(max, value));
  travelSettings[key] = value;
  input.value = String(value);
  saveTravelSettings();
  invalidateTravelSettings();
  syncUrl();
}

displaySettingsPanel.addEventListener("input", (event) => {
  const target = event.target;
  if (target.matches("[data-bus-network]")) {
    const disabled = new Set(travelSettings.disabledBusNetworks);
    if (target.checked) disabled.delete(target.dataset.busNetwork); else disabled.add(target.dataset.busNetwork);
    travelSettings.disabledBusNetworks = [...disabled];
    saveTravelSettings(); invalidateTravelSettings(); invalidateVisualSettings(); syncUrl();
    return;
  }
  if (target.matches("[data-display-toggle]")) {
    displaySettings[target.dataset.displayToggle] = target.checked;
    saveDisplaySettings();
    invalidateVisualSettings();
    if (target.dataset.displayToggle === "railMagnetism") syncUrl();
    return;
  }
  if (target.matches("[data-display-number]")) {
    applyDisplayNumber(target);
    return;
  }
  if (target.matches("[data-travel-number]")) {
    applyTravelNumber(target);
    return;
  }
  if (target.matches("[data-display-color]")) {
    const key = target.dataset.displayColor;
    if (!validHexColor(target.value)) return;
    displaySettings[key] = target.value.toLowerCase();
    setColorControl(key, target.value);
    saveDisplaySettings();
    syncDisplaySettingsControls();
    invalidateVisualSettings();
    return;
  }
  if (target.matches("[data-display-color-code]")) {
    const key = target.dataset.displayColorCode;
    if (!validHexColor(target.value.trim())) return;
    displaySettings[key] = target.value.trim().toLowerCase();
    setColorControl(key, displaySettings[key]);
    saveDisplaySettings();
    syncDisplaySettingsControls();
    invalidateVisualSettings();
    return;
  }
  if (target.matches("[data-route-color]")) {
    const routeId = target.dataset.routeColor;
    if (!validHexColor(target.value)) return;
    displaySettings.routeColors[routeId] = target.value.toLowerCase();
    const code = target.closest(".route-color-row")?.querySelector("[data-route-color-code]");
    if (code) code.value = target.value.toUpperCase();
    saveDisplaySettings();
    invalidateVisualSettings();
    return;
  }
  if (target.matches("[data-route-color-code]")) {
    const routeId = target.dataset.routeColorCode;
    const color = target.value.trim();
    if (!validHexColor(color)) return;
    displaySettings.routeColors[routeId] = color.toLowerCase();
    const picker = target.closest(".route-color-row")?.querySelector("[data-route-color]");
    if (picker) picker.value = color;
    target.value = color.toUpperCase();
    saveDisplaySettings();
    invalidateVisualSettings();
    return;
  }
  if (target.matches("[data-epci-color]")) {
    const epciCode = target.dataset.epciColor;
    if (!validHexColor(target.value)) return;
    displaySettings.epciColors[epciCode] = target.value.toLowerCase();
    const code = target.closest(".epci-color-row")?.querySelector("[data-epci-color-code]");
    if (code) code.value = target.value.toUpperCase();
    saveDisplaySettings();
    invalidateVisualSettings();
    return;
  }
  if (target.matches("[data-epci-color-code]")) {
    const epciCode = target.dataset.epciColorCode;
    const color = target.value.trim();
    if (!validHexColor(color)) return;
    displaySettings.epciColors[epciCode] = color.toLowerCase();
    const picker = target.closest(".epci-color-row")?.querySelector("[data-epci-color]");
    if (picker) picker.value = color;
    target.value = color.toUpperCase();
    saveDisplaySettings();
    invalidateVisualSettings();
    return;
  }
  if (target.matches("[data-isochrone-color]")) {
    const index = Number(target.dataset.isochroneColor);
    if (!displaySettings.isochroneStops[index] || !validHexColor(target.value)) return;
    displaySettings.isochroneStops[index].color = target.value.toLowerCase();
    saveDisplaySettings();
    syncDisplaySettingsControls();
    invalidateVisualSettings();
    return;
  }
  if (target.matches("[data-isochrone-alpha]")) {
    const index = Number(target.dataset.isochroneAlpha);
    if (!displaySettings.isochroneStops[index]) return;
    displaySettings.isochroneStops[index].alpha = clamp(Number(target.value) / 100, 0, 1);
    saveDisplaySettings();
    syncDisplaySettingsControls();
    invalidateVisualSettings();
  }
});

displaySettingsPanel.addEventListener("blur", (event) => {
  const target = event.target;
  if (target.matches("[data-display-number]")) {
    applyDisplayNumber(target);
  } else if (target.matches("[data-travel-number]")) {
    applyTravelNumber(target);
  } else if (target.matches("[data-display-color-code]")) {
    setColorControl(target.dataset.displayColorCode, displaySettings[target.dataset.displayColorCode]);
  } else if (target.matches("[data-route-color-code], [data-epci-color-code]")) {
    syncDisplaySettingsControls();
  }
}, true);

displaySettingsPanel.addEventListener("click", (event) => {
  const adjust = event.target.closest("[data-adjust]");
  if (adjust) {
    const key = adjust.dataset.adjust;
    const input = displaySettingsPanel.querySelector('[data-display-number="' + key + '"]');
    if (!input) return;
    input.value = String(Number(input.value || DEFAULT_DISPLAY_SETTINGS[key]) + Number(adjust.dataset.delta || input.step || 1));
    applyDisplayNumber(input);
    return;
  }

  const travelAdjust = event.target.closest("[data-travel-adjust]");
  if (travelAdjust) {
    const key = travelAdjust.dataset.travelAdjust;
    const input = displaySettingsPanel.querySelector('[data-travel-number="' + key + '"]');
    if (!input) return;
    input.value = String(Number(input.value || DEFAULT_TRAVEL_SETTINGS[key]) + Number(travelAdjust.dataset.delta || input.step || 1));
    applyTravelNumber(input);
    return;
  }

  const reset = event.target.closest("[data-reset-display]");
  if (reset) {
    const key = reset.dataset.resetDisplay;
    displaySettings[key] = DEFAULT_DISPLAY_SETTINGS[key];
    syncDisplaySettingsControls();
    saveDisplaySettings();
    if (key === "railMagnetMaxScale") syncUrl();
    invalidateVisualSettings();
    return;
  }

  const travelReset = event.target.closest("[data-reset-travel]");
  if (travelReset) {
    const key = travelReset.dataset.resetTravel;
    travelSettings[key] = DEFAULT_TRAVEL_SETTINGS[key];
    syncDisplaySettingsControls();
    saveTravelSettings();
    invalidateTravelSettings();
    syncUrl();
    return;
  }

  const routeReset = event.target.closest("[data-reset-route]");
  if (routeReset) {
    delete displaySettings.routeColors[routeReset.dataset.resetRoute];
    syncDisplaySettingsControls();
    saveDisplaySettings();
    invalidateVisualSettings();
    return;
  }

  const epciReset = event.target.closest("[data-reset-epci]");
  if (epciReset) {
    delete displaySettings.epciColors[epciReset.dataset.resetEpci];
    syncDisplaySettingsControls();
    saveDisplaySettings();
    invalidateVisualSettings();
    return;
  }

  if (event.target.closest("[data-add-isochrone-stop]")) {
    const stops = displaySettings.isochroneStops;
    if (stops.length >= 24) return;
    const middle = Math.floor(stops.length / 2);
    const a = stops[middle - 1], b = stops[middle];
    const rgbA = hexToRgb(a.color), rgbB = hexToRgb(b.color);
    const color = "#" + rgbA.map((value, i) => Math.round((value + rgbB[i]) / 2).toString(16).padStart(2, "0")).join("");
    stops.splice(middle, 0, {t: 0.5, color, alpha: (a.alpha + b.alpha) / 2});
    stops.forEach((stop, i) => {stop.t = i / (stops.length - 1);});
    buildIsochroneGradientControls(); saveDisplaySettings(); invalidateVisualSettings();
    return;
  }

  const resetGradient = event.target.closest("[data-reset-isochrone-gradient]");
  if (resetGradient) {
    displaySettings.isochroneStops = DEFAULT_ISOCHRONE_STOPS.map((stop) => ({ ...stop }));
    buildIsochroneGradientControls();
    saveDisplaySettings();
    invalidateVisualSettings();
    return;
  }

  const epciPalette = event.target.closest("[data-palette-epci]");
  if (epciPalette) {
    event.preventDefault();
    event.stopPropagation();
    applyPaletteToEpcis();
    return;
  }

  const palette = event.target.closest("[data-palette-group]");
  if (palette) {
    event.preventDefault();
    event.stopPropagation();
    applyPaletteToGroup(palette.dataset.paletteGroup);
  }
});

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

let landBounds = null;
function pointInLand(point) {
  if (!landBounds) landBounds = state.data.boroughs.flatMap(b => b.polygons).map(polygon => {
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for (const [x,y] of polygon[0]) {minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
    return {polygon,minX,minY,maxX,maxY};
  });
  return landBounds.some(b => point[0]>=b.minX && point[0]<=b.maxX && point[1]>=b.minY && point[1]<=b.maxY && pointInPolygon(point,b.polygon));
}

function communeAt(point) {
  if (!point) return null;
  for (const commune of state.data.communes || []) {
    if (PRIORITY_TOWNS.has(commune.name)) continue;
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

function heatmapComponents(minutes, alphaMultiplier = 1, useStopAlpha = true) {
  const t = clamp(minutes / state.maxTransitTime, 0, 1);
  const stops = displaySettings.isochroneStops;
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
  const leftRgb = hexToRgb(left.color);
  const rightRgb = hexToRgb(right.color);
  const rgb = leftRgb.map((value, i) => Math.round(value + (rightRgb[i] - value) * mix));
  const stopAlpha = left.alpha + (right.alpha - left.alpha) * mix;
  const alphaBase = useStopAlpha ? stopAlpha : 1;
  const alpha = clamp(alphaBase * displaySettings.isochroneOpacity * alphaMultiplier, 0, 1);
  return [...rgb, alpha];
}
function heatmapColor(minutes, alphaMultiplier = 1, useStopAlpha = true) {
  const [r, g, b, a] = heatmapComponents(minutes, alphaMultiplier, useStopAlpha);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
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

const CSS_METRES_PER_PIXEL_AT_SCALE_1 = 0.0002645833333;
function mapScaleDenominator(transform = state.currentRender?.transform) {
  if (!transform?.scale) return Infinity;
  const metresPerPixel = 1 / transform.scale;
  return metresPerPixel / CSS_METRES_PER_PIXEL_AT_SCALE_1;
}
function niceScaleDistance(targetMetres) {
  if (!(targetMetres > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(targetMetres));
  for (const factor of [5, 2, 1]) {
    const candidate = factor * power;
    if (candidate <= targetMetres) return candidate;
  }
  return power / 2;
}
function formatScaleRatio(value) {
  if (!Number.isFinite(value)) return "";
  const rounded = Math.max(1000, Math.round(value / 1000) * 1000);
  return "≈ 1:" + rounded.toLocaleString("fr-FR");
}
function updateMapScale(transform) {
  if (!mapScale || !transform?.scale) return;
  const targetPixels = 92;
  const metres = niceScaleDistance(targetPixels / transform.scale);
  const pixels = Math.max(36, metres * transform.scale);
  mapScaleBar.style.width = pixels + "px";
  mapScaleDistance.textContent = metres >= 1000
    ? (metres / 1000).toLocaleString("fr-FR", {maximumFractionDigits:1}) + " km"
    : Math.round(metres) + " m";
  mapScaleRatio.textContent = formatScaleRatio(mapScaleDenominator(transform));
  mapScale.hidden = false;
}

function nearestStations(point, count, includePlanned = true) {
  const nearest = [];
  state.data.stations.forEach((station, index) => {
    if (!includePlanned && station.planned) return;
    if (station.mode === "BUS" && !(station.displayRoutes || station.routes || []).some(busNetworkEnabled)) return;
    const item = {
      index,
      name: station.name,
      walkMinutes: distance(point, station.point) / state.data.meta.walkMetersPerMinute + travelSettings.stationEntryPenalty,
    };
    if (nearest.length === count && item.walkMinutes >= nearest[nearest.length - 1].walkMinutes) return;
    nearest.push(item);
    nearest.sort((a, b) => a.walkMinutes - b.walkMinutes);
    if (nearest.length > count) nearest.pop();
  });
  return nearest;
}

let roadClient = null;
let roadResult = null;
let roadRequestedKey = "";
let roadFailure = "";
function roadSettingsKey() { return JSON.stringify([state.includeProjects, travelSettings]); }
function roadSnapshot() {
  return state.walkingOnRoads && roadClient?.ready && !roadClient.failed && roadResult?.settingsKey === roadSettingsKey() ? roadResult : null;
}
function currentRoadProbe() {
  const snapshot = roadSnapshot();
  return snapshot && String(snapshot.origin) === String(state.originPoint) && String(snapshot.probe) === String(state.probePoint) ? snapshot : null;
}
function requestRoadWarp(origin, transform, width, height) {
  const topLeft = transform.toWorld(0, 0), bottomRight = transform.toWorld(width, height);
  const preview = state.dragTarget === "origin";
  // Keep the same sample positions while dragging: snapping is done once.
  const cols = width < 600 ? 100 : 140;
  const spec = { bounds: [topLeft[0], bottomRight[1], bottomRight[0], topLeft[1]], cols, rows: Math.max(60, Math.round(cols * height / width)) };
  const request = { origin, probe: state.probePoint, includeProjects: state.includeProjects, settings: {...travelSettings}, settingsKey: roadSettingsKey(), threshold: activeThreshold(), maxTime: state.maxTransitTime, preview, spec };
  request.key = JSON.stringify(request);
  roadRequestedKey = request.key;
  roadClient.request(request);
  return roadSnapshot()?.warp || null;
}
function startRoadWalking() {
  if (roadClient) return;
  try {
    const worker = new Worker(new URL("./walking-worker.mjs?v=2026-10-06-live2", import.meta.url), {type:"module"});
    roadClient = new WalkingClient(worker, result => {
      if (result.settingsKey === roadSettingsKey()) {
        roadResult = result; backdropKey = ""; lastJourneyKey = ""; requestDraw();
      }
    }, () => { backdropKey = ""; requestDraw(); }, message => {
      roadFailure = message; backdropKey = ""; requestDraw(); console.error("Marche sur voirie :", message);
    });
    worker.postMessage({type:"init", data:state.data});
  } catch (error) { roadFailure = error.message; }
}

let cachedModel = null;
let cachedModelKey = "";
let cachedWarp = null;
let cachedWarpKey = "";
function activeThreshold() {
  return state.outlineMinutes.length ? Math.max(...state.outlineMinutes) : state.maxTransitTime;
}
let directClient = null;
let directAnchor = null;
let directAnchorSettings = "";
let directRevision = 0;
let directResult = null;
let directRequestedKey = "";
function directSettingsKey() { return JSON.stringify([state.includeProjects, travelSettings]); }
function startDirectCalculations() {
  if (directClient) return;
  try {
    const worker = new Worker(new URL("./direct-worker.mjs?v=2026-10-06-live2", import.meta.url), {type:"module"});
    directClient = new DirectClient(worker, result => {
      if (state.walkingOnRoads || result.settingsKey !== directSettingsKey()) return;
      const moving = state.dragTarget === "origin" || !state.pinned;
      if (result.preview ? !moving : result.key !== directRequestedKey) return;
      directAnchor = restoreDirectModel(state.data, result.snapshot);
      directAnchorSettings = result.settingsKey;
      if (!result.preview) { directResult = result; cachedReach=result.reach; cachedReachKey=""; lastJourneyKey=""; }
      directRevision++; cachedModelKey = ""; requestDraw();
    }, message => { console.error("Calcul direct :", message); requestDraw(); });
    worker.postMessage({type:"init", data:state.data});
  } catch (error) { console.error("Calcul direct :", error); }
}
function getTravelModel(origin) {
  const settingsKey = directSettingsKey();
  const asynchronous = !state.walkingOnRoads && directClient && !directClient.failed;
  const key = `${origin}:${settingsKey}:${asynchronous ? directRevision : "exact"}`;
  if (key !== cachedModelKey) {
    if (asynchronous && directAnchor && directAnchorSettings === settingsKey) {
      cachedModel = previewTravelModel(state.data, directAnchor, origin);
    } else {
      cachedModel = buildTravelModel(state.data, origin, state.includeProjects, {...travelSettings, routingVariant:"comfort"});
      directAnchor = cachedModel; directAnchorSettings = settingsKey;
    }
    cachedModelKey = key;
  }
  return cachedModel;
}

function estimateTravel(origin, distances, destination) {
  return routeEstimate(state.data, getTravelModel(origin), destination);
}
let cachedReachKey = "", cachedReach = null;
function summarizeReachability(origin) {
  const model = getTravelModel(origin), key = `${cachedModelKey}:${activeThreshold()}`;
  if ((state.dragTarget === "origin" || (!state.walkingOnRoads && directClient && !directClient.failed)) && cachedReach) return cachedReach;
  if (key !== cachedReachKey) { cachedReach = reachability(state.data, model, activeThreshold()); cachedReachKey = key; }
  return cachedReach;
}

function computeWarp(origin, { fast = false } = {}) {
  const model = getTravelModel(origin);
  const key = cachedModelKey + ":static";
  if (cachedWarpKey === key) return cachedWarp;
  const { distances } = model;
  const seeds = [];
  const { gridCols, gridRows, bounds } = state.data.meta;
  const [minX, minY, maxX, maxY] = bounds;
  const cellW = (maxX - minX) / gridCols;
  const cellH = (maxY - minY) / gridRows;
  const minuteGrid = Array.from({ length: gridRows }, () => new Array(gridCols).fill(Infinity));
  const validMask = Array.from({ length: gridRows }, () => new Array(gridCols).fill(false));

  const cells = state.data.cells;
  const values = estimateTravelTimes(state.data, model, cells.map(cell => cell.point));
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i]; minuteGrid[cell.row][cell.col] = values[i]; validMask[cell.row][cell.col] = true;
  }

  cachedWarpKey = key;
  cachedWarp = {
    distances,
    seeds,
    reachability: null,
    minutes: minuteGrid,
    validMask,
    cellW,
    cellH,
    bounds,
  };
  return cachedWarp;
}

function pointInStaticGrid(point) {
  const { bounds, gridCols, gridRows } = state.data.meta;
  const col = Math.floor(((point[0] - bounds[0]) / (bounds[2] - bounds[0])) * gridCols);
  const row = Math.floor(((point[1] - bounds[1]) / (bounds[3] - bounds[1])) * gridRows);
  return col >= 0 && row >= 0 && col < gridCols && row < gridRows && state.data.mask[row * gridCols + col] !== -1;
}

let viewportSamples = null;
function computeViewportWarp(origin, transform, width, height) {
  const model = getTravelModel(origin);
  const panPreview = state.dragTarget === "pan" || state.dragTarget === "origin" || !state.pinned;
  const key = `${cachedModelKey}:view:${transform.scale}:${transform.toWorld(0,0)}:${width}:${height}:${panPreview}:${state.probePoint}:${activeThreshold()}`;
  if (cachedWarpKey === key) return cachedWarp;
  const topLeft = transform.toWorld(0, 0), bottomRight = transform.toWorld(width, height);
  const bounds = [topLeft[0], bottomRight[1], bottomRight[0], topLeft[1]];
  const asynchronous = !state.walkingOnRoads && directClient && !directClient.failed;
  const finalCols = width < 600 ? 100 : 180;
  const finalRows = Math.max(80,Math.round(finalCols*height/width));
  if (asynchronous) {
    const request = {origin:[...origin], probe:state.probePoint, settings:{...travelSettings}, includeProjects:state.includeProjects,
      settingsKey:directSettingsKey(), threshold:activeThreshold(), preview:panPreview,
      spec:panPreview ? null : {bounds,cols:finalCols,rows:finalRows}};
    request.rasterKey=JSON.stringify([request.origin,request.settingsKey,request.spec]);
    request.key=JSON.stringify(request);
    directRequestedKey=request.key; directClient.request(request);
    if (!panPreview && directResult?.rasterKey===request.rasterKey && directResult.warp) {
      cachedWarpKey=key; cachedWarp=directResult.warp; return cachedWarp;
    }
  }
  const gridCols = panPreview || asynchronous ? 64 : finalCols;
  const gridRows = Math.max(panPreview || asynchronous ? 48 : 80, Math.round(gridCols*height/width));
  const geometryKey = `${bounds}:${gridCols}:${gridRows}`;
  if (viewportSamples?.key !== geometryKey) {
    const cellW = (bounds[2] - bounds[0]) / gridCols, cellH = (bounds[3] - bounds[1]) / gridRows;
    const points = [], cells = [];
    const validMask = Array.from({length:gridRows}, () => new Array(gridCols).fill(false));
    for (let row = 0; row < gridRows; row++) for (let col = 0; col < gridCols; col++) {
      const point = [bounds[0] + (col + .5) * cellW, bounds[1] + (row + .5) * cellH];
      if (!pointInStaticGrid(point)) continue;
      points.push(point); cells.push([row,col]); validMask[row][col] = true;
    }
    viewportSamples = {key:geometryKey, points, cells, validMask, bounds, cellW, cellH, gridRows, gridCols};
  }
  const samples = viewportSamples;
  const values = estimateTravelTimes(state.data, model, samples.points);
  const minutes = Array.from({length:samples.gridRows}, () => new Float64Array(samples.gridCols).fill(Infinity));
  for (let i = 0; i < samples.cells.length; i++) { const [row,col] = samples.cells[i]; minutes[row][col] = values[i]; }
  cachedWarpKey = key;
  cachedWarp = {minutes, validMask:samples.validMask, bounds:samples.bounds, cellW:samples.cellW, cellH:samples.cellH, distances:model.distances, origin:model.origin};
  return cachedWarp;
}

function createCanvasBacking(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
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
  drawCtx.save();
  drawCtx.globalAlpha = displaySettings.communeFillOpacity;
  drawCtx.fillStyle = displaySettings.communeColor;
  for (const commune of state.data.communes || []) {
    if (PRIORITY_TOWNS.has(commune.name)) continue;
    for (const polygon of commune.polygons) {
      drawCtx.beginPath();
      tracePolygon(drawCtx, polygon, projectPoint);
      drawCtx.fill();
    }
  }
  drawCtx.restore();

  drawCtx.save();
  drawCtx.globalAlpha = displaySettings.epciFillOpacity;
  for (const borough of state.data.boroughs) {
    drawCtx.fillStyle = epciDisplayColor(borough);
    for (const polygon of borough.polygons) {
      drawCtx.beginPath();
      tracePolygon(drawCtx, polygon, projectPoint);
      drawCtx.fill();
    }
  }
  drawCtx.restore();

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
    if (route.mode === "RFN" || state.data.routeInfo?.[route.id]?.serviceStatus?.status === "suspended") continue;
    const isRemi = route.mode === "BUS" && state.data.routeInfo?.[route.id]?.network === "remi";
    if (route.mode === "BUS" && (!busNetworkEnabled(route.id) || state.viewportScale < (isRemi ? 1.3 : 1.8))) continue;
    drawCtx.strokeStyle = routeDisplayColor(route);
    drawCtx.lineWidth = route.mode === "TRAM" ? displaySettings.tramWidth : ["BHNS", "BUS"].includes(route.mode) ? displaySettings.bhnsWidth : displaySettings.terWidth;
    if (isRemi) drawCtx.lineWidth *= 1.33;
    drawCtx.lineCap = "round";
    drawCtx.lineJoin = "round";
    const excluded = state.data.routeInfo?.[route.id]?.calculationAvailable === false;
    drawCtx.setLineDash(excluded ? [3, 5] : route.mode === "BHNS" ? [7, 5] : []);
    drawPolyline(drawCtx, route.points, projectPoint);
  }
  drawCtx.setLineDash([]);
}

function drawDepartmentLimits(drawCtx, projectPoint) {
  const communeWidth = displaySettings.communeBorderWidth * (state.viewportScale >= 2 ? 1.3 : 0.8);
  for (const commune of state.data.communes || []) {
    if (PRIORITY_TOWNS.has(commune.name)) continue;
    for (const polygon of commune.polygons) {
      for (const ring of polygon) {
        if (ring.length < 2) continue;
        drawCtx.strokeStyle = "#000000";
        drawCtx.lineWidth = communeWidth;
        drawPolyline(drawCtx, ring, projectPoint);
      }
    }
  }
  drawCtx.lineJoin = "round";
  drawCtx.lineCap = "round";
  for (const borough of state.data.boroughs) {
    drawCtx.strokeStyle = "#000000";
    drawCtx.lineWidth = displaySettings.epciBorderWidth * (borough.code === "243700754" ? 1.7 : 1);
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
    if (PRIORITY_TOWNS.has(commune.name)) continue;
    if (state.data.stations.some((station) => station.mode === "TER" && station.name === commune.name && station.terminal && distance(station.point, commune.label) < 3500)) continue;
    const [minX, minY, maxX, maxY] = commune.bbox;
    const [left, bottom] = projectPoint([minX, minY]);
    const [right, top] = projectPoint([maxX, maxY]);
    if (right - left < 75 || bottom - top < 25) continue;
    const [x, y] = projectPoint(commune.label);
    if (x < 20 || y < 14 || x > width - 20 || y > height - 14) continue;
    const fontSize = 11 * displaySettings.labelScale;
    drawCtx.font = "600 " + fontSize + "px Outfit, sans-serif";
    const textWidth = drawCtx.measureText(commune.name).width;
    const box = [x - textWidth / 2 - 5, y - fontSize + 1, x + textWidth / 2 + 5, y + 5];
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

function minimumWarpMinutesNearPoint(warp, point) {
  if (!warp?.minutes?.length || !warp.minutes[0]?.length) return Infinity;
  const col = (point[0] - warp.bounds[0]) / warp.cellW - 0.5;
  const row = (point[1] - warp.bounds[1]) / warp.cellH - 0.5;
  const rows = [Math.floor(row), Math.ceil(row)];
  const cols = [Math.floor(col), Math.ceil(col)];
  let best = Infinity;
  for (const r of rows) for (const c of cols) {
    if (r < 0 || c < 0 || r >= warp.minutes.length || c >= warp.minutes[0].length || !warp.validMask[r][c]) continue;
    best = Math.min(best, warp.minutes[r][c]);
  }
  return best;
}

let stationSymbols = null;
let stationSymbolsKey = "";
let visibleStations = [];
let stationTimesKey = "", stationTimes = null;
function drawStations(drawCtx, projectPoint, warp) {
  const snapshot = roadSnapshot(), source = heatmapSourcePoint();
  const model = !snapshot && source ? getTravelModel(source) : null;
  const active = snapshot?.activeStations || model?.activeStations;
  const symbolsKey = `${staticLayersKey}:${directSettingsKey()}`;
  if (stationSymbolsKey !== symbolsKey) {
    stationSymbols ||= document.createElement("canvas");
    stationSymbols.width = mapCanvas.width; stationSymbols.height = mapCanvas.height;
    const symbolCtx = stationSymbols.getContext("2d"), dpr = window.devicePixelRatio || 1;
    symbolCtx.setTransform(dpr,0,0,dpr,0,0);
    drawStationSymbols(symbolCtx,projectPoint,active);
    visibleStations = [];
    for (let i=0;i<state.data.stations.length;i++) {
      const station=state.data.stations[i];
      if (station.mode === "TER" && (!station.routes?.length || (active && !active[i]))) continue;
      if (station.mode === "BUS" && (state.viewportScale<2.4 || !(station.displayRoutes || station.routes || []).some(busNetworkEnabled))) continue;
      const [x,y] = projectPoint(station.drawPoint || station.point);
      if (x < -8 || y < -8 || x > mapCanvas.clientWidth+8 || y > mapCanvas.clientHeight+8) continue;
      const radius=station.mode === "TER" ? displaySettings.railStationRadius : station.mode === "BUS" ? displaySettings.stationRadius*.62 : displaySettings.stationRadius;
      visibleStations.push({station,index:i,x,y,radius});
    }
    stationSymbolsKey=symbolsKey; stationTimesKey="";
  }
  const timesKey = snapshot?.key || cachedModelKey;
  if (stationTimesKey !== timesKey) {
    stationTimes = snapshot ? visibleStations.map(s=>snapshot.stationMinutes[s.index]) : model ? estimateTravelTimes(state.data,model,visibleStations.map(s=>s.station.point)) : [];
    stationTimesKey=timesKey;
  }
  const threshold=activeThreshold();
  for (let i=0;i<visibleStations.length;i++) {
    const {station,x,y,radius:stationRadius}=visibleStations[i], minutes=stationTimes[i];
    if (!Number.isFinite(minutes) || minutes>threshold || minimumWarpMinutesNearPoint(warp,station.point)<=threshold) continue;
    const radius=Math.max(stationRadius+.5,(stationRadius+(state.viewportScale<2 ? 2.2 : 1.4))*displaySettings.isochronePocketScale);
    const gradient=drawCtx.createRadialGradient(x,y,0,x,y,radius);
    gradient.addColorStop(0,heatmapColor(minutes,.8)); gradient.addColorStop(.72,heatmapColor(minutes,.32)); gradient.addColorStop(1,heatmapColor(minutes,0));
    drawCtx.beginPath();drawCtx.arc(x,y,radius,0,Math.PI*2);drawCtx.fillStyle=gradient;drawCtx.fill();drawCtx.strokeStyle="#111111";drawCtx.lineWidth=1;drawCtx.stroke();
  }
  drawCtx.drawImage(stationSymbols,0,0,mapCanvas.clientWidth,mapCanvas.clientHeight);
}

function drawStationSymbols(drawCtx, projectPoint, active) {
  const source = heatmapSourcePoint();
  const major = /^(Tours|Saint-Pierre-des-Corps|Blois-Chambord|Saumur|Vendôme-Villiers-sur-Loir|Orléans|Paris-Austerlitz|Caen|Nantes|Poitiers|Le Mans|Vierzon|Loches|Amboise)$/i;
  const labels = [];
  for (const [index, station] of state.data.stations.entries()) {
    if (station.mode === "TER" && ((!station.routes || station.routes.length === 0) || (active && !active[index]))) continue;
    if (station.mode === "BUS" && (state.viewportScale < 2.4 || !(station.displayRoutes || station.routes || []).some(busNetworkEnabled))) continue;
    const [x, y] = projectPoint(station.drawPoint || station.point);
    if (x < -8 || y < -8 || x > mapCanvas.clientWidth + 8 || y > mapCanvas.clientHeight + 8) continue;
    const stationRadius = station.mode === "TER" ? displaySettings.railStationRadius : station.mode === "BUS" ? displaySettings.stationRadius * 0.62 : displaySettings.stationRadius;
    drawCtx.beginPath();
    drawCtx.arc(x, y, stationRadius, 0, Math.PI * 2);
    drawCtx.fillStyle = "#fff";
    drawCtx.fill();
    drawCtx.lineWidth = 0.55;
    drawCtx.strokeStyle = station.mode === "TRAM" ? (station.planned ? "#1d91b6" : "#bd074e") : station.mode === "BHNS" ? "#e18529" : station.mode === "BUS" ? "#4b677d" : "#345c77";
    drawCtx.stroke();
    if (station.mode === "BUS") {
      if (displaySettings.showBusLabels && state.viewportScale >= 6) labels.push({ station, x, y, terminal: false });
      continue;
    }
    if (station.mode !== "TER") continue;
    const terminal = station.terminal || major.test(station.name);
    const priority = PRIORITY_STATIONS.has(station.name);
    const show = priority || (terminal ? state.viewportScale >= 0.55 : !station.inSerm && state.viewportScale >= 0.8);
    if (show) labels.push({ station, x, y, terminal: terminal || priority, priority });
  }
  const occupied = [];
  const named = new Set();
  labels.sort((a, b) => Number(b.priority || false) - Number(a.priority || false) || Number(b.terminal) - Number(a.terminal) || a.station.name.localeCompare(b.station.name, "fr"));
  for (const { station, x, y, terminal, priority } of labels) {
    if (named.has(station.name)) continue;
    const fontSize = (terminal ? 12 : 10) * displaySettings.labelScale;
    drawCtx.font = `${terminal ? 700 : 500} ${fontSize}px Outfit, sans-serif`;
    const textWidth = drawCtx.measureText(station.name).width;
    const candidates = [[x + 6, y - 5], [x - textWidth - 6, y - 5], [x + 6, y + 13], [x - textWidth - 6, y + 13]];
    if (priority) for (let offset = 24; offset <= 120; offset += 16) {
      candidates.push([x + 6, y - offset], [x - textWidth - 6, y + offset]);
    }
    const place = candidates.find(([tx, ty]) => {
      const box = [tx - 3, ty - fontSize - 3, tx + textWidth + 3, ty + 3];
      return box[0] >= 3 && box[2] <= mapCanvas.clientWidth - 3 && box[1] >= 3 && box[3] <= mapCanvas.clientHeight - 3 && !occupied.some(([a, b, c, d]) => box[0] < c && box[2] > a && box[1] < d && box[3] > b);
    });
    const fallback = priority ? [clamp(x + 6, 6, Math.max(6, mapCanvas.clientWidth - textWidth - 6)), clamp(y - 5, fontSize + 6, mapCanvas.clientHeight - 6)] : null;
    if (!place && !fallback) continue;
    named.add(station.name);
    const [tx, ty] = place || fallback;
    occupied.push([tx - 3, ty - fontSize - 3, tx + textWidth + 3, ty + 3]);
    drawCtx.textAlign = "left";
    drawCtx.lineWidth = terminal ? 3.8 : 3;
    drawCtx.strokeStyle = "rgba(255,255,255,0.96)";
    drawCtx.strokeText(station.name, tx, ty);
    drawCtx.fillStyle = terminal ? "#1d3951" : "#36536a";
    drawCtx.fillText(station.name, tx, ty);
  }
  mapCanvas.dataset.priorityLabels = JSON.stringify([...named].filter(name => PRIORITY_STATIONS.has(name)));
}

let sermClipPath = null;
let sermClipKey = "";
function clipToSerm(drawCtx, projectPoint) {
  if (sermClipKey !== staticLayersKey || !sermClipPath) {
    const path = new Path2D();
    for (const epci of state.data.boroughs) for (const polygon of epci.polygons) for (const ring of polygon) {
      if (!ring.length) continue;
      path.moveTo(...projectPoint(ring[0]));
      for (let i = 1; i < ring.length; i++) path.lineTo(...projectPoint(ring[i]));
      path.closePath();
    }
    sermClipPath = path; sermClipKey = staticLayersKey;
  }
  drawCtx.clip(sermClipPath, "evenodd");
}

let heatmapRaster = null;
let heatmapRasterKey = "";
let heatmapPalette = null;
function drawHeatmap(drawCtx, warp, projectPoint) {
  const {minutes, validMask} = warp;
  const key = `${state.maxTransitTime}:${JSON.stringify(displaySettings.isochroneStops)}:${displaySettings.isochroneOpacity}`;
  if (heatmapRasterKey !== key || !heatmapPalette) {
    heatmapPalette = new Uint8ClampedArray(1024 * 4);
    for (let i = 0; i < 1024; i++) {
      const color = heatmapComponents(i / 1023 * state.maxTransitTime);
      heatmapPalette.set([color[0],color[1],color[2],Math.round(color[3]*255)], i*4);
    }
  }
  if (heatmapRaster?.warp !== warp || heatmapRasterKey !== key) {
    const rows = minutes.length, cols = minutes[0].length;
    if (!heatmapRaster || heatmapRaster.canvas.width !== cols || heatmapRaster.canvas.height !== rows) {
      const canvas = document.createElement("canvas"); canvas.width = cols; canvas.height = rows;
      const rasterCtx = canvas.getContext("2d");
      heatmapRaster = {canvas, rasterCtx, image:rasterCtx.createImageData(cols,rows)};
    }
    const pixels = heatmapRaster.image.data; pixels.fill(0);
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      if (!validMask[row][col]) continue;
      const color = Math.min(1023, Math.max(0, Math.round(minutes[row][col] / state.maxTransitTime * 1023))) * 4;
      const i = ((rows-row-1)*cols+col)*4;
      pixels[i]=heatmapPalette[color]; pixels[i+1]=heatmapPalette[color+1]; pixels[i+2]=heatmapPalette[color+2]; pixels[i+3]=heatmapPalette[color+3];
    }
    heatmapRaster.rasterCtx.putImageData(heatmapRaster.image,0,0);
    heatmapRaster.warp = warp; heatmapRasterKey = key;
  }
  const [x,y] = projectPoint([warp.bounds[0],warp.bounds[3]]), [right,bottom] = projectPoint([warp.bounds[2],warp.bounds[1]]);
  drawCtx.imageSmoothingEnabled = true;
  drawCtx.drawImage(heatmapRaster.canvas,x,y,right-x,bottom-y);
}


function pointKey(point) {
  return `${point[0].toFixed(1)},${point[1].toFixed(1)}`;
}

function drawOutline(drawCtx, warp, projectPoint) {
  drawCtx.strokeStyle = "#111111";
  drawCtx.lineJoin = "round";
  drawCtx.lineCap = "round";
  for (const threshold of [...state.outlineMinutes].sort((a, b) => a - b)) {
    const segments = contourSegments(warp, threshold);
    if (!segments.length) continue;
    drawCtx.lineWidth = OUTLINE_WIDTHS[threshold] || 2;
    drawCtx.beginPath();
    for (const [a, b] of segments) {
      drawCtx.moveTo(...projectPoint(a));
      drawCtx.lineTo(...projectPoint(b));
    }
    drawCtx.stroke();
  }
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

function drawLabelBubble(drawCtx, screen, lines, color, below = false, actionSpace = 0, compact = false) {
  const padX = compact ? 6 : 12;
  const padY = compact ? 4 : 8;
  const items = lines.map((line) => typeof line === "string" ? { text: line, small: false } : line);
  drawCtx.textAlign = "center";
  drawCtx.textBaseline = "middle";
  const canvasWidth = mapCanvas.getBoundingClientRect().width;
  const canvasHeight = mapCanvas.getBoundingClientRect().height;
  const maxTextWidth = Math.min(360, canvasWidth - padX * 2 - 16 - actionSpace);
  for (const item of items) {
    drawCtx.font = item.small ? `500 ${compact ? 8 : 11}px Outfit, sans-serif` : `600 ${compact ? 9 : 13}px Outfit, sans-serif`;
    while (item.text.length > 8 && drawCtx.measureText(item.text).width > maxTextWidth) {
      item.text = `${item.text.slice(0, -2)}…`;
    }
  }
  const width = Math.ceil(Math.max(...items.map((item) => {
    drawCtx.font = item.small ? `500 ${compact ? 8 : 11}px Outfit, sans-serif` : `600 ${compact ? 9 : 13}px Outfit, sans-serif`;
    return drawCtx.measureText(item.text).width;
  }))) + padX * 2 + actionSpace;
  const height = padY * 2 + items.reduce((sum, item) => sum + (item.small ? (compact ? 9 : 14) : (compact ? 11 : 16)), 0);
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
    const lineHeight = item.small ? (compact ? 9 : 14) : (compact ? 11 : 16);
    drawCtx.font = item.small ? `500 ${compact ? 8 : 11}px Outfit, sans-serif` : `600 ${compact ? 9 : 13}px Outfit, sans-serif`;
    drawCtx.fillStyle = item.small ? "#52687a" : "#1c2f42";
    drawCtx.fillText(item.text, x + (width - actionSpace) / 2, lineY + lineHeight / 2);
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
  const ordered = [...new Set([...station.routes, ...(station.displayRoutes || [])])].sort((a, b) => Number(b.startsWith("TER ")) - Number(a.startsWith("TER ")) || a.localeCompare(b, "fr"));
  if (!ordered.length) { lines.push({text: "Sans desserte retenue dans le calcul", small: true}); return lines; }
  const routeId = ordered[0];
  if (routeId === "TRAM A") lines.push({ text: "Tramway A", small: true });
  else if (routeId === "TRAM B") lines.push({ text: "Tramway B · projet 2028", small: true });
  else if (routeId === "BHNS C") lines.push({ text: "BHNS C · projet 2028", small: true });
  else if (routeId === "NAVETTE") lines.push({ text: "Navette Tours ↔ Saint-Pierre-des-Corps", small: true });
  else if (routeId.startsWith("BUS ")) {
    const info = state.data.routeInfo?.[routeId] || {};
    const wait = Number(info.waitMinutes) * travelSettings.busWaitFactor;
    lines.push({ text: info.title || routeId, small: true });
    if (info.calculationAvailable === false) lines.push({ text: "Sur réservation · hors calcul", small: true });
    else if (Number.isFinite(wait) && wait > 0) lines.push({ text: `Attente de cette ligne : ${wait % 1 ? wait.toFixed(1) : wait} min`, small: true });
  } else {
    const title = state.data.routeInfo?.[routeId]?.title || "";
    const endpoints = title.includes(" - ") ? title.slice(title.indexOf(" - ") + 3) : title;
    lines.push({ text: `${routeId} · ${endpoints}`, small: true });
  }
  if (!routeId.startsWith("BUS ")) {
    const wait = routeWaitingMinutes(state.data, routeId, travelSettings);
    if (wait > 0) lines.push({ text: `Attente de cette ligne : ${Number(wait.toFixed(1))} min`, small: true });
  }
  if (ordered.length > 1) {
    const others = ordered.slice(1, 3).map(id => {
      const info = state.data.routeInfo?.[id];
      if (info?.calculationAvailable === false) return `${id} · réservation, hors calcul`;
      if (info?.mode === "BUS" && travelSettings.busWaitFactor > 0) return `${id} · attente ${(info.waitMinutes * travelSettings.busWaitFactor).toFixed(1)} min`;
      return id;
    });
    lines.push({ text: others.join(" ; "), small: true });
    if (ordered.length > 3) lines.push({ text: `+ ${ordered.length - 3} autre(s) ligne(s)`, small: true });
  }
  return lines;
}

function arrivalDescriptor(point) {
  const snapshot = roadSnapshot();
  const model = !snapshot && state.originPoint ? getTravelModel(state.originPoint) : null;
  const details = snapshot ? snapshot.probeDetails : model ? routeEstimate(state.data, model, point, true) : null;
  const nearest = nearestStations(point, 1)[0];
  const stationIndex = details?.station >= 0 ? details.station : nearest?.index;
  const station = Number.isInteger(stationIndex) ? state.data.stations[stationIndex] : null;
  const commune = communeAt(point) || (station ? communeAt(station.point) : null) || placeName(point);
  if (!station) return commune;
  if (station.mode === "TER") {
    const stationName = /^gare\s+de\b/i.test(station.name) ? station.name : `Gare de ${station.name}`;
    return `${commune} - ${stationName}`;
  }
  return `${commune} - ${station.name}`;
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
    statusText.textContent = "Cliquez ou touchez la carte pour choisir un départ.";
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
  const snapshot = roadSnapshot();
  walkingNote.textContent = !state.walkingOnRoads ? ""
    : roadFailure ? "Voirie indisponible : marche provisoirement estimée en ligne droite. Rechargez pour réessayer."
    : !snapshot ? roadClient?.ready ? "Calcul de la marche sur voirie…" : "Préparation de la marche sur voirie…"
    : !snapshot.sourceCovered ? "Départ hors couverture IGN du SERM : accès initial estimé en ligne droite."
    : !snapshot.sourceConnected ? "Aucun accès piéton identifié à moins de 75 m de ce départ. Placez-le près d’une rue ou d’un arrêt."
    : "Marche sur voirie IGN ; surface colorée approximée autour des rues.";
  if (snapshot && snapshot.key !== roadRequestedKey && !state.dragTarget) statusText.textContent += " · Calcul en cours…";
  if (warp) {
    const { reachable, total } = snapshot?.reach || summarizeReachability(source);
    const percent = Math.round((reachable / total) * 100);
    const percentText = reachable > 0 && percent === 0 ? "Moins de 1 %" : `${percent} %`;
    reachText.textContent = `${percentText} des points d’arrêt intégrés au calcul sont joignables en ${activeThreshold()} minutes depuis ce point.`;
  }
}

function nearestLandPoint(point) {
  if (!point) return null;
  if (pointInLand(point)) return point;
  let best = null;
  let bestDistance = Infinity;
  const tolerance = Math.min(8000, Math.max(1500, 8 / (state.currentRender?.transform.scale || 0.004)));
  for (const route of state.data.routes) {
    if (route.mode === "RFN" || route.mode === "BUS") continue;
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

const measureFrames = new URLSearchParams(location.search).has("perf");
let measuredFrames = [];
function drawMap() {
  if (!state.ready) return;
  const frameStart = measureFrames ? performance.now() : 0;
  const { width, height } = createCanvasBacking(mapCanvas);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = displaySettings.backgroundColor;
  ctx.fillRect(0, 0, width, height);

  const source = heatmapSourcePoint();
  const other = heatmapOtherPoint();
  const movingOrigin = state.dragTarget === "origin";
  const focusBounds = viewBounds();
  const scaleMul = clamp(state.viewportScale, minViewportScale(width, height), MAX_VIEWPORT_SCALE);
  const focus = state.viewportCenter || (scaleMul > 1.02 ? (state.probePoint && state.originPoint ? [(state.originPoint[0] + state.probePoint[0]) / 2, (state.originPoint[1] + state.probePoint[1]) / 2] : source || defaultCenter()) : defaultCenter());
  const transform = buildTransform(focusBounds, width, height, scaleMul, focus);
  const projectPoint = (point) => transform.toScreen(point);
  // Re-evaluate paths, colours and contours at the current pointer each frame.
  // The direct worker refreshes route topology while live entry walks follow it.
  const useRoadWorker = state.walkingOnRoads && roadClient?.ready && !roadClient.failed;
  const warp = source && useRoadWorker ? requestRoadWarp(source, transform, width, height) : source ? (movingOrigin || !state.pinned || scaleMul > 1.8 || !pointInLand(focus) || !pointInLand(source)
    ? computeViewportWarp(source, transform, width, height)
    : directClient && !directClient.failed && !state.walkingOnRoads ? computeViewportWarp(source,transform,width,height) : computeWarp(source)) : null;

  const warpDone = measureFrames ? performance.now() : 0;
  let heatMs=0, stationsMs=0;
  const nextBackdropKey = `${useRoadWorker ? roadSnapshot()?.key : cachedModelKey}:${cachedWarpKey}:${width}:${height}:${scaleMul}:${focus}:${state.maxTransitTime}:${state.outlineMinutes}`;
  if (nextBackdropKey !== backdropKey) {
    mapBackdrop.width = mapCanvas.width; mapBackdrop.height = mapCanvas.height;
    const baseCtx = mapBackdrop.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    baseCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    baseCtx.fillStyle = displaySettings.backgroundColor; baseCtx.fillRect(0,0,width,height);
    const staticKey = `${width}:${height}:${dpr}:${scaleMul}:${focus}:${JSON.stringify(displaySettings)}`;
    if (staticLayersKey !== staticKey) {
      staticBase.width = staticNetwork.width = mapCanvas.width;
      staticBase.height = staticNetwork.height = mapCanvas.height;
      const landCtx = staticBase.getContext("2d"), networkCtx = staticNetwork.getContext("2d");
      landCtx.setTransform(dpr,0,0,dpr,0,0); networkCtx.setTransform(dpr,0,0,dpr,0,0);
      drawBasemap(landCtx, projectPoint);
      drawDepartmentLimits(networkCtx, projectPoint);
      drawRoutes(networkCtx, projectPoint);
      drawCommuneLabels(networkCtx, projectPoint);
      staticLayersKey = staticKey;
    }
    baseCtx.drawImage(staticBase,0,0,width,height);
    if (warp) {
      const heatStart = measureFrames ? performance.now() : 0;
      baseCtx.save();
      clipToSerm(baseCtx, projectPoint);
      drawHeatmap(baseCtx, warp, projectPoint);
      if (state.outlineMinutes.length) drawOutline(baseCtx, warp, projectPoint);
      baseCtx.restore();
      heatMs = measureFrames ? performance.now()-heatStart : 0;
    }
    baseCtx.drawImage(staticNetwork,0,0,width,height);
    const stationsStart = measureFrames ? performance.now() : 0;
    drawStations(baseCtx, projectPoint, warp);
    stationsMs = measureFrames ? performance.now()-stationsStart : 0;
    backdropKey = nextBackdropKey;
  }
  const backdropDone = measureFrames ? performance.now() : 0;
  ctx.drawImage(mapBackdrop, 0, 0, width, height);

  let travelMinutes = null;
  if (warp && other) travelMinutes = useRoadWorker ? currentRoadProbe()?.probeDetails?.minutes : estimateTravel(source, warp.distances, other);
  state.pinHits = { origin: null, probe: null };

  if (state.probePoint) {
    const probeScreen = projectPoint(state.probePoint);
    const originScreen = state.originPoint ? projectPoint(state.originPoint) : null;
    const nearOrigin = originScreen && Math.abs(originScreen[0] - probeScreen[0]) < 280 && Math.abs(originScreen[1] - probeScreen[1]) < 130;
    drawMarker(ctx, probeScreen, "#1c2f42", state.dragTarget === "probe" ? 5 : 4);
    const probeDescriptor = arrivalDescriptor(state.probePoint);
    const probeLines = [{ text: `Arrivée : ${probeDescriptor}`, small: false }];
    probeLines.push({ text: Number.isFinite(travelMinutes) ? formatMinutes(travelMinutes) : "—", small: true });
    const probeLabel = drawLabelBubble(ctx, probeScreen, probeLines, "#1c2f42", nearOrigin && probeScreen[1] >= originScreen[1], 18, true);
    state.pinHits.probe = { screen: probeScreen, label: probeLabel };
  }
  if (state.originPoint) {
    const originScreen = projectPoint(state.originPoint);
    drawMarker(ctx, originScreen, displaySettings.isochroneStops[0].color, state.pinned || state.dragTarget === "origin" ? 7 : 6);
    const originName = placeName(state.originPoint);
    const originLines = ["Départ", originName];
    originLines.push(...stationModeLines(state.originPoint));
    const probeScreen = state.probePoint ? projectPoint(state.probePoint) : null;
    const nearProbe = probeScreen && Math.abs(originScreen[0] - probeScreen[0]) < 280 && Math.abs(originScreen[1] - probeScreen[1]) < 130;
    const originLabel = drawLabelBubble(ctx, originScreen, originLines, displaySettings.isochroneStops[0].color, nearProbe && originScreen[1] >= probeScreen[1]);
    state.pinHits.origin = { screen: originScreen, label: originLabel };
  }

  mapCanvas.dataset.dragging = state.dragTarget || "";
  mapCanvas.dataset.walkingMode = useRoadWorker ? "road" : "direct";
  mapCanvas.dataset.calculationState = useRoadWorker ? (roadSnapshot()?.key===roadRequestedKey ? "ready" : "pending") : directClient && !directClient.failed && !state.walkingOnRoads ? (directResult?.key===directRequestedKey ? "ready" : "pending") : "ready";
  state.currentRender = { warp, transform, focus };
  updateMapScale(transform);
  legend.hidden = !warp;
  legendMax.textContent = `${state.maxTransitTime} min`;
  syncStatus(warp, travelMinutes);
  if (!state.dragTarget) updateJourney();
  state.dirty = false;
  if (measureFrames) {
    const ms = performance.now() - frameStart;
    if (state.dragTarget === "origin") {
      measuredFrames.push(ms);
      mapCanvas.dataset.framePhases = JSON.stringify({warp:warpDone-frameStart,heat:heatMs,stations:stationsMs,backdrop:backdropDone-warpDone,overlays:performance.now()-backdropDone});
      mapCanvas.dataset.liveFrames = JSON.stringify({count:measuredFrames.length, meanMs:measuredFrames.reduce((a,b)=>a+b,0)/measuredFrames.length, maxMs:Math.max(...measuredFrames)});
    }
    mapCanvas.dataset.frameMs = ms.toFixed(2);
    mapCanvas.dataset.surfaceOrigin = String(warp?.origin || source);
    mapCanvas.dataset.markerOrigin = String(state.originPoint);
    mapCanvas.dataset.directWorker = directClient?.ready ? "ready" : "loading";
    mapCanvas.dataset.preview = String(Boolean(cachedModel?.preview && state.dragTarget === "origin"));
  }
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

function placePoint(world, magnet) {
  const scaleAllowsMagnetism = mapScaleDenominator() >= displaySettings.railMagnetMaxScale;
  const point = magnet && pointInLand(world) && displaySettings.railMagnetism && scaleAllowsMagnetism
    ? snapToRailStation(world, state.data.stations, state.data.routeInfo, travelSettings.railMagnetRadiusKm * 1000) : world;
  return nearestLandPoint(point);
}

function setOrigin(world, { pin = false, label = null, silent = false, magnet = true } = {}) {
  const snapped = placePoint(world, magnet);
  if (!snapped) return;
  state.originPoint = snapped;
  state.originLabel = label;
  state.pinned = pin;
  requestDraw();
  if (!silent) syncUrl();
}

function setProbe(world, pinned = false, { silent = false, magnet = true } = {}) {
  const snapped = placePoint(world, magnet);
  if (!snapped) return;
  state.probePoint = snapped;
  state.probePinned = pinned;
  requestDraw();
  if (!silent) syncUrl();
}

function settleOutsideStation(kind) {
  const key = kind === "origin" ? "originPoint" : "probePoint";
  const point = state[key];
  if (!point || pointInLand(point)) return;
  state[key] = snapToRailStation(point, state.data.stations, state.data.routeInfo, Infinity);
}

function endDrag(event) {
  if (!state.dragTarget) return;
  const moved = state.dragMoved;
  const target = state.dragTarget;
  let settledTarget = target;
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
  if (!moved && target === "pan" && event?.type === "pointerup") {
    const { world } = pointerToWorld(event);
    if (world) {
      if (!state.originPoint) { setOrigin(world, { pin: true, label: null, silent: true }); settledTarget = "origin"; }
      else if (!state.probePoint) { setProbe(world, false, { silent: true }); settledTarget = "probe"; }
    }
  }
  if (settledTarget === "origin" || settledTarget === "probe") {
    const pointKey = settledTarget === "origin" ? "originPoint" : "probePoint";
    state[pointKey] = placePoint(state[pointKey], true) || state[pointKey];
    settleOutsideStation(settledTarget);
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
  params.set("calc", SHARE_CALC_VERSION);
  for (const [key, param] of Object.entries(TRAVEL_QUERY_PARAMS)) params.set(param, String(travelSettings[key]));
  if (travelSettings.disabledBusNetworks.length) params.set("offbus", travelSettings.disabledBusNetworks.join(","));
  params.set("walking", state.walkingOnRoads ? "road" : "direct");
  params.set("magnet", displaySettings.railMagnetism ? "1" : "0");
  params.set("magnetscale", String(Math.round(displaySettings.railMagnetMaxScale)));
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
  state.walkingOnRoads = params.has("walking") ? params.get("walking") !== "direct" : SITE_DEFAULTS.map.walkingOnRoads;
  roadWalkingToggle.checked = state.walkingOnRoads;
  if (params.has("magnet")) displaySettings.railMagnetism = params.get("magnet") !== "0";
  if (params.has("magnetscale")) {
    const scale = Number(params.get("magnetscale"));
    if (Number.isFinite(scale)) displaySettings.railMagnetMaxScale = clamp(scale, 50000, 5000000);
  } else if (params.has("magnetzoom")) {
    const legacyZoom = Number(params.get("magnetzoom"));
    if (Number.isFinite(legacyZoom) && legacyZoom > 0) displaySettings.railMagnetMaxScale = clamp(500000 / legacyZoom, 50000, 5000000);
  }
  const origin = parsePair(params.get("origin"));
  const probe = params.has("distance") ? parsePair(params.get("distance")) : !params.has("origin") ? SITE_DEFAULTS.map.probePoint : null;
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
  if (Number.isFinite(max) && max >= 20 && max <= MAX_TIME_MINUTES) {
    state.maxTransitTime = max;
    maxTimeInput.value = String(max);
    maxTimeLabel.textContent = `Temps max. ${max} min`;
  }
  maxTimeInput.value = String(state.maxTransitTime);
  maxTimeLabel.textContent = `Temps max. ${state.maxTransitTime} min`;
  state.includeProjects = params.get("projects") === "1" ? true : params.get("projects") === "0" ? false : DEFAULT_INCLUDE_PROJECTS;
  projectsToggle.checked = state.includeProjects;
  const hasTravelParams = params.has("offbus") || Object.values(TRAVEL_QUERY_PARAMS).some((param) => params.has(param));
  if (params.get("calc") === SHARE_CALC_VERSION || hasTravelParams) {
    const restored = { ...DEFAULT_TRAVEL_SETTINGS, disabledBusNetworks: params.get("offbus")?.split(",") || [] };
    for (const [key, param] of Object.entries(TRAVEL_QUERY_PARAMS)) {
      if (params.has(param)) restored[key] = Number(params.get(param));
    }
    for (const [stem, base, param] of [["ter",15,"terw"],["tram",4,"tramw"],["navette",5,"navw"]]) {
      if (!params.has(TRAVEL_QUERY_PARAMS[stem + "WaitFactor"]) && params.has(param)) restored[stem + "WaitFactor"] = Number(params.get(param)) / base;
    }
    Object.assign(travelSettings, normalizeTravelSettings(restored));
    syncDisplaySettingsControls();
  }
  if (origin) {
    setOrigin(origin, { pin: true, silent: true, magnet: false });
  } else {
    setOrigin([...SITE_DEFAULTS.map.originPoint], {
      pin: true,
      magnet: false,
      silent: true,
    });
  }
  if (probe) setProbe(probe, false, { silent: true, magnet: false });
  if (params.get("view")) {
    state.viewportCenter = parsePair(params.get("view")) || defaultCenter();
    const zoom = Number(params.get("zoom"));
    if (Number.isFinite(zoom) && zoom > 0) state.viewportScale = clamp(zoom, MIN_VIEWPORT_SCALE, MAX_VIEWPORT_SCALE);
  }
  settleOutsideStation("origin"); settleOutsideStation("probe");
  state.handMode = true;
  syncCursor();
  syncUrl();
}

mapCanvas.addEventListener("pointermove", (event) => {
  if (pinch && event.pointerType === "touch") return;
  const { screen, world } = pointerToWorld(event);
  if (!world) return;
  if (state.dragTarget && event.pointerType === "mouse" && !(event.buttons & 1)) {
    endDrag(event); return;
  }
  if (state.dragTarget && state.dragPointerId === event.pointerId) {
    if (state.dragTarget === "pan") {
      if (state.dragStartScreen && distance(screen, state.dragStartScreen) > PIN_TAP_SLOP) state.dragMoved = true;
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
      setOrigin(world, { pin: true, label: null, silent: true, magnet: false });
    } else {
      setProbe(world, false, { silent: true });
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
    if (event.pointerType === "touch") return;
    if (state.probePoint && distance(state.probePoint, world) < HOVER_DEADBAND) return;
    setProbe(world, false, { silent: true });
  }
});

mapCanvas.addEventListener("pointerdown", (event) => {
  if (measureFrames) measuredFrames = [];
  if (pinch && event.pointerType === "touch") return;
  const { screen, world } = pointerToWorld(event);
  if (!world) return;
  const hit = hitPin(screen);
  if (state.handMode && !hit) {
    event.preventDefault();
    state.dragTarget = "pan";
    state.dragPointerId = event.pointerId;
    state.dragMoved = false;
    state.dragStartScreen = screen;
    state.panStartCenter = [...(state.viewportCenter || state.currentRender?.focus || defaultCenter())];
    mapCanvas.setPointerCapture(event.pointerId);
    syncCursor(screen);
    return;
  }
  const target = hit || (state.pinned ? "probe" : "origin");
  if (target === "probe" && state.probePinned) return;
  event.preventDefault();
  if (hit && !state.viewportCenter && state.currentRender?.focus) {
    state.viewportCenter = [...state.currentRender.focus];
  }
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
    setProbe(world, false, { silent: true });
  }
  syncCursor(screen);
});

mapCanvas.addEventListener("pointerup", endDrag);
mapCanvas.addEventListener("pointercancel", endDrag);
mapCanvas.addEventListener("lostpointercapture", endDrag);
window.addEventListener("pointerup", event => {
  if (state.dragTarget && state.dragPointerId === event.pointerId) endDrag(event);
});
window.addEventListener("blur", () => endDrag());

mapCanvas.addEventListener("dblclick", (event) => {
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

const transferMenu = document.getElementById("settingsTransferMenu");
const transferStatus = document.getElementById("settingsTransferStatus");
const importInput = document.getElementById("settingsImportFile");
document.getElementById("settingsExport").addEventListener("click", () => {
  if (!state.ready) return;
  const content = createSettingsFile(displaySettings, travelSettings, state);
  const url = URL.createObjectURL(new Blob([content], {type:"application/json"}));
  const link = document.createElement("a");
  link.href = url; link.download = "tours-parametres.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  transferMenu.open = false;
  transferStatus.textContent = "Paramètres et affichage exportés.";
});
document.getElementById("settingsImport").addEventListener("click", () => importInput.click());
importInput.addEventListener("change", async () => {
  const file = importInput.files[0];
  if (!file || !state.ready) return;
  try {
    if (file.size > 1000000) throw new Error("Fichier trop volumineux (maximum 1 Mo).");
    const imported = parseSettingsFile(await file.text());
    const display = normalizeDisplaySettings(imported.display);
    const travel = normalizeTravelSettings(imported.travel);
    Object.assign(displaySettings, display);
    Object.assign(travelSettings, travel);
    Object.assign(state, imported.map);
    state.originLabel = null; state.pinned = true;
    state.probePinned = Boolean(state.probePoint);
    roadResult = null; directAnchor = null; stationSymbolsKey = ""; staticLayersKey = "";
    saveDisplaySettings(); saveTravelSettings();
    buildIsochroneGradientControls(); syncDisplaySettingsControls(); syncOutlineToggles();
    roadWalkingToggle.checked = state.walkingOnRoads;
    projectsToggle.checked = state.includeProjects;
    maxTimeInput.value = String(state.maxTransitTime);
    maxTimeLabel.textContent = `Temps max. ${state.maxTransitTime} min`;
    if (state.walkingOnRoads) startRoadWalking();
    invalidateTravelSettings(); syncUrl();
    transferMenu.open = false;
    transferStatus.textContent = "Paramètres et affichage importés.";
  } catch (error) {
    transferStatus.textContent = `Import impossible : ${error.message}`;
  } finally { importInput.value = ""; }
});

displaySettingsButton.addEventListener("click", (event) => {
  event.stopPropagation();
  setDisplaySettingsOpen(displaySettingsPanel.hidden);
});
displaySettingsClose.addEventListener("click", () => setDisplaySettingsOpen(false));
displaySettingsDone.addEventListener("click", () => setDisplaySettingsOpen(false));
displaySettingsScrim.addEventListener("click", () => setDisplaySettingsOpen(false));
displayResetAll.addEventListener("click", () => {
  Object.assign(displaySettings, freshDisplaySettings());
  Object.assign(travelSettings, DEFAULT_TRAVEL_SETTINGS);
  state.walkingOnRoads = SITE_DEFAULTS.map.walkingOnRoads; roadWalkingToggle.checked = state.walkingOnRoads;
  if (state.walkingOnRoads) startRoadWalking();
  buildIsochroneGradientControls();
  saveDisplaySettings();
  saveTravelSettings();
  invalidateTravelSettings();
  syncUrl();
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !displaySettingsPanel.hidden) setDisplaySettingsOpen(false);
});
const infosDialog = document.getElementById("infosDialog");
document.getElementById("infosButton").addEventListener("click", () => infosDialog.showModal());
document.getElementById("infosClose").addEventListener("click", () => infosDialog.close());
infosDialog.addEventListener("click", event => { if (event.target === infosDialog && (event.clientX < infosDialog.getBoundingClientRect().left || event.clientX > infosDialog.getBoundingClientRect().right || event.clientY < infosDialog.getBoundingClientRect().top || event.clientY > infosDialog.getBoundingClientRect().bottom)) infosDialog.close(); });

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
  state.maxTransitTime = Math.max(state.maxTransitTime, activeThreshold());
  maxTimeInput.value = state.maxTransitTime;
  maxTimeLabel.textContent = `Temps max. ${state.maxTransitTime} min`;
  requestDraw();
  syncUrl();
});
roadWalkingToggle.addEventListener("change", () => {
  state.walkingOnRoads = roadWalkingToggle.checked;
  if (state.walkingOnRoads) startRoadWalking();
  invalidateTravelSettings(); syncUrl();
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
  zoomAt(VIEWPORT_ZOOM_STEP, [mapCanvas.clientWidth / 2, mapCanvas.clientHeight / 2]);
});
document.getElementById("zoomOutButton").addEventListener("click", () => {
  zoomAt(1 / VIEWPORT_ZOOM_STEP, [mapCanvas.clientWidth / 2, mapCanvas.clientHeight / 2]);
});
let lastJourneyKey = "";
function updateJourney() {
  if (!state.originPoint || !state.probePoint) { journeyPanel.hidden = true; lastJourneyKey = ""; return; }
  const snapshot = currentRoadProbe();
  const useRoad = state.walkingOnRoads && roadClient?.ready && !roadClient.failed;
  if (!useRoad) getTravelModel(state.originPoint);
  const key = `${useRoad ? "road:" + (snapshot?.key || roadRequestedKey) : "direct:" + cachedModelKey}:${state.probePoint}`;
  if (key === lastJourneyKey) return;
  lastJourneyKey = key;
  const useDirectWorker = !state.walkingOnRoads && directClient && !directClient.failed;
  const journey = snapshot ? snapshot.journey : state.walkingOnRoads && roadClient?.ready && !roadClient.failed ? null
    : useDirectWorker ? directResult?.key===directRequestedKey ? directResult.journey : null
    : describeJourney(state.data,getTravelModel(state.originPoint),state.probePoint);
  journeyPanel.hidden = false; journeyContent.replaceChildren();
  const add = text => { const p = document.createElement("p"); p.textContent = text; journeyContent.append(p); };
  if (!journey) { add(state.walkingOnRoads ? "Calcul du trajet sur voirie en cours…" : "Calcul du trajet en cours…"); return; }
  if (journey.roadUnavailable) { add("Aucun chemin piéton identifié vers ce point. Placez-le près d’une rue ou d’un arrêt."); return; }

  if (!journey.legs.length) add(`Marche${!state.walkingOnRoads ? " (en ligne droite)" : ""} : ${formatMinutes(journey.minutes)}.`);
  else {
    add(`Marche${!state.walkingOnRoads ? " (en ligne droite)" : ""} : ${formatMinutes(journey.walking)} ; attente, accès et marges : ${formatMinutes(journey.waiting)}.`);
    for (const leg of journey.legs) {
      add(`${leg.routeId} : ${state.data.stations[leg.from].name} → ${state.data.stations[leg.to].name}, ${formatMinutes(leg.minutes)}${leg.requiresReservation ? " (sur réservation)" : ""}.`);
    }
  }
}
function zoomAt(factor, screen) {
  if (!state.currentRender) return;
  const {width,height} = mapCanvas.getBoundingClientRect();
  const before = state.currentRender.transform.toWorld(...screen);
  state.viewportScale = clamp(state.viewportScale * factor, minViewportScale(width,height), MAX_VIEWPORT_SCALE);
  const focus = state.viewportCenter || state.currentRender.focus;
  const transform = buildTransform(viewBounds(),width,height,state.viewportScale,focus);
  const after = transform.toWorld(...screen);
  state.viewportCenter = [focus[0]+before[0]-after[0],focus[1]+before[1]-after[1]];
  requestDraw(); syncUrl();
}
mapCanvas.addEventListener("wheel", event => {
  if (!event.ctrlKey && !state.handMode) return;
  event.preventDefault();
  const rect=mapCanvas.getBoundingClientRect();
  zoomAt(Math.exp(-event.deltaY*0.002),[event.clientX-rect.left,event.clientY-rect.top]);
}, {passive:false});
let pinch = null;
mapCanvas.addEventListener("touchstart", event => {
  if (event.touches.length !== 2) return;
  event.preventDefault(); endDrag();
  pinch = Math.hypot(event.touches[0].clientX-event.touches[1].clientX,event.touches[0].clientY-event.touches[1].clientY);
}, {passive:false});
mapCanvas.addEventListener("touchmove", event => {
  if (!pinch || event.touches.length !== 2) return;
  event.preventDefault();
  const next=Math.hypot(event.touches[0].clientX-event.touches[1].clientX,event.touches[0].clientY-event.touches[1].clientY);
  const rect=mapCanvas.getBoundingClientRect();
  zoomAt(next/pinch,[(event.touches[0].clientX+event.touches[1].clientX)/2-rect.left,(event.touches[0].clientY+event.touches[1].clientY)/2-rect.top]);
  pinch=next;
}, {passive:false});
mapCanvas.addEventListener("touchend",()=>{pinch=null;});
window.addEventListener("resize", () => {backdropKey=""; requestDraw();});
new ResizeObserver(() => {backdropKey=""; requestDraw();}).observe(mapStage);

async function init() {
  const response = await fetch(DATA_URL);
  if (!response.ok) throw new Error(`Chargement impossible (${response.status})`);
  state.data = await response.json();
  state.ready = true;
  startDirectCalculations();
  buildIsochroneGradientControls();
  buildEpciColorSettings();
  buildRouteColorSettings();
  buildBusNetworkSettings();
  syncDisplaySettingsControls();
  restoreUrl();
  if (state.walkingOnRoads) startRoadWalking();
  state.dirty = false;
  requestDraw();
}

init().catch(error => { statusText.textContent = "Impossible de charger la carte. Rechargez la page."; console.error(error); });
