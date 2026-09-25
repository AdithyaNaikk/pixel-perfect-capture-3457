import { OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { XR, createXRStore } from "@react-three/xr";
import { useEffect, useMemo, useState } from "react";

import { FOCUS, Scene } from "./Scene";
import { loadWeights, type Weights } from "@/lib/weights";

/** Half-width of the whole scene (input grid edge at x = 2.4 + margin). */
const SCENE_HALF_W = 2.85;
const SCENE_HALF_H = 1.0;
const MIN_DIST = 4.7; // camera z = 2.2 when the scene fits

/** Pulls the desktop camera back until both input grids fit the viewport. */
function CameraFit() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  useEffect(() => {
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const aspect = width / Math.max(height, 1);
    const dist = Math.max(MIN_DIST, SCENE_HALF_W / (tanV * aspect), SCENE_HALF_H / tanV);
    camera.position.set(FOCUS[0], FOCUS[1], FOCUS[2] + dist);
    camera.lookAt(...FOCUS);
    camera.updateProjectionMatrix();
  }, [camera, width, height]);
  return null;
}

export function XRApp() {
  const store = useMemo(() => createXRStore(), []);
  const [weights, setWeights] = useState<Weights | null>(null);
  const [vrSupported, setVrSupported] = useState<boolean | null>(null);

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
    <div className="fixed inset-0" style={{ backgroundColor: "#05060a" }}>
      <Canvas
        dpr={[1, 1.5]}
        shadows={false}
        camera={{ position: [0, 1.5, 2.2], fov: 65, near: 0.05, far: 100 }}
      >
        <XR store={store}>
          <color attach="background" args={["#05060a"]} />
          <fog attach="fog" args={["#05060a", 3, 14]} />
          <CameraFit />
          {weights && <Scene weights={weights} />}
          <OrbitControls target={FOCUS} enablePan={false} makeDefault />
        </XR>
      </Canvas>

      <div className="pointer-events-none fixed inset-x-0 top-0 flex items-start justify-between p-5">
        <div className="font-mono text-sm tracking-widest text-slate-300">
          SAME WEIGHTS, TWO BRAINS
          {!weights && <span className="ml-2 opacity-60">loading weights…</span>}
        </div>
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
      </div>
    </div>
  );
}
