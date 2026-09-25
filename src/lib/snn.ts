import { forward } from "./ann";
import type { Weights } from "./weights";

// Brain mode: spiking network with the SAME weights as the AI, scaled once per layer.
export interface SnnParams {
  W1_scale: number; W2_scale: number; threshold: number;
  beta: number; timesteps: number; input_rate: number;
}

export interface SnnResult {
  winner: number;                    // predicted digit, or -1 if no output neuron ever fired
  outputCounts: number[];            // total spikes per digit 0-9
  hiddenSpikes: number[][];          // hiddenSpikes[t] = hidden neurons that fired at step t
  outputSpikes: number[][];          // outputSpikes[t] = digits whose output neuron fired at step t
  outputPotential: Float32Array[];   // outputPotential[t][d] = membrane potential of digit d after step t
}

// W1 and W2 use EXACTLY the same flat layout as annForward: W1[pixel * 64 + hidden], W2[hidden * 10 + digit].
export function snnRun(
  input: Float32Array,   // the same 784-value array (0..1) that annForward received
  W1: Float32Array,
  W2: Float32Array,
  p: SnnParams,
  lesion: boolean[],     // 64 entries, true = neuron switched off
  seed = 1,
): SnnResult {
  const NI = 784, NH = 64, NO = 10;
  let s = seed >>> 0;
  const rand = () => { // mulberry32: seeded, so a run can be replayed exactly
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const v1 = new Float32Array(NH), v2 = new Float32Array(NO);
  const I1 = new Float32Array(NH), I2 = new Float32Array(NO);
  const outputCounts = new Array(NO).fill(0);
  const hiddenSpikes: number[][] = [], outputSpikes: number[][] = [], outputPotential: Float32Array[] = [];

  for (let t = 0; t < p.timesteps; t++) {
    // 1. input pixels fire at random, brighter pixels more often
    I1.fill(0);
    for (let i = 0; i < NI; i++) {
      const x = input[i];
      if (x > 0 && rand() < x * p.input_rate) {
        const row = i * NH;
        for (let h = 0; h < NH; h++) I1[h] += W1[row + h];
      }
    }
    // 2. hidden neurons: leak, add input, fire at threshold, subtract threshold
    const hs: number[] = [];
    for (let h = 0; h < NH; h++) {
      if (lesion[h]) { v1[h] = 0; continue; }     // switched off: never fires
      v1[h] = p.beta * v1[h] + I1[h] * p.W1_scale;
      if (v1[h] >= p.threshold) { v1[h] -= p.threshold; hs.push(h); }
    }
    // 3. output neurons: same rule, driven by hidden spikes
    I2.fill(0);
    for (const h of hs) {
      const row = h * NO;
      for (let d = 0; d < NO; d++) I2[d] += W2[row + d];
    }
    const os: number[] = [];
    for (let d = 0; d < NO; d++) {
      v2[d] = p.beta * v2[d] + I2[d] * p.W2_scale;
      if (v2[d] >= p.threshold) { v2[d] -= p.threshold; os.push(d); outputCounts[d]++; }
    }
    hiddenSpikes.push(hs);
    outputSpikes.push(os);
    outputPotential.push(Float32Array.from(v2));
  }

  // 4. answer: the output neuron with the most spikes over the WHOLE run (ties: higher potential)
  let winner = -1, best = -Infinity;
  for (let d = 0; d < NO; d++) {
    if (outputCounts[d] === 0) continue;
    const score = outputCounts[d] + 1e-6 * v2[d];
    if (score > best) { best = score; winner = d; }
  }
  return { winner, outputCounts, hiddenSpikes, outputSpikes, outputPotential };
}

// ---- App glue (not part of the provided snnRun) ----

const flatCache = new WeakMap<Weights, { W1: Float32Array; W2: Float32Array }>();

/** Same flat layout as the AI forward pass: W1[pixel * 64 + hidden], W2[hidden * 10 + digit]. */
export function flatWeights(weights: Weights) {
  let f = flatCache.get(weights);
  if (!f) {
    const W1 = new Float32Array(784 * 64);
    const W2 = new Float32Array(64 * 10);
    for (let h = 0; h < 64; h++) for (let i = 0; i < 784; i++) W1[i * 64 + h] = weights.w1[h]![i]!;
    for (let d = 0; d < 10; d++) for (let h = 0; h < 64; h++) W2[h * 10 + d] = weights.w2[d]![h]!;
    f = { W1, W2 };
    flatCache.set(weights, f);
  }
  return f;
}

/** Parameters from the "snn" block of weights.json, or computed per input when it is missing. */
export function snnParams(x: Float32Array, weights: Weights, lesioned: Set<number>): SnnParams {
  if (weights.snnBlock) return weights.snnBlock;
  const ann = forward(x, weights, lesioned);
  let maxH = 0;
  for (const v of ann.hidden) maxH = Math.max(maxH, v);
  let maxO = 0;
  for (const v of ann.output) maxO = Math.max(maxO, v);
  if (!(maxH > 0)) maxH = 1;
  if (!(maxO > 0)) maxO = 1;
  return { W1_scale: 1 / maxH, W2_scale: maxH / maxO, threshold: 1, beta: 0.99, timesteps: 100, input_rate: 1 };
}

export function brainRun(x: Float32Array, weights: Weights, lesioned: Set<number>): SnnResult & { params: SnnParams } {
  const { W1, W2 } = flatWeights(weights);
  const params = snnParams(x, weights, lesioned);
  const lesion = Array.from({ length: 64 }, (_, h) => lesioned.has(h));
  return { ...snnRun(x, W1, W2, params, lesion), params };
}
