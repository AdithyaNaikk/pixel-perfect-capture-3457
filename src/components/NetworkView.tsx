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

export type NetworkSide = "ai" | "brain";

export interface NetworkViewProps {
  side: NetworkSide;
  label: string;
  subtitle: string;
  position: [number, number, number];
  /** Local X of input, hidden and output layers. */
  layerX: [number, number, number];
  weights: Weights;
  color: string;
}

const TOP_INCOMING = 6;
const NEGATIVE_COLOR = new THREE.Color("#5b6b86");
const DIM = 0.22;
const INPUT_OFF = 0.015;
const ACTIVATION_MS = 150;
const CALCULATION_COUNT = "50,816";

/** Sets instance matrices once and installs an instanceColor buffer. */
function useInstanced(
  positions: THREE.Vector3[],
  color: string,
  ref: RefObject<THREE.InstancedMesh | null>,
) {
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const base = new THREE.Color(color).multiplyScalar(DIM);
    for (let i = 0; i < positions.length; i++) {
      const position = positions[i];
      if (!position) continue;
      dummy.position.copy(position);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, base);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [positions, color, ref]);
}

export function NetworkView({
  side,
  label,
  subtitle,
  position,
  layerX,
  weights,
  color,
}: NetworkViewProps) {
  const inputRef = useRef<THREE.InstancedMesh>(null);
  const hiddenRef = useRef<THREE.InstancedMesh>(null);
  const outputRef = useRef<THREE.InstancedMesh>(null);
  const activationStart = useRef<number | null>(null);
  const hiddenTarget = useRef<Float32Array | null>(null);
  const outputTarget = useRef<Float32Array | null>(null);
  const [aiResult, setAiResult] = useState<ForwardResult | null>(null);
  const inputImage = useAppStore((s) => s.inputImage);
  const runId = useAppStore((s) => s.runId);

  const [inX, hidX, outX] = layerX;
  const inputPos = useMemo(() => inputPositions(inX), [inX]);
  const hiddenPos = useMemo(() => hiddenPositions(hidX), [hidX]);
  const outputPos = useMemo(() => outputPositions(outX), [outX]);

  useInstanced(inputPos, color, inputRef);
  useInstanced(hiddenPos, color, hiddenRef);
  useInstanced(outputPos, color, outputRef);

  // Input cube brightness follows the preprocessed image (no React re-render).
  useEffect(() => {
    const full = new THREE.Color(color);
    const base = full.clone().multiplyScalar(INPUT_OFF);
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

    const result = forward(inputImage, weights, new Set<number>());
    const maxHidden = Math.max(0, ...result.hidden);
    const maxOutput = Math.max(0, ...result.output);
    hiddenTarget.current = result.hidden.map((value) => (maxHidden > 0 ? value / maxHidden : 0));
    outputTarget.current = result.output.map((value) => (maxOutput > 0 ? value / maxOutput : 0));
    activationStart.current = performance.now();
    setAiResult(result);
  }, [side, runId, inputImage, weights]);

  useFrame(() => {
    if (side !== "ai" || activationStart.current === null) return;
    const hiddenMesh = hiddenRef.current;
    const outputMesh = outputRef.current;
    const hidden = hiddenTarget.current;
    const output = outputTarget.current;
    if (!hiddenMesh || !outputMesh || !hidden || !output) return;

    const full = new THREE.Color(color);
    const base = full.clone().multiplyScalar(DIM);
    const tmp = new THREE.Color();
    const progress = Math.min((performance.now() - activationStart.current) / ACTIVATION_MS, 1);

    for (let i = 0; i < hidden.length; i++) {
      tmp.copy(base).lerp(full, (hidden[i] ?? 0) * progress);
      hiddenMesh.setColorAt(i, tmp);
    }
    for (let i = 0; i < output.length; i++) {
      tmp.copy(base).lerp(full, (output[i] ?? 0) * progress);
      outputMesh.setColorAt(i, tmp);
    }
    if (hiddenMesh.instanceColor) hiddenMesh.instanceColor.needsUpdate = true;
    if (outputMesh.instanceColor) outputMesh.instanceColor.needsUpdate = true;
    if (progress >= 1) activationStart.current = null;
  });

  const lineGeometries = useMemo(() => {
    const positive = new THREE.Color(color);
    const inputVerts: number[] = [];
    const inputColors: number[] = [];
    const outputVerts: number[] = [];
    const outputColors: number[] = [];

    const push = (verts: number[], colors: number[], a: THREE.Vector3, b: THREE.Vector3, w: number) => {
      verts.push(a.x, a.y, a.z, b.x, b.y, b.z);
      const c = w >= 0 ? positive : NEGATIVE_COLOR;
      colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
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
        push(inputVerts, inputColors, input, hidden, weight);
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
        push(outputVerts, outputColors, hidden, output, weight);
      }
    }

    const makeGeometry = (verts: number[], colors: number[]) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      return geometry;
    };
    return {
      input: makeGeometry(inputVerts, inputColors),
      output: makeGeometry(outputVerts, outputColors),
    };
  }, [weights, color, inputPos, hiddenPos, outputPos]);

  useEffect(() => () => {
    lineGeometries.input.dispose();
    lineGeometries.output.dispose();
  }, [lineGeometries]);

  const winnerPosition = aiResult ? outputPos[aiResult.prediction] : undefined;

  return (
    <group position={position} name={`network-${side}`}>
      <lineSegments geometry={lineGeometries.input} frustumCulled={false} renderOrder={-1}>
        <lineBasicMaterial vertexColors transparent opacity={0.04} depthWrite={false} />
      </lineSegments>
      <lineSegments geometry={lineGeometries.output} frustumCulled={false} renderOrder={-1}>
        <lineBasicMaterial vertexColors transparent opacity={0.08} depthWrite={false} />
      </lineSegments>

      <instancedMesh
        ref={inputRef}
        args={[undefined, undefined, inputPos.length]}
        frustumCulled={false}
        renderOrder={1}
      >
        <boxGeometry args={[INPUT_CUBE_SIZE, INPUT_CUBE_SIZE, INPUT_CUBE_SIZE]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>

      <instancedMesh
        ref={hiddenRef}
        args={[undefined, undefined, hiddenPos.length]}
        frustumCulled={false}
        renderOrder={1}
      >
        <sphereGeometry args={[HIDDEN_RADIUS, 12, 8]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>

      <instancedMesh
        ref={outputRef}
        args={[undefined, undefined, outputPos.length]}
        frustumCulled={false}
        renderOrder={1}
      >
        <sphereGeometry args={[OUTPUT_RADIUS, 12, 8]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>

      {side === "ai" && aiResult && winnerPosition && (
        <>
          <mesh position={[winnerPosition.x, winnerPosition.y, 0.018]} renderOrder={2}>
            <torusGeometry args={[OUTPUT_RADIUS * 1.55, 0.006, 8, 48]} />
            <meshBasicMaterial color={color} transparent opacity={0.95} toneMapped={false} />
          </mesh>
          <mesh position={[winnerPosition.x, winnerPosition.y, 0.014]} renderOrder={2}>
            <torusGeometry args={[OUTPUT_RADIUS * 2.15, 0.004, 8, 48]} />
            <meshBasicMaterial color={color} transparent opacity={0.35} toneMapped={false} />
          </mesh>
          <group position={[hidX, 1, 0.02]}>
            <mesh position={[0, 0, -0.018]} renderOrder={1}>
              <planeGeometry args={[0.98, 0.3]} />
              <meshBasicMaterial color="#05060a" transparent opacity={0.72} depthWrite={false} />
            </mesh>
            <Text
              position={[0, 0.05, 0]}
              fontSize={0.085}
              color={color}
              anchorX="center"
              anchorY="middle"
              renderOrder={2}
            >
              {`AI answer: ${aiResult.prediction}`}
            </Text>
            <Text
              position={[0, -0.065, 0]}
              fontSize={0.045}
              color="#d7e8ef"
              anchorX="center"
              anchorY="middle"
              renderOrder={2}
            >
              {`1 step · ${CALCULATION_COUNT} calculations`}
            </Text>
          </group>
        </>
      )}


      <Text
        position={[hidX, 0.72, 0]}
        fontSize={0.14}
        color={color}
        anchorX="center"
        anchorY="middle"
      >
        {label}
      </Text>
      <Text
        position={[hidX, 0.58, 0]}
        fontSize={0.055}
        color={color}
        anchorX="center"
        anchorY="middle"
      >
        {subtitle}
      </Text>
    </group>
  );
}
