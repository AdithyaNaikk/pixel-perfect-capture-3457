import { forward } from "./ann";
import { goldenDigits } from "./goldenDigits";
import { brainRun } from "./snn";
import { preprocessStrokes, type Point } from "./preprocess";
import type { Weights } from "./weights";

let seven: Float32Array | null = null;

/** Golden test digit "7", built through the same preprocessStrokes as the pad. */
export function goldenSeven(): Float32Array {
  if (!seven) {
    const strokes: Point[][] = [
      [{ x: 60, y: 40 }, { x: 120, y: 38 }, { x: 180, y: 38 }, { x: 215, y: 40 }],
      [{ x: 215, y: 40 }, { x: 185, y: 110 }, { x: 155, y: 180 }, { x: 130, y: 250 }],
    ];
    seven = preprocessStrokes(strokes);
  }
  return seven;
}

export function runSelfTest(weights: Weights): string {
  const p = forward(goldenSeven(), weights, new Set()).prediction;
  return p === 7 ? "Self-test: PASS (7 → 7)" : `Self-test: FAIL (7 → ${p})`;
}

/** Brain (spiking) network on the 10 golden digits 0–9. */
export function runBrainSelfTest(weights: Weights): string {
  let ok = 0;
  goldenDigits().forEach((x, d) => {
    if (brainRun(x, weights, new Set()).winner === d) ok++;
  });
  return `Brain self-test: ${ok}/10`;
}
