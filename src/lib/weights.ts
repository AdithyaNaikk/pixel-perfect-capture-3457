export interface SnnSettings {
  steps: number;
  input_rate: number;
  leak: number;
  threshold: number;
  /** Optional fixed weight scales from weights.json (W1_scale / W2_scale). */
  w1Scale?: number;
  w2Scale?: number;
}

export interface WeightsMeta {
  architecture?: string;
  ann_test_accuracy?: number;
  snn_test_accuracy?: number;
  snn_settings?: Partial<SnnSettings>;
}

/** Internal (transposed) weights used by the app. */
export interface Weights {
  /** [64][784] hidden <- input */
  w1: number[][];
  /** [10][64] output <- hidden */
  w2: number[][];
  meta: WeightsMeta;
  snn: SnnSettings;
  /** Complete "snn" block from weights.json, if present. */
  snnBlock?: { W1_scale: number; W2_scale: number; threshold: number; beta: number; timesteps: number; input_rate: number };
  /** True when these are random placeholder weights. */
  isPlaceholder?: boolean;
}

/** On-disk format of public/weights.json. */
interface WeightsFile {
  /** [784][64]: w1[i][j] = input i -> hidden j */
  w1: number[][];
  /** [64][10]: w2[j][k] = hidden j -> output k */
  w2: number[][];
  meta?: WeightsMeta;
  W1_scale?: number;
  W2_scale?: number;
  beta?: number;
  threshold?: number;
  timesteps?: number;
  input_rate?: number;
  snn?: Record<string, unknown>;
}

export const INPUT_SIZE = 784;
export const HIDDEN_SIZE = 64;
export const OUTPUT_SIZE = 10;

const DEFAULT_SNN: SnnSettings = { steps: 80, input_rate: 0.3, leak: 0.95, threshold: 1 };

function randn(std: number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function matrix(rows: number, cols: number, std: number): number[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => randn(std)));
}

function transpose(m: number[][]): number[][] {
  const rows = m.length;
  const cols = m[0]!.length;
  return Array.from({ length: cols }, (_, c) => Array.from({ length: rows }, (_, r) => m[r]![c]!));
}

function isMatrix(m: unknown, rows: number, cols: number): m is number[][] {
  return (
    Array.isArray(m) &&
    m.length === rows &&
    m.every((r) => Array.isArray(r) && r.length === cols && r.every((v) => typeof v === "number" && Number.isFinite(v)))
  );
}

function isValidFile(data: unknown): data is WeightsFile {
  const d = data as WeightsFile | null;
  return !!d && isMatrix(d.w1, INPUT_SIZE, HIDDEN_SIZE) && isMatrix(d.w2, HIDDEN_SIZE, OUTPUT_SIZE);
}

function fromFile(file: WeightsFile, isPlaceholder: boolean): Weights {
  const meta = file.meta ?? {};
  const s = (meta.snn_settings ?? {}) as Partial<SnnSettings> & Record<string, unknown>;
  const m = meta as Record<string, unknown>;
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const pick = (...vals: unknown[]) => vals.find((v) => typeof v === "number" && Number.isFinite(v)) as number | undefined;
  const w1Scale = pick(file.W1_scale, s["W1_scale"], m["W1_scale"]);
  const w2Scale = pick(file.W2_scale, s["W2_scale"], m["W2_scale"]);
  return {
    w1: transpose(file.w1),
    w2: transpose(file.w2),
    meta,
    snn: {
      steps: num(pick(file.timesteps, s["timesteps"], s.steps), DEFAULT_SNN.steps),
      input_rate: num(pick(file.input_rate, s.input_rate), DEFAULT_SNN.input_rate),
      leak: num(pick(file.beta, s["beta"], s.leak), DEFAULT_SNN.leak),
      threshold: num(pick(file.threshold, s.threshold), DEFAULT_SNN.threshold),
      ...(w1Scale !== undefined && w2Scale !== undefined ? { w1Scale, w2Scale } : {}),
    },
    snnBlock: readSnnBlock(file.snn),
    isPlaceholder,
  };
}

function readSnnBlock(b: Record<string, unknown> | undefined): Weights["snnBlock"] {
  if (!b) return undefined;
  const keys = ["W1_scale", "W2_scale", "threshold", "beta", "timesteps", "input_rate"] as const;
  if (!keys.every((k) => typeof b[k] === "number" && Number.isFinite(b[k]))) return undefined;
  const n = (k: (typeof keys)[number]) => b[k] as number;
  return { W1_scale: n("W1_scale"), W2_scale: n("W2_scale"), threshold: n("threshold"), beta: n("beta"), timesteps: n("timesteps"), input_rate: n("input_rate") };
}

/** Random placeholder weights, generated in the file format then converted. */
export function randomWeights(std = 0.05): Weights {
  return fromFile({ w1: matrix(INPUT_SIZE, HIDDEN_SIZE, std), w2: matrix(HIDDEN_SIZE, OUTPUT_SIZE, std) }, true);
}

export async function loadWeights(url = "/weights.json"): Promise<Weights> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: unknown = await res.json();
    if (!isValidFile(data)) throw new Error("unexpected shape (expected w1 [784][64], w2 [64][10])");
    return fromFile(data, false);
  } catch (err) {
    console.warn(`[weights] Could not load ${url} (${String(err)}); using random placeholder weights.`);
    return randomWeights();
  }
}
