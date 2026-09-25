import * as THREE from "three";

import { AXON_GUIDE, DENDRITE_GUIDES, SOMA_POINT, TERMINAL_POINTS } from "./brainGuides";

export const MAX_PULSES = 8;
/** Signal-path position of the cell body (0 = dendrite tips, 1 = axon terminals). */
export const SOMA_PATH = 0.35;
const AXON_BRANCH = DENDRITE_GUIDES.length;

export interface PulseUniforms {
  uPos: { value: number[] };
  uWidth: { value: number[] };
  uAmp: { value: number[] };
  uBranch: { value: number[] };
  uCol: { value: THREE.Vector3[] };
  uSoma: { value: number };
  uSomaCol: { value: THREE.Color };
  uSwell: { value: number };
}

export function createPulseUniforms(): PulseUniforms {
  return {
    uPos: { value: new Array(MAX_PULSES).fill(0) },
    uWidth: { value: new Array(MAX_PULSES).fill(0.05) },
    uAmp: { value: new Array(MAX_PULSES).fill(0) },
    uBranch: { value: new Array(MAX_PULSES).fill(-1) },
    uCol: { value: Array.from({ length: MAX_PULSES }, () => new THREE.Vector3()) },
    uSoma: { value: 0 },
    uSomaCol: { value: new THREE.Color("#ff7fd4") },
    uSwell: { value: 0.012 },
  };
}

interface Sample {
  x: number;
  y: number;
  path: number;
  branch: number;
}

