import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Deterministic hash -> [0, 1). */
export function rand01(seed: number) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const Z = new THREE.Vector3(0, 0, 1);

const UP = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const _qt = new THREE.Quaternion();

/** Fixed, seeded organic rotation for a Brain neuron instance (twist + slight tilt). */
export function neuronQuat(index: number, out: THREE.Quaternion) {
  out.setFromAxisAngle(Z, rand01(index + 7.3) * Math.PI * 2);
  _qt.setFromAxisAngle(X, (rand01(index + 3.1) - 0.5) * 0.6);
  out.premultiply(_qt);
  _qt.setFromAxisAngle(UP, (rand01(index + 5.9) - 0.5) * 0.6);
  return out.premultiply(_qt);
}

/** Seeded tissue-like offset for Brain hidden neuron h. */
export function organicOffset(h: number, out: THREE.Vector3) {
  return out.set(
    (rand01(h + 11.1) - 0.5) * 0.12,
    (rand01(h + 23.7) - 0.5) * 0.12,
    (rand01(h + 37.3) - 0.5) * 0.3,
  );
}

export const SOMA_COLOR = new THREE.Color("#ff5fc8");
export const BRANCH_COLOR = new THREE.Color("#ffc2ea");

function paint(g: THREE.BufferGeometry, c: THREE.Color) {
  const n = g.attributes["position"]!.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute("uv");
  return g;
}

function taper(from: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number) {
  const dir = to.clone().sub(from);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, 4, 1, true);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()));
  const mid = from.clone().add(to).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  return paint(g, BRANCH_COLOR);
}

/**
 * Small magenta soma, 6 forked pale-pink dendrites (+Z / sideways, ~3r long),
 * axon toward -Z (~4r) ending in 3 terminal bulbs. One merged geometry with vertex colours.
 */
export function createNeuronGeometry(r: number) {
  const parts: THREE.BufferGeometry[] = [];
  const soma = new THREE.SphereGeometry(r, 8, 6);
  soma.scale(1, 0.85, 0.95);
  parts.push(paint(soma, SOMA_COLOR));

  for (let k = 0; k < 6; k++) {
    const ang = (k / 6) * Math.PI * 2 + rand01(k + 1) * 0.5;
    const dir = new THREE.Vector3(Math.cos(ang), Math.sin(ang), 0.9 + rand01(k + 9) * 0.5).normalize();
    const start = dir.clone().multiplyScalar(r * 0.8);
    const len = r * (2.7 + rand01(k + 4) * 0.6);
    const end = dir.clone().multiplyScalar(r * 0.8 + len);
    const fork = start.clone().lerp(end, 0.66);
    parts.push(taper(start, fork, r * 0.3, r * 0.1));
    const side = new THREE.Vector3().crossVectors(dir, Z);
    if (side.lengthSq() < 0.01) side.set(1, 0, 0);
    side.normalize();
    const rest = len * 0.4;
    for (const sgn of [1, -1]) {
      const tip = fork.clone().addScaledVector(dir, rest).addScaledVector(side, sgn * rest * 0.55);
      parts.push(taper(fork, tip, r * 0.1, r * 0.025));
    }
  }

  const axStart = new THREE.Vector3(0, 0, -r * 0.8);
  const axEnd = new THREE.Vector3(0, 0, -r * 4);
  parts.push(taper(axStart, axEnd, r * 0.22, r * 0.07));
  for (let b = 0; b < 3; b++) {
    const a = (b / 3) * Math.PI * 2;
    const tip = new THREE.Vector3(Math.cos(a) * r * 0.45, Math.sin(a) * r * 0.45, -r * 4.6);
    parts.push(taper(axEnd, tip, r * 0.07, r * 0.03));
    const bulb = new THREE.SphereGeometry(r * 0.14, 4, 3);
    bulb.translate(tip.x, tip.y, tip.z);
    parts.push(paint(bulb, BRANCH_COLOR));
  }

  const merged = mergeGeometries(parts, false)!;
  parts.forEach((p) => p.dispose());
  merged.computeBoundingSphere();
  return merged;
}

const _d = new THREE.Vector3();
const _p1 = new THREE.Vector3();
const _p2 = new THREE.Vector3();

/** Quadratic-curve control point with a small seeded sideways bend. */
export function curveControl(a: THREE.Vector3, b: THREE.Vector3, seed: number, out: THREE.Vector3) {
  _d.subVectors(b, a);
  const len = _d.length();
  _p1.crossVectors(_d, UP);
  if (_p1.lengthSq() < 1e-8) _p1.set(1, 0, 0);
  _p1.normalize();
  _p2.crossVectors(_d, _p1).normalize();
  const ang = rand01(seed) * Math.PI * 2;
  const mag = len * (0.04 + 0.08 * rand01(seed + 0.5));
  return out
    .addVectors(a, b)
    .multiplyScalar(0.5)
    .addScaledVector(_p1, Math.cos(ang) * mag)
    .addScaledVector(_p2, Math.sin(ang) * mag);
}

/** Point on the quadratic curve a -> c -> b at t. */
export function curvePoint(a: THREE.Vector3, c: THREE.Vector3, b: THREE.Vector3, t: number, out: THREE.Vector3) {
  const u = 1 - t;
  return out.set(
    u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    u * u * a.y + 2 * u * t * c.y + t * t * b.y,
    u * u * a.z + 2 * u * t * c.z + t * t * b.z,
  );
}

export const CURVE_SEGMENTS = 4;
/** Seeds shared by line drawing and travelling dots. */
export const seedIn = (i: number, h: number) => 100000 + i * 64 + h;
export const seedOut = (h: number, o: number) => h * 10 + o + 1;
