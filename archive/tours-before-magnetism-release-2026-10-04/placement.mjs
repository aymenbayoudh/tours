// Projected map coordinates are metres. Only stations with retained TER service
// participate; snap to the physical station point, not its display offset.
export function snapToRailStation(point, stations, routeInfo, radiusMetres) {
  let best = point, gap = radiusMetres;
  for (const station of stations) {
    if (station.mode !== 'TER' || !station.routes?.some(id => routeInfo[id]?.mode === 'TER' && routeInfo[id]?.serviceStatus?.status !== 'suspended')) continue;
    const d = Math.hypot(point[0] - station.point[0], point[1] - station.point[1]);
    if (d < gap) { gap = d; best = station.point; }
  }
  return best;
}