function guideSamples(): Sample[] {
  const out: Sample[] = [];
  const v = new THREE.Vector3();
  DENDRITE_GUIDES.forEach((g, b) => {
    const c = new THREE.CatmullRomCurve3(g.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
    for (let i = 0; i <= 24; i++) {
      c.getPoint(i / 24, v);
      out.push({ x: v.x, y: v.y, path: SOMA_PATH * (i / 24), branch: b });
    }
  });
  const axon = new THREE.CatmullRomCurve3(AXON_GUIDE.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  for (let i = 0; i <= 24; i++) {
    axon.getPoint(i / 24, v);
    out.push({ x: v.x, y: v.y, path: SOMA_PATH + 0.5 * (i / 24), branch: AXON_BRANCH });
  }
  const end = AXON_GUIDE[AXON_GUIDE.length - 1]!;
  for (const t of TERMINAL_POINTS) {
    for (let i = 1; i <= 6; i++) {
      const k = i / 6;
      out.push({ x: end[0] + (t[0] - end[0]) * k, y: end[1] + (t[1] - end[1]) * k, path: 0.85 + 0.15 * k, branch: AXON_BRANCH });
    }
  }
  out.push({ x: SOMA_POINT[0], y: SOMA_POINT[1], path: SOMA_PATH, branch: AXON_BRANCH });
  return out;
}

const VERT_HEAD = /* glsl */ `
attribute float aPath;
attribute float aBranch;
uniform float uPos[${MAX_PULSES}];
uniform float uWidth[${MAX_PULSES}];
uniform float uAmp[${MAX_PULSES}];
uniform float uBranch[${MAX_PULSES}];
uniform vec3 uCol[${MAX_PULSES}];
uniform float uSoma;
uniform vec3 uSomaCol;
uniform float uSwell;
uniform float uSwellScale;
varying vec3 vPulseGlow;
varying float vPulseDim;
`;

const VERT_BODY = /* glsl */ `
{
  vec3 g = vec3(0.0);
  float s = 0.0;
  for (int i = 0; i < ${MAX_PULSES}; i++) {
    float d = (aPath - uPos[i]) / uWidth[i];
    float k = uAmp[i] * exp(-d * d);
    float onBranch = uBranch[i] < -0.5 ? step(${(SOMA_PATH - 0.05).toFixed(2)}, aPath)
      : ((abs(aBranch - uBranch[i]) < 0.5 || aPath > ${(SOMA_PATH - 0.05).toFixed(2)}) ? 1.0 : 0.0);
    k *= onBranch;
    g += uCol[i] * k;
    s += k;
  }
  float sd = (aPath - ${SOMA_PATH.toFixed(2)}) / 0.07;
  float sm = exp(-sd * sd);
  g += uSomaCol * max(uSoma, 0.0) * sm;
  vPulseDim = 1.0 - clamp(-uSoma, 0.0, 0.8) * sm;
  vPulseGlow = g;
  transformed += normal * uSwell * uSwellScale * min(s, 2.0);
}
`;

const FRAG_HEAD = /* glsl */ `
varying vec3 vPulseGlow;
varying float vPulseDim;
`;

/** Clones the GLB, centres it, scales its largest side to `size`, and lights its own surface with pulses. */
export function buildPulseNeuron(scene: THREE.Object3D, size: number, uniforms: PulseUniforms): THREE.Group {
  const clone = scene.clone(true);
  const box = new THREE.Box3().setFromObject(clone);
  const dims = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  clone.position.sub(centre);
  clone.updateMatrixWorld(true);
  const samples = guideSamples();
  const maxDim = Math.max(dims.x, dims.y, dims.z, 1e-6);
  const minX = box.min.x - centre.x;

  const meshes: THREE.Mesh[] = [];
  clone.traverse((c) => {
    if (c instanceof THREE.Mesh) meshes.push(c);
  });

  // First pass: nearest guide point per vertex, and how well the guides fit the model.
  const v = new THREE.Vector3();
  const results: { path: Float32Array; branch: Float32Array; pos: Float32Array }[] = [];
  let distSum = 0;
  let distN = 0;
  for (const mesh of meshes) {
    const geo = mesh.geometry as THREE.BufferGeometry;
    const pos = geo.getAttribute("position");
    const n = pos.count;
    const path = new Float32Array(n);
    const branch = new Float32Array(n);
    const world = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      world[i * 2] = v.x;
      world[i * 2 + 1] = v.y;
      let best = Infinity;
      let bs = samples[0]!;
      for (const s of samples) {
        const dx = s.x - v.x;
        const dy = s.y - v.y;
        const d = dx * dx + dy * dy;
        if (d < best) {
          best = d;
          bs = s;
        }
      }
      path[i] = bs.path;
      branch[i] = bs.branch;
      if (i % 7 === 0) {
        distSum += Math.sqrt(best);
        distN++;
      }
    }
    results.push({ path, branch, pos: world });
  }

  // Guides too far from the surface: fall back to the model's longest axis (X).
  const guidesOk = distN === 0 || distSum / distN < 0.12 * (maxDim / 1.9);
  if (!guidesOk) {
    console.warn("[neuron] guide curves do not fit the model; using its longest axis for the signal path");
    for (const r of results) {
      for (let i = 0; i < r.path.length; i++) {
        const x = r.pos[i * 2]!;
        const y = r.pos[i * 2 + 1]!;
        const t = (x - minX) / maxDim;
        r.path[i] = Math.min(1, Math.max(0, t));
        const a = Math.atan2(y - SOMA_POINT[1], x - SOMA_POINT[0]);
        r.branch[i] = t < SOMA_PATH ? Math.floor(((a + Math.PI) / (2 * Math.PI)) * AXON_BRANCH) % AXON_BRANCH : AXON_BRANCH;
      }
    }
  }

  meshes.forEach((mesh, idx) => {
    const geo = (mesh.geometry as THREE.BufferGeometry).clone();
    if (!geo.getAttribute("normal")) geo.computeVertexNormals();
    geo.setAttribute("aPath", new THREE.BufferAttribute(results[idx]!.path, 1));
    geo.setAttribute("aBranch", new THREE.BufferAttribute(results[idx]!.branch, 1));
    mesh.geometry = geo;
    const scaleVec = new THREE.Vector3();
    mesh.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), scaleVec);
    const swellScale = 1 / Math.max(1e-6, (scaleVec.x + scaleVec.y + scaleVec.z) / 3);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const patched = mats.map((m) => {
      const mat = m.clone();
      mat.side = THREE.DoubleSide;
      mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms, { uSwellScale: { value: swellScale } });
        shader.vertexShader = VERT_HEAD + shader.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>\n${VERT_BODY}`);
        shader.fragmentShader = FRAG_HEAD + shader.fragmentShader.replace(
          "#include <dithering_fragment>",
          "gl_FragColor.rgb = gl_FragColor.rgb * vPulseDim + vPulseGlow;\n#include <dithering_fragment>",
        );
      };
      mat.customProgramCacheKey = () => `neuron-pulse-${swellScale.toFixed(4)}`;
      mat.needsUpdate = true;
      return mat;
    });
    mesh.material = Array.isArray(mesh.material) ? patched : patched[0]!;
    mesh.frustumCulled = false;
  });

  const g = new THREE.Group();
  g.add(clone);
  g.scale.setScalar(size / maxDim);
  return g;
}
