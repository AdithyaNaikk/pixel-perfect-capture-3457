import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import * as THREE from "three";

import {
  HIDDEN_RADIUS,
  INPUT_CUBE_SIZE,
  OUTPUT_RADIUS,
  hiddenPositions,
  inputPositions,
  outputPositions,
} from "@/lib/layout";
import { forward, type ForwardResult } from "@/lib/ann";
import type { Weights } from "@/lib/weights";
import { useAppStore } from "@/lib/store";
import { LESION_GREY, SpikingPlayback } from "./SpikingPlayback";
import { CURVE_SEGMENTS, createNeuronGeometry, curveControl, curvePoint, neuronQuat, seedIn, seedOut } from "@/lib/brainGeometry";

export type NetworkSide = "ai" | "brain";

export interface NetworkViewProps {
  side: NetworkSide;
  label: string;
  subtitle: string;
  position: [number, number, number];
  /** World X the network is centred on. */
  centerX: number;
  weights: Weights;
  color: string;
}

const TOP_INCOMING = 6;
const DIM = 0.22;
const INPUT_OFF = 0.015;
const INPUT_SWEEP_END = 0.12;
const HIDDEN_SWEEP_END = 0.27;
const OUTPUT_SWEEP_END = 0.4;
const MIN_ACTIVE_BRIGHTNESS = 0.15;
const WINNER_SCALE = 1.35;
const CALCULATION_COUNT = "50,816";
import { ANSWER_SIZE, ANSWER_SUB_Y, ANSWER_Y, INACTIVE_COLOR, LABEL_Z, OUTPUT_Z, TITLE_Y } from "@/lib/layout";
const INACTIVE = new THREE.Color(INACTIVE_COLOR);
const X_COLOR = new THREE.Color("#ff3344");
const X_ARM = HIDDEN_RADIUS * 2.2;

/** Sets instance matrices once and installs an instanceColor buffer. */
function useInstanced(
  positions: THREE.Vector3[],
  color: string,
  ref: RefObject<THREE.InstancedMesh | null>,
  twistOffset: number | null = null,
) {
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const base = INACTIVE.clone();
    for (let i = 0; i < positions.length; i++) {
      const position = positions[i];
      if (!position) continue;
      dummy.position.copy(position);
      if (twistOffset !== null) neuronQuat(i + twistOffset, dummy.quaternion);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, base);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [positions, color, ref, twistOffset]);
}

