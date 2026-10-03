import { buildTravelModel, estimateTravel as routeEstimate, reachability, describeJourney } from "./routing.mjs?v=2026-10-03d";
const DATA_URL = new URL("./data/commute_map_data.json?v=2026-10-03d", import.meta.url).toString();
const MIN_VIEWPORT_SCALE = 0.12;
const MAX_VIEWPORT_SCALE = 120;
const VIEWPORT_ZOOM_STEP = 1.32;
const DEFAULT_VIEWPORT_SCALE = 1;
const PANEL_PADDING = 22;
const ROUTE_LINE_WIDTH = 3.6;
const DISPLAY_SETTINGS_STORAGE_KEY = "tours-display-settings-v2";
const TRAVEL_SETTINGS_STORAGE_KEY = "tours-travel-settings-v1";
const DEFAULT_ISOCHRONE_STOPS = Object.freeze([
  { t: 0, color: "#dc4525", alpha: 1 },
  { t: 0.2, color: "#f47f2e", alpha: 0.96 },
  { t: 0.4, color: "#ffc44f", alpha: 0.9 },
  { t: 0.62, color: "#f8e89c", alpha: 0.76 },
  { t: 0.82, color: "#ffe2a1", alpha: 0.42 },
  { t: 1, color: "#ffe2a1", alpha: 0 },
]);
const DEFAULT_DISPLAY_SETTINGS = Object.freeze({
  terWidth: ROUTE_LINE_WIDTH,
  tramWidth: 4.2,
  bhnsWidth: 3.4,
  stationRadius: 2.5,
  railStationRadius: 2,
  labelScale: 1,
  communeBorderWidth: 0.7,
  epciBorderWidth: 1.3,
  isochroneOpacity: 0.58,
  communeFillOpacity: 1,
  epciFillOpacity: 1,
  communeColor: "#c5d0db",
  backgroundColor: "#efe6d6",
});
const DEFAULT_TRAVEL_SETTINGS = Object.freeze({
  terWait: 15,
  tramWait: 4,
  bhnsWait: 3.25,
  navetteWait: 5,
  stationEntryPenalty: 1.8,
  stationExitPenalty: 1.8,
  transferPenalty: 3.5,
  walkingTransferPenalty: 2,
});
const HOVER_DEADBAND = 12;
const PIN_HIT_RADIUS = 32;
const PIN_TAP_SLOP = 8;
const MAX_TIME_MINUTES = 180;
const OUTLINE_OPTIONS = [15, 30, 45, 60, 90, 120];
const DEFAULT_OUTLINE_MINUTES = [15, 30, 60];
const OUTLINE_WIDTHS = { 15: 1.4, 30: 2.1, 45: 2, 60: 1.5 };
const DEFAULT_MAX_TIME_MINUTES = 90;
const DEFAULT_INCLUDE_PROJECTS = true;
const DEFAULT_ORIGIN = {
  lat: 47.38915,
  lon: 0.69416,
  label: "Gare de Tours",
};
const SHARE_DECIMALS = 5;
const SHARE_CALC_VERSION = "1";
const TRAVEL_QUERY_PARAMS = Object.freeze({
  terWait: "terw",
  tramWait: "tramw",
  bhnsWait: "bhnsw",
  navetteWait: "navw",
  stationEntryPenalty: "entry",
  stationExitPenalty: "exit",
  transferPenalty: "transfer",
  walkingTransferPenalty: "walktransfer",
});

function freshDisplaySettings() {
  return {
    ...DEFAULT_DISPLAY_SETTINGS,
    routeColors: {},
    epciColors: {},
    isochroneStops: DEFAULT_ISOCHRONE_STOPS.map((stop) => ({ ...stop })),
  };
}

function validHexColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || ""));
}

