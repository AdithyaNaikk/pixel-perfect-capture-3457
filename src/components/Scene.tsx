import { Grid } from "@react-three/drei";

import { NetworkView } from "./NetworkView";
import type { Weights } from "@/lib/weights";

export const AI_COLOR = "#4fd1ff";
export const BRAIN_COLOR = "#ff7a45";

/** Midpoint between the two networks — used as the orbit target. */
export const FOCUS: [number, number, number] = [0, 1.5, -2.5];

const SEPARATION = 1.6;
const TILT = 0.18; // radians, angled slightly toward the user

export function Scene({ weights }: { weights: Weights }) {
  return (
    <>
      <ambientLight intensity={0.6} />
      <hemisphereLight args={["#2a3550", "#05060a", 0.5]} />
      <directionalLight position={[2, 5, 2]} intensity={0.5} />

      <NetworkView
        side="ai"
        label="AI"
        position={[-SEPARATION / 2, 1.5, -2.5]}
        rotation={[0, TILT, 0]}
        weights={weights}
        color={AI_COLOR}
      />
      <NetworkView
        side="brain"
        label="BRAIN"
        position={[SEPARATION / 2, 1.5, -2.5]}
        rotation={[0, -TILT, 0]}
        weights={weights}
        color={BRAIN_COLOR}
      />

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
