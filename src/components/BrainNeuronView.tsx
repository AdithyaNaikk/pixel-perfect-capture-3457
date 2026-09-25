import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { BRAIN_MODEL_POS, BRAIN_URL, NEURON_URL, NeuronPlaceholder, SafeModel } from "./Models";
import {
  AXON_GUIDE,
  DENDRITE_GUIDES,
  HILLOCK_POINT,
  NEURON_SCALE,
  NEURON_SIZE,
  SOMA_POINT,
  TERMINAL_POINTS,
  axonCurve,
  dendriteCurves,
} from "@/lib/brainGuides";
import { SPIKE_COLOR } from "@/lib/layout";
import { simulate, SNN_T, type SnnResult } from "@/lib/snn";
import { useAppStore } from "@/lib/store";
import type { Weights } from "@/lib/weights";

const STEP_MS = 50;
const MAX_PULSES = 150;
const PULSE_STEPS = 3;
const AXON_STEPS = 3;
const AXON_NODES = 6;
const PARTICLES = 20;
const END = SNN_T + AXON_STEPS + 1;
const WARM = new THREE.Color(SPIKE_COLOR);
const COOL = new THREE.Color("#5aa8ff");
const FIRE = new THREE.Color("#fff4b0");
const SOMA_GLOW = new THREE.Color("#ff7fd4");
const LESION = new THREE.Color("#3a3a40");
const IPS_COLOR = new THREE.Color("#ffe066");
const BAR_IDLE = new THREE.Color("#76516f");
const SCOPE_W = 1.1;
const SCOPE_H = 0.32;

interface Status {
  step: number;
  done: boolean;
}

interface Runs {
  damaged: SnnResult;
  healthy: SnnResult;
  /** Output neuron shown: the winning output neuron of this (possibly damaged) run. */
  shown: number;
  lesioned: Set<number>;
}

function glowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.45)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function glowMat(tex: THREE.Texture, color: THREE.Color, opacity = 1) {
  return new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
}