function normalizeDisplaySettings(value) {
  const source = value && typeof value === "object" ? value : {};
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
  const isochroneStops = DEFAULT_ISOCHRONE_STOPS.map((fallback, index) => {
    const stop = Array.isArray(source.isochroneStops) ? source.isochroneStops[index] : null;
    const alpha = Number(stop?.alpha);
    return {
      t: fallback.t,
      color: validHexColor(stop?.color) ? stop.color.toLowerCase() : fallback.color,
      alpha: Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : fallback.alpha,
    };
  });
  return {
    terWidth: numeric("terWidth", 0.5, 10),
    tramWidth: numeric("tramWidth", 0.5, 10),
    bhnsWidth: numeric("bhnsWidth", 0.5, 10),
    stationRadius: numeric("stationRadius", 1, 10),
    railStationRadius: numeric("railStationRadius", 1, 10),
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
  const source = value && typeof value === "object" ? value : {};
  const numeric = (key, min, max) => {
    const number = Number(source[key]);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : DEFAULT_TRAVEL_SETTINGS[key];
  };
  return {
    terWait: numeric("terWait", 0, 60),
    tramWait: numeric("tramWait", 0, 30),
    bhnsWait: numeric("bhnsWait", 0, 30),
    navetteWait: numeric("navetteWait", 0, 30),
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
  viewportScale: DEFAULT_VIEWPORT_SCALE,
  viewportCenter: null,
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
const maxTimeInput = document.getElementById("maxTimeInput");
const maxTimeLabel = document.getElementById("maxTimeLabel");
const helpPanel = document.getElementById("helpPanel");
const sharePanel = document.getElementById("sharePanel");
const shareUrl = document.getElementById("shareUrl");
const settingsButton = document.getElementById("settingsButton");
const settingsPanel = document.getElementById("settingsPanel");
const settingsClose = document.getElementById("settingsClose");
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
const mapCard = document.querySelector(".map-card");
const journeyPanel = document.getElementById("journeyPanel");
const journeyContent = document.getElementById("journeyContent");
const mapBackdrop = document.createElement("canvas");
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
  const info = state.data?.routeInfo?.[routeId];
  if (validHexColor(info?.color)) return info.color.toLowerCase();
  const route = state.data?.routes?.find((item) => item.id === routeId && validHexColor(item.color));
  return route?.color?.toLowerCase() || "#345c77";
}

function routeDisplayColor(route) {
  return displaySettings.routeColors[route.id] || route.color;
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
  return displaySettings.epciColors[borough.code] || displaySettings.communeColor;
}

function setDisplaySettingsOpen(open) {
  displaySettingsPanel.hidden = !open;
  displaySettingsScrim.hidden = !open;
  displaySettingsButton.setAttribute("aria-expanded", String(open));
  if (open) {
    setSettingsOpen(false);
    sharePanel.hidden = true;
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

  displayRouteColors.querySelectorAll(".route-color-row").forEach((row) => {
    const routeId = row.dataset.routeId;
    const color = (displaySettings.routeColors[routeId] || defaultRouteColor(routeId)).toLowerCase();
    const picker = row.querySelector("[data-route-color]");
    const code = row.querySelector("[data-route-color-code]");
    if (picker) picker.value = color;
    if (code) code.value = color.toUpperCase();
  });

  displayEpciColors?.querySelectorAll(".epci-color-row").forEach((row) => {
    const epciCode = row.dataset.epciCode;
    const color = (displaySettings.epciColors[epciCode] || displaySettings.communeColor).toLowerCase();
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
  Nord: ["TER K39", "TER P30", "TER P33"],
  Ouest: ["TER K1", "TER P1", "TER P65"],
  Est: ["TER K1", "TER K16", "TER K6+", "TER P6", "TER P7", "TER P17", "TER P166"],
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

  // The current My Maps reference accounts for every configured route.
  // If a new route is added later, keep it visible under Tours rather than
  // silently dropping it, until the reference folders are updated.
  const ungrouped = [...unique.values()].filter((route) => !groupedIds.has(route.id));
  if (ungrouped.length) {
    const tours = displayRouteColors.querySelector('[data-route-group="Tours"] .route-color-group-body');
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
    strong.textContent = Math.round(stop.t * 100) + "%";
    const small = document.createElement("small");
    small.textContent = index === 0 ? "départ" : index === displaySettings.isochroneStops.length - 1 ? "temps maximal" : "étape";
    label.append(strong, small);

    const control = document.createElement("div");
    control.className = "isochrone-stop-picker";

    const picker = document.createElement("input");
    picker.type = "color";
    picker.dataset.isochroneColor = String(index);
    picker.setAttribute("aria-label", "Couleur du dégradé à " + Math.round(stop.t * 100) + "%");

    const alphaTrack = document.createElement("div");
    alphaTrack.className = "isochrone-alpha-track";
    const alpha = document.createElement("input");
    alpha.type = "range";
    alpha.min = "0";
    alpha.max = "100";
    alpha.step = "1";
    alpha.dataset.isochroneAlpha = String(index);
    alpha.setAttribute("aria-label", "Transparence du dégradé à " + Math.round(stop.t * 100) + "%");
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
  const min = Number(input.min);
  const max = Number(input.max);
  let value = Number(input.value);
  if (!Number.isFinite(value)) value = fallback;
  value = Math.max(min, Math.min(max, value));
  displaySettings[key] = value;
  input.value = String(value);
  const percent = displaySettingsPanel.querySelector('[data-display-percent="' + key + '"]');
  if (percent) percent.textContent = Math.round(value * 100) + "%";
  saveDisplaySettings();
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

  const resetGradient = event.target.closest("[data-reset-isochrone-gradient]");
  if (resetGradient) {
    displaySettings.isochroneStops = DEFAULT_ISOCHRONE_STOPS.map((stop) => ({ ...stop }));
    syncDisplaySettingsControls();
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

function heatmapColor(minutes, alphaMultiplier = 1, useStopAlpha = true) {
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
      walkMinutes: distance(point, station.point) / state.data.meta.walkMetersPerMinute + travelSettings.stationEntryPenalty,
    };
    if (nearest.length === count && item.walkMinutes >= nearest[nearest.length - 1].walkMinutes) return;
    nearest.push(item);
    nearest.sort((a, b) => a.walkMinutes - b.walkMinutes);
    if (nearest.length > count) nearest.pop();
  });
  return nearest;
}

let cachedModel = null;
let cachedModelKey = "";
let cachedWarp = null;
let cachedWarpKey = "";
function activeThreshold() {
  return state.outlineMinutes.length ? Math.max(...state.outlineMinutes) : state.maxTransitTime;
}
function getTravelModel(origin) {
  const settingsKey = Object.entries(travelSettings).map(([key, value]) => key + ":" + value).join("|");
  const key = `${origin[0]},${origin[1]},${state.includeProjects}:${settingsKey}`;
  if (key !== cachedModelKey) {
    cachedModel = buildTravelModel(state.data, origin, state.includeProjects, travelSettings);
    cachedModelKey = key;
  }
  return cachedModel;
}
function estimateTravel(origin, distances, destination) {
  return routeEstimate(state.data, getTravelModel(origin), destination);
}
function summarizeReachability(origin) {
  return reachability(state.data, getTravelModel(origin), activeThreshold());
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

  for (const cellIndex of state.data.mask) {
    if (cellIndex === -1) continue;
    const cell = state.data.cells[cellIndex];
    minuteGrid[cell.row][cell.col] = routeEstimate(state.data, model, cell.point);
    validMask[cell.row][cell.col] = true;
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

function computeViewportWarp(origin, transform, width, height) {
  const model = getTravelModel(origin);
  const panPreview = state.dragTarget === "pan";
  const key = `${cachedModelKey}:view:${transform.scale}:${transform.toWorld(0,0)}:${width}:${height}:${state.maxTransitTime}:${activeThreshold()}:${panPreview}`;
  if (cachedWarpKey === key) return cachedWarp;
  const topLeft = transform.toWorld(0, 0);
  const bottomRight = transform.toWorld(width, height);
  const bounds = [topLeft[0], bottomRight[1], bottomRight[0], topLeft[1]];
  const gridCols = panPreview ? 90 : width < 600 ? 100 : 180;
  const gridRows = Math.max(80, Math.round((gridCols * height) / width));
  const cellW = (bounds[2] - bounds[0]) / gridCols;
  const cellH = (bounds[3] - bounds[1]) / gridRows;
  const minutes = Array.from({ length: gridRows }, () => new Array(gridCols).fill(Infinity));
  const validMask = Array.from({ length: gridRows }, () => new Array(gridCols).fill(false));
  for (let row = 0; row < gridRows; row += 1) {
    for (let col = 0; col < gridCols; col += 1) {
      const point = [bounds[0] + (col + 0.5) * cellW, bounds[1] + (row + 0.5) * cellH];
      if (!pointInStaticGrid(point)) continue;
      minutes[row][col] = routeEstimate(state.data, model, point);
      validMask[row][col] = true;
    }
  }
  cachedWarpKey = key;
  cachedWarp = { minutes, validMask, bounds, cellW, cellH, distances: model.distances };
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
    if (route.mode === "BUS" && state.viewportScale < 1.8) continue;
    drawCtx.strokeStyle = routeDisplayColor(route);
    drawCtx.lineWidth = route.mode === "TRAM" ? displaySettings.tramWidth : route.mode === "BHNS" ? displaySettings.bhnsWidth : route.mode === "BUS" ? 1.35 : displaySettings.terWidth;
    drawCtx.lineCap = "round";
    drawCtx.lineJoin = "round";
    drawCtx.setLineDash(route.mode === "BHNS" ? [7, 5] : []);
    drawPolyline(drawCtx, route.points, projectPoint);
  }
  drawCtx.setLineDash([]);
}

function drawDepartmentLimits(drawCtx, projectPoint) {
  const communeWidth = displaySettings.communeBorderWidth * (state.viewportScale >= 2 ? 1.3 : 0.8);
  for (const commune of state.data.communes || []) {
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

function drawStations(drawCtx, projectPoint, warp) {
  const source = heatmapSourcePoint();
  const model = source ? getTravelModel(source) : null;
  const threshold = state.maxTransitTime;
  const major = /^(Tours|Saint-Pierre-des-Corps|Blois-Chambord|Saumur|Vendôme-Villiers-sur-Loir|Orléans|Paris-Austerlitz|Caen|Nantes|Poitiers|Le Mans|Vierzon|Loches|Amboise)$/i;
  const labels = [];
  for (const station of state.data.stations) {
    const index = state.data.stations.indexOf(station);
    if (station.mode === "TER" && ((!station.routes || station.routes.length === 0) || (model && !model.activeStations[index]))) continue;
    if (station.mode === "BUS" && state.viewportScale < 2.4) continue;
    const [x, y] = projectPoint(station.drawPoint || station.point);
    if (x < -8 || y < -8 || x > mapCanvas.clientWidth + 8 || y > mapCanvas.clientHeight + 8) continue;
    const stationRadius = station.mode === "TER" ? displaySettings.railStationRadius : station.mode === "BUS" ? Math.max(1.4, displaySettings.stationRadius * 0.62) : displaySettings.stationRadius;
    const minutes = model && model.activeStations[index] ? routeEstimate(state.data, model, station.point) : Infinity;
    const rasterMissesStation = Number.isFinite(minutes) && minutes <= threshold && minimumWarpMinutesNearPoint(warp, station.point) > threshold;
    if (rasterMissesStation) {
      // A ring is deliberately a point symbol, not a fake geographic surface.
      // It also represents reachable stations outside the SERM, where the raster is clipped.
      drawCtx.beginPath();
      drawCtx.arc(x, y, Math.max(stationRadius + 3.2, 5), 0, Math.PI * 2);
      drawCtx.strokeStyle = heatmapColor(minutes, 1.35, false);
      drawCtx.lineWidth = 2.2;
      drawCtx.stroke();
    }
    drawCtx.beginPath();
    drawCtx.arc(x, y, stationRadius, 0, Math.PI * 2);
    drawCtx.fillStyle = "#fff";
    drawCtx.fill();
    drawCtx.lineWidth = 0.55;
    drawCtx.strokeStyle = station.mode === "TRAM" ? (station.planned ? "#1d91b6" : "#bd074e") : station.mode === "BHNS" ? "#e18529" : station.mode === "BUS" ? "#4b677d" : "#345c77";
    drawCtx.stroke();
    if (station.mode === "BUS") {
      if (state.viewportScale >= 6) labels.push({ station, x, y, terminal: false });
      continue;
    }
    if (station.mode !== "TER") continue;
    const terminal = station.terminal || major.test(station.name);
    const show = terminal ? state.viewportScale >= 0.55 : !station.inSerm && state.viewportScale >= 0.8;
    if (show) labels.push({ station, x, y, terminal });
  }
  const occupied = [];
  labels.sort((a, b) => Number(b.terminal) - Number(a.terminal) || a.station.name.localeCompare(b.station.name, "fr"));
  for (const { station, x, y, terminal } of labels) {
    const fontSize = (terminal ? 12 : 10) * displaySettings.labelScale;
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

function clipToSerm(drawCtx, projectPoint) {
  drawCtx.beginPath();
  for (const epci of state.data.boroughs) {
    for (const polygon of epci.polygons) {
      for (const ring of polygon) {
        if (!ring.length) continue;
        drawCtx.moveTo(...projectPoint(ring[0]));
        for (let i = 1; i < ring.length; i += 1) drawCtx.lineTo(...projectPoint(ring[i]));
        drawCtx.closePath();
      }
    }
  }
  drawCtx.clip("evenodd");
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
      if (!validMask[row][col] || !validMask[row][col + 1] || !validMask[row + 1][col + 1] || !validMask[row + 1][col]) continue;
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
  const ordered = [...station.routes].sort((a, b) => Number(b.startsWith("TER ")) - Number(a.startsWith("TER ")) || a.localeCompare(b, "fr"));
  if (!ordered.length) { lines.push({text: "Sans desserte retenue dans le calcul", small: true}); return lines; }
  const routeId = ordered[0];
  if (routeId === "TRAM A") lines.push({ text: "Tramway A", small: true });
  else if (routeId === "TRAM B") lines.push({ text: "Tramway B · projet 2028", small: true });
  else if (routeId === "BHNS C") lines.push({ text: "BHNS C · projet 2028", small: true });
  else if (routeId === "NAVETTE") lines.push({ text: "Navette Tours ↔ Saint-Pierre-des-Corps", small: true });
  else if (routeId.startsWith("BUS ")) {
    const info = state.data.routeInfo?.[routeId] || {};
    const wait = Number(info.waitMinutes);
    lines.push({ text: info.title || routeId, small: true });
    if (Number.isFinite(wait)) lines.push({ text: `Attente modélisée : ${wait % 1 ? wait.toFixed(1) : wait} min`, small: true });
  } else {
    const title = state.data.routeInfo?.[routeId]?.title || "";
    const endpoints = title.includes(" - ") ? title.slice(title.indexOf(" - ") + 3) : title;
    lines.push({ text: `${routeId} · ${endpoints}`, small: true });
  }
  if (ordered.length > 1) lines.push({ text: `+ ${ordered.length - 1} autre${ordered.length > 2 ? "s" : ""} ligne${ordered.length > 2 ? "s" : ""}`, small: true });
  return lines;
}

function arrivalDescriptor(point) {
  const model = state.originPoint ? getTravelModel(state.originPoint) : null;
  const details = model ? routeEstimate(state.data, model, point, true) : null;
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
  if (warp) {
    const { reachable, total } = summarizeReachability(source);
    const percent = Math.round((reachable / total) * 100);
    const percentText = reachable > 0 && percent === 0 ? "Moins de 1 %" : `${percent} %`;
    reachText.textContent = `${percentText} des points d’arrêt intégrés au calcul sont joignables en ${activeThreshold()} minutes depuis ce point (estimation, pas une part de population).`;
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

function drawMap() {
  if (!state.ready) return;
  const { width, height } = createCanvasBacking(mapCanvas);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = displaySettings.backgroundColor;
  ctx.fillRect(0, 0, width, height);

  const source = heatmapSourcePoint();
  const other = heatmapOtherPoint();
  const previewingOriginDrag = state.dragTarget === "origin" && state.dragMoved && Boolean(state.currentRender?.warp);
  const focusBounds = viewBounds();
  const scaleMul = clamp(state.viewportScale, minViewportScale(width, height), MAX_VIEWPORT_SCALE);
  const focus = state.viewportCenter || (scaleMul > 1.02 ? (state.probePoint && state.originPoint ? [(state.originPoint[0] + state.probePoint[0]) / 2, (state.originPoint[1] + state.probePoint[1]) / 2] : source || defaultCenter()) : defaultCenter());
  const transform = buildTransform(focusBounds, width, height, scaleMul, focus);
  const projectPoint = (point) => transform.toScreen(point);
  const warp = source ? (previewingOriginDrag
    ? state.currentRender.warp
    : (scaleMul > 1.8 || !pointInLand(focus) || !pointInLand(source)
      ? computeViewportWarp(source, transform, width, height)
      : computeWarp(source))) : null;

  const nextBackdropKey = `${cachedModelKey}:${cachedWarpKey}:${width}:${height}:${scaleMul}:${focus}:${state.maxTransitTime}:${state.outlineMinutes}`;
  if (nextBackdropKey !== backdropKey) {
    mapBackdrop.width = mapCanvas.width; mapBackdrop.height = mapCanvas.height;
    const baseCtx = mapBackdrop.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    baseCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    baseCtx.fillStyle = displaySettings.backgroundColor; baseCtx.fillRect(0,0,width,height);
    drawBasemap(baseCtx, projectPoint);
    if (warp) {
      baseCtx.save();
      clipToSerm(baseCtx, projectPoint);
      drawHeatmap(baseCtx, warp, projectPoint);
      if (state.outlineMinutes.length) drawOutline(baseCtx, warp, projectPoint);
      baseCtx.restore();
    }
    drawDepartmentLimits(baseCtx, projectPoint);
    drawRoutes(baseCtx, projectPoint);
    drawCommuneLabels(baseCtx, projectPoint);
    drawStations(baseCtx, projectPoint, warp);
    backdropKey = nextBackdropKey;
  }
  ctx.drawImage(mapBackdrop, 0, 0, width, height);

  let travelMinutes = null;
  if (!previewingOriginDrag && warp && other) travelMinutes = estimateTravel(source, warp.distances, other);
  state.pinHits = { origin: null, probe: null };

  if (state.probePoint) {
    const probeScreen = projectPoint(state.probePoint);
    const originScreen = state.originPoint ? projectPoint(state.originPoint) : null;
    const nearOrigin = originScreen && Math.abs(originScreen[0] - probeScreen[0]) < 280 && Math.abs(originScreen[1] - probeScreen[1]) < 130;
    drawMarker(ctx, probeScreen, "#1c2f42", state.dragTarget === "probe" ? 5 : 4);
    const probeDescriptor = previewingOriginDrag ? placeName(state.probePoint) : arrivalDescriptor(state.probePoint);
    const probeLines = [{ text: `Arrivée : ${probeDescriptor}`, small: false }];
    probeLines.push({ text: previewingOriginDrag ? "mise à jour au relâchement" : (Number.isFinite(travelMinutes) ? formatMinutes(travelMinutes) : "—"), small: true });
    const probeLabel = drawLabelBubble(ctx, probeScreen, probeLines, "#1c2f42", nearOrigin && probeScreen[1] >= originScreen[1], 18, true);
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

  state.currentRender = { warp, transform, focus };
  legend.hidden = !warp;
  legendMax.textContent = `${state.maxTransitTime} min`;
  if (!previewingOriginDrag) syncStatus(warp, travelMinutes);
  if (!state.dragTarget) updateJourney();
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
  if (!moved && target === "pan" && event) {
    const { world } = pointerToWorld(event);
    if (world) {
      if (!state.originPoint) setOrigin(world, { pin: true, label: null, silent: true });
      else if (!state.probePoint) setProbe(world, false, { silent: true });
    }
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
  if (Number.isFinite(max) && max >= 20 && max <= MAX_TIME_MINUTES) {
    state.maxTransitTime = max;
    maxTimeInput.value = String(max);
    maxTimeLabel.textContent = `Temps max. ${max} min`;
  }
  state.includeProjects = params.get("projects") === "1" ? true : params.get("projects") === "0" ? false : DEFAULT_INCLUDE_PROJECTS;
  projectsToggle.checked = state.includeProjects;
  const hasTravelParams = Object.values(TRAVEL_QUERY_PARAMS).some((param) => params.has(param));
  if (params.get("calc") === SHARE_CALC_VERSION || hasTravelParams) {
    const restored = { ...DEFAULT_TRAVEL_SETTINGS };
    for (const [key, param] of Object.entries(TRAVEL_QUERY_PARAMS)) {
      if (params.has(param)) restored[key] = Number(params.get(param));
    }
    Object.assign(travelSettings, normalizeTravelSettings(restored));
    syncDisplaySettingsControls();
  }
  if (origin) {
    setOrigin(origin, { pin: true, silent: true });
  } else {
    setOrigin(lonLatToWorld(DEFAULT_ORIGIN.lon, DEFAULT_ORIGIN.lat), {
      pin: true,
      label: DEFAULT_ORIGIN.label,
      silent: true,
    });
  }
  if (probe) setProbe(probe, false, { silent: true });
  if (params.get("view")) {
    state.viewportCenter = parsePair(params.get("view")) || defaultCenter();
    const zoom = Number(params.get("zoom"));
    if (Number.isFinite(zoom) && zoom > 0) state.viewportScale = clamp(zoom, MIN_VIEWPORT_SCALE, MAX_VIEWPORT_SCALE);
  }
  state.handMode = true;
  syncCursor();
  syncUrl();
}

mapCanvas.addEventListener("pointermove", (event) => {
  if (pinch && event.pointerType === "touch") return;
  const { screen, world } = pointerToWorld(event);
  if (!world) return;
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
      setOrigin(world, { pin: true, label: null, silent: true });
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

function setSettingsOpen(open) {
  settingsPanel.hidden = !open;
  settingsButton.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) {
    sharePanel.hidden = true;
    if (!displaySettingsPanel.hidden) setDisplaySettingsOpen(false);
  }
}

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
  syncDisplaySettingsControls();
  saveDisplaySettings();
  saveTravelSettings();
  invalidateTravelSettings();
  syncUrl();
});

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
  if (event.key !== "Escape") return;
  if (!displaySettingsPanel.hidden) setDisplaySettingsOpen(false);
  else if (!settingsPanel.hidden) setSettingsOpen(false);
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
  state.maxTransitTime = Math.max(state.maxTransitTime, activeThreshold());
  maxTimeInput.value = state.maxTransitTime;
  maxTimeLabel.textContent = `Temps max. ${state.maxTransitTime} min`;
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
  zoomAt(VIEWPORT_ZOOM_STEP, [mapCanvas.clientWidth / 2, mapCanvas.clientHeight / 2]);
});
document.getElementById("zoomOutButton").addEventListener("click", () => {
  zoomAt(1 / VIEWPORT_ZOOM_STEP, [mapCanvas.clientWidth / 2, mapCanvas.clientHeight / 2]);
});
const fullscreenButton = document.getElementById("fullscreenButton");
function syncFullscreen() {
  const active = Boolean(document.fullscreenElement) || mapCard.classList.contains("is-expanded");
  fullscreenButton.textContent = active ? "Quitter le plein écran" : "Plein écran";
  fullscreenButton.setAttribute("aria-pressed", String(active));
  document.body.classList.toggle("map-expanded", active);
  backdropKey = "";
  requestDraw();
}
fullscreenButton.addEventListener("click", () => {
  // A viewport-sized map is reliable on iPhone and embedded browsers, which
  // can reject or immediately exit the native Fullscreen API.
  mapCard.classList.toggle("is-expanded");
  syncFullscreen();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && mapCard.classList.contains("is-expanded") && !document.fullscreenElement) {
    mapCard.classList.remove("is-expanded"); syncFullscreen();
  }
});
let lastJourneyKey = "";
function updateJourney() {
  if (!state.originPoint || !state.probePoint) { journeyPanel.hidden = true; lastJourneyKey = ""; return; }
  const key = `${cachedModelKey}:${state.probePoint}`;
  if (key === lastJourneyKey) return;
  lastJourneyKey = key;
  const journey = describeJourney(state.data, getTravelModel(state.originPoint), state.probePoint);
  journeyPanel.hidden = false; journeyContent.replaceChildren();
  const add = text => { const p = document.createElement("p"); p.textContent = text; journeyContent.append(p); };
  if (!journey.legs.length) add(`Marche directe estimée : ${formatMinutes(journey.minutes)}.`);
  else {
    add(`Marche : ${formatMinutes(journey.walking)} ; attente, accès et marges : ${formatMinutes(journey.waiting)}.`);
    for (const leg of journey.legs) {
      const method = leg.pattern === null ? " (estimation)" : " (durée horaire représentative)";
      add(`${leg.routeId} : ${state.data.stations[leg.from].name} → ${state.data.stations[leg.to].name}, ${formatMinutes(leg.minutes)}${method}.`);
    }
  }
}
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
  buildIsochroneGradientControls();
  buildEpciColorSettings();
  buildRouteColorSettings();
  syncDisplaySettingsControls();
  restoreUrl();
  state.dirty = false;
  requestDraw();
}

init().catch(error => { statusText.textContent = "Impossible de charger la carte. Rechargez la page."; console.error(error); });
