import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import * as THREE from "three";

import { HIDDEN_RADIUS, OUTPUT_RADIUS } from "@/lib/layout";
import { curveControl, curvePoint, neuronQuat, seedIn, seedOut } from "@/lib/brainGeometry";
import { ANSWER_SIZE, ANSWER_SUB_Y, ANSWER_Y, INACTIVE_COLOR, LABEL_Z, SPIKE_COLOR } from "@/lib/layout";
import { SNN_T, simulate, type SnnResult } from "@/lib/snn";
import { useAppStore } from "@/lib/store";
import type { Weights } from "@/lib/weights";

const STEP_MS = 50;
const FLASH_MS = 120;
const TRAVEL_STEPS = 2;
const MAX_DOTS = 300;
const FLASH = new THREE.Color(SPIKE_COLOR);
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
  panelX: number;
}

interface Status {
  step: number;
  leader: number;
  done: boolean;
  spikes: number;
}

export function SpikingPlayback(props: Props) {
  const { weights, color, dim, inputOff, inputRef, hiddenRef, outputRef, inputPos, hiddenPos, outputPos, inputOut, panelX } = props;
  const runId = useAppStore((s) => s.runId);
  const replayId = useAppStore((s) => s.replayId);
  const [result, setResult] = useState<SnnResult | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const clock = useRef<number | null>(null);
  const dotsRef = useRef<THREE.InstancedMesh>(null);
  const barRefs = useRef<(THREE.Mesh | null)[]>([]);
  const lastStep = useRef(-1);
  const glowRef = useRef<THREE.InstancedMesh>(null);
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
      glowBase: new THREE.Color(color).multiplyScalar(0.08),
      glowFlash: FLASH.clone().multiplyScalar(0.55),
      black: new THREE.Color(0, 0, 0),
      hidden: new Float32Array(hiddenPos.length),
      output: new Float32Array(outputPos.length),
      input: new Float32Array(inputPos.length),
    }),
    [color, dim, inputOff, hiddenPos.length, outputPos.length, inputPos.length],
  );

  // Soft glow halos: hidden matrices fixed, colours faint by default.
  useEffect(() => {
    const g = glowRef.current;
    if (!g) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    for (let i = 0; i < nH + outputPos.length; i++) {
      const pos = i < nH ? hiddenPos[i]! : outputPos[i - nH]!;
      const s = i < nH ? HIDDEN_RADIUS * 1.9 : OUTPUT_RADIUS * 1.9;
      sc.set(s, s, s);
      g.setMatrixAt(i, m.compose(pos, q, sc));
      g.setColorAt(i, tmp.glowBase);
    }
    g.instanceMatrix.needsUpdate = true;
    if (g.instanceColor) g.instanceColor.needsUpdate = true;
  }, [hiddenPos, outputPos, nH, tmp]);

  // Simulate the whole run instantly.
  useEffect(() => {
    const img = useAppStore.getState().inputImage;
    if (runId === 0 || !img) return;
    setResult(simulate(img, weights, useAppStore.getState().lesioned));
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
        tmp.c.copy(tmp.inBase).lerp(tmp.full, img?.[i] ?? 0).lerp(FLASH, tmp.input[i]!);
        inMesh.setColorAt(i, tmp.c);
      }
      if (inMesh.instanceColor) inMesh.instanceColor.needsUpdate = true;
    }
    const lesioned = useAppStore.getState().lesioned;
    if (hMesh) {
      for (let i = 0; i < hiddenPos.length; i++) {
        if (lesioned.has(i)) tmp.c.copy(LESION_GREY);
        else tmp.c.copy(tmp.base).lerp(FLASH, tmp.hidden[i]!);
        hMesh.setColorAt(i, tmp.c);
      }
      if (hMesh.instanceColor) hMesh.instanceColor.needsUpdate = true;
    }
    const glow = glowRef.current;
    if (glow) {
      for (let i = 0; i < nH; i++) {
        if (lesioned.has(i)) glow.setColorAt(i, tmp.black);
        else glow.setColorAt(i, tmp.c.copy(tmp.glowBase).lerp(tmp.glowFlash, tmp.hidden[i]!));
      }
      for (let o = 0; o < outputPos.length; o++) {
        glow.setColorAt(nH + o, tmp.c.copy(tmp.glowBase).lerp(tmp.glowFlash, tmp.output[o]!));
      }
      if (glow.instanceColor) glow.instanceColor.needsUpdate = true;
    }
    if (oMesh) {
      for (let i = 0; i < outputPos.length; i++) {
        tmp.c.copy(tmp.base).lerp(FLASH, tmp.output[i]!);
        oMesh.setColorAt(i, tmp.c);
      }
      if (oMesh.instanceColor) oMesh.instanceColor.needsUpdate = true;
    }

    // Travelling dots along drawn connections (stateless, pooled).
    let n = 0;
    const place = (a: THREE.Vector3, b: THREE.Vector3, k: number, seed: number) => {
      curveControl(a, b, seed, tmp.ctrl);
      curvePoint(a, tmp.ctrl, b, k, tmp.v);
      tmp.v.z += 0.01;
      tmp.m.makeTranslation(tmp.v.x, tmp.v.y, tmp.v.z);
      dots.setMatrixAt(n++, tmp.m);
    };
    for (let t = Math.max(0, Math.floor(p) - TRAVEL_STEPS); t <= Math.floor(p) && t < SNN_T && n < MAX_DOTS; t++) {
      const k = (p - t) / TRAVEL_STEPS;
      if (k < 0 || k > 1) continue;
      for (const h of res.hiddenSpikes[t]!) {
        const a = hiddenPos[h]!;
        for (let o = 0; o < outputPos.length && n < MAX_DOTS; o++) place(a, outputPos[o]!, k, seedOut(h, o));
      }
      for (const i of res.inputSpikes[t]!) {
        const targets = inputOut[i];
        if (!targets) continue;
        const a = inputPos[i]!;
        for (const h of targets) {
          if (n >= MAX_DOTS) break;
          if (lesioned.has(h)) continue;
          place(a, hiddenPos[h]!, k, seedIn(i, h));
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
        if (glow) {
          const gs = sc * OUTPUT_RADIUS * 1.9;
          tmp.sv.set(gs, gs, gs);
          tmp.q.identity();
          glow.setMatrixAt(nH + o, tmp.m.compose(outputPos[o]!, tmp.q, tmp.sv));
        }
      }
      oMesh.instanceMatrix.needsUpdate = true;
      if (glow) glow.instanceMatrix.needsUpdate = true;
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
      useAppStore.getState().setSpiking({ done: true, prediction: res.prediction });
    }
  });

  return (
    <>
      <instancedMesh ref={dotsRef} args={[undefined, undefined, MAX_DOTS]} frustumCulled={false} renderOrder={2}>
        <sphereGeometry args={[0.007, 6, 4]} />
        <meshBasicMaterial color={FLASH} toneMapped={false} transparent opacity={0.9} depthWrite={false} />
      </instancedMesh>

      <instancedMesh
        ref={glowRef}
        args={[undefined, undefined, nH + outputPos.length]}
        frustumCulled={false}
        renderOrder={2}
        raycast={() => null}
      >
        <sphereGeometry args={[1, 8, 6]} />
        <meshBasicMaterial transparent blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
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
            {status.done ? `Brain: ${result.prediction}` : `Brain: ${status.leader} leading, ${status.spikes} spikes`}
          </Text>
          <Text position={[panelX, ANSWER_SUB_Y, LABEL_Z]} fontSize={0.05} color="#f3e2d7" anchorX="center" anchorY="middle">
            {status.done
              ? `decided at step ${result.decisionStep} · ${result.synapticEvents.toLocaleString("en-US")} calculations`
              : `step ${status.step}/${SNN_T}`}
          </Text>
          <Text position={[panelX, ANSWER_SUB_Y - 0.13, LABEL_Z]} fontSize={0.045} color="#f3e2d7" anchorX="center" anchorY="middle">
            Spikes: each neuron fires pulses over time.
          </Text>
        </>
      )}
    </>
  );
}
