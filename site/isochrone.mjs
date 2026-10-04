// Marching squares over finite travel-time samples.
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
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

export function contourSegments(warp, threshold) {
  const { minutes, validMask, bounds, cellW, cellH } = warp;
  const center = (row, col) => [bounds[0] + (col + 0.5) * cellW, bounds[1] + (row + 0.5) * cellH];
  const segments = [];
  for (let row = 0; row < minutes.length - 1; row += 1) {
    for (let col = 0; col < minutes[row].length - 1; col += 1) {
      if (!validMask[row][col] || !validMask[row][col + 1] || !validMask[row + 1][col + 1] || !validMask[row + 1][col]) continue;
      // Keep non-finite values out of contour interpolation.
      if (!Number.isFinite(minutes[row][col]) || !Number.isFinite(minutes[row][col + 1]) || !Number.isFinite(minutes[row + 1][col + 1]) || !Number.isFinite(minutes[row + 1][col])) continue;
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

