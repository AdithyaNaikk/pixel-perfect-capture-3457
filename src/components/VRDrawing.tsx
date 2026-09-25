import { Text } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useXR, useXRInputSourceState } from "@react-three/xr";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { preprocessStrokes, type Point } from "@/lib/preprocess";
import { useAppStore } from "@/lib/store";

const PANEL_POS = new THREE.Vector3(0, 1.2, 1.6);
const PANEL_SIZE = 0.6;
const MAX_SEGMENTS = 20000;
const GLOW = "#ffe2b8";

function pressed(state: { state?: string } | undefined) {
  return state?.state === "pressed";
}

/** Ray-based drawing panel in VR. Renders only in immersive VR. */
export function VRDrawing() {
  const mode = useXR((s) => s.mode);
  if (mode !== "immersive-vr") return null;
  return <VRDrawingInner />;
}

function VRDrawingInner() {
  const controller = useXRInputSourceState("controller", "right");
  const left = useXRInputSourceState("controller", "left");
  const run = useAppStore((s) => s.run);
  const lesionMode = useAppStore((s) => s.lesionMode);
  const lesionedCount = useAppStore((s) => s.lesioned.size);
  const prevX = useRef(false);
  const prev = useRef({ a: false, b: false });
  /** Strokes in panel-local 2D coordinates (metres, y up). */
  const strokes = useRef<Point[][]>([]);
  const current = useRef<Point[] | null>(null);
  /** Latest ray hit on the panel in local coordinates, or null when the ray is off the panel. */
  const hit = useRef<THREE.Vector3 | null>(null);
  const hitVec = useMemo(() => new THREE.Vector3(), []);
  const segCount = useRef(0);

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
    strokes.current = [];
    current.current = null;
    segCount.current = 0;
    geometry.setDrawRange(0, 0);
  };

  const submit = () => {
    const pts: Point[][] = strokes.current
      .filter((s) => s.length > 0)
      // mm units; flip Y so the result is screen-like (y down) for preprocessStrokes.
      .map((s) => s.map((p) => ({ x: p.x * 1000, y: -p.y * 1000 })));
    if (pts.length === 0) return;
    run(preprocessStrokes(pts));
  };

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    hitVec.copy(e.point).sub(PANEL_POS); // panel faces +Z, unrotated: local X/Y = world X/Y
    hit.current = hitVec;
  };
  const onLeave = () => {
    hit.current = null;
  };

  useFrame(() => {
    const x = pressed(left?.gamepad["x-button"]);
    if (x && !prevX.current) useAppStore.getState().toggleLesionMode();
    prevX.current = x;
    if (!controller) return;
    const trigger =
      !useAppStore.getState().lesionMode && pressed(controller.gamepad["xr-standard-trigger"]);
    const a = pressed(controller.gamepad["a-button"]);
    const b = pressed(controller.gamepad["b-button"]);
    const h = hit.current;

    if (trigger && h) {
      if (!current.current) {
        current.current = [];
        strokes.current.push(current.current);
      }
      const stroke = current.current;
      const last = stroke[stroke.length - 1];
      const px = h.x;
      const py = h.y;
      if (!last || Math.abs(last.x - px) + Math.abs(last.y - py) > 0.001) {
        if (last && segCount.current < MAX_SEGMENTS) {
          const arr = geometry.attributes["position"]!.array as Float32Array;
          const o = segCount.current * 6;
          arr[o] = last.x; arr[o + 1] = last.y; arr[o + 2] = 0.003;
          arr[o + 3] = px; arr[o + 4] = py; arr[o + 5] = 0.003;
          segCount.current++;
          geometry.attributes["position"]!.needsUpdate = true;
          geometry.setDrawRange(0, segCount.current * 2);
        }
        stroke.push({ x: px, y: py });
      }
    } else {
      current.current = null;
    }

    if (a && !prev.current.a) submit();
    if (b && !prev.current.b) clear();
    prev.current = { a, b };
  });

  const h = PANEL_SIZE / 2;
  const border = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([-h, -h, 0, h, -h, 0, h, h, 0, -h, h, 0, -h, -h, 0], 3),
    );
    return g;
  }, [h]);

  return (
    <group position={PANEL_POS}>
      <mesh renderOrder={0} onPointerMove={onMove} onPointerOver={onMove} onPointerLeave={onLeave} onPointerOut={onLeave}>
        <planeGeometry args={[PANEL_SIZE, PANEL_SIZE]} />
        <meshBasicMaterial color="#0b0f16" transparent opacity={0.6} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <line>
        <primitive object={border} attach="geometry" />
        <lineBasicMaterial color="#ffffff" toneMapped={false} />
      </line>
      <lineSegments geometry={geometry} frustumCulled={false} raycast={() => null}>
        <lineBasicMaterial color={GLOW} toneMapped={false} />
      </lineSegments>
      <Text position={[0, h + 0.03, 0]} fontSize={0.03} color={GLOW} anchorX="center" anchorY="middle">
        Draw here
      </Text>
      <VRButton label="Clear" position={[-0.3, -h - 0.07, 0]} onPress={clear} />
      <VRButton label="Submit" position={[-0.1, -h - 0.07, 0]} onPress={submit} />
      <VRButton
        label="Lesion mode"
        position={[0.1, -h - 0.07, 0]}
        onPress={() => useAppStore.getState().toggleLesionMode()}
        active={lesionMode}
      />
      <VRButton label="Heal all" position={[0.3, -h - 0.07, 0]} onPress={() => useAppStore.getState().healAll()} />
      <VRButton
        label="Run again"
        position={[0.5, -h - 0.07, 0]}
        onPress={() => {
          const img = useAppStore.getState().inputImage;
          if (img) useAppStore.getState().run(img);
        }}
      />
      <Text position={[0.1, -h - 0.135, 0]} fontSize={0.022} color={lesionMode ? "#ff5566" : "#c9a0a6"} anchorX="center" anchorY="middle">
        {`Lesioned: ${lesionedCount} / 64`}
      </Text>
      <Text position={[0, -h - 0.17, 0]} fontSize={0.018} color="#9fb0c4" anchorX="center" anchorY="middle">
        Trigger: draw · A: Submit · B: Clear · X: lesion mode
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
  );
}

function VRButton({
  label,
  position,
  onPress,
  active = false,
}: {
  label: string;
  position: [number, number, number];
  onPress: () => void;
  active?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <group position={position}>
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          onPress();
        }}
        onPointerOver={() => setHover(true)}
        onPointerOut={() => setHover(false)}
      >
        <planeGeometry args={[0.18, 0.07]} />
        <meshBasicMaterial color={active ? (hover ? "#d6334a" : "#b3202f") : hover ? "#2c3f57" : "#162232"} side={THREE.DoubleSide} />
      </mesh>
      <Text position={[0, 0, 0.002]} fontSize={0.026} color="#ffffff" anchorX="center" anchorY="middle" raycast={() => null}>
        {label}
      </Text>
    </group>
  );
}
