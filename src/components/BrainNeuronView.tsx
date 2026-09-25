import { Billboard, Text, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { Boundary, NEURON_URL, NeuronPlaceholder, useExists } from "./Models";
import { AXON_GUIDE, DENDRITE_GUIDES, HILLOCK_POINT, NEURON_SCALE, NEURON_SIZE, SOMA_POINT, axonCurve, dendriteCurves } from "@/lib/brainGuides";
import { MAX_PULSES, SOMA_PATH, buildPulseNeuron, createPulseUniforms, type PulseUniforms } from "@/lib/neuronShader";
import { brainRun, type SnnResult } from "@/lib/snn";
import { useAppStore } from "@/lib/store";
import type { Weights } from "@/lib/weights";

const STEP_MS = 40;
const IN_STEPS = 4; // incoming dendrite pulse travel time (steps)
const AXON_STEPS = 1.6; // axon pulse travel time (faster than incoming)
const TERM_STEPS = 2.5; // terminal flash
const WARM = new THREE.Vector3(1.0, 0.55, 0.22);
const COOL = new THREE.Vector3(0.25, 0.55, 1.2);
const FIRE = new THREE.Vector3(2.6, 2.4, 1.4);
const SOMA_GLOW = new THREE.Color("#ff7fd4");
const SOMA_FIRE = new THREE.Color("#fff4b0");
const BAR_IDLE = new THREE.Color("#76516f");
const BAR_WIN = new THREE.Color("#ffb070");
const NB = DENDRITE_GUIDES.length;

type Run = SnnResult & { params: { threshold: number; timesteps: number } };

interface Runs {
  damaged: Run;
  healthy: Run;
  /** Output neuron shown: the brain's answer (result.winner), or 0 when nothing fired. */
  shown: number;
  lesioned: Set<number>;
  /** Signed incoming weight per [step * NB + branch] into the shown neuron. */
  branchSum: Float32Array;
  maxBranch: number;
  /** Cumulative output counts per [step * 10 + digit]. */
  cum: Int32Array;
}

function prepare(damaged: Run, healthy: Run, weights: Weights, lesioned: Set<number>): Runs {
  const T = damaged.params.timesteps;
  const shown = damaged.winner >= 0 ? damaged.winner : 0;
  const row = weights.w2[shown]!;
  const branchSum = new Float32Array(T * NB);
  let maxBranch = 1e-6;
  const cum = new Int32Array(T * 10);
  for (let t = 0; t < T; t++) {
    for (const h of damaged.hiddenSpikes[t] ?? []) branchSum[t * NB + (h % NB)] = branchSum[t * NB + (h % NB)]! + (row[h] ?? 0);
    for (let b = 0; b < NB; b++) maxBranch = Math.max(maxBranch, Math.abs(branchSum[t * NB + b]!));
    for (let d = 0; d < 10; d++) cum[t * 10 + d] = (t > 0 ? cum[(t - 1) * 10 + d]! : 0);
    for (const d of damaged.outputSpikes[t] ?? []) cum[t * 10 + d] = cum[t * 10 + d]! + 1;
  }
  return { damaged, healthy, shown, lesioned, branchSum, maxBranch, cum };
}

export function BrainNeuronView({ weights, centerX }: { weights: Weights; centerX: number }) {
  const runId = useAppStore((s) => s.runId);
  const replayId = useAppStore((s) => s.replayId);
  const debug = useAppStore((s) => s.debugGuides);
  const [runs, setRuns] = useState<Runs | null>(null);
  const [status, setStatus] = useState<{ step: number; done: boolean } | null>(null);
  const clock = useRef<number | null>(null);
  const lastStep = useRef(-1);
  const uniforms = useMemo(() => createPulseUniforms(), []);
  const barRefs = useRef<(THREE.Mesh | null)[]>([]);
  const ipsMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: "#ffe066", transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    [],
  );
  useEffect(() => () => ipsMat.dispose(), [ipsMat]);
  const ipsLabel = useRef<THREE.Group>(null);
  const dotsRef = useRef<THREE.Object3D>(null);

  // Run the spiking network (shared lesion mask) whenever a run starts.
  useEffect(() => {
    const image = useAppStore.getState().inputImage;
    if (runId === 0 || !image) return;
    const lesioned = new Set(useAppStore.getState().lesioned);
    const damaged = brainRun(image, weights, lesioned);
    const healthy = lesioned.size > 0 ? brainRun(image, weights, new Set()) : damaged;
    setRuns(prepare(damaged, healthy, weights, lesioned));
    useAppStore.getState().setSpiking({ done: false, prediction: null });
    useAppStore.getState().setBrainCounts(null);
  }, [runId, weights]);

  useEffect(() => {
    if (!runs) return;
    clock.current = 0;
    lastStep.current = -1;
    setStatus({ step: 0, done: false });
  }, [runs, replayId]);

  useFrame(({ clock: time }, rawDelta) => {
    const u = uniforms;
    for (let i = 0; i < MAX_PULSES; i++) u.uAmp.value[i] = 0;
    if (!runs) {
      u.uSoma.value = 0.1;
      return;
    }
    const res = runs.damaged;
    const T = res.params.timesteps;
    const END = T + AXON_STEPS + TERM_STEPS;
    let p = clock.current ?? END;
    if (clock.current !== null) {
      const speed = useAppStore.getState().speed;
      p = Math.min(clock.current + ((Math.min(rawDelta, 0.05) * 1000) / STEP_MS) * speed, END);
      clock.current = p;
    }
    const cur = Math.min(Math.floor(p), T - 1);
    const frac = Math.min(1, p - Math.floor(p));
    const done = p >= T;
    const shown = runs.shown;
    const fires = res.winner >= 0;

    // Most recent spike of the shown output neuron.
    let spikeAge = 99;
    if (fires) for (let t = Math.max(0, cur - 10); t <= cur; t++) if (res.outputSpikes[t]?.includes(shown) && p - t >= 0) spikeAge = p - t;

    let n = 0;
    // Firing: bright pulse from the cell body down the axon, then the terminals flash.
    if (spikeAge < AXON_STEPS) {
      u.uPos.value[n] = SOMA_PATH + (1 - SOMA_PATH) * (spikeAge / AXON_STEPS);
      u.uWidth.value[n] = 0.06;
      u.uAmp.value[n] = 1;
      u.uBranch.value[n] = -1;
      u.uCol.value[n]!.copy(FIRE);
      n++;
    } else if (spikeAge < AXON_STEPS + TERM_STEPS) {
      u.uPos.value[n] = 1;
      u.uWidth.value[n] = 0.12;
      u.uAmp.value[n] = 1 - (spikeAge - AXON_STEPS) / TERM_STEPS;
      u.uBranch.value[n] = -1;
      u.uCol.value[n]!.copy(FIRE);
      n++;
    }

    // Incoming: one merged pulse per branch per step, travelling toward the cell body.
    for (let t = Math.min(cur, Math.floor(p)); t >= 0 && n < MAX_PULSES; t--) {
      const age = p - t;
      if (age > IN_STEPS) break;
      if (t >= T) continue;
      for (let b = 0; b < NB && n < MAX_PULSES; b++) {
        const sum = runs.branchSum[t * NB + b]!;
        if (sum === 0) continue;
        u.uPos.value[n] = SOMA_PATH * (age / IN_STEPS);
        u.uWidth.value[n] = 0.045;
        u.uAmp.value[n] = 0.35 + 0.65 * Math.min(1, Math.abs(sum) / runs.maxBranch);
        u.uBranch.value[n] = b;
        u.uCol.value[n]!.copy(sum > 0 ? WARM : COOL);
        n++;
      }
    }

    // Cell body glow follows the membrane potential; flash on firing; dip afterwards (refractory).
    const pot = res.outputPotential;
    const vPrev = cur > 0 ? (pot[cur - 1]?.[shown] ?? 0) : 0;
    const vNow = pot[cur]?.[shown] ?? 0;
    const v = Math.max(0, Math.min(1, (vPrev + (vNow - vPrev) * frac) / res.params.threshold));
    const flash = Math.max(0, 1 - spikeAge / 1.2);
    const refr = spikeAge >= 1.2 && spikeAge < 5 ? 1 - (spikeAge - 1.2) / 3.8 : 0;
    u.uSoma.value = refr > 0 ? -0.35 * refr : 0.08 + 0.6 * v + 2.2 * flash;
    u.uSomaCol.value.copy(SOMA_GLOW).lerp(SOMA_FIRE, flash);

    // Live output spike-count bars; winner highlighted only once decided.
    let maxFinal = 1;
    for (const c of res.outputCounts) maxFinal = Math.max(maxFinal, c);
    for (let o = 0; o < 10; o++) {
      const bar = barRefs.current[o];
      if (!bar) continue;
      const h = Math.max(0.004, ((runs.cum[cur * 10 + o] ?? 0) / maxFinal) * 0.5);
      bar.scale.y = h;
      bar.position.y = h / 2;
      (bar.material as THREE.MeshBasicMaterial).color.copy(done && fires && o === res.winner ? BAR_WIN : BAR_IDLE);
    }

    // Intraparietal sulcus: flashes with each spike, softly lit once revealed.
    const ips = Math.max(flash * 0.95, done && fires ? 0.45 + Math.sin(time.elapsedTime * 2) * 0.05 : 0);
    ipsMat.opacity = ips;
    if (ipsLabel.current) ipsLabel.current.visible = ips > 0.05;

    // Animated "..." while thinking.
    if (dotsRef.current) dotsRef.current.visible = !done;

    if (cur !== lastStep.current || (done && !status?.done)) {
      lastStep.current = cur;
      setStatus({ step: cur + 1, done });
    }
    if (clock.current !== null && p >= END) {
      clock.current = null;
      useAppStore.getState().setSpiking({ done: true, prediction: fires ? res.winner : null });
      useAppStore.getState().setBrainCounts([...res.outputCounts]);
    }
  });

  const res = runs?.damaged;
  const done = !!status?.done;
  const answer = !res ? "" : !done ? "..." : res.winner < 0 ? "?" : String(res.winner);
  const total = res ? res.outputCounts.reduce((a, b) => a + b, 0) : 0;
  const confidence = res && res.winner >= 0 && total > 0 ? res.outputCounts[res.winner]! / total : 0;
  const healthySpikes = runs ? (runs.healthy.outputCounts[runs.shown] ?? 0) : 0;
  const damagedSpikes = runs ? (runs.damaged.outputCounts[runs.shown] ?? 0) : 0;

  const NEURON_POS: [number, number, number] = [centerX, 1.62, -2.2];
  const HEAD_POS: [number, number, number] = [centerX + 1.05, 0.95, -2.2];
  // Face the user's start position (0, 1.6, 3).
  const headYaw = Math.atan2(0 - HEAD_POS[0], 3 - HEAD_POS[2]);

  return (
    <group name="brain-single-neuron">
      <group position={NEURON_POS}>
        <PulseNeuronModel uniforms={uniforms} />
        {debug && (
          <group scale={NEURON_SCALE}>
            <Guides />
          </group>
        )}
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

      <group position={HEAD_POS} rotation={[0, headYaw, 0]}>
        <GlassHead />
        <group position={[0, 0.2, 0]}>
          <ProceduralBrain ipsMat={ipsMat} />
          <group ref={ipsLabel} visible={false} position={[0, 0.13, 0]}>
            <Billboard>
              <Text fontSize={0.022} color="#ffe066" anchorX="center" anchorY="middle" outlineWidth={0.002} outlineColor="#05060a">
                Intraparietal sulcus: number meaning
              </Text>
            </Billboard>
          </group>
        </group>
      </group>
      <ThoughtBubble position={[HEAD_POS[0], HEAD_POS[1] + 0.34, HEAD_POS[2]]} answer={answer} dotsRef={dotsRef} />

      <Text position={[centerX, 3.35, -2.2]} fontSize={0.22} color="#ff5fc8" anchorX="center" anchorY="middle">Brain network</Text>
      {res && status && (
        <>
          <Text position={[centerX, 2.83, -2.2]} fontSize={0.05} color="#f3e2d7" anchorX="center" anchorY="middle">
            {done
              ? res.winner < 0
                ? "no answer: no output neuron fired"
                : `${Math.round(confidence * 100)}% confidence · ${total} output spikes`
              : `step ${status.step}/${res.params.timesteps}`}
          </Text>
          {done && runs && runs.lesioned.size > 0 && (
            <Text position={[centerX, 2.7, -2.2]} fontSize={0.05} color="#ff8899" anchorX="center" anchorY="middle">
              {`healthy: ${healthySpikes} spikes / damaged: ${damagedSpikes} spikes`}
            </Text>
          )}
        </>
      )}
      <Text position={[centerX, 0.3, -2.2]} maxWidth={2.1} fontSize={0.05} lineHeight={1.3} color="#d9bfd3" textAlign="center" anchorX="center" anchorY="middle">
        Spikes: each neuron fires pulses over time. This is the winning output neuron; the network behind it runs hidden.
      </Text>
    </group>
  );
}

