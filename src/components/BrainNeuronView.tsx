import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { BrainEye } from "./BrainEye";
import { createNeuronGeometry, EYE_Y, eyeRetinaPositions } from "@/lib/brainGeometry";
import { INPUT_CUBE_SIZE, INACTIVE_COLOR, SPIKE_COLOR } from "@/lib/layout";
import { simulate, SNN_T, type SnnResult } from "@/lib/snn";
import { useAppStore } from "@/lib/store";
import type { Weights } from "@/lib/weights";

const STEP_MS = 50;
const MAX_PULSES = 40;
const SOMA: [number, number, number] = [2.4, 1.55, -2.35];
const HEAD: [number, number, number] = [2.4, 1.35, -4.25];
const REST = new THREE.Color("#34345c");
const CHARGED = new THREE.Color("#d987d1");
const FIRE = new THREE.Color("#fff4a8");
const WARM = new THREE.Color(SPIKE_COLOR);
const COOL = new THREE.Color("#66baff");
const BAR_IDLE = new THREE.Color("#76516f");
const RECEPTOR_BRIGHT = new THREE.Color("#ffd6f2");
const RECEPTOR_IDLE = new THREE.Color(INACTIVE_COLOR);

interface Status {
  step: number;
  fired: number;
  revealed: boolean;
}

interface PulseEvent {
  step: number;
  dendrite: number;
  weight: number;
}

function dendritePoint(index: number, t: number, out: THREE.Vector3) {
  const angle = (index / 6) * Math.PI * 2 + 0.25;
  const startX = SOMA[0] + Math.cos(angle) * 0.72;
  const startY = SOMA[1] + Math.sin(angle) * 0.6;
  const startZ = SOMA[2] + 0.85;
  const u = 1 - t;
  return out.set(
    u * u * startX + 2 * u * t * (SOMA[0] + Math.cos(angle) * 0.38) + t * t * SOMA[0],
    u * u * startY + 2 * u * t * (SOMA[1] + Math.sin(angle) * 0.3) + t * t * SOMA[1],
    u * u * startZ + 2 * u * t * (SOMA[2] + 0.38) + t * t * SOMA[2],
  );
}

function axonPoint(t: number, out: THREE.Vector3) {
  const u = 1 - t;
  return out.set(
    SOMA[0] + Math.sin(t * Math.PI) * 0.08,
    u * SOMA[1] + t * (HEAD[1] + 0.18),
    u * SOMA[2] + t * HEAD[2],
  );
}

