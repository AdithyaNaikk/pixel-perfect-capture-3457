import * as THREE from "three";

/**
 * Alignment guides for the provided neuron.glb, in the model's own (centred) coordinates.
 * The model's largest side is 1.9016 units along X; it is shown at NEURON_SIZE metres.
 * Tweak these points (with the "Debug guides" toggle on) to realign effects to the mesh.
 */
export const NEURON_SIZE = 1.8;
export const NEURON_MODEL_EXTENT = 1.9016;
export const NEURON_SCALE = NEURON_SIZE / NEURON_MODEL_EXTENT;

type P = [number, number, number];

export const SOMA_POINT: P = [-0.3, 0.13, 0];
export const HILLOCK_POINT: P = [-0.07, 0.14, 0];

/** Dendrite guides, each running from its tip INTO the cell body. */
export const DENDRITE_GUIDES: P[][] = [
  [[-0.7, 0.68, 0], [-0.56, 0.46, 0], [-0.44, 0.3, 0], SOMA_POINT],
  [[-0.3, 0.64, 0], [-0.22, 0.42, 0], [-0.26, 0.28, 0], SOMA_POINT],
  [[-0.06, 0.64, 0], [-0.16, 0.4, 0], [-0.22, 0.26, 0], SOMA_POINT],
  [[-0.94, 0.04, 0], [-0.7, 0.1, 0], [-0.5, 0.12, 0], SOMA_POINT],
  [[-0.74, -0.32, 0], [-0.56, -0.22, 0], [-0.44, -0.06, 0], SOMA_POINT],
  [[-0.64, -0.46, 0], [-0.52, -0.24, 0], [-0.4, -0.04, 0], SOMA_POINT],
  [[-0.3, -0.4, 0], [-0.26, -0.16, 0], [-0.28, 0.0, 0], SOMA_POINT],
  [[-0.08, -0.38, 0], [-0.18, -0.16, 0], [-0.24, 0.02, 0], SOMA_POINT],
];

/** Axon guide from the hillock to the terminal branch point. */
export const AXON_GUIDE: P[] = [HILLOCK_POINT, [0.16, 0.12, 0], [0.36, -0.02, 0], [0.52, -0.18, 0], [0.68, -0.4, 0]];

/** Axon terminal tips (for flashes / particles). */
export const TERMINAL_POINTS: P[] = [
  [0.9, -0.32, 0],
  [0.84, -0.48, 0],
  [0.68, -0.66, 0],
  [0.52, -0.54, 0],
  [0.84, -0.26, 0],
];

const toVec = (p: P) => new THREE.Vector3(p[0], p[1], p[2]);
export const dendriteCurves = () => DENDRITE_GUIDES.map((g) => new THREE.CatmullRomCurve3(g.map(toVec)));
export const axonCurve = () => new THREE.CatmullRomCurve3(AXON_GUIDE.map(toVec));

/**
 * Intraparietal sulcus glow patches on the brain model (local to the brain model group,
 * in metres). Elongated along Z (front-to-back) on the upper back of each hemisphere.
 */
export const IPS_PATCHES: { position: P; scale: P; rotation: P }[] = [
  { position: [-0.17, 0.2, -0.16], scale: [0.05, 0.035, 0.2], rotation: [0.35, 0, 0] },
  { position: [0.17, 0.2, -0.16], scale: [0.05, 0.035, 0.2], rotation: [0.35, 0, 0] },
];
