import { forward } from "./ann";
import type { Weights } from "./weights";

import { snnRun, type SnnParams, type SnnResult } from "./snnRun";

export { snnRun, type SnnParams, type SnnResult };


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