function PulseNeuronModel({ uniforms }: { uniforms: PulseUniforms }) {
  const ok = useExists(NEURON_URL);
  if (!ok) return <NeuronPlaceholder />;
  return (
    <Boundary fallback={<NeuronPlaceholder />}>
      <Suspense fallback={null}>
        <PulseNeuronInner uniforms={uniforms} />
      </Suspense>
    </Boundary>
  );
}

function PulseNeuronInner({ uniforms }: { uniforms: PulseUniforms }) {
  const { scene } = useGLTF(NEURON_URL);
  const obj = useMemo(() => buildPulseNeuron(scene, NEURON_SIZE, uniforms), [scene, uniforms]);
  return <primitive object={obj} />;
}

function Guides() {
  const geos = useMemo(
    () => [...dendriteCurves(), axonCurve()].map((c) => new THREE.BufferGeometry().setFromPoints(c.getPoints(24))),
    [],
  );
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

/** Stylised glass head (~30 cm tall), facing +Z. */
function GlassHead() {
  const mat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#9fd8ff", transparent: true, opacity: 0.25, depthWrite: false, roughness: 0.1, metalness: 0.1, side: THREE.DoubleSide }),
    [],
  );
  useEffect(() => () => mat.dispose(), [mat]);
  return (
    <group renderOrder={6}>
      <mesh material={mat} position={[0, 0.205, -0.005]} scale={[0.9, 1, 1.05]} raycast={() => null}>
        <sphereGeometry args={[0.1, 28, 20]} />
      </mesh>
      <mesh material={mat} position={[0, 0.125, 0.025]} scale={[0.78, 0.85, 0.85]} raycast={() => null}>
        <sphereGeometry args={[0.075, 24, 16]} />
      </mesh>
      <mesh material={mat} position={[0, 0.175, 0.105]} rotation={[Math.PI / 2, 0, 0]} raycast={() => null}>
        <coneGeometry args={[0.014, 0.035, 10]} />
      </mesh>
      <mesh material={mat} position={[0, 0.04, -0.01]} raycast={() => null}>
        <cylinderGeometry args={[0.038, 0.045, 0.08, 16]} />
      </mesh>
    </group>
  );
}

