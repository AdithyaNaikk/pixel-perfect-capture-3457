import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import * as THREE from "three";

import { OUTPUT_RADIUS } from "@/lib/layout";
import { curveControl, curvePoint, nervePoint, neuronQuat, seedIn, seedOut } from "@/lib/brainGeometry";
const RECEPTOR_BRIGHT = new THREE.Color("#ffd6f2");
import { ANSWER_SIZE, ANSWER_SUB_Y, ANSWER_Y, INACTIVE_COLOR, LABEL_Z, SPIKE_COLOR } from "@/lib/layout";
import { brainRun } from "@/lib/snn";

/** Playback view of one snnRun result (cumulative counts and live leader derived from it). */
interface SnnResult {
  T: number;
  inputSpikes: number[][];
  hiddenSpikes: number[][];
  outputSpikes: number[][];
  counts: number[][];
  leader: number[];
  /** result.winner from snnRun (-1 = no answer). */
  winner: number;
  prediction: string;
  decisionStep: number;
}

function toPlayback(img: Float32Array, weights: Weights, lesioned: Set<number>): SnnResult {
  const r = brainRun(img, weights, lesioned);
  const T = r.params.timesteps;
  const counts: number[][] = [];
  const leader: number[] = [];
  const c = new Array(10).fill(0) as number[];
  for (let t = 0; t < T; t++) {
    for (const d of r.outputSpikes[t] ?? []) c[d] = c[d]! + 1;
    counts.push(c.slice());
    const v = r.outputPotential[t]!;
    let best = 0;
    for (let d = 1; d < 10; d++) if (c[d]! > c[best]! || (c[d] === c[best] && v[d]! > v[best]!)) best = d;
    leader.push(best);
  }
  let d = T - 1;
  while (d > 0 && leader[d - 1] === r.winner) d--;
  return {
    T,
    inputSpikes: Array.from({ length: T }, () => []),
    hiddenSpikes: r.hiddenSpikes,
    outputSpikes: r.outputSpikes,
    counts,
    leader,
    winner: r.winner,
    prediction: r.winner < 0 ? "?" : String(r.winner),
    decisionStep: d + 1,
  };
}
import { useAppStore } from "@/lib/store";
import type { Weights } from "@/lib/weights";

const STEP_MS = 50;
const FLASH_MS = 120;
const TRAVEL_STEPS = 2;
const MAX_DOTS = 300;
const FLASH = new THREE.Color(SPIKE_COLOR);
/** Instance tint that, multiplied by the pink/magenta vertex colours, reads as orange. */
const NEURON_FLASH = new THREE.Color(1, 1.25, 0.5);
const NEURON_IDLE = new THREE.Color(1, 1, 1);
const BAR_MAX = 0.55;
const BAR_W = 0.05;
export const LESION_GREY = new THREE.Color("#2a2a2e");

interface Props {
  weights: Weights;
  color: string;
  dim: number;
  inputOff: number;
  inputRef: RefObject<THREE.InstancedMesh | null>;
  hiddenRef: RefObject<THREE.InstancedMesh | null>;
  outputRef: RefObject<THREE.InstancedMesh | null>;
  inputPos: THREE.Vector3[];
  hiddenPos: THREE.Vector3[];
  outputPos: THREE.Vector3[];
  /** For each input pixel, the hidden neurons it has a DRAWN connection to. */
  inputOut: number[][];
  hiddenOut: number[][];
  panelX: number;
}

interface Status {
  step: number;
  leader: number;
  done: boolean;
  spikes: number;
}

