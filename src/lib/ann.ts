import type { Weights } from "@/lib/weights";
import { HIDDEN_SIZE, INPUT_SIZE, OUTPUT_SIZE } from "@/lib/weights";

export interface ForwardResult {
  hidden: Float32Array;
  output: Float32Array;
  prediction: number;
}

/** A bias-free two-layer ReLU network forward pass. */
export function forward(
  x: Float32Array,
  weights: Weights,
  lesioned: Set<number>,
): ForwardResult {
  if (x.length !== INPUT_SIZE) {
    throw new RangeError(`Expected ${INPUT_SIZE} inputs, received ${x.length}`);
  }

  const hidden = new Float32Array(HIDDEN_SIZE);
  for (let h = 0; h < HIDDEN_SIZE; h++) {
    if (lesioned.has(h)) continue;
    const row = weights.w1[h];
    if (!row) continue;
    let sum = 0;
    for (let i = 0; i < INPUT_SIZE; i++) sum += (row[i] ?? 0) * (x[i] ?? 0);
    hidden[h] = Math.max(0, sum);
  }

  const output = new Float32Array(OUTPUT_SIZE);
  let prediction = 0;
  let best = Number.NEGATIVE_INFINITY;
  for (let o = 0; o < OUTPUT_SIZE; o++) {
    const row = weights.w2[o];
    if (!row) continue;
    let sum = 0;
    for (let h = 0; h < HIDDEN_SIZE; h++) sum += (row[h] ?? 0) * (hidden[h] ?? 0);
    const activation = Math.max(0, sum);
    output[o] = activation;
    if (activation > best) {
      best = activation;
      prediction = o;
    }
  }

  return { hidden, output, prediction };
}