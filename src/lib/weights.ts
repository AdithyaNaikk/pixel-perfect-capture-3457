export interface Weights {
  /** [64][784] input -> hidden */
  w1: number[][];
  /** [10][64] hidden -> output */
  w2: number[][];
  lambda1: number;
  lambda2: number;
  /** True when these are random placeholder weights. */
  isPlaceholder?: boolean;
}

export const INPUT_SIZE = 784;
export const HIDDEN_SIZE = 64;
export const OUTPUT_SIZE = 10;

/** Box-Muller normal sample. */
function randn(std: number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function matrix(rows: number, cols: number, std: number): number[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => randn(std)),
  );
}

export function randomWeights(std = 0.05): Weights {
  return {
    w1: matrix(HIDDEN_SIZE, INPUT_SIZE, std),
    w2: matrix(OUTPUT_SIZE, HIDDEN_SIZE, std),
    lambda1: 1,
    lambda2: 1,
    isPlaceholder: true,
  };
}

function isValid(data: unknown): data is Weights {
  const w = data as Weights | null;
  return (
    !!w &&
    Array.isArray(w.w1) &&
    w.w1.length === HIDDEN_SIZE &&
    Array.isArray(w.w1[0]) &&
    w.w1[0].length === INPUT_SIZE &&
    Array.isArray(w.w2) &&
    w.w2.length === OUTPUT_SIZE &&
    Array.isArray(w.w2[0]) &&
    w.w2[0].length === HIDDEN_SIZE
  );
}

export async function loadWeights(url = "/weights.json"): Promise<Weights> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: unknown = await res.json();
    if (!isValid(data)) throw new Error("unexpected shape");
    const w = data as Weights;
    return {
      w1: w.w1,
      w2: w.w2,
      lambda1: typeof w.lambda1 === "number" ? w.lambda1 : 1,
      lambda2: typeof w.lambda2 === "number" ? w.lambda2 : 1,
    };
  } catch (err) {
    console.warn(
      `[weights] Could not load ${url} (${String(err)}); using random placeholder weights.`,
    );
    return randomWeights();
  }
}