export function BrainNeuronView({ weights, centerX }: { weights: Weights; centerX: number }) {
  const runId = useAppStore((s) => s.runId);
  const replayId = useAppStore((s) => s.replayId);
  const debug = useAppStore((s) => s.debugGuides);
  const [runs, setRuns] = useState<Runs | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const clock = useRef<number | null>(null);
  const lastStep = useRef(-1);

  const tex = useMemo(() => glowTexture(), []);
  const dCurves = useMemo(() => dendriteCurves(), []);
  const aCurve = useMemo(() => axonCurve(), []);
  const mats = useMemo(
    () => ({
      soma: glowMat(tex, SOMA_GLOW, 0.4),
      hillock: glowMat(tex, FIRE, 0),
      terminal: glowMat(tex, FIRE, 0),
      axon: glowMat(tex, FIRE, 1),
      pulses: new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      particles: glowMat(tex, FIRE, 1),
      ips: new THREE.MeshBasicMaterial({ color: IPS_COLOR, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    }),
    [tex],
  );
  useEffect(() => () => { tex.dispose(); Object.values(mats).forEach((m) => m.dispose()); }, [tex, mats]);

  const somaRef = useRef<THREE.Mesh>(null);
  const hillockRef = useRef<THREE.Mesh>(null);
  const terminalRef = useRef<THREE.Mesh>(null);
  const axonRef = useRef<THREE.Mesh>(null);
  const pulseRef = useRef<THREE.InstancedMesh>(null);
  const particleRef = useRef<THREE.InstancedMesh>(null);
  const pathwayRef = useRef<THREE.InstancedMesh>(null);
  const barRefs = useRef<(THREE.Mesh | null)[]>([]);
  const scopeLine = useRef<THREE.Line>(null);
  const scopeSpikes = useRef<THREE.LineSegments>(null);

  // Pathway entry for each of the 64 hidden neurons: dendrite and start position along it.
  const pathways = useMemo(
    () => Array.from({ length: 64 }, (_, h) => ({ d: h % DENDRITE_GUIDES.length, t0: 0.05 + (Math.floor(h / DENDRITE_GUIDES.length) / 8) * 0.6 })),
    [],
  );
  const pathwayPos = useMemo(() => pathways.map((p) => dCurves[p.d]!.getPoint(p.t0)), [pathways, dCurves]);
  const axonNodes = useMemo(() => Array.from({ length: AXON_NODES }, (_, i) => aCurve.getPoint(i / (AXON_NODES - 1))), [aCurve]);

  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), v: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3(), c: new THREE.Color() }), []);

  // Run both simulations (with the shared lesion mask, and healthy) whenever a run starts.
  useEffect(() => {
    const image = useAppStore.getState().inputImage;
    if (runId === 0 || !image) return;
    const lesioned = new Set(useAppStore.getState().lesioned);
    const damaged = simulate(image, weights, lesioned);
    const healthy = lesioned.size > 0 ? simulate(image, weights, new Set()) : damaged;
    setRuns({ damaged, healthy, shown: damaged.prediction, lesioned });
    useAppStore.getState().setSpiking({ done: false, prediction: null });
    useAppStore.getState().setBrainCounts(null);
  }, [runId, weights]);

  useEffect(() => {
    if (!runs) return;
    clock.current = 0;
    lastStep.current = -1;
    setStatus({ step: 0, done: false });
  }, [runs, replayId]);

  // Pathway markers: warm/cool by weight sign, grey when lesioned or unconnected.
  useEffect(() => {
    const mesh = pathwayRef.current;
    if (!mesh) return;
    const row = runs ? weights.w2[runs.shown] : undefined;
    for (let h = 0; h < 64; h++) {
      const p = pathwayPos[h]!;
      tmp.m.makeTranslation(p.x, p.y, 0.02);
      mesh.setMatrixAt(h, tmp.m);
      const w = row?.[h] ?? 0;
      if (runs?.lesioned.has(h) || !row || w === 0) tmp.c.copy(LESION);
      else tmp.c.copy(w > 0 ? WARM : COOL).multiplyScalar(0.55);
      mesh.setColorAt(h, tmp.c);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [runs, weights, pathwayPos, tmp]);

  useFrame(({ clock: time }, rawDelta) => {
    const soma = somaRef.current;
    const pulses = pulseRef.current;
    if (!runs || !soma || !pulses) return;
    const res = runs.damaged;
    const shown = runs.shown;
    let p = clock.current ?? END;
    if (clock.current !== null) {
      const speed = useAppStore.getState().speed;
      p = Math.min(clock.current + ((Math.min(rawDelta, 0.05) * 1000) / STEP_MS) * speed, END);
      clock.current = p;
    }
    const cur = Math.min(Math.floor(p), SNN_T - 1);
    const frac = Math.min(1, p - Math.floor(p));
    const threshold = weights.snn?.threshold ?? 1;
    const done = p >= SNN_T;

    // Most recent spike of the shown neuron.
    let spikeAge = 99;
    for (let t = Math.max(0, cur - 8); t <= cur; t++) if (res.outputSpikes[t]?.includes(shown)) spikeAge = p - t;

    // Soma glow follows the membrane potential (leaks between pulses), flashes on spikes, dips after.
    const vPrev = cur > 0 ? (res.outputPotentials[cur - 1]?.[shown] ?? 0) : 0;
    const vNow = res.outputPotentials[cur]?.[shown] ?? 0;
    const v = (vPrev + (vNow - vPrev) * frac) / threshold;
    const flash = Math.max(0, 1 - spikeAge / 1.5);
    const refractory = spikeAge > 1.5 && spikeAge < 4 ? 1 - (spikeAge - 1.5) / 2.5 : 0;
    const rest = 0.35;
    const bright = Math.max(0.05, rest + Math.max(-0.5, Math.min(1, v)) * 0.55 - refractory * 0.22 + flash);
    mats.soma.opacity = Math.min(1, bright);
    mats.soma.color.copy(SOMA_GLOW).lerp(FIRE, flash);
    soma.scale.setScalar(0.34 + Math.max(0, v) * 0.08 + flash * 0.22);
    mats.hillock.opacity = Math.max(0, 1 - spikeAge / 0.8);

    // Axon: pulse jumps node to node (saltatory), terminals flash with particles.
    const axon = axonRef.current;
    if (axon) {
      const k = spikeAge / AXON_STEPS;
      axon.visible = k >= 0 && k < 1;
      if (axon.visible) axon.position.copy(axonNodes[Math.min(AXON_NODES - 1, Math.floor(k * AXON_NODES))]!);
    }
    const termAge = spikeAge - AXON_STEPS;
    mats.terminal.opacity = termAge >= 0 ? Math.max(0, 1 - termAge / 1.5) : 0;
    const particles = particleRef.current;
    if (particles) {
      let n = 0;
      if (termAge >= 0 && termAge < 1.5) {
        const r = termAge * 0.06;
        for (let i = 0; i < PARTICLES; i++) {
          const tp = TERMINAL_POINTS[i % TERMINAL_POINTS.length]!;
          const a = i * 2.39996;
          tmp.m.makeScale(0.03, 0.03, 0.03).setPosition(tp[0] + Math.cos(a) * r, tp[1] + Math.sin(a) * r, 0.03);
          particles.setMatrixAt(n++, tmp.m);
        }
      }
      particles.count = n;
      particles.instanceMatrix.needsUpdate = true;
    }

    // Dendrite pulses from real hidden spikes weighted into the shown neuron.
    const row = weights.w2[shown]!;
    let maxW = 1e-6;
    for (const w of row) maxW = Math.max(maxW, Math.abs(w));
    let n = 0;
    for (let t = Math.min(cur, Math.floor(p)); t >= 0 && t > p - PULSE_STEPS - 1 && n < MAX_PULSES; t--) {
      const age = p - t;
      if (age < 0 || age > PULSE_STEPS) continue;
      for (const h of res.hiddenSpikes[t] ?? []) {
        if (n >= MAX_PULSES) break;
        const w = row[h] ?? 0;
        if (w === 0 || runs.lesioned.has(h)) continue;
        const pw = pathways[h]!;
        dCurves[pw.d]!.getPoint(pw.t0 + (1 - pw.t0) * (age / PULSE_STEPS), tmp.v);
        const size = 0.04 + 0.07 * (Math.abs(w) / maxW);
        tmp.s.set(size, size, size);
        tmp.v.z = 0.04;
        tmp.m.compose(tmp.v, tmp.q, tmp.s);
        pulses.setMatrixAt(n, tmp.m);
        pulses.setColorAt(n, w > 0 ? WARM : COOL);
        n++;
      }
    }
    pulses.count = n;
    pulses.instanceMatrix.needsUpdate = true;
    if (pulses.instanceColor) pulses.instanceColor.needsUpdate = true;


    // Bars: live counts; winner highlighted only once the brain has decided (end of playback).
    const counts = res.counts[cur];
    let maxFinal = 1;
    for (const c of res.counts[SNN_T - 1] ?? []) maxFinal = Math.max(maxFinal, c);
    for (let o = 0; o < 10; o++) {
      const bar = barRefs.current[o];
      if (!bar) continue;
      const h = Math.max(0.004, ((counts?.[o] ?? 0) / maxFinal) * 0.5);
      bar.scale.y = h;
      bar.position.y = h / 2;
      (bar.material as THREE.MeshBasicMaterial).color.copy(done && !res.noAnswer && o === res.prediction ? WARM : BAR_IDLE);
    }

    // IPS patches flash with each spike and stay softly lit once revealed.
    mats.ips.opacity = Math.min(1, (debug ? 0.3 : 0) + Math.max(done ? 0.4 + Math.sin(time.elapsedTime * 2) * 0.05 : 0.02, flash * 0.95));

    if (cur !== lastStep.current || (done && !status?.done)) {
      lastStep.current = cur;
      setStatus({ step: cur + 1, done });
    }
    if (clock.current !== null && p >= END) {
      clock.current = null;
      useAppStore.getState().setSpiking({ done: true, prediction: res.noAnswer ? null : res.prediction });
      useAppStore.getState().setBrainCounts(Array.from(res.counts[SNN_T - 1] ?? []));
    }
  });

  const res = runs?.damaged;
  const done = !!status?.done;
  const answer = !res || !done ? "..." : res.noAnswer ? "?" : String(res.prediction);
  const healthySpikes = runs ? (runs.healthy.counts[SNN_T - 1]?.[runs.shown] ?? 0) : 0;
  const damagedSpikes = runs ? (runs.damaged.counts[SNN_T - 1]?.[runs.shown] ?? 0) : 0;
  const liveSpikes = runs && status ? (runs.damaged.counts[Math.max(0, status.step - 1)]?.[runs.shown] ?? 0) : 0;

  const NEURON_POS: [number, number, number] = [centerX, 1.62, -2.2];
  const HEAD: [number, number, number] = [centerX + 1.2, 0.55, -2.2];

  return (
    <group name="brain-single-neuron">
      <group position={NEURON_POS}>
        {/* The provided neuron.glb, unchanged; effects are layered on top. */}
        <SafeModel url={NEURON_URL} size={NEURON_SIZE} fallback={<NeuronPlaceholder />} />
        <group scale={NEURON_SCALE}>
          <mesh ref={somaRef} position={[SOMA_POINT[0], SOMA_POINT[1], 0.05]} material={mats.soma} renderOrder={3} raycast={() => null}>
            <planeGeometry args={[1, 1]} />
          </mesh>
          <mesh ref={hillockRef} position={[HILLOCK_POINT[0], HILLOCK_POINT[1], 0.05]} scale={0.18} material={mats.hillock} renderOrder={3} raycast={() => null}>
            <planeGeometry args={[1, 1]} />
          </mesh>
          <mesh ref={terminalRef} position={[0.72, -0.44, 0.05]} scale={0.5} material={mats.terminal} renderOrder={3} raycast={() => null}>
            <planeGeometry args={[1, 1]} />
          </mesh>
          <mesh ref={axonRef} scale={0.14} material={mats.axon} visible={false} renderOrder={4} raycast={() => null}>
            <planeGeometry args={[1, 1]} />
          </mesh>
          <instancedMesh ref={pulseRef} args={[undefined, undefined, MAX_PULSES]} material={mats.pulses} frustumCulled={false} renderOrder={4} raycast={() => null}>
            <planeGeometry args={[1, 1]} />
          </instancedMesh>
          <instancedMesh ref={particleRef} args={[undefined, undefined, PARTICLES]} material={mats.particles} frustumCulled={false} renderOrder={4} raycast={() => null}>
            <planeGeometry args={[1, 1]} />
          </instancedMesh>
          <instancedMesh ref={pathwayRef} args={[undefined, undefined, 64]} frustumCulled={false} renderOrder={3} raycast={() => null}>
            <sphereGeometry args={[0.012, 6, 4]} />
            <meshBasicMaterial toneMapped={false} />
          </instancedMesh>
          {debug && <Guides curves={[...dCurves, aCurve]} />}
        </group>
      </group>

      {/* Faint brain model; the IPS strips are its children so they follow its transform. */}
      <group position={BRAIN_MODEL_POS}>
        <SafeModel url={BRAIN_URL} size={1.15} opacity={0.35} desaturate>
          {(dims) => <IpsStrips dims={dims} material={mats.ips} debug={debug} />}
        </SafeModel>
      </group>

      {/* Output spike counts for all 10 output neurons. */}
      <group position={[centerX - 1.45, 1.0, -2.2]}>
        {Array.from({ length: 10 }, (_, o) => (
          <group key={o} position={[(o - 4.5) * 0.075, 0, 0]}>
            <mesh ref={(m) => { barRefs.current[o] = m; }} scale={[1, 0.004, 1]}>
              <boxGeometry args={[0.045, 1, 0.045]} />
              <meshBasicMaterial color={BAR_IDLE} toneMapped={false} />
            </mesh>
            <Text position={[0, -0.05, 0]} fontSize={0.045} color="#d7c5d2" anchorX="center" anchorY="middle">{String(o)}</Text>
          </group>
        ))}
        <Text position={[0, -0.12, 0]} fontSize={0.045} color="#ffc2ea" anchorX="center" anchorY="middle">output spikes</Text>
      </group>

      <HeadAndThought position={HEAD} answer={answer} />

      <Text position={[centerX, 3.35, -2.2]} fontSize={0.22} color="#ff5fc8" anchorX="center" anchorY="middle">Brain network</Text>
      <Text position={[centerX, 3.05, -2.2]} fontSize={0.3} color="#ffb070" anchorX="center" anchorY="middle">{`Brain: ${answer}`}</Text>
      {res && status && (
        <>
          <Text position={[centerX, 2.83, -2.2]} fontSize={0.05} color="#f3e2d7" anchorX="center" anchorY="middle">
            {done
              ? res.noAnswer
                ? `no answer · ${res.synapticEvents.toLocaleString("en-US")} calculations`
                : `${Math.round(res.confidence * 100)}% confidence · ${res.synapticEvents.toLocaleString("en-US")} calculations`
              : `step ${status.step}/${SNN_T} · ${liveSpikes} fires`}
          </Text>
          {done && runs && runs.lesioned.size > 0 && (
            <Text position={[centerX, 2.7, -2.2]} fontSize={0.05} color="#ff8899" anchorX="center" anchorY="middle">
              {`healthy: ${healthySpikes} spikes / damaged: ${damagedSpikes} spikes`}
            </Text>
          )}
        </>
      )}
      <Text position={[centerX, 0.3, -2.2]} maxWidth={2.1} fontSize={0.05} lineHeight={1.3} color="#d9bfd3" textAlign="center" anchorX="center" anchorY="middle">
        Output neuron of the brain-style network. The network behind it is running, just hidden.
      </Text>
    </group>
  );
}

function Guides({ curves }: { curves: THREE.CatmullRomCurve3[] }) {
  const geos = useMemo(() => curves.map((c) => new THREE.BufferGeometry().setFromPoints(c.getPoints(24))), [curves]);
  useEffect(() => () => geos.forEach((g) => g.dispose()), [geos]);
  return (
    <group position={[0, 0, 0.06]}>
      {geos.map((g, i) => (
        // @ts-expect-error three line element
        <line key={i} geometry={g}>
          <lineBasicMaterial color={i === geos.length - 1 ? "#00ffff" : "#00ff88"} depthTest={false} />
        </line>
      ))}
      <mesh position={SOMA_POINT}><sphereGeometry args={[0.03, 8, 6]} /><meshBasicMaterial color="#ffff00" depthTest={false} /></mesh>
      <mesh position={HILLOCK_POINT}><sphereGeometry args={[0.025, 8, 6]} /><meshBasicMaterial color="#ff8800" depthTest={false} /></mesh>
      {AXON_GUIDE.length > 0 && null}
    </group>
  );
}

function HeadAndThought({ answer, position }: { answer: string; position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.35, 0]}>
        <sphereGeometry args={[0.16, 10, 8]} />
        <meshBasicMaterial color="#d8b6c8" />
      </mesh>
      <mesh position={[0, 0.05, 0]}>
        <capsuleGeometry args={[0.12, 0.28, 4, 8]} />
        <meshBasicMaterial color="#704c73" />
      </mesh>
      <group position={[0.1, 0.9, 0]}>
        <mesh>
          <sphereGeometry args={[0.25, 12, 8]} />
          <meshBasicMaterial color="#fff1f7" transparent opacity={0.92} />
        </mesh>
        <mesh position={[-0.08, -0.3, 0]}>
          <sphereGeometry args={[0.05, 8, 6]} />
          <meshBasicMaterial color="#fff1f7" transparent opacity={0.92} />
        </mesh>
        <Text position={[0, 0, 0.255]} fontSize={0.18} color="#3a2440" anchorX="center" anchorY="middle">{answer}</Text>
      </group>
    </group>
  );
}

