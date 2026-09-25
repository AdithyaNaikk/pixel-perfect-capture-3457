import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { XR, createXRStore } from "@react-three/xr";
import { useEffect, useMemo, useState } from "react";

import { FOCUS, Scene } from "./Scene";
import { loadWeights, type Weights } from "@/lib/weights";

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
          <fog attach="fog" args={["#05060a", 3, 12]} />
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
