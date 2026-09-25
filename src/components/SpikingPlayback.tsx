import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import * as THREE from "three";

import { OUTPUT_RADIUS } from "@/lib/layout";
import { SNN_T, simulate, type SnnResult } from "@/lib/snn";
import { useAppStore } from "@/lib/store";
import type { Weights } from "@/lib/weights";

const STEP_MS = 50;
const FLASH_MS = 120;
const TRAVEL_STEPS = 2;
const MAX_DOTS = 800;
const FLASH = new THREE.Color("#ffd9a8");
const BAR_MAX = 0.32;
const BAR_H = 0.03;

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

  const tmp = useMemo(
    () => ({
      full: new THREE.Color(color),
      base: new THREE.Color(color).multiplyScalar(dim),
      inBase: new THREE.Color(color).multiplyScalar(inputOff),
      c: new THREE.Color(),
      m: new THREE.Matrix4(),
      v: new THREE.Vector3(),
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
    setResult(simulate(img, weights, new Set<number>()));
    useAppStore.getState().setSpiking({ done: false, prediction: null });
  }, [runId, weights]);

  // Start (or restart) playback.
  useEffect(() => {
    if (!result) return;
    clock.current = 0;
    lastStep.current = -1;
    setStatus({ step: 0, leader: result.leader[0] ?? 0, done: false });
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
    if (hMesh) {
      for (let i = 0; i < hiddenPos.length; i++) {
        tmp.c.copy(tmp.base).lerp(FLASH, tmp.hidden[i]!);
        hMesh.setColorAt(i, tmp.c);
      }
      if (hMesh.instanceColor) hMesh.instanceColor.needsUpdate = true;
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
    const place = (a: THREE.Vector3, b: THREE.Vector3, k: number) => {
      tmp.v.copy(a).lerp(b, k);
      tmp.v.z += 0.01;
      tmp.m.makeTranslation(tmp.v.x, tmp.v.y, tmp.v.z);
      dots.setMatrixAt(n++, tmp.m);
    };
    for (let t = Math.max(0, Math.floor(p) - TRAVEL_STEPS); t <= Math.floor(p) && t < SNN_T && n < MAX_DOTS; t++) {
      const k = (p - t) / TRAVEL_STEPS;
      if (k < 0 || k > 1) continue;
      for (const h of res.hiddenSpikes[t]!) {
        const a = hiddenPos[h]!;
        for (let o = 0; o < outputPos.length && n < MAX_DOTS; o++) place(a, outputPos[o]!, k);
      }
      for (const i of res.inputSpikes[t]!) {
        const targets = inputOut[i];
        if (!targets) continue;
        const a = inputPos[i]!;
        for (const h of targets) {
          if (n >= MAX_DOTS) break;
          place(a, hiddenPos[h]!, k);
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
    for (let o = 0; o < outputPos.length; o++) {
      const bar = barRefs.current[o];
      if (!bar) continue;
      const len = Math.max(0.0001, (counts[o]! / maxC) * BAR_MAX);
      bar.scale.x = len;
      bar.position.x = outputPos[o]!.x + OUTPUT_RADIUS + 0.03 + len / 2;
      const mat = bar.material as THREE.MeshBasicMaterial;
      mat.color.copy(o === leader ? FLASH : tmp.full);
      mat.opacity = o === leader ? 1 : 0.45;
    }

    if (cur !== lastStep.current || finished) {
      lastStep.current = cur;
      setStatus({ step: cur + 1, leader, done: p >= SNN_T });
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

      {result &&
        outputPos.map((pos, o) => (
          <mesh
            key={o}
            ref={(m) => {
              barRefs.current[o] = m;
            }}
            position={[pos.x + OUTPUT_RADIUS + 0.03, pos.y, 0]}
            scale={[0.0001, 1, 1]}
            renderOrder={2}
          >
            <boxGeometry args={[1, BAR_H, 0.005]} />
            <meshBasicMaterial color={color} transparent opacity={0.45} toneMapped={false} />
          </mesh>
        ))}

      {result && status && (
        <group position={[panelX, 1, 0.02]}>
          <mesh position={[0, 0, -0.018]} renderOrder={1}>
            <planeGeometry args={[1.35, 0.3]} />
            <meshBasicMaterial color="#05060a" transparent opacity={0.72} depthWrite={false} />
          </mesh>
          <Text position={[0, 0.05, 0]} fontSize={status.done ? 0.07 : 0.065} color={color} anchorX="center" anchorY="middle" renderOrder={2}>
            {status.done
              ? `Spiking answer: ${result.prediction} (decided at step ${result.decisionStep})`
              : `Thinking... step ${status.step}/${SNN_T}, leader: ${status.leader}`}
          </Text>
          <Text position={[0, -0.065, 0]} fontSize={0.045} color="#f3e2d7" anchorX="center" anchorY="middle" renderOrder={2}>
            {status.done
              ? `${SNN_T} steps · ${result.synapticEvents.toLocaleString("en-US")} calculations`
              : " "}
          </Text>
        </group>
      )}
    </>
  );
}
