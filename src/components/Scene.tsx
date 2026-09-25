import { Grid, Text } from "@react-three/drei";

import { AI_X, BRAIN_X } from "@/lib/layout";

import { Guidance3D } from "./Guidance";
import { SceneModels } from "./Models";
import { useAppStore } from "@/lib/store";
import { NetworkView } from "./NetworkView";
import type { Weights } from "@/lib/weights";

export const AI_COLOR = "#5fd4f5";
export const BRAIN_COLOR = "#ff5fc8";

/** Midpoint between the two networks — used as the orbit target. */
export const FOCUS: [number, number, number] = [0, 1.2, -2.2];

const NET_POS: [number, number, number] = [0, 0, 0];

export function Scene({ weights }: { weights: Weights }) {
  return (
    <>
      <ambientLight intensity={0.6} />
      <hemisphereLight args={["#2a3550", "#05060a", 0.5]} />
      <directionalLight position={[2, 5, 2]} intensity={0.5} />

      <NetworkView
        side="ai"
        label="AI network"
        subtitle="artificial neurons"
        position={NET_POS}
        centerX={AI_X}
        weights={weights}
        color={AI_COLOR}
      />
      <NetworkView
        side="brain"
        label="Brain network"
        subtitle="brain-inspired neurons"
        position={NET_POS}
        centerX={BRAIN_X}
        weights={weights}
        color={BRAIN_COLOR}
      />

      <Guidance3D />
      <Pedestal x={AI_X} color={AI_COLOR} />
      <Pedestal x={BRAIN_X} color={BRAIN_COLOR} />
      <SceneModels />
      <LesionLabel />


      <Grid
        position={[0, 0, -2]}
        args={[20, 20]}
        cellSize={0.5}
        cellColor="#1b2437"
        sectionSize={2}
        sectionColor="#2d3d5c"
        fadeDistance={14}
        fadeStrength={1.5}
        infiniteGrid
      />
    </>
  );
}

/** Flat oval pedestal (radius 1.5, 2.1x along Z) with a thin glowing ring. */
function Pedestal({ x, color }: { x: number; color: string }) {
  return (
    <group position={[x, 0.02, -2.1]} scale={[1, 1, 2.1]}>
      <mesh>
        <cylinderGeometry args={[1.5, 1.5, 0.03, 64]} />
        <meshBasicMaterial color="#10152a" />
      </mesh>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.5, 0.012, 6, 96]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
    </group>
  );
}

function LesionLabel() {
  const on = useAppStore((s) => s.lesionMode);
  if (!on) return null;
  return (
    <Text position={[0, 3.35, -2.2]} fontSize={0.1} color="#ff3344" anchorX="center" anchorY="middle" outlineWidth={0.004} outlineColor="#05060a">
      LESION MODE
    </Text>
  );
}