/**
 * Intraparietal sulcus: a thin curved strip on each hemisphere along the upper back of the brain,
 * running front (+Z) to back (−Z), hugging the surface of the fitted model's bounding ellipsoid.
 */
function IpsStrips({ dims, material, debug }: { dims: THREE.Vector3; material: THREE.Material; debug: boolean }) {
  const geos = useMemo(() => {
    const rx = dims.x / 2, ry = dims.y / 2, rz = dims.z / 2;
    return [-1, 1].map((side) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 12; i++) {
        // From just behind the top centre toward the upper back.
        const a = THREE.MathUtils.lerp(-0.05, 0.95, i / 12);
        const xN = side * 0.38;
        const yz = Math.sqrt(Math.max(0, 1 - xN * xN)) * 1.01;
        pts.push(new THREE.Vector3(xN * rx, Math.cos(a) * yz * ry, -Math.sin(a) * yz * rz));
      }
      return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 32, Math.min(rx, ry) * 0.035, 5, false);
    });
  }, [dims]);
  useEffect(() => () => geos.forEach((g) => g.dispose()), [geos]);
  return (
    <>
      {geos.map((g, i) => (
        <mesh key={i} geometry={g} material={material} renderOrder={5} raycast={() => null} />
      ))}
      {debug && geos.map((g, i) => (
        <mesh key={`d${i}`} geometry={g} raycast={() => null}>
          <meshBasicMaterial color="#00ff88" wireframe />
        </mesh>
      ))}
    </>
  );
}
