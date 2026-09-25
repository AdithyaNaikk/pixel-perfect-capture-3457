import { OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { XR, createXRStore } from "@react-three/xr";
import { useEffect, useMemo, useState } from "react";

import { FOCUS, Scene } from "./Scene";
import { DrawingPanel } from "./DrawingPanel";
import { GuidanceLine, HINT_DESKTOP, HINT_VR } from "./Guidance";
import { VRDrawing } from "./VRDrawing";
import { ControllerPen } from "./Models";
import { useAppStore, type PlaybackSpeed } from "@/lib/store";
import { loadWeights, type Weights } from "@/lib/weights";

/** Half-width of the whole scene (input grid edge at x = 2.4 + margin). */
const SCENE_HALF_W = 2.85;
const SCENE_HALF_H = 1.45; // includes titles and answers above the networks
const MIN_DIST = 4.7; // camera z = 2.2 when the scene fits

/** Pulls the desktop camera back until both input grids fit the viewport. */
function CameraFit({ panelExpanded }: { panelExpanded: boolean }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  useEffect(() => {
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const reservedHeight = panelExpanded ? Math.min(296, height * 0.5) : 0;
    const availableHeight = Math.max(height - reservedHeight, 1);
    const viewportAspect = width / Math.max(height, 1);
    const verticalFit = (SCENE_HALF_H / tanV) * (height / availableHeight);
    const dist = Math.max(MIN_DIST, SCENE_HALF_W / (tanV * viewportAspect), verticalFit);
    camera.position.set(FOCUS[0], FOCUS[1], FOCUS[2] + dist);
    camera.lookAt(...FOCUS);
    if (panelExpanded) {
      camera.setViewOffset(width, height, 0, reservedHeight / 2, width, height);
    } else {
      camera.clearViewOffset();
    }
    camera.updateProjectionMatrix();
    return () => camera.clearViewOffset();
  }, [camera, width, height, panelExpanded]);
  return null;
}

export function XRApp() {
  const store = useMemo(() => createXRStore(), []);
  const [weights, setWeights] = useState<Weights | null>(null);
  const [vrSupported, setVrSupported] = useState<boolean | null>(null);
  const [drawingExpanded, setDrawingExpanded] = useState(true);

  useEffect(() => {
    let alive = true;
    loadWeights().then((w) => {
      if (alive) setWeights(w);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    if (!xr?.isSessionSupported) {
      setVrSupported(false);
      return;
    }
    xr.isSessionSupported("immersive-vr")
      .then(setVrSupported)
      .catch(() => setVrSupported(false));
  }, []);

  return (
    <div
      className="fixed inset-0 h-screen w-screen overflow-hidden"
      style={{ backgroundColor: "#05060a" }}
    >
      <Canvas
        style={{ width: "100%", height: "100%", display: "block" }}
        dpr={[1, 1.5]}
        shadows={false}
        camera={{ position: [0, 1.5, 2.2], fov: 65, near: 0.05, far: 100 }}
      >
        <XR store={store}>
          <color attach="background" args={["#05060a"]} />
          <fog attach="fog" args={["#05060a", 3, 14]} />
          <CameraFit panelExpanded={drawingExpanded} />
          {weights && <Scene weights={weights} />}
          <VRDrawing />
          <ControllerPen />
          <OrbitControls target={FOCUS} enablePan={false} makeDefault />
        </XR>
      </Canvas>

      <div className="pointer-events-none fixed inset-x-0 top-0 z-10 grid grid-cols-[minmax(0,1fr)_minmax(0,700px)_minmax(0,1fr)] items-start gap-4 p-5">
        <div className="font-mono text-sm tracking-widest text-slate-300">
          SAME WEIGHTS, TWO BRAINS
          {!weights && <span className="ml-2 opacity-60">loading weights…</span>}
          {weights?.isPlaceholder && (
            <div className="mt-1 text-xs tracking-normal text-amber-300">⚠ Using random placeholder weights</div>
          )}
          {weights && !weights.isPlaceholder && (
            <div className="mt-1 text-xs tracking-normal text-emerald-300/80">
              Trained weights loaded
              {typeof weights.meta.ann_test_accuracy === "number" &&
                ` · ANN test accuracy ${(weights.meta.ann_test_accuracy * 100).toFixed(1)}%`}
            </div>
          )}
        </div>
        <div className="min-w-0 pt-1">
          <GuidanceLine />
        </div>
        <div className="flex flex-col items-end gap-2">
        {vrSupported === true ? (
          <button
            onClick={() => store.enterVR()}
            className="pointer-events-auto rounded-full border border-cyan-300/40 bg-cyan-300/10 px-5 py-2 font-mono text-sm text-cyan-200 transition-colors hover:bg-cyan-300/20"
          >
            Enter VR
          </button>
        ) : vrSupported === false ? (
          <span className="font-mono text-xs text-slate-500">VR not available</span>
        ) : null}
          <LesionControls />
        </div>
      </div>
      <div className="pointer-events-none fixed inset-x-0 bottom-1 flex justify-center">
        <span className="font-mono text-[10px] text-slate-500">
          {vrSupported ? HINT_VR : HINT_DESKTOP}
        </span>
      </div>
      <DrawingPanel expanded={drawingExpanded} onExpandedChange={setDrawingExpanded} top={<PlaybackControls />} />
    </div>
  );
}

function LesionControls() {
  const on = useAppStore((s) => s.lesionMode);
  const toggle = useAppStore((s) => s.toggleLesionMode);
  const random = useAppStore((s) => s.lesionRandom);
  const heal = useAppStore((s) => s.healAll);
  const btn = "rounded-full border border-red-400/40 bg-red-400/10 px-3 py-1 text-red-200 hover:bg-red-400/20";
  return (
    <div className="pointer-events-auto flex flex-col items-end gap-1.5 font-mono text-xs">
      <button onClick={toggle} aria-pressed={on} className={`${btn} ${on ? "bg-red-500/40 text-red-50" : ""}`}>
        Lesion mode {on ? "on" : "off"}
      </button>
      {on && (
        <>
          <button onClick={() => random(10)} className={btn}>Lesion 10 random</button>
          <button onClick={heal} className={btn}>Heal all</button>
          <span className="text-[10px] text-red-200/70">click a middle neuron</span>
        </>
      )}
    </div>
  );
}

function PlaybackControls() {
  const runId = useAppStore((s) => s.runId);
  const speed = useAppStore((s) => s.speed);
  const replay = useAppStore((s) => s.replay);
  const setSpeed = useAppStore((s) => s.setSpeed);
  if (runId === 0) return null;
  const options: { label: string; value: PlaybackSpeed }[] = [
    { label: "Pause", value: 0 },
    { label: "0.25x", value: 0.25 },
    { label: "1x", value: 1 },
  ];
  return (
    <div className="flex items-center gap-2 rounded-full bg-slate-950/80 p-1 font-mono text-xs">
      <button
        onClick={replay}
        className="rounded-full border border-orange-300/40 bg-orange-300/10 px-3 py-1 text-orange-200 hover:bg-orange-300/20"
      >
        Replay
      </button>
      <div className="flex overflow-hidden rounded-full border border-orange-300/30" role="group" aria-label="Playback speed">
        {options.map((o) => (
          <button
            key={o.label}
            onClick={() => setSpeed(o.value)}
            aria-pressed={speed === o.value}
            className={`px-2.5 py-1 ${speed === o.value ? "bg-orange-300/25 text-orange-100" : "text-orange-200/70 hover:bg-orange-300/10"}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