export function SpikingPlayback(props: Props) {
  const { weights, color, dim, inputOff, inputRef, hiddenRef, outputRef, inputPos, hiddenPos, outputPos, inputOut, hiddenOut, panelX } = props;
  const runId = useAppStore((s) => s.runId);
  const replayId = useAppStore((s) => s.replayId);
  const [result, setResult] = useState<SnnResult | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const clock = useRef<number | null>(null);
  const dotsRef = useRef<THREE.InstancedMesh>(null);
  const barRefs = useRef<(THREE.Mesh | null)[]>([]);
  const lastStep = useRef(-1);
  const nH = hiddenPos.length;

  const tmp = useMemo(
    () => ({
      full: new THREE.Color(color),
      base: new THREE.Color(INACTIVE_COLOR),
      inBase: new THREE.Color(INACTIVE_COLOR),
      c: new THREE.Color(),
      m: new THREE.Matrix4(),
      v: new THREE.Vector3(),
      q: new THREE.Quaternion(),
      sv: new THREE.Vector3(),
      ctrl: new THREE.Vector3(),
      hidden: new Float32Array(hiddenPos.length),
      output: new Float32Array(outputPos.length),
      input: new Float32Array(inputPos.length),
    }),
    [color, dim, inputOff, hiddenPos.length, outputPos.length, inputPos.length],
  );

  // Simulate the whole run instantly.
  useEffect(() => {
    const img = useAppStore.getState().inputImage;
    if (runId === 0 || !img) return;
    setResult(toPlayback(img, weights, useAppStore.getState().lesioned));
    useAppStore.getState().setBrainCounts(null);
    useAppStore.getState().setSpiking({ done: false, prediction: null });
  }, [runId, weights]);

  // Start (or restart) playback.
  useEffect(() => {
    if (!result) return;
    clock.current = 0;
    lastStep.current = -1;
    setStatus({ step: 0, leader: result.leader[0] ?? 0, done: false, spikes: 0 });
  }, [result, replayId]);

  useFrame((_, rawDelta) => {
    const res = result;
    const dots = dotsRef.current;
    if (!res || clock.current === null || !dots) return;
    const SNN_T = res.T;
    const speed = useAppStore.getState().speed;
    const dt = Math.min(rawDelta, 0.05);
    const p = Math.min(clock.current + ((dt * 1000) / STEP_MS) * speed, SNN_T + TRAVEL_STEPS + FLASH_MS / STEP_MS);
    clock.current = p;
    const cur = Math.min(Math.floor(p), SNN_T - 1);
    const finished = p >= SNN_T + TRAVEL_STEPS + FLASH_MS / STEP_MS;

    // Flash intensities: recent spikes fade over FLASH_MS.
    tmp.hidden.fill(0);
    tmp.output.fill(0);
    tmp.input.fill(0);
    const flashSteps = Math.ceil(FLASH_MS / STEP_MS) + 1;
    for (let t = Math.max(0, cur - flashSteps); t <= cur && t < SNN_T; t++) {
      if (t > p) break;
      const f = Math.max(0, 1 - ((p - t) * STEP_MS) / FLASH_MS);
      if (f <= 0) continue;
      for (const i of res.inputSpikes[t]!) tmp.input[i] = Math.max(tmp.input[i]!, f);
      for (const h of res.hiddenSpikes[t]!) tmp.hidden[h] = Math.max(tmp.hidden[h]!, f);
      for (const o of res.outputSpikes[t]!) tmp.output[o] = Math.max(tmp.output[o]!, f);
    }

    const img = useAppStore.getState().inputImage;
    const inMesh = inputRef.current;
    const hMesh = hiddenRef.current;
    const oMesh = outputRef.current;
    if (inMesh) {
      for (let i = 0; i < inputPos.length; i++) {
        tmp.c.copy(tmp.inBase).lerp(RECEPTOR_BRIGHT, img?.[i] ?? 0).lerp(FLASH, tmp.input[i]!);
        inMesh.setColorAt(i, tmp.c);
      }
      if (inMesh.instanceColor) inMesh.instanceColor.needsUpdate = true;
    }
    const lesioned = useAppStore.getState().lesioned;
    if (hMesh) {
      for (let i = 0; i < hiddenPos.length; i++) {
        if (lesioned.has(i)) tmp.c.copy(LESION_GREY);
        else tmp.c.copy(NEURON_IDLE).lerp(NEURON_FLASH, tmp.hidden[i]!);
        hMesh.setColorAt(i, tmp.c);
      }
      if (hMesh.instanceColor) hMesh.instanceColor.needsUpdate = true;
    }
    if (oMesh) {
      for (let i = 0; i < outputPos.length; i++) {
        tmp.c.copy(NEURON_IDLE).lerp(NEURON_FLASH, tmp.output[i]!);
        oMesh.setColorAt(i, tmp.c);
      }
      if (oMesh.instanceColor) oMesh.instanceColor.needsUpdate = true;
    }

    // Travelling dots along drawn connections (stateless, pooled).
    let n = 0;
    const place = (a: THREE.Vector3, b: THREE.Vector3, k: number, seed: number, viaNerve = false) => {
      if (viaNerve) nervePoint(a, b, panelX, k, tmp.v);
      else {
        curveControl(a, b, seed, tmp.ctrl);
        curvePoint(a, tmp.ctrl, b, k, tmp.v);
      }
      tmp.v.z += 0.01;
      tmp.m.makeTranslation(tmp.v.x, tmp.v.y, tmp.v.z);
      dots.setMatrixAt(n++, tmp.m);
    };
    for (let t = Math.max(0, Math.floor(p) - TRAVEL_STEPS); t <= Math.floor(p) && t < SNN_T && n < MAX_DOTS; t++) {
      const k = (p - t) / TRAVEL_STEPS;
      if (k < 0 || k > 1) continue;
      for (const h of res.hiddenSpikes[t]!) {
        const a = hiddenPos[h]!;
        for (const o of hiddenOut[h] ?? []) {
          if (n >= MAX_DOTS) break;
          place(a, outputPos[o]!, k, seedOut(h, o));
        }
      }
      for (const i of res.inputSpikes[t]!) {
        const targets = inputOut[i];
        if (!targets) continue;
        const a = inputPos[i]!;
        for (const h of targets) {
          if (n >= MAX_DOTS) break;
          if (lesioned.has(h)) continue;
          place(a, hiddenPos[h]!, k, seedIn(i, h), true);
        }
      }
    }
    dots.count = n;
    dots.instanceMatrix.needsUpdate = true;

    // Spike count bars.
    const counts = res.counts[cur]!;
    const leader = res.leader[cur]!;
    let maxC = 1;
    for (const c of res.counts[SNN_T - 1]!) maxC = Math.max(maxC, c);
    // Output neurons grow with their spike count (1.0 -> 1.6 for the top neuron).
    if (oMesh) {
      for (let o = 0; o < outputPos.length; o++) {
        const sc = 1 + 0.6 * (counts[o]! / maxC);
        tmp.sv.set(sc, sc, sc);
        tmp.m.compose(outputPos[o]!, neuronQuat(nH + o, tmp.q), tmp.sv);
        oMesh.setMatrixAt(o, tmp.m);
      }
      oMesh.instanceMatrix.needsUpdate = true;
    }
    for (let o = 0; o < outputPos.length; o++) {
      const bar = barRefs.current[o];
      if (!bar) continue;
      const len = Math.max(0.0001, (counts[o]! / maxC) * BAR_MAX);
      // Bars grow upward above each output sphere.
      bar.scale.y = len;
      bar.position.y = outputPos[o]!.y + OUTPUT_RADIUS * 1.6 + 0.04 + len / 2;
      const mat = bar.material as THREE.MeshBasicMaterial;
      mat.color.copy(o === leader ? FLASH : tmp.full);
      mat.opacity = o === leader ? 1 : 0.45;
    }

    if (cur !== lastStep.current || finished) {
      lastStep.current = cur;
      setStatus({ step: cur + 1, leader, done: p >= SNN_T, spikes: counts[leader] ?? 0 });
    }
    if (finished) {
      clock.current = null;
      useAppStore.getState().setSpiking({ done: true, prediction: res.winner < 0 ? null : res.winner });
      useAppStore.getState().setBrainCounts([...res.counts[SNN_T - 1]!]);
    }
  });

  return (
    <>
      <instancedMesh ref={dotsRef} args={[undefined, undefined, MAX_DOTS]} frustumCulled={false} renderOrder={2}>
        <sphereGeometry args={[0.007, 6, 4]} />
        <meshBasicMaterial color={FLASH} toneMapped={false} transparent opacity={0.9} depthWrite={false} />
      </instancedMesh>

      {result &&
        outputPos.map((pos, o) => (
          <mesh
            key={o}
            ref={(m) => {
              barRefs.current[o] = m;
            }}
            position={[pos.x, pos.y + OUTPUT_RADIUS * 1.6 + 0.04, pos.z]}
            scale={[1, 0.0001, 1]}
            renderOrder={2}
          >
            <boxGeometry args={[BAR_W, 1, BAR_W]} />
            <meshBasicMaterial color={color} transparent opacity={0.45} toneMapped={false} />
          </mesh>
        ))}

      {result && status && (
        <>
          <Text position={[panelX, ANSWER_Y, LABEL_Z]} fontSize={ANSWER_SIZE} color={color} anchorX="center" anchorY="middle" outlineWidth={0.006} outlineColor="#05060a">
            {status.done ? `Brain: ${result.prediction}` : `Brain: ...  (${status.spikes} spikes so far)`}
          </Text>
          <Text position={[panelX, ANSWER_SUB_Y, LABEL_Z]} fontSize={0.05} color="#f3e2d7" anchorX="center" anchorY="middle">
            {status.done
              ? result.winner < 0 ? "no answer: no output neuron fired" : `decided at step ${result.decisionStep}`
              : `step ${status.step}/${result.T}`}
          </Text>
          <Text position={[panelX, ANSWER_SUB_Y - 0.13, LABEL_Z]} fontSize={0.045} color="#f3e2d7" anchorX="center" anchorY="middle">
            Spikes: each neuron fires pulses over time.
          </Text>
        </>
      )}
    </>
  );
}
