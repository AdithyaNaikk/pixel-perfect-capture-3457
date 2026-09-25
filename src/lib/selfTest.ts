import { forward } from "./ann";
import { preprocessStrokes, type Point } from "./preprocess";
import type { Weights } from "./weights";

let seven: Float32Array | null = null;

/**
 * Golden test digit "7". weights.json carries no sample image, so a clean 7 is built from
 * strokes through the SAME preprocessStrokes used by the desktop pad and VR.
 */
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
