import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useXR, useXRInputSourceState } from "@react-three/xr";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { preprocessStrokes, type Point } from "@/lib/preprocess";
import { useAppStore } from "@/lib/store";
import { rightHand } from "@/lib/rightHand";
import { goldenSeven } from "@/lib/selfTest";

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
  const prevLeftTrigger = useRef(false);
  const prev = useRef({ a: false, b: false });
  /** Strokes in panel-local 2D coordinates (metres, y up). */
  const strokes = useRef<Point[][]>([]);
  const current = useRef<Point[] | null>(null);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const rayOrigin = useMemo(() => new THREE.Vector3(), []);
  const rayDirection = useMemo(() => new THREE.Vector3(), []);
  const segCount = useRef(0);
  const tipLocal = useMemo(() => new THREE.Vector3(0, 0, -0.13), []);
  const tip = useMemo(() => new THREE.Vector3(), []);
  const [warning, setWarning] = useState("");
  const weightsStatus = useAppStore((s) => s.weightsStatus);
  const selfTest = useAppStore((s) => s.selfTest);

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
    setWarning("");
  };

  const submit = () => {
    const pts: Point[][] = strokes.current
      .filter((s) => s.length > 0)
      // mm units; flip Y so the result is screen-like (y down) for preprocessStrokes.
      .map((s) => s.map((p) => ({ x: p.x * 1000, y: -p.y * 1000 })));
    const all = pts.flat();
    if (all.length === 0) return setWarning("Nothing drawn yet");
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of all) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
    const size = Math.max(maxX - minX, maxY - minY);
    if (all.length < 5 || size < 5) return setWarning("Only a dot: draw a full digit");
    if (size < 30) return setWarning("Too small: draw bigger");
    setWarning("");
    run(preprocessStrokes(pts));
  };


  useFrame(({ scene }) => {
    const x = pressed(left?.gamepad["x-button"]);
    if (x && !prevX.current) useAppStore.getState().toggleLesionMode();
    prevX.current = x;
    const leftTrigger = pressed(left?.gamepad["xr-standard-trigger"]);
    if (lesionMode && leftTrigger && !prevLeftTrigger.current && left?.object) {
      const target = scene.getObjectByName("ai-hidden-neurons");
      if (target) {
        left.object.updateWorldMatrix(true, false);
        left.object.getWorldPosition(rayOrigin);
        rayDirection.set(0, 0, -1).transformDirection(left.object.matrixWorld);
        raycaster.set(rayOrigin, rayDirection);
        const hitNeuron = raycaster.intersectObject(target, false)[0];
        if (hitNeuron?.instanceId !== undefined) useAppStore.getState().toggleLesion(hitNeuron.instanceId);
      }
    }
    prevLeftTrigger.current = leftTrigger;
    if (!controller) return;
    const trigger = pressed(controller.gamepad["xr-standard-trigger"]);
    const a = pressed(controller.gamepad["a-button"]);
    const b = pressed(controller.gamepad["b-button"]);
    if (trigger && rightHand.mode === "idle") rightHand.mode = "draw";
    if (!trigger && rightHand.mode === "draw") rightHand.mode = "idle";
    const obj = controller.object;

    if (trigger && rightHand.mode === "draw" && obj) {
      // Controller tip in world space -> panel-local 2D (x right, y up; panel is unrotated).
      obj.updateWorldMatrix(true, false);
      tip.copy(tipLocal).applyMatrix4(obj.matrixWorld).sub(PANEL_POS);
      if (!current.current) {
        current.current = [];
        strokes.current.push(current.current);
      }
      const stroke = current.current;
      const last = stroke[stroke.length - 1];
      const px = tip.x;
      const py = tip.y;
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
      <mesh
        renderOrder={0}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
      >
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
      <Text position={[0, h + 0.075, 0]} fontSize={0.022} color={weightsStatus === "RANDOM WEIGHTS" ? "#ff5566" : "#7fe3a8"} anchorX="center" anchorY="middle">
        {`${weightsStatus}${selfTest ? "  ·  " + selfTest : ""}`}
      </Text>
      {warning && (
        <Text position={[0, -h + 0.04, 0.004]} fontSize={0.026} color="#ffb070" anchorX="center" anchorY="middle">
          {warning}
        </Text>
      )}
      <VRButton label="Test digit" position={[-0.5, -h - 0.07, 0]} onPress={() => { clear(); run(goldenSeven()); }} />
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
      <group position={[h + 0.12, 0, 0]}>
        <mesh>
          <planeGeometry args={[0.16, 0.16]} />
          <meshBasicMaterial map={texture} toneMapped={false} />
        </mesh>
        <Text position={[0, -0.1, 0]} fontSize={0.016} color="#9fb0c4" anchorX="center" anchorY="middle">
          network input 28×28
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
