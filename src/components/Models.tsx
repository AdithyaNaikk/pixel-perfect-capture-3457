import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useXR, useXRInputSourceState } from "@react-three/xr";
import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";

export const CHIP_URL = "/models/chip.glb";
export const NEURON_URL = "/models/neuron.glb";
export const PEN_URL = "/models/pen.glb";

/** Resolves to the set of model URLs that actually exist; preloads them. */
const existing = new Map<string, Promise<boolean>>();
function checkModel(url: string): Promise<boolean> {
  let p = existing.get(url);
  if (!p) {
    p = fetch(url, { method: "HEAD" })
      .then((r) => {
        const type = r.headers.get("content-type") ?? "";
        const ok = r.ok && !type.includes("text/html");
        if (ok) useGLTF.preload(url);
        return ok;
      })
      .catch(() => false);
    existing.set(url, p);
  }
  return p;
}
if (typeof window !== "undefined") [CHIP_URL, NEURON_URL, PEN_URL].forEach(checkModel);

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.warn("[models] failed to load model", err);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function useExists(url: string) {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let alive = true;
    checkModel(url).then((v) => alive && setOk(v));
    return () => {
      alive = false;
    };
  }, [url]);
  return ok;
}

/** Clones the GLTF scene, centres it and scales its largest side to `size`. */
function Fitted({ url, size, rotation }: { url: string; size: number; rotation?: [number, number, number] }) {
  const { scene } = useGLTF(url);
  const obj = useMemo(() => {
    const clone = scene.clone(true);
    const box = new THREE.Box3().setFromObject(clone);
    const dims = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const s = size / Math.max(dims.x, dims.y, dims.z, 1e-6);
    const g = new THREE.Group();
    clone.position.sub(centre);
    g.add(clone);
    g.scale.setScalar(s);
    return g;
  }, [scene, size]);
  return <primitive object={obj} rotation={rotation} />;
}

function SafeModel(props: { url: string; size: number; rotation?: [number, number, number] }) {
  const ok = useExists(props.url);
  if (!ok) return null;
  return (
    <Boundary>
      <Suspense fallback={null}>
        <Fitted {...props} />
      </Suspense>
    </Boundary>
  );
}

/** Chip above/behind the AI network, neuron above/behind the SPIKING network. */
export function SceneModels() {
  return (
    <>
      <group position={[-1.5, 2.6, -3.4]}>
        <SafeModel url={CHIP_URL} size={1} />
      </group>
      <group position={[1.5, 2.6, -3.4]}>
        <SafeModel url={NEURON_URL} size={1} />
      </group>
    </>
  );
}

/** Pen that follows the right controller in VR, tip forward along the ray (-Z). */
export function ControllerPen() {
  const mode = useXR((s) => s.mode);
  if (mode !== "immersive-vr") return null;
  return <PenInner />;
}

function PenInner() {
  const controller = useXRInputSourceState("controller", "right");
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = group.current;
    const obj = controller?.object;
    if (!g) return;
    g.visible = !!obj;
    if (!obj) return;
    obj.updateWorldMatrix(true, false);
    obj.matrixWorld.decompose(g.position, g.quaternion, g.scale);
  });
  return (
    <group ref={group}>
      {/* Assumes the pen model's long axis is Y with the tip at +Y; rotate so the tip points to -Z. */}
      <group rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -0.06]}>
        <SafeModel url={PEN_URL} size={0.15} />
      </group>
    </group>
  );
}