/** Two slightly flattened, gently bumpy hemispheres (~16 cm long) with a gap; IPS lines on the upper back. */
function ProceduralBrain({ ipsMat }: { ipsMat: THREE.Material }) {
  const RX = 0.036, RY = 0.047, RZ = 0.08, OFF = 0.04;
  const { geo, mat, ips } = useMemo(() => {
    const g = new THREE.SphereGeometry(1, 48, 32);
    const pos = g.getAttribute("position");
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const bump = 1 + 0.05 * Math.sin(9 * v.x + 1.3) * Math.sin(8 * v.y) * Math.sin(7 * v.z + 0.7) + 0.025 * Math.sin(21 * v.y + 13 * v.z);
      v.multiplyScalar(bump);
      pos.setXYZ(i, v.x * RX, v.y * RY * (v.y < 0 ? 0.8 : 1), v.z * RZ);
    }
    g.computeVertexNormals();
    const m = new THREE.MeshStandardMaterial({ color: "#c9a7b4", transparent: true, opacity: 0.4, depthWrite: false, roughness: 0.8 });
    const tubes = [-1, 1].map((side) => {
      const pts: THREE.Vector3[] = [];
      const xn = 0.4;
      const r = Math.sqrt(1 - xn * xn) * 1.04;
      for (let i = 0; i <= 14; i++) {
        const a = THREE.MathUtils.lerp(0.15, 1.25, i / 14); // from top toward the upper back (-Z)
        pts.push(new THREE.Vector3(side * (OFF + xn * RX), Math.cos(a) * r * RY, -Math.sin(a) * r * RZ));
      }
      return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.0025, 6, false);
    });
    return { geo: g, mat: m, ips: tubes };
  }, []);
  useEffect(() => () => { geo.dispose(); mat.dispose(); ips.forEach((t) => t.dispose()); }, [geo, mat, ips]);
  return (
    <group>
      <mesh geometry={geo} material={mat} position={[-OFF, 0, 0]} renderOrder={8} raycast={() => null} />
      <mesh geometry={geo} material={mat} position={[OFF, 0, 0]} renderOrder={8} raycast={() => null} />
      {ips.map((t, i) => (
        <mesh key={i} geometry={t} material={ipsMat} renderOrder={9} raycast={() => null} />
      ))}
    </group>
  );
}

