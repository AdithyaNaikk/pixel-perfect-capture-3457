import { Grid, Text } from "@react-three/drei";

import { OUTPUT_COUNT, OUTPUT_SPACING } from "@/lib/layout";

import { Guidance3D } from "./Guidance";
import { SceneModels } from "./Models";
import { useAppStore } from "@/lib/store";
import { NetworkView } from "./NetworkView";
import type { Weights } from "@/lib/weights";

export const AI_COLOR = "#4fd1ff";
export const BRAIN_COLOR = "#ff7a45";

/** Midpoint between the two networks — used as the orbit target. */
export const FOCUS: [number, number, number] = [0, 1.5, -2.5];

const NET_POS: [number, number, number] = [0, 1.5, -2.5];

export function Scene({ weights }: { weights: Weights }) {
  return (
    <>
      <ambientLight intensity={0.6} />
      <hemisphereLight args={["#2a3550", "#05060a", 0.5]} />
      <directionalLight position={[2, 5, 2]} intensity={0.5} />

      <NetworkView
        side="ai"
        label="AI"
        subtitle="artificial neurons"
        position={NET_POS}
        layerX={[-2.4, -1.5, -0.6]}
        weights={weights}
        color={AI_COLOR}
      />
      <NetworkView
        side="brain"
        label="SPIKING"
        subtitle="brain-inspired neurons"
        position={NET_POS}
        layerX={[2.4, 1.5, 0.6]}
        weights={weights}
        color={BRAIN_COLOR}
      />

      <Guidance3D />
      <SceneModels />
      <LesionLabel />

      <OutputLabels />

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

function OutputLabels() {
  const ai = useAppStore((s) => s.aiAnswer);
  const sp = useAppStore((s) => (s.spiking?.done ? s.spiking.prediction : null));
  return (
    <>
      {Array.from({ length: OUTPUT_COUNT }, (_, i) => {
        const isAi = ai === i;
        const isSp = sp === i;
        return (
          <Text
            key={i}
            position={[0, 1.5 + ((OUTPUT_COUNT - 1) / 2 - i) * OUTPUT_SPACING, -2.5]}
            fontSize={isAi || isSp ? 0.1 : 0.085}
            color={isAi ? AI_COLOR : isSp ? BRAIN_COLOR : "#e6ecf5"}
            outlineWidth={isAi && isSp ? 0.008 : 0}
            outlineColor={BRAIN_COLOR}
            anchorX="center"
            anchorY="middle"
          >
            {String(i)}
          </Text>
        );
      })}
    </>
  );
}

function LesionLabel() {
  const on = useAppStore((s) => s.lesionMode);
  if (!on) return null;
  return (
    <Text position={[0, 2.22, -2.48]} fontSize={0.1} color="#ff3344" anchorX="center" anchorY="middle" outlineWidth={0.004} outlineColor="#05060a">
      LESION MODE
    </Text>
  );
}
