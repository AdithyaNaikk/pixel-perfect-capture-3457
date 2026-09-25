import * as THREE from "three";

/** Geometry constants shared by layout and rendering. */
export const INPUT_GRID = 28;
export const INPUT_CUBE_SIZE = 0.016;
export const INPUT_SPACING = 0.018;

export const HIDDEN_GRID = 8;
export const HIDDEN_RADIUS = 0.025;
export const HIDDEN_SPACING = 0.075;

export const OUTPUT_COUNT = 10;
export const OUTPUT_RADIUS = 0.035;
export const OUTPUT_SPACING = 0.085;

/** Layers are flat XY planes facing +Z, placed at different X positions. */
export const LAYER_GAP = 0.9;

function gridPositions(
  count: number,
  spacing: number,
  x: number,
): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const half = (count - 1) / 2;
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      out.push(
        new THREE.Vector3(
          x + (col - half) * spacing,
          (half - row) * spacing,
          0,
        ),
      );
    }
  }
  return out;
}

/** 784 positions, row-major (matches MNIST flattening). */
export function inputPositions(x: number): THREE.Vector3[] {
  return gridPositions(INPUT_GRID, INPUT_SPACING, x);
}

/** 64 positions in an 8x8 grid. */
export function hiddenPositions(x: number): THREE.Vector3[] {
  return gridPositions(HIDDEN_GRID, HIDDEN_SPACING, x);
}

/** 10 positions in a vertical column. */
export function outputPositions(x: number): THREE.Vector3[] {
  const half = (OUTPUT_COUNT - 1) / 2;
  return Array.from(
    { length: OUTPUT_COUNT },
    (_, i) => new THREE.Vector3(x, (half - i) * OUTPUT_SPACING, 0),
  );
}
