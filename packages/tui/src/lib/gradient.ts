/**
 * gradient.ts — btop-style gradient color picker (no external deps).
 *
 * Implements a simple linear interpolation between hex color stops,
 * analogous to btop's Theme::g(gradient).at(0..100).
 *
 * @see spec.md §2.1 (btop graph_symbols 차용)
 */

/** Parse "#rrggbb" → [r,g,b] */
function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** Interpolate two colors at t ∈ [0,1] → "#rrggbb" */
function lerp(a: [number, number, number], b: [number, number, number], t: number): string {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`;
}

/**
 * Pick a color from a gradient defined by color stops.
 * @param stops  Array of hex color strings (≥2)
 * @param t      Position in [0, 1]
 * @returns      Interpolated hex color
 */
export function pickGradientColor(stops: readonly string[], t: number): string {
  if (stops.length === 0) return '#ffffff';
  if (stops.length === 1) return stops[0]!;
  const clamped = Math.max(0, Math.min(1, t));
  const segments = stops.length - 1;
  const scaled = clamped * segments;
  const segIdx = Math.min(Math.floor(scaled), segments - 1);
  const segT = scaled - segIdx;
  const a = parseHex(stops[segIdx]!);
  const b = parseHex(stops[segIdx + 1]!);
  return lerp(a, b, segT);
}

/**
 * Build a fixed-size LUT from gradient stops.
 * Useful for pre-computing a palette of N colors.
 */
export function buildGradientLut(stops: readonly string[], size: number): string[] {
  const lut: string[] = [];
  for (let i = 0; i < size; i++) {
    lut.push(pickGradientColor(stops, i / (size - 1)));
  }
  return lut;
}
