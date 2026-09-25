export type Point = { x: number; y: number };

const SIZE = 28;
const BOX = 20;

function makeCanvas(w: number, h: number) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/** MNIST-style preprocessing of stroke data. Returns 784 values in 0..1, row-major, row 0 = top. */
export function preprocessStrokes(strokes: Point[][]): Float32Array {
  const out = new Float32Array(SIZE * SIZE);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes)
    for (const p of s) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  if (!isFinite(minX)) return out;

  const bw = maxX - minX, bh = maxY - minY;
  const scale = BOX / Math.max(bw, bh, 1e-6);
  const offX = (SIZE - bw * scale) / 2;
  const offY = (SIZE - bh * scale) / 2;

  const canvas = makeCanvas(SIZE, SIZE);
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | null;
  if (!ctx) return out;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.strokeStyle = "#fff";
  ctx.fillStyle = "#fff";
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const tx = (p: Point) => [(p.x - minX) * scale + offX, (p.y - minY) * scale + offY] as const;
  for (const s of strokes) {
    if (s.length === 0) continue;
    if (s.length === 1) {
      const [x, y] = tx(s[0]!);
      ctx.beginPath();
      ctx.arc(x, y, 1.1, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    const [x0, y0] = tx(s[0]!);
    ctx.moveTo(x0, y0);
    for (let i = 1; i < s.length; i++) {
      const [x, y] = tx(s[i]!);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  const data = ctx.getImageData(0, 0, SIZE, SIZE).data;
  const img = new Float32Array(SIZE * SIZE);
  let sum = 0, cx = 0, cy = 0;
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const v = data[(y * SIZE + x) * 4]! / 255;
      img[y * SIZE + x] = v;
      sum += v;
      cx += v * x;
      cy += v * y;
    }
  if (sum === 0) return out;
  // Centre of mass shift (pixel centres at x+0.5 → target 14 means index 13.5)
  const dx = Math.round(13.5 - cx / sum);
  const dy = Math.round(13.5 - cy / sum);
  const shifted = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const sx = x - dx, sy = y - dy;
      if (sx >= 0 && sx < SIZE && sy >= 0 && sy < SIZE) shifted[y * SIZE + x] = img[sy * SIZE + sx]!;
    }

  // 3x3 Gaussian blur
  const k = [1, 2, 1, 2, 4, 2, 1, 2, 1];
  let max = 0;
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      let acc = 0;
      for (let j = -1; j <= 1; j++)
        for (let i = -1; i <= 1; i++) {
          const sx = x + i, sy = y + j;
          if (sx < 0 || sx >= SIZE || sy < 0 || sy >= SIZE) continue;
          acc += shifted[sy * SIZE + sx]! * k[(j + 1) * 3 + (i + 1)]!;
        }
      const v = acc / 16;
      out[y * SIZE + x] = v;
      if (v > max) max = v;
    }
  if (max > 0) for (let i = 0; i < out.length; i++) out[i] = out[i]! / max;
  return out;
}
