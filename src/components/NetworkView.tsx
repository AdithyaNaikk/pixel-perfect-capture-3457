import { Text } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import {
  HIDDEN_RADIUS,
  INPUT_CUBE_SIZE,
  OUTPUT_RADIUS,
  hiddenPositions,
  inputPositions,
  outputPositions,
} from "@/lib/layout";
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

/** Sets instance matrices once and installs an instanceColor buffer. */
function useInstanced(
  positions: THREE.Vector3[],
  color: string,
  ref: React.RefObject<THREE.InstancedMesh | null>,
) {
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const base = new THREE.Color(color).multiplyScalar(DIM);
    for (let i = 0; i < positions.length; i++) {
      dummy.position.copy(positions[i]!);
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
      const row = weights.w1[h]!;
      const idx = Array.from(row.keys())
        .sort((a, b) => Math.abs(row[b]!) - Math.abs(row[a]!))
        .slice(0, TOP_INCOMING);
       for (const i of idx) push(inputVerts, inputColors, inputPos[i]!, hiddenPos[h]!, row[i]!);
    }

    // Hidden -> output: all connections.
    for (let o = 0; o < weights.w2.length; o++) {
      const row = weights.w2[o]!;
      for (let h = 0; h < row.length; h++) {
         push(outputVerts, outputColors, hiddenPos[h]!, outputPos[o]!, row[h]!);
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
        <meshStandardMaterial
          toneMapped={false}
          emissive={color}
          emissiveIntensity={0.25}
        />
      </instancedMesh>

      <instancedMesh
        ref={outputRef}
        args={[undefined, undefined, outputPos.length]}
        frustumCulled={false}
        renderOrder={1}
      >
        <sphereGeometry args={[OUTPUT_RADIUS, 12, 8]} />
        <meshStandardMaterial
          toneMapped={false}
          emissive={color}
          emissiveIntensity={0.3}
        />
      </instancedMesh>


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
