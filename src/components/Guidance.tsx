import { Text } from "@react-three/drei";
import { useXR } from "@react-three/xr";

import { useAppStore } from "@/lib/store";

const START =
  "Two networks. Exactly the same learned weights. Draw a digit to see how each one computes.";
const AI_DONE =
  "The artificial network answered in one step: every neuron computed a number at the same time.";
const SPIKING =
  "Spiking neurons collect input over time, leak slowly, and fire a spike when they reach a threshold. Watch the answer emerge.";
const SAME =
  "Same weights, same answer, different computation. The spiking network needed time but only fired some neurons (compare the calculation counts).";
const STROKE = "Stroke-like damage: see how each network copes with the same lost neurons.";
const DIFFERENT =
  "Same weights, but different answers. The way a network computes can change what it decides.";

export const HINT_VR = "Trigger: draw · A: run · B: clear · X: lesion mode";
export const HINT_DESKTOP = "Draw with the mouse, then press Run";

/** Picks the guidance message for the current app state. */
export function useGuidanceText(): string {
  const runId = useAppStore((s) => s.runId);
  const aiAnswer = useAppStore((s) => s.aiAnswer);
  const spiking = useAppStore((s) => s.spiking);
  const lesionRerun = useAppStore((s) => s.lesionRerun);
  if (runId === 0) return START;
  if (spiking?.done && lesionRerun) return STROKE;
  if (spiking?.done) {
    return spiking.prediction === aiAnswer ? SAME : DIFFERENT;
  }
  if (spiking) return SPIKING;
  if (aiAnswer !== null) return AI_DONE;
  return START;
}

/** "Lesioned: n / 64 neurons" while lesion mode is on, else null. */
export function useLesionLine(): string | null {
  const on = useAppStore((s) => s.lesionMode);
  const n = useAppStore((s) => s.lesioned.size);
  return on ? `Lesioned: ${n} / 64 neurons` : null;
}

/** Floating 3D guidance panel at the top centre of the scene. */
export function Guidance3D() {
  const mode = useXR((s) => s.mode);
  if (mode !== "immersive-vr") return null;
  return <Guidance3DInner />;
}

function Guidance3DInner() {
  const text = useGuidanceText();
  const lesion = useLesionLine();
  return (
    <group position={[0, 2.62, -2.5]}>
      <mesh position={[0, 0, -0.02]} renderOrder={1}>
        <planeGeometry args={[3.4, 0.6]} />
        <meshBasicMaterial color="#05060a" transparent opacity={0.6} depthWrite={false} />
      </mesh>
      <Text
        position={[0, 0.06, 0]}
        fontSize={0.062}
        maxWidth={3.2}
        lineHeight={1.25}
        color="#e6ecf5"
        anchorX="center"
        anchorY="middle"
        textAlign="center"
        renderOrder={2}
      >
        {text}
      </Text>
      <Text
        position={[0, -0.14, 0]}
        fontSize={0.04}
        color="#8fa3b8"
        anchorX="center"
        anchorY="middle"
        renderOrder={2}
      >
        {`${HINT_VR}  ·  ${HINT_DESKTOP}`}
      </Text>
      {lesion && (
        <Text position={[0, -0.21, 0]} fontSize={0.045} color="#ff5566" anchorX="center" anchorY="middle" renderOrder={2}>
          {lesion}
        </Text>
      )}
    </group>
  );
}

/** Small HTML mirror of the guidance text for the desktop view. */
export function GuidanceLine() {
  const text = useGuidanceText();
  const lesion = useLesionLine();
  return (
    <div className="pointer-events-none fixed inset-x-0 top-14 flex justify-center px-4">
      <p className="max-w-xl text-center font-mono text-xs leading-relaxed text-slate-300/90">
        {text}
        {lesion && <span className="block text-red-400">{lesion}</span>}
      </p>
    </div>
  );
}
