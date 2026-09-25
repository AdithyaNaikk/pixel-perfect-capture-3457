import { forward } from "./ann";
import { HIDDEN_SIZE, INPUT_SIZE, OUTPUT_SIZE, type Weights } from "./weights";

export const SNN_T = 80;
const LEAK = 0.98;
const THRESHOLD = 1;

export interface SnnResult {
  /** Per timestep: indices of neurons that spiked. */
  inputSpikes: number[][];
  hiddenSpikes: number[][];
  outputSpikes: number[][];
  /** Per timestep: cumulative output spike counts after that step. */
  counts: Int32Array[];
  /** Per timestep: leader after that step. */
  leader: number[];
  prediction: number;
  /** 1-based step after which the winner stays in the lead. */
  decisionStep: number;
  synapticEvents: number;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function argmaxCounts(counts: Int32Array, v: Float32Array): number {
  let best = 0;
  for (let o = 1; o < counts.length; o++) {
    const c = counts[o]!;
    const b = counts[best]!;
    if (c > b || (c === b && v[o]! > v[best]!)) best = o;
  }
  return best;
}

export function simulate(x: Float32Array, weights: Weights, lesioned: Set<number>): SnnResult {
  let lambda1 = weights.lambda1;
  let lambda2 = weights.lambda2;
  if (weights.isPlaceholder) {
    const ann = forward(x, weights, lesioned);
    lambda1 = Math.max(...ann.hidden);
    lambda2 = Math.max(...ann.output);
  }
  if (!(lambda1 > 0)) lambda1 = 1;
  if (!(lambda2 > 0)) lambda2 = 1;
  const s1 = 1 / lambda1;
  const s2 = lambda1 / lambda2;

  const rand = mulberry32(42);
  const vH = new Float32Array(HIDDEN_SIZE);
  const vO = new Float32Array(OUTPUT_SIZE);
  const count = new Int32Array(OUTPUT_SIZE);
  const res: SnnResult = {
    inputSpikes: [],
    hiddenSpikes: [],
    outputSpikes: [],
    counts: [],
    leader: [],
    prediction: 0,
    decisionStep: 1,
    synapticEvents: 0,
  };

  for (let t = 0; t < SNN_T; t++) {
    const inS: number[] = [];
    for (let i = 0; i < INPUT_SIZE; i++) if (rand() < x[i]!) inS.push(i);

    const hS: number[] = [];
    for (let h = 0; h < HIDDEN_SIZE; h++) {
      const row = weights.w1[h]!;
      let sum = 0;
      for (const i of inS) sum += row[i]!;
      vH[h] = vH[h]! * LEAK + sum * s1;
      if (lesioned.has(h)) continue;
      if (vH[h]! >= THRESHOLD) {
        hS.push(h);
        vH[h] = vH[h]! - THRESHOLD;
      }
    }

    const oS: number[] = [];
    for (let o = 0; o < OUTPUT_SIZE; o++) {
      const row = weights.w2[o]!;
      let sum = 0;
      for (const h of hS) sum += row[h]!;
      vO[o] = vO[o]! * LEAK + sum * s2;
      if (vO[o]! >= THRESHOLD) {
        oS.push(o);
        vO[o] = vO[o]! - THRESHOLD;
        count[o] = count[o]! + 1;
      }
    }

    res.inputSpikes.push(inS);
    res.hiddenSpikes.push(hS);
    res.outputSpikes.push(oS);
    res.counts.push(count.slice());
    res.leader.push(argmaxCounts(count, vO));
    res.synapticEvents += inS.length * HIDDEN_SIZE + hS.length * OUTPUT_SIZE;
  }

  res.prediction = res.leader[SNN_T - 1]!;
  let d = SNN_T - 1;
  while (d > 0 && res.leader[d - 1] === res.prediction) d--;
  res.decisionStep = d + 1;
  return res;
}
