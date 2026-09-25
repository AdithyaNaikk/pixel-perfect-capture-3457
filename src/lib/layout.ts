import * as THREE from "three";

/** Geometry constants shared by layout and rendering. */
export const INPUT_GRID = 28;
export const INPUT_CUBE_SIZE = 0.012;
export const INPUT_SPACING = 0.018;

export const HIDDEN_GRID = 8;
export const HIDDEN_RADIUS = 0.025;
export const HIDDEN_SPACING = 0.075;

export const OUTPUT_COUNT = 10;
export const OUTPUT_RADIUS = 0.035;
export const OUTPUT_SPACING = 0.085;

/** Layers are spaced along the network's local +Z (front to back). */
export const LAYER_GAP = 0.9;
export const INPUT_Z = LAYER_GAP;
export const HIDDEN_Z = 0;
export const OUTPUT_Z = -LAYER_GAP;

function gridPositions(
  count: number,
  spacing: number,
  z: number,
): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const half = (count - 1) / 2;
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      out.push(
        new THREE.Vector3(
          (col - half) * spacing,
          (half - row) * spacing,
          z,
        ),
      );
    }
  }
  return out;
}

/** 784 positions, row-major (matches MNIST flattening). */
export function inputPositions(): THREE.Vector3[] {
  return gridPositions(INPUT_GRID, INPUT_SPACING, INPUT_Z);
}

/** 64 positions in an 8x8 grid. */
export function hiddenPositions(): THREE.Vector3[] {
  return gridPositions(HIDDEN_GRID, HIDDEN_SPACING, HIDDEN_Z);
}

/** 10 positions in a vertical column. */
export function outputPositions(): THREE.Vector3[] {
  const half = (OUTPUT_COUNT - 1) / 2;
  return Array.from(
    { length: OUTPUT_COUNT },
    (_, i) => new THREE.Vector3(0, (half - i) * OUTPUT_SPACING, OUTPUT_Z),
  );
}
