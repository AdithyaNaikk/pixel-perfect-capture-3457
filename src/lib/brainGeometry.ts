import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Deterministic hash -> [0, 1). */
export function rand01(seed: number) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const Z = new THREE.Vector3(0, 0, 1);

/** Fixed, seeded twist around the forward (Z) axis for a Brain neuron instance. */
export function neuronQuat(index: number, out: THREE.Quaternion) {
  return out.setFromAxisAngle(Z, rand01(index + 7.3) * Math.PI * 2);
}

const UP = new THREE.Vector3(0, 1, 0);

function taper(from: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number) {
  const dir = to.clone().sub(from);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, 4, 1, true);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()));
  const mid = from.clone().add(to).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  return g;
}

/** Soma + 5 forked dendrites + axon (-Z) with terminal bulb, merged into one geometry. */
export function createNeuronGeometry(r: number) {
  const parts: THREE.BufferGeometry[] = [];
  const soma = new THREE.SphereGeometry(r, 9, 7);
  soma.scale(1, 0.85, 0.95);
  parts.push(soma);

  const dirs: [number, number, number][] = [
    [0, 1, 0.45], [0.95, 0.3, 0.5], [-0.9, 0.4, 0.3], [0.55, -0.85, 0.4], [-0.5, -0.9, 0.55],
  ];
  dirs.forEach((d, k) => {
    const dir = new THREE.Vector3(...d).normalize();
    const start = dir.clone().multiplyScalar(r * 0.8);
    const len = r * (1.5 + rand01(k + 1) * 0.5);
    const end = dir.clone().multiplyScalar(r * 0.8 + len);
    parts.push(taper(start, end, r * 0.22, r * 0.07));
    // Small fork near the end.
    const forkStart = start.clone().lerp(end, 0.7);
    const side = new THREE.Vector3().crossVectors(dir, Z).normalize();
    if (side.lengthSq() < 0.01) side.set(1, 0, 0);
    const forkEnd = forkStart.clone().addScaledVector(dir, len * 0.35).addScaledVector(side, len * 0.3);
    parts.push(taper(forkStart, forkEnd, r * 0.1, r * 0.04));
  });

  const axStart = new THREE.Vector3(0, 0, -r * 0.8);
  const axEnd = new THREE.Vector3(0, 0, -r * 3.2);
  parts.push(taper(axStart, axEnd, r * 0.2, r * 0.08));
  const bulb = new THREE.SphereGeometry(r * 0.22, 6, 4);
  bulb.translate(0, 0, -r * 3.3);
  parts.push(bulb);

  const indexed = parts.map((p) => {
    p.deleteAttribute("uv");
    return p;
  });
  const merged = mergeGeometries(indexed, false)!;
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
