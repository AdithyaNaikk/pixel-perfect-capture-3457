import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useXR, useXRInputSourceState } from "@react-three/xr";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { preprocessStrokes, type Point } from "@/lib/preprocess";
import { useAppStore } from "@/lib/store";

const FRAME_POS = new THREE.Vector3(0, 1.3, -0.7);
const FRAME_SIZE = 0.5;
const MAX_SEGMENTS = 20000;
const GLOW = "#ffe2b8";

function pressed(state: { state?: string } | undefined) {
  return state?.state === "pressed";
}

/** Air drawing in VR with the right controller. Renders only in immersive VR. */
export function VRDrawing() {
  const mode = useXR((s) => s.mode);
  if (mode !== "immersive-vr") return null;
  return <VRDrawingInner />;
}

function VRDrawingInner() {
  const controller = useXRInputSourceState("controller", "right");
  const run = useAppStore((s) => s.run);
  const strokes3d = useRef<THREE.Vector3[][]>([]);
  const current = useRef<THREE.Vector3[] | null>(null);
  const prev = useRef({ trigger: false, a: false, b: false });
  const segCount = useRef(0);
  const tmp = useMemo(() => new THREE.Vector3(), []);

  // Frame faces the user (+Z); local axes are world X / Y.
  const frame = useMemo(() => {
    const quat = new THREE.Quaternion();
    return {
      xAxis: new THREE.Vector3(1, 0, 0).applyQuaternion(quat),
      yAxis: new THREE.Vector3(0, 1, 0).applyQuaternion(quat),
    };
  }, []);

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_SEGMENTS * 6), 3));
    g.setDrawRange(0, 0);
    return g;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const texture = useMemo(() => {
    const t = new THREE.DataTexture(new Uint8Array(28 * 28 * 4), 28, 28, THREE.RGBAFormat);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.flipY = false;
    return t;
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);

  useEffect(() => {
    const apply = (img: Float32Array | null) => {
      const data = texture.image.data as Uint8Array;
      // DataTexture row 0 is the bottom; image row 0 is the top.
      for (let r = 0; r < 28; r++) {
        for (let c = 0; c < 28; c++) {
          const v = Math.round((img?.[r * 28 + c] ?? 0) * 255);
          const o = ((27 - r) * 28 + c) * 4;
          data[o] = v;
          data[o + 1] = v;
          data[o + 2] = v;
          data[o + 3] = 255;
        }
      }
      texture.needsUpdate = true;
    };
    apply(useAppStore.getState().inputImage);
    return useAppStore.subscribe((s, p) => {
      if (s.inputImage !== p.inputImage) apply(s.inputImage);
    });
  }, [texture]);

  const clear = () => {
    strokes3d.current = [];
    current.current = null;
    segCount.current = 0;
    geometry.setDrawRange(0, 0);
  };

  const runDrawing = () => {
    const strokes: Point[][] = strokes3d.current
      .filter((s) => s.length > 0)
      .map((s) =>
        s.map((p) => {
          tmp.copy(p).sub(FRAME_POS);
          // mm units; flip Y so the result is screen-like (y down).
          return { x: tmp.dot(frame.xAxis) * 1000, y: -tmp.dot(frame.yAxis) * 1000 };
        }),
      );
    run(preprocessStrokes(strokes));
  };

  useFrame(() => {
    if (!controller) return;
    const trigger = pressed(controller.gamepad["xr-standard-trigger"]);
    const a = pressed(controller.gamepad["a-button"]);
    const b = pressed(controller.gamepad["b-button"]);
    const was = prev.current;

    if (trigger && controller.object) {
      const pos = controller.object.getWorldPosition(new THREE.Vector3());
      if (!was.trigger || !current.current) {
        current.current = [];
        strokes3d.current.push(current.current);
      }
      const stroke = current.current;
      const last = stroke[stroke.length - 1];
      if (last && segCount.current < MAX_SEGMENTS) {
        const arr = geometry.attributes.position!.array as Float32Array;
        const o = segCount.current * 6;
        arr[o] = last.x; arr[o + 1] = last.y; arr[o + 2] = last.z;
        arr[o + 3] = pos.x; arr[o + 4] = pos.y; arr[o + 5] = pos.z;
        segCount.current++;
        geometry.attributes.position!.needsUpdate = true;
        geometry.setDrawRange(0, segCount.current * 2);
      }
      stroke.push(pos);
    } else if (was.trigger) {
      current.current = null;
    }

    if (a && !was.a) runDrawing();
    if (b && !was.b) clear();
    prev.current = { trigger, a, b };
  });

  const h = FRAME_SIZE / 2;
  const border = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([-h, -h, 0, h, -h, 0, h, h, 0, -h, h, 0, -h, -h, 0], 3),
    );
    return g;
  }, [h]);

  return (
    <>
      <group position={FRAME_POS}>
        <mesh renderOrder={0}>
          <planeGeometry args={[FRAME_SIZE, FRAME_SIZE]} />
          <meshBasicMaterial color="#1a2433" transparent opacity={0.25} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        <line>
          <primitive object={border} attach="geometry" />
          <lineBasicMaterial color={GLOW} toneMapped={false} />
        </line>
        <Text position={[0, h + 0.03, 0]} fontSize={0.03} color={GLOW} anchorX="center" anchorY="middle">
          Draw here
        </Text>
        <Text position={[0, -h - 0.03, 0]} fontSize={0.018} color="#9fb0c4" anchorX="center" anchorY="middle">
          Trigger: draw · A: Run · B: Clear
        </Text>
        <group position={[h + 0.12, 0, 0]}>
          <mesh>
            <planeGeometry args={[0.16, 0.16]} />
            <meshBasicMaterial map={texture} toneMapped={false} />
          </mesh>
          <Text position={[0, -0.1, 0]} fontSize={0.016} color="#9fb0c4" anchorX="center" anchorY="middle">
            28×28
          </Text>
        </group>
      </group>
      <lineSegments geometry={geometry} frustumCulled={false}>
        <lineBasicMaterial color={GLOW} toneMapped={false} />
      </lineSegments>
    </>
  );
}
