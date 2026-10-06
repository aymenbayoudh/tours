const MAP_KEYS = ["originPoint", "probePoint", "viewportCenter", "viewportScale", "outlineMinutes", "maxTransitTime", "includeProjects", "walkingOnRoads"];
export function createSettingsFile(display, travel, state) {
  const map = Object.fromEntries(MAP_KEYS.map(key => [key, state[key]]));
  return JSON.stringify({format:"tours-settings", version:1, display, travel, map}, null, 2) + "\n";
}
export function parseSettingsFile(text) {
  let value;
  try { value = JSON.parse(text); } catch { throw new Error("Le fichier doit être un fichier JSON valide."); }
  const object = v => v && typeof v === "object" && !Array.isArray(v);
  if (!object(value) || value.format !== "tours-settings" || value.version !== 1) throw new Error("Format de paramètres Tours non reconnu.");
  if (![value.display, value.travel, value.map].every(object)) throw new Error("Fichier de paramètres incomplet.");
  const map = Object.fromEntries(MAP_KEYS.map(key => [key, value.map[key]]));
  const point = p => Array.isArray(p) && p.length === 2 && p.every(n => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 21000000);
  if (!point(map.originPoint) || (map.probePoint !== null && !point(map.probePoint)) || (map.viewportCenter !== null && !point(map.viewportCenter))) throw new Error("Positions de carte invalides.");
  if (!Number.isFinite(map.viewportScale) || map.viewportScale < .12 || map.viewportScale > 120 || !Number.isFinite(map.maxTransitTime) || map.maxTransitTime < 20 || map.maxTransitTime > 180) throw new Error("Zoom ou durée invalide.");
  if (!Array.isArray(map.outlineMinutes) || !map.outlineMinutes.every(n => [15,30,45,60,90,120].includes(n)) || typeof map.includeProjects !== "boolean" || typeof map.walkingOnRoads !== "boolean") throw new Error("Options de carte invalides.");
  for (const settings of [value.display, value.travel]) {
    for (const v of Object.values(settings)) if (typeof v === "number" && !Number.isFinite(v)) throw new Error("Paramètre numérique invalide.");
  }
  map.outlineMinutes = [...new Set(map.outlineMinutes)];
  return {display:value.display, travel:value.travel, map};
}
