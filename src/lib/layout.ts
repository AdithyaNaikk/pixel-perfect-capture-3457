import * as THREE from "three";

/**
 * World-space layout (metres, floor at y = 0). Each network is centred on its
 * own X; layers run front to back along -Z and face +Z toward the user.
 */
export const INPUT_GRID = 28;
export const INPUT_SPACING = 0.055;
export const INPUT_CUBE_SIZE = 0.045;
export const INPUT_Z = 0;
export const INPUT_BOTTOM_Y = 0.55;

export const HIDDEN_GRID = 8;
export const HIDDEN_SPACING = 0.19;
export const HIDDEN_RADIUS = 0.06;
export const HIDDEN_Z = -2.2;
export const HIDDEN_BOTTOM_Y = 0.65;

export const OUTPUT_COUNT = 10;
export const OUTPUT_SPACING = 0.26;
export const OUTPUT_RADIUS = 0.08;
export const OUTPUT_Z = -4.3;
export const OUTPUT_Y = 1.3;

export const AI_X = -2.4;
export const BRAIN_X = 2.4;

export const INACTIVE_COLOR = "#1a2236";
export const SPIKE_COLOR = "#ffb070";

/** Labels above each network (world Y, placed at the hidden layer's Z). */
export const LABEL_Z = HIDDEN_Z;
export const TITLE_Y = 3.35;
export const ANSWER_Y = 3.05;
export const ANSWER_SIZE = 0.3;
export const ANSWER_SUB_Y = 2.83;

function grid(count: number, spacing: number, cx: number, bottomY: number, z: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const half = (count - 1) / 2;
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      // Row 0 is the top row; column increases to +X (upright, not mirrored from +Z).
      out.push(new THREE.Vector3(cx + (col - half) * spacing, bottomY + (count - 1 - row) * spacing, z));
    }
  }
  return out;
}

/** 784 positions, row-major (matches MNIST flattening). */
export function inputPositions(cx: number): THREE.Vector3[] {
  return grid(INPUT_GRID, INPUT_SPACING, cx, INPUT_BOTTOM_Y, INPUT_Z);
}

/** 64 positions in an 8x8 grid. */
export function hiddenPositions(cx: number): THREE.Vector3[] {
  return grid(HIDDEN_GRID, HIDDEN_SPACING, cx, HIDDEN_BOTTOM_Y, HIDDEN_Z);
}

/** 10 positions in a horizontal row. */
export function outputPositions(cx: number): THREE.Vector3[] {
  const half = (OUTPUT_COUNT - 1) / 2;
  return Array.from(
    { length: OUTPUT_COUNT },
    (_, i) => new THREE.Vector3(cx + (i - half) * OUTPUT_SPACING, OUTPUT_Y, OUTPUT_Z),
  );
}
