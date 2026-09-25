import { preprocessStrokes, type Point } from "./preprocess";

type S = [number, number][][];

function arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 16): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return out;
}

const PI = Math.PI;
/** Clean stroke-drawn digits 0–9 (screen coords, y down), run through the same preprocessing as drawing. */
const DIGITS: S[] = [
  [arc(140, 140, 60, 95, 0, 2 * PI, 28)],
  [[[150, 40], [150, 240]]],
  [[...arc(140, 95, 60, 55, PI, 2.2 * PI), [80, 240], [205, 240]]],
  [[...arc(135, 90, 55, 48, 1.1 * PI, 2.5 * PI), ...arc(135, 185, 62, 52, 1.5 * PI, 2.9 * PI)]],
  [[[170, 40], [70, 170], [210, 170]], [[170, 40], [170, 245]]],
  [[[200, 40], [95, 40], [85, 125], ...arc(135, 175, 65, 60, 1.25 * PI, 2.85 * PI)]],
  [[[180, 40], ...arc(135, 180, 60, 60, 1.05 * PI, 1.05 * PI + 2 * PI, 22).slice(0, 1), ...arc(135, 180, 60, 60, PI, 3 * PI, 22)]],
  [[[70, 40], [210, 40], [120, 245]]],
  [[...arc(140, 90, 50, 48, 0.5 * PI, 2.5 * PI, 20), ...arc(140, 185, 60, 52, -0.5 * PI, 1.5 * PI, 20)]],
  [[...arc(140, 95, 58, 55, 0, 2 * PI, 20), [198, 95], [185, 245]]],
];

let cache: Float32Array[] | null = null;
export function goldenDigits(): Float32Array[] {
  if (!cache)
    cache = DIGITS.map((d) => preprocessStrokes(d.map((s) => s.map(([x, y]): Point => ({ x, y })))));
  return cache;
}
