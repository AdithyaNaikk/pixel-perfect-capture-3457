import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useXR, useXRInputSourceState } from "@react-three/xr";
import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";

import brainAsset from "@/assets/brain.glb.asset.json";
import chipAsset from "@/assets/chip.glb.asset.json";
import neuronAsset from "@/assets/neuron.glb.asset.json";
import penAsset from "@/assets/pen.glb.asset.json";

export const CHIP_URL = chipAsset.url;
export const NEURON_URL = neuronAsset.url;
export const BRAIN_URL = brainAsset.url;
export const PEN_URL = penAsset.url;

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
if (typeof window !== "undefined") [CHIP_URL, NEURON_URL, BRAIN_URL, PEN_URL].forEach(checkModel);

class Boundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(err: unknown) {
    console.warn("[models] failed to load model", err);
  }
  override render() {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
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

function SafeModel({
  fallback = null,
  ...props
}: {
  url: string;
  size: number;
  rotation?: [number, number, number];
  fallback?: ReactNode;
}) {
  const ok = useExists(props.url);
  if (!ok) return <>{fallback}</>;
  return (
    <Boundary fallback={fallback}>
      <Suspense fallback={null}>
        <Fitted {...props} />
      </Suspense>
    </Boundary>
  );
}

/** Chip above the AI network, neuron above the Brain network, brain at its right edge. */
export function SceneModels() {
  return (
    <>
      <group position={[-2.4, 2.75, -4.6]}>
        <SafeModel url={CHIP_URL} size={1} fallback={<ChipPlaceholder />} />
      </group>
      <group position={[1.9, 2.8, -4.6]}>
        <SafeModel url={NEURON_URL} size={1} fallback={<NeuronPlaceholder />} />
      </group>
      <group position={[3.65, 2.65, -4.6]}>
        <SafeModel url={BRAIN_URL} size={1.15} />
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

/** Placeholder chip: flat dark box with a glowing cyan core. */
function ChipPlaceholder() {
  return (
    <group rotation={[0.5, 0, 0]}>
      <mesh>
        <boxGeometry args={[0.8, 0.08, 0.8]} />
        <meshBasicMaterial color="#1c2436" />
      </mesh>
      <mesh position={[0, 0.05, 0]}>
        <boxGeometry args={[0.36, 0.03, 0.36]} />
        <meshBasicMaterial color="#5fd4f5" toneMapped={false} />
      </mesh>
    </group>
  );
}

const BRANCHES: { rot: [number, number, number]; len: number }[] = [
  { rot: [0, 0, 0.5], len: 0.35 },
  { rot: [0, 0, -0.6], len: 0.4 },
  { rot: [0, 0, 2.4], len: 0.3 },
  { rot: [0, 0, -2.3], len: 0.35 },
  { rot: [0.9, 0, 0.1], len: 0.3 },
  { rot: [0, 0, Math.PI], len: 0.45 },
];

/** Placeholder neuron: sphere with a few branching cylinders. */
function NeuronPlaceholder() {
  return (
    <group>
      <mesh>
        <sphereGeometry args={[0.16, 20, 14]} />
        <meshBasicMaterial color="#ff5fc8" toneMapped={false} />
      </mesh>
      {BRANCHES.map((b, i) => (
        <group key={i} rotation={b.rot}>
          <mesh position={[0, 0.14 + b.len / 2, 0]}>
            <cylinderGeometry args={[0.012, 0.025, b.len, 6]} />
            <meshBasicMaterial color="#c24a9c" />
          </mesh>
        </group>
      ))}
    </group>
  );
}