/** Three rising circles and a white cloud (~40 cm) with a large dark digit; always faces the user, drawn on top. */
function ThoughtBubble({ position, answer, dotsRef }: { position: [number, number, number]; answer: string; dotsRef: React.RefObject<THREE.Object3D | null> }) {
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#ffffff", depthTest: false, depthWrite: false, transparent: true, toneMapped: false }), []);
  useEffect(() => () => mat.dispose(), [mat]);
  const puffs: [number, number, number][] = [
    [0, 0.34, 0.13], [-0.12, 0.31, 0.09], [0.12, 0.31, 0.09], [-0.07, 0.4, 0.09], [0.07, 0.41, 0.1], [-0.15, 0.37, 0.06], [0.15, 0.37, 0.06], [0, 0.27, 0.08],
  ];
  const trail: [number, number, number][] = [[0.02, 0.0, 0.015], [0.04, 0.07, 0.024], [0.03, 0.15, 0.035]];
  const showDots = answer === "...";
  return (
    <Billboard position={position}>
      {[...trail, ...puffs].map(([x, y, r], i) => (
        <mesh key={i} position={[x, y, 0]} material={mat} renderOrder={30} raycast={() => null}>
          <circleGeometry args={[r, 28]} />
        </mesh>
      ))}
      {showDots ? (
        <group ref={dotsRef}>
          <ThinkingDots />
        </group>
      ) : (
        answer && (
          <Text position={[0, 0.34, 0.001]} fontSize={0.2} color="#1b1024" anchorX="center" anchorY="middle" outlineWidth={0.006} outlineColor="#1b1024" renderOrder={31} material-depthTest={false}>
            {answer}
          </Text>
        )
      )}
    </Billboard>
  );
}

function ThinkingDots() {
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  useFrame(({ clock }) => {
    refs.current.forEach((m, i) => {
      if (m) m.position.y = 0.34 + Math.max(0, Math.sin(clock.elapsedTime * 6 - i * 0.9)) * 0.025;
    });
  });
  return (
    <>
      {[-0.06, 0, 0.06].map((x, i) => (
        <mesh key={i} ref={(m) => { refs.current[i] = m; }} position={[x, 0.34, 0.001]} renderOrder={31} raycast={() => null}>
          <circleGeometry args={[0.02, 16]} />
          <meshBasicMaterial color="#1b1024" depthTest={false} depthWrite={false} transparent />
        </mesh>
      ))}
    </>
  );
}