export function NetworkView({
  side,
  label,
  subtitle,
  position,
  centerX,
  weights,
  color,
}: NetworkViewProps) {
  const inputRef = useRef<THREE.InstancedMesh>(null);
  const hiddenRef = useRef<THREE.InstancedMesh>(null);
  const outputRef = useRef<THREE.InstancedMesh>(null);
  const hoverRef = useRef<THREE.Mesh>(null);
  const winnerRef = useRef<THREE.Group>(null);
  const lineMaterialRef = useRef<THREE.LineBasicMaterial>(null);
  const sweepElapsed = useRef<number | null>(null);
  const hiddenTarget = useRef<Float32Array | null>(null);
  const outputTarget = useRef<Float32Array | null>(null);
  const lineTarget = useRef<Float32Array | null>(null);
  const [aiResult, setAiResult] = useState<ForwardResult | null>(null);
  const inputImage = useAppStore((s) => s.inputImage);
  const runId = useAppStore((s) => s.runId);

  const hidX = centerX;
  const inputPos = useMemo(() => inputPositions(centerX), [centerX]);
  const hiddenPos = useMemo(() => hiddenPositions(centerX), [centerX]);
  const outputPos = useMemo(() => outputPositions(centerX), [centerX]);

  useInstanced(inputPos, color, inputRef);
  const brain = side === "brain";
  useInstanced(hiddenPos, color, hiddenRef, brain ? 0 : null);
  useInstanced(outputPos, color, outputRef, brain ? hiddenPos.length : null);
  const brainGeo = useMemo(
    () =>
      brain
        ? {
            hidden: createNeuronGeometry(HIDDEN_RADIUS),
            output: createNeuronGeometry(OUTPUT_RADIUS),
            input: new THREE.SphereGeometry(INPUT_CUBE_SIZE * 0.6, 6, 3),
          }
        : null,
    [brain],
  );
  useEffect(() => () => {
    brainGeo?.hidden.dispose();
    brainGeo?.output.dispose();
    brainGeo?.input.dispose();
  }, [brainGeo]);

  // Lesion hover: red highlight on the hovered hidden neuron (shared by both networks).
  useEffect(() => {
    const apply = (st: { lesionMode: boolean; hoverHidden: number | null }) => {
      const m = hoverRef.current;
      if (!m) return;
      const p = st.hoverHidden !== null ? hiddenPos[st.hoverHidden] : undefined;
      m.visible = st.lesionMode && !!p;
      if (p) m.position.copy(p);
    };
    apply(useAppStore.getState());
    return useAppStore.subscribe(apply);
  }, [hiddenPos]);

  // Input cube brightness follows the preprocessed image (no React re-render).
  useEffect(() => {
    const full = new THREE.Color(color);
    const base = INACTIVE.clone();
    const tmp = new THREE.Color();
    const apply = (img: Float32Array | null) => {
      const mesh = inputRef.current;
      if (!mesh) return;
      for (let i = 0; i < inputPos.length; i++) {
        tmp.copy(base).lerp(full, img?.[i] ?? 0);
        mesh.setColorAt(i, tmp);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    };
    apply(useAppStore.getState().inputImage);
    return useAppStore.subscribe((s, prev) => {
      if (s.inputImage !== prev.inputImage) apply(s.inputImage);
    });
  }, [color, inputPos]);

  useEffect(() => {
    if (side !== "ai" || runId === 0 || !inputImage) return;

    const result = forward(inputImage, weights, useAppStore.getState().lesioned);
    const maxHidden = Math.max(0, ...result.hidden);
    const maxOutput = Math.max(0, ...result.output);
    hiddenTarget.current = result.hidden.map((value) =>
      value > 0 && maxHidden > 0 ? Math.max(MIN_ACTIVE_BRIGHTNESS, value / maxHidden) : 0,
    );
    outputTarget.current = result.output.map((value) =>
      value > 0 && maxOutput > 0 ? Math.max(MIN_ACTIVE_BRIGHTNESS, value / maxOutput) : 0,
    );

    const lineActivity: number[] = [];
    let maxInputLine = 0;
    for (let h = 0; h < weights.w1.length; h++) {
      const row = weights.w1[h];
      if (!row) continue;
      const indices = Array.from(row.keys())
        .sort((a, b) => Math.abs(row[b] ?? 0) - Math.abs(row[a] ?? 0))
        .slice(0, TOP_INCOMING);
      for (const i of indices) {
        const activity = Math.abs((inputImage[i] ?? 0) * (row[i] ?? 0));
        lineActivity.push(activity);
        maxInputLine = Math.max(maxInputLine, activity);
      }
    }
    const inputLineCount = lineActivity.length;
    let maxOutputLine = 0;
    for (let o = 0; o < weights.w2.length; o++) {
      const row = weights.w2[o];
      if (!row) continue;
      for (let h = 0; h < row.length; h++) {
        const activity = Math.abs((result.hidden[h] ?? 0) * (row[h] ?? 0));
        lineActivity.push(activity);
        maxOutputLine = Math.max(maxOutputLine, activity);
      }
    }
    lineTarget.current = Float32Array.from(lineActivity, (value, index) => {
      const max = index < inputLineCount ? maxInputLine : maxOutputLine;
      return max > 0 ? value / max : 0;
    });
    const resetMesh = (mesh: THREE.InstancedMesh | null) => {
      if (!mesh) return;
      for (let i = 0; i < mesh.count; i++) mesh.setColorAt(i, INACTIVE);
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    };
    resetMesh(inputRef.current);
    resetMesh(hiddenRef.current);
    resetMesh(outputRef.current);
    sweepElapsed.current = 0;
    if (winnerRef.current) winnerRef.current.visible = false;
    setAiResult(result);
    useAppStore.getState().setAiAnswer(result.prediction);
  }, [side, runId, inputImage, weights]);

  const fadeColors = useMemo(
    () => ({
      full: new THREE.Color(color),
      base: INACTIVE.clone(),
      c: new THREE.Color(),
      matrix: new THREE.Matrix4(),
      quaternion: new THREE.Quaternion(),
      scale: new THREE.Vector3(),
    }),
    [color],
  );

  useFrame((_, rawDelta) => {
    if (side !== "ai" || sweepElapsed.current === null) return;
    const elapsed = Math.min(sweepElapsed.current + Math.min(rawDelta, 0.05), OUTPUT_SWEEP_END);
    sweepElapsed.current = elapsed;
    const hiddenMesh = hiddenRef.current;
    const outputMesh = outputRef.current;
    const hidden = hiddenTarget.current;
    const output = outputTarget.current;
    if (!hiddenMesh || !outputMesh || !hidden || !output) return;

    const { full, base, c: tmp, matrix, quaternion, scale } = fadeColors;
    const lesioned = useAppStore.getState().lesioned;
    const inputProgress = Math.min(elapsed / INPUT_SWEEP_END, 1);
    const hiddenProgress = Math.max(0, Math.min((elapsed - INPUT_SWEEP_END) / (HIDDEN_SWEEP_END - INPUT_SWEEP_END), 1));
    const outputProgress = Math.max(0, Math.min((elapsed - HIDDEN_SWEEP_END) / (OUTPUT_SWEEP_END - HIDDEN_SWEEP_END), 1));

    const inputMesh = inputRef.current;
    if (inputMesh) {
      for (let i = 0; i < inputPos.length; i++) {
        tmp.copy(base).lerp(full, (inputImage?.[i] ?? 0) * inputProgress);
        inputMesh.setColorAt(i, tmp);
      }
      if (inputMesh.instanceColor) inputMesh.instanceColor.needsUpdate = true;
    }

    for (let i = 0; i < hidden.length; i++) {
      if (lesioned.has(i)) tmp.copy(LESION_GREY);
      else tmp.copy(base).lerp(full, (hidden[i] ?? 0) * hiddenProgress);
      hiddenMesh.setColorAt(i, tmp);
    }
    for (let i = 0; i < output.length; i++) {
      tmp.copy(base).lerp(full, (output[i] ?? 0) * outputProgress);
      outputMesh.setColorAt(i, tmp);
      const winnerScale = aiResult?.prediction === i ? 1 + (WINNER_SCALE - 1) * outputProgress : 1;
      scale.set(winnerScale, winnerScale, winnerScale);
      const position = outputPos[i];
      if (position) {
        matrix.compose(position, quaternion, scale);
        outputMesh.setMatrixAt(i, matrix);
      }
    }
    if (hiddenMesh.instanceColor) hiddenMesh.instanceColor.needsUpdate = true;
    if (outputMesh.instanceColor) outputMesh.instanceColor.needsUpdate = true;
    outputMesh.instanceMatrix.needsUpdate = true;

    const lineColors = lineGeometries.all.attributes["color"];
    const targets = lineTarget.current;
    const lineMaterial = lineMaterialRef.current;
    if (lineColors && targets && lineMaterial) {
      const colors = lineColors.array as Float32Array;
      const inputSegments = TOP_INCOMING * hiddenPos.length;
      const inputPulse = elapsed >= INPUT_SWEEP_END && elapsed < HIDDEN_SWEEP_END
        ? Math.sin(((elapsed - INPUT_SWEEP_END) / (HIDDEN_SWEEP_END - INPUT_SWEEP_END)) * Math.PI)
        : 0;
      const outputPulse = elapsed >= HIDDEN_SWEEP_END && elapsed < OUTPUT_SWEEP_END
        ? Math.sin(((elapsed - HIDDEN_SWEEP_END) / (OUTPUT_SWEEP_END - HIDDEN_SWEEP_END)) * Math.PI)
        : 0;
      for (let segment = 0; segment < targets.length; segment++) {
        const pulse = segment < inputSegments ? inputPulse : outputPulse;
        const brightness = 0.12 + 0.88 * (targets[segment] ?? 0) * pulse;
        const offset = segment * 6;
        colors[offset] = full.r * brightness;
        colors[offset + 1] = full.g * brightness;
        colors[offset + 2] = full.b * brightness;
        colors[offset + 3] = full.r * brightness;
        colors[offset + 4] = full.g * brightness;
        colors[offset + 5] = full.b * brightness;
      }
      lineColors.needsUpdate = true;
      lineMaterial.opacity = elapsed < OUTPUT_SWEEP_END ? 0.8 : 0.18;
    }

    if (winnerRef.current) winnerRef.current.visible = outputProgress > 0;
    if (elapsed >= OUTPUT_SWEEP_END) {
      if (lineColors) {
        const colors = lineColors.array as Float32Array;
        for (let i = 0; i < colors.length; i += 3) {
          colors[i] = full.r;
          colors[i + 1] = full.g;
          colors[i + 2] = full.b;
        }
        lineColors.needsUpdate = true;
      }
      sweepElapsed.current = null;
    }
  });

  const lineGeometries = useMemo(() => {
    const positive = new THREE.Color(color);
    const inputVerts: number[] = [];
    const inputColors: number[] = [];
    const outputVerts: number[] = [];
    const outputColors: number[] = [];

    const inputRanges: number[][] = Array.from({ length: hiddenPos.length }, () => []);
    const outputRanges: number[][] = Array.from({ length: hiddenPos.length }, () => []);
    const segs = side === "brain" ? CURVE_SEGMENTS : 1;
    const ctrl = new THREE.Vector3();
    const p0 = new THREE.Vector3();
    const p1 = new THREE.Vector3();
    const push = (verts: number[], colors: number[], a: THREE.Vector3, b: THREE.Vector3, seed: number) => {
      const c = positive;
      if (segs === 1) {
        verts.push(a.x, a.y, a.z, b.x, b.y, b.z);
        colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
        return;
      }
      curveControl(a, b, seed, ctrl);
      p0.copy(a);
      for (let k = 1; k <= segs; k++) {
        curvePoint(a, ctrl, b, k / segs, p1);
        verts.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
        colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
        p0.copy(p1);
      }
    };

    // Input -> hidden: top 6 incoming weights per hidden neuron.
    for (let h = 0; h < weights.w1.length; h++) {
      const row = weights.w1[h];
      const hidden = hiddenPos[h];
      if (!row || !hidden) continue;
      const idx = Array.from(row.keys())
        .sort((a, b) => Math.abs(row[b] ?? 0) - Math.abs(row[a] ?? 0))
        .slice(0, TOP_INCOMING);
       for (const i of idx) {
        const input = inputPos[i];
        const weight = row[i];
        if (!input || weight === undefined) continue;
        inputRanges[h]!.push(inputVerts.length);
        push(inputVerts, inputColors, input, hidden, seedIn(i, h));
      }
    }

    // Hidden -> output: all connections.
    for (let o = 0; o < weights.w2.length; o++) {
      const row = weights.w2[o];
      const output = outputPos[o];
      if (!row || !output) continue;
      for (let h = 0; h < row.length; h++) {
        const hidden = hiddenPos[h];
        const weight = row[h];
        if (!hidden || weight === undefined) continue;
        outputRanges[h]!.push(outputVerts.length);
        push(outputVerts, outputColors, hidden, output, seedOut(h, o));
      }
    }

    const makeGeometry = (verts: number[], colors: number[]) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      return geometry;
    };
    // One LineSegments per network: input->hidden followed by hidden->output.
    const off = inputVerts.length;
    const ranges = inputRanges.map((r, h) => [...r, ...(outputRanges[h] ?? []).map((o) => o + off)]);
    const allVerts = inputVerts.concat(outputVerts);
    return {
      all: makeGeometry(allVerts, inputColors.concat(outputColors)),
      allOrig: new Float32Array(allVerts),
      ranges,
      stride: segs * 6,
    };
  }, [side, weights, color, inputPos, hiddenPos, outputPos]);

  useEffect(() => () => {
    lineGeometries.all.dispose();
  }, [lineGeometries]);

  // Lesions: grey neurons, red X marks, hidden connection lines.
  const xRef = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const full = INACTIVE.clone();
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const zAxis = new THREE.Vector3(0, 0, 1);
    const scale = new THREE.Vector3();
    const pos = new THREE.Vector3();
    let prevSet = new Set<number>();
    const collapse = (geo: THREE.BufferGeometry, orig: Float32Array, ranges: number[][], set: Set<number>, stride: number) => {
      const arr = geo.attributes["position"]!.array as Float32Array;
      arr.set(orig);
      for (const h of set) {
        for (const o of ranges[h] ?? []) {
          for (let k = 3; k < stride; k += 3) {
            arr[o + k] = arr[o]!;
            arr[o + k + 1] = arr[o + 1]!;
            arr[o + k + 2] = arr[o + 2]!;
          }
        }
      }
      geo.attributes["position"]!.needsUpdate = true;
    };
    const apply = (set: Set<number>) => {
      const hMesh = hiddenRef.current;
      const xMesh = xRef.current;
      if (hMesh) {
        for (const h of prevSet) if (!set.has(h)) hMesh.setColorAt(h, full);
        for (const h of set) hMesh.setColorAt(h, LESION_GREY);
        if (hMesh.instanceColor) hMesh.instanceColor.needsUpdate = true;
      }
      if (xMesh) {
        for (let h = 0; h < hiddenPos.length; h++) {
          const p = hiddenPos[h]!;
          const on = set.has(h);
          for (let k = 0; k < 2; k++) {
            q.setFromAxisAngle(zAxis, k === 0 ? Math.PI / 4 : -Math.PI / 4);
            scale.set(on ? 1 : 0, on ? 1 : 0, on ? 1 : 0);
            pos.set(p.x, p.y, p.z + HIDDEN_RADIUS + 0.004);
            m.compose(pos, q, scale);
            xMesh.setMatrixAt(h * 2 + k, m);
          }
        }
        xMesh.instanceMatrix.needsUpdate = true;
      }
      collapse(lineGeometries.all, lineGeometries.allOrig, lineGeometries.ranges, set, lineGeometries.stride);
      prevSet = set;
    };
    apply(useAppStore.getState().lesioned);
    return useAppStore.subscribe((st, prev) => {
      if (st.lesioned !== prev.lesioned) apply(st.lesioned);
    });
  }, [color, hiddenPos, lineGeometries]);

  // Drawn input->hidden connections, per input pixel.
  const inputOut = useMemo(() => {
    const out: number[][] = Array.from({ length: inputPos.length }, () => []);
    for (let h = 0; h < weights.w1.length; h++) {
      const row = weights.w1[h]!;
      Array.from(row.keys())
        .sort((a, b) => Math.abs(row[b] ?? 0) - Math.abs(row[a] ?? 0))
        .slice(0, TOP_INCOMING)
        .forEach((i) => out[i]?.push(h));
    }
    return out;
  }, [weights, inputPos.length]);

  const winnerPosition = aiResult ? outputPos[aiResult.prediction] : undefined;

  return (
    <group position={position} name={`network-${side}`}>
      <lineSegments geometry={lineGeometries.all} frustumCulled={false} renderOrder={-1}>
        <lineBasicMaterial ref={lineMaterialRef} vertexColors transparent opacity={0.18} depthWrite={false} />
      </lineSegments>

      <instancedMesh
        ref={inputRef}
        args={[undefined, undefined, inputPos.length]}
        frustumCulled={false}
        renderOrder={1}
      >
        {brainGeo ? (
          <primitive object={brainGeo.input} attach="geometry" />
        ) : (
          <boxGeometry args={[INPUT_CUBE_SIZE, INPUT_CUBE_SIZE, INPUT_CUBE_SIZE]} />
        )}
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>

      <instancedMesh
        ref={hiddenRef}
        args={[undefined, undefined, hiddenPos.length]}
        frustumCulled={false}
        renderOrder={1}
        onClick={(e) => {
          const st = useAppStore.getState();
          if (!st.lesionMode || e.instanceId === undefined) return;
          e.stopPropagation();
          st.toggleLesion(e.instanceId);
        }}
        onPointerMove={(e) => {
          if (e.instanceId === undefined) return;
          useAppStore.getState().setHoverHidden(e.instanceId);
        }}
        onPointerOut={() => useAppStore.getState().setHoverHidden(null)}
      >
        {brainGeo ? (
          <primitive object={brainGeo.hidden} attach="geometry" />
        ) : (
          <sphereGeometry args={[HIDDEN_RADIUS, 12, 8]} />
        )}
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>

      <instancedMesh
        ref={xRef}
        args={[undefined, undefined, hiddenPos.length * 2]}
        frustumCulled={false}
        renderOrder={3}
        raycast={() => null}
      >
        <boxGeometry args={[X_ARM, X_ARM * 0.18, 0.002]} />
        <meshBasicMaterial color={X_COLOR} toneMapped={false} />
      </instancedMesh>

      <instancedMesh
        ref={outputRef}
        args={[undefined, undefined, outputPos.length]}
        frustumCulled={false}
        renderOrder={1}
      >
        {brainGeo ? (
          <primitive object={brainGeo.output} attach="geometry" />
        ) : (
          <sphereGeometry args={[OUTPUT_RADIUS, 12, 8]} />
        )}
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>

      <mesh ref={hoverRef} visible={false} renderOrder={4} raycast={() => null}>
        <sphereGeometry args={[HIDDEN_RADIUS * 1.35, 12, 8]} />
        <meshBasicMaterial color="#ff2a3a" transparent opacity={0.85} depthWrite={false} toneMapped={false} />
      </mesh>

      {side === "ai" && aiResult && winnerPosition && (
        <>
          <group ref={winnerRef} visible={false}>
            <mesh position={[winnerPosition.x, winnerPosition.y, winnerPosition.z + 0.02]} renderOrder={2}>
              <torusGeometry args={[OUTPUT_RADIUS * 1.75, 0.009, 8, 48]} />
              <meshBasicMaterial color={color} transparent opacity={1} toneMapped={false} />
            </mesh>
            <mesh position={[winnerPosition.x, winnerPosition.y, winnerPosition.z + 0.015]} renderOrder={2}>
              <torusGeometry args={[OUTPUT_RADIUS * 2.35, 0.005, 8, 48]} />
              <meshBasicMaterial color={color} transparent opacity={0.45} toneMapped={false} />
            </mesh>
          </group>
          <Text position={[hidX, ANSWER_Y, LABEL_Z]} fontSize={ANSWER_SIZE} color={color} anchorX="center" anchorY="middle" outlineWidth={0.006} outlineColor="#05060a">
            {`AI: ${aiResult.prediction}`}
          </Text>
          <Text position={[hidX, ANSWER_SUB_Y, LABEL_Z]} fontSize={0.05} color="#d7e8ef" anchorX="center" anchorY="middle">
            {`1 step · ${CALCULATION_COUNT} calculations`}
          </Text>
          <Text position={[hidX, ANSWER_SUB_Y - 0.13, LABEL_Z]} fontSize={0.045} color="#d7e8ef" anchorX="center" anchorY="middle">
            No spikes: each neuron computes one number, once.
          </Text>
        </>
      )}

      {side === "brain" && (
        <SpikingPlayback
          weights={weights}
          color={color}
          dim={DIM}
          inputOff={INPUT_OFF}
          inputRef={inputRef}
          hiddenRef={hiddenRef}
          outputRef={outputRef}
          inputPos={inputPos}
          hiddenPos={hiddenPos}
          outputPos={outputPos}
          inputOut={inputOut}
          panelX={hidX}
        />
      )}

      <Text
        position={[hidX, TITLE_Y, LABEL_Z]}
        fontSize={0.22}
        color={color}
        anchorX="center"
        anchorY="middle"
      >
        {label}
      </Text>
      <Text
        position={[hidX, TITLE_Y + 0.2, LABEL_Z]}
        fontSize={0.07}
        color={color}
        anchorX="center"
        anchorY="middle"
      >
        {subtitle}
      </Text>
      <OutputLabels side={side} color={color} outputPos={outputPos} />
    </group>
  );
}

/** Per-network 0-9 labels under the output row; the winner is highlighted. */
function OutputLabels({ side, color, outputPos }: { side: NetworkSide; color: string; outputPos: THREE.Vector3[] }) {
  const winner = useAppStore((s) =>
    side === "ai" ? s.aiAnswer : s.spiking?.done ? s.spiking.prediction : null,
  );
  return (
    <>
      {outputPos.map((p, i) => (
        <Text
          key={i}
          position={[p.x, p.y - 0.19, OUTPUT_Z]}
          fontSize={winner === i ? 0.15 : 0.11}
          color={winner === i ? color : "#b7c0d4"}
          anchorX="center"
          anchorY="middle"
        >
          {String(i)}
        </Text>
      ))}
    </>
  );
}