export function BrainNeuronView({ weights, centerX }: { weights: Weights; centerX: number }) {
  const runId = useAppStore((s) => s.runId);
  const replayId = useAppStore((s) => s.replayId);
  const [result, setResult] = useState<SnnResult | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const clock = useRef<number | null>(null);
  const somaRef = useRef<THREE.Mesh>(null);
  const receptorRef = useRef<THREE.InstancedMesh>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  const pulseRef = useRef<THREE.InstancedMesh>(null);
  const axonPulseRef = useRef<THREE.Mesh>(null);
  const barRefs = useRef<(THREE.Mesh | null)[]>([]);
  const lastStep = useRef(-1);
  const neuronGeometry = useMemo(() => createNeuronGeometry(0.22), []);
  const receptorPositions = useMemo(() => eyeRetinaPositions(centerX), [centerX]);
  const pulseEvents = useMemo<PulseEvent[]>(() => {
    if (!result) return [];
    const out: PulseEvent[] = [];
    const winner = result.prediction;
    const row = weights.w2[winner];
    if (!row) return out;
    for (let step = 0; step < result.hiddenSpikes.length; step++) {
      const spikes = result.hiddenSpikes[step];
      if (!spikes) continue;
      for (const hidden of spikes) {
        const weight = row[hidden] ?? 0;
        if (weight !== 0) out.push({ step, dendrite: hidden % 6, weight });
      }
    }
    return out;
  }, [result, weights]);
  const maxWeight = useMemo(() => {
    let max = 0;
    for (const pulse of pulseEvents) max = Math.max(max, Math.abs(pulse.weight));
    return max || 1;
  }, [pulseEvents]);
  const tmp = useMemo(() => ({
    color: new THREE.Color(),
    matrix: new THREE.Matrix4(),
    position: new THREE.Vector3(),
    scale: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
  }), []);

  useEffect(() => () => neuronGeometry.dispose(), [neuronGeometry]);

  useEffect(() => {
    const mesh = receptorRef.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < receptorPositions.length; i++) {
      const position = receptorPositions[i];
      if (!position) continue;
      matrix.makeTranslation(position.x, position.y, position.z);
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, RECEPTOR_IDLE);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [receptorPositions]);

  useEffect(() => {
    const image = useAppStore.getState().inputImage;
    if (runId === 0 || !image) return;
    setResult(simulate(image, weights, useAppStore.getState().lesioned));
    useAppStore.getState().setSpiking({ done: false, prediction: null });
  }, [runId, weights]);

  useEffect(() => {
    if (!result) return;
    clock.current = 0;
    lastStep.current = -1;
    setStatus({ step: 0, fired: 0, revealed: false });
  }, [result, replayId]);

  useFrame((_, rawDelta) => {
    const res = result;
    const soma = somaRef.current;
    const halo = haloRef.current;
    const pulses = pulseRef.current;
    const axonPulse = axonPulseRef.current;
    if (!res || clock.current === null || !soma || !halo || !pulses || !axonPulse) return;
    const speed = useAppStore.getState().speed;
    const p = Math.min(clock.current + ((Math.min(rawDelta, 0.05) * 1000) / STEP_MS) * speed, SNN_T + 2.4);
    clock.current = p;
    const cur = Math.min(Math.floor(p), SNN_T - 1);
    const winner = res.prediction;
    const potentials = res.outputPotentials[cur];
    const threshold = weights.snn?.threshold ?? 1;
    const charge = Math.max(0, Math.min(1, (potentials?.[winner] ?? 0) / threshold));
    let spikeAge = 99;
    for (let t = Math.max(0, cur - 3); t <= cur; t++) {
      if (res.outputSpikes[t]?.includes(winner)) spikeAge = Math.min(spikeAge, p - t);
    }
    const flash = Math.max(0, 1 - spikeAge / 2.4);
    const material = soma.material as THREE.MeshBasicMaterial;
    material.color.copy(REST).lerp(CHARGED, charge).lerp(FIRE, flash);

    const receptors = receptorRef.current;
    const image = useAppStore.getState().inputImage;
    if (receptors) {
      for (let input = 0; input < receptorPositions.length; input++) {
        const spiked = res.inputSpikes[cur]?.includes(input) ?? false;
        tmp.color.copy(RECEPTOR_IDLE).lerp(RECEPTOR_BRIGHT, image?.[input] ?? 0);
        if (spiked) tmp.color.copy(WARM);
        receptors.setColorAt(input, tmp.color);
      }
      if (receptors.instanceColor) receptors.instanceColor.needsUpdate = true;
    }
    const somaScale = 1 + flash * 0.28;
    soma.scale.setScalar(somaScale);
    halo.visible = flash > 0.01;
    halo.scale.setScalar(1.15 + flash * 0.6);
    (halo.material as THREE.MeshBasicMaterial).opacity = flash * 0.35;

    let count = 0;
    for (let i = pulseEvents.length - 1; i >= 0 && count < MAX_PULSES; i--) {
      const event = pulseEvents[i];
      if (!event) continue;
      const age = p - event.step;
      if (age < 0 || age > 2) continue;
      dendritePoint(event.dendrite, age / 2, tmp.position);
      const size = 0.018 + 0.035 * Math.min(1, Math.abs(event.weight) / maxWeight);
      tmp.scale.setScalar(size);
      tmp.matrix.compose(tmp.position, tmp.quaternion, tmp.scale);
      pulses.setMatrixAt(count, tmp.matrix);
      pulses.setColorAt(count, event.weight > 0 ? WARM : COOL);
      count++;
    }
    pulses.count = count;
    pulses.instanceMatrix.needsUpdate = true;
    if (pulses.instanceColor) pulses.instanceColor.needsUpdate = true;

    if (spikeAge >= 0 && spikeAge <= 2.4) {
      axonPulse.visible = true;
      axonPoint(Math.min(1, spikeAge / 2.4), axonPulse.position);
      axonPulse.scale.setScalar(0.05 + flash * 0.025);
    } else axonPulse.visible = false;

    const counts = res.counts[cur];
    const finalCounts = res.counts[SNN_T - 1];
    let maxFinal = 1;
    if (finalCounts) for (const value of finalCounts) maxFinal = Math.max(maxFinal, value);
    for (let output = 0; output < 10; output++) {
      const bar = barRefs.current[output];
      if (!bar) continue;
      const height = Math.max(0.004, ((counts?.[output] ?? 0) / maxFinal) * 0.52);
      bar.scale.y = height;
      bar.position.y = 0.2 + height / 2;
      const revealed = !res.noAnswer && cur + 1 >= res.decisionStep;
      (bar.material as THREE.MeshBasicMaterial).color.copy(revealed && output === winner ? WARM : BAR_IDLE);
    }

    const revealed = !res.noAnswer && cur + 1 >= res.decisionStep;
    if (cur !== lastStep.current) {
      lastStep.current = cur;
      setStatus({ step: cur + 1, fired: counts?.[winner] ?? 0, revealed });
    }
    if (p >= SNN_T + 2.4) {
      clock.current = null;
      useAppStore.getState().setSpiking({ done: true, prediction: res.noAnswer ? null : winner });
    }
  });

  const answer = !result || !status ? "..." : result.noAnswer && status.step >= SNN_T ? "No answer" : status.revealed ? String(result.prediction) : "...";
  const confidence = result ? `${Math.round(result.confidence * 100)}% confidence` : "";

  return (
    <group name="brain-single-neuron">
      <BrainEye cx={centerX} />
      <instancedMesh ref={receptorRef} args={[undefined, undefined, receptorPositions.length]} frustumCulled={false} renderOrder={1} raycast={() => null}>
        <icosahedronGeometry args={[INPUT_CUBE_SIZE * 0.42, 0]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <OpticBundle />
      <mesh ref={somaRef} geometry={neuronGeometry} position={SOMA} rotation={[0, 0, 0]} renderOrder={1}>
        <meshBasicMaterial color={REST} toneMapped={false} />
      </mesh>
      <Axon />
      <mesh ref={haloRef} position={SOMA} visible={false} raycast={() => null} renderOrder={2}>
        <sphereGeometry args={[0.31, 12, 8]} />
        <meshBasicMaterial color={FIRE} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      <instancedMesh ref={pulseRef} args={[undefined, undefined, MAX_PULSES]} frustumCulled={false} renderOrder={3} raycast={() => null}>
        <sphereGeometry args={[1, 6, 4]} />
        <meshBasicMaterial vertexColors toneMapped={false} depthWrite={false} />
      </instancedMesh>
      <mesh ref={axonPulseRef} visible={false} renderOrder={3} raycast={() => null}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshBasicMaterial color={FIRE} toneMapped={false} depthWrite={false} />
      </mesh>
      <HeadAndThought answer={answer} />
      <group position={[3.34, 1.0, -2.5]}>
        {Array.from({ length: 10 }, (_, output) => (
          <group key={output} position={[(output - 4.5) * 0.105, 0, 0]}>
            <mesh ref={(mesh) => { barRefs.current[output] = mesh; }} scale={[1, 0.004, 1]}>
              <boxGeometry args={[0.055, 1, 0.055]} />
              <meshBasicMaterial color={BAR_IDLE} toneMapped={false} />
            </mesh>
            <Text position={[0, 0.12, 0]} fontSize={0.065} color="#d7c5d2" anchorX="center" anchorY="middle">{String(output)}</Text>
          </group>
        ))}
        <Text position={[0, -0.02, 0]} fontSize={0.06} color="#ffc2ea" anchorX="center" anchorY="middle">output spikes</Text>
      </group>
      <Text position={[centerX, 3.35, -2.2]} fontSize={0.22} color="#ff5fc8" anchorX="center" anchorY="middle">Brain network</Text>
      <Text position={[centerX, 3.05, -2.2]} fontSize={0.3} color="#ffb070" anchorX="center" anchorY="middle">{`Brain: ${answer}`}</Text>
      {result && status && (
        <>
          <Text position={[centerX, 2.83, -2.2]} fontSize={0.05} color="#f3e2d7" anchorX="center" anchorY="middle">
            {status.revealed ? `decided at step ${result.decisionStep} · ${result.synapticEvents.toLocaleString("en-US")} calculations` : result.noAnswer && status.step >= SNN_T ? `${result.synapticEvents.toLocaleString("en-US")} calculations` : `step ${status.step}/${SNN_T}`}
          </Text>
          <Text position={[centerX, 2.7, -2.2]} fontSize={0.045} color="#f3e2d7" anchorX="center" anchorY="middle">
            {`${status.fired} fires${status.revealed ? ` · ${confidence}` : ""}`}
          </Text>
        </>
      )}
      <Text position={[centerX, 0.34, -2.25]} maxWidth={2.1} fontSize={0.055} lineHeight={1.3} color="#d9bfd3" textAlign="center" anchorX="center" anchorY="middle">
        Output neuron of the brain-style network. The network behind it is running, just hidden.
      </Text>
    </group>
  );
}

function OpticBundle() {
  const curves = useMemo(() => Array.from({ length: 5 }, (_, i) => {
    const offset = (i - 2) * 0.035;
    return new THREE.CatmullRomCurve3([
      new THREE.Vector3(2.4 + offset, EYE_Y, -0.7),
      new THREE.Vector3(2.4 + offset * 1.8, 1.55, -1.35),
      new THREE.Vector3(2.4 + offset * 4, 1.55 + offset * 3, -1.55),
    ]);
  }), []);
  return <>{curves.map((curve, i) => (
    <mesh key={i} raycast={() => null}>
      <tubeGeometry args={[curve, 12, 0.012, 5, false]} />
      <meshBasicMaterial color="#ffc2ea" transparent opacity={0.15} depthWrite={false} />
    </mesh>
  ))}</>;
}

function Axon() {
  const curve = useMemo(() => new THREE.CatmullRomCurve3([
    new THREE.Vector3(...SOMA),
    new THREE.Vector3(SOMA[0] + 0.08, SOMA[1] - 0.04, -3.0),
    new THREE.Vector3(SOMA[0] - 0.06, SOMA[1] + 0.03, -3.65),
    new THREE.Vector3(HEAD[0], HEAD[1] + 0.18, HEAD[2]),
  ]), []);
  return (
    <mesh raycast={() => null}>
      <tubeGeometry args={[curve, 28, 0.035, 6, false]} />
      <meshBasicMaterial color="#8d73a2" toneMapped={false} />
    </mesh>
  );
}

function HeadAndThought({ answer }: { answer: string }) {
  return (
    <group position={HEAD}>
      <mesh position={[0, 0.35, 0]}>
        <sphereGeometry args={[0.16, 10, 8]} />
        <meshBasicMaterial color="#d8b6c8" />
      </mesh>
      <mesh position={[0, 0.05, 0]}>
        <capsuleGeometry args={[0.12, 0.28, 4, 8]} />
        <meshBasicMaterial color="#704c73" />
      </mesh>
      <group position={[0.28, 0.72, 0]}>
        <mesh>
          <sphereGeometry args={[0.3, 12, 8]} />
          <meshBasicMaterial color="#fff1f7" transparent opacity={0.92} />
        </mesh>
        <mesh position={[-0.22, -0.22, 0]}>
          <sphereGeometry args={[0.07, 8, 6]} />
          <meshBasicMaterial color="#fff1f7" transparent opacity={0.92} />
        </mesh>
        <Text position={[0, 0, 0.305]} fontSize={answer === "No answer" ? 0.09 : 0.18} maxWidth={0.5} color="#3a2440" anchorX="center" anchorY="middle">{answer}</Text>
      </group>
    </group>
  );
}