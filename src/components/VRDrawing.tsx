import { Text } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useXR, useXRInputSourceState } from "@react-three/xr";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { preprocessStrokes, type Point } from "@/lib/preprocess";
import { useAppStore } from "@/lib/store";
import { rightHand, teleportEvents } from "@/lib/rightHand";
import { goldenSeven } from "@/lib/selfTest";

const PANEL_POS = new THREE.Vector3(0, 1.2, 1.6);
const PANEL_SIZE = 0.3;
const CANVAS = 512;
const INK_WIDTH = 22;
const PAD_DISTANCE = 0.7;
const CHEST_DROP = 0.2;
const PAD_TILT = -0.3;
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
  const run = useAppStore((s) => s.run);
  const lesionMode = useAppStore((s) => s.lesionMode);
  const lesionedCount = useAppStore((s) => s.lesioned.size);
  const prev = useRef({ a: false, b: false });
  /** Strokes in pad-canvas pixels (0..512, y down), like the desktop pad. */
  const strokes = useRef<Point[][]>([]);
  const current = useRef<Point[] | null>(null);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const hits = useMemo<THREE.Intersection[]>(() => [], []);
  const padMesh = useRef<THREE.Mesh>(null);
  const [warning, setWarning] = useState("");
  const weightsStatus = useAppStore((s) => s.weightsStatus);
  const selfTest = useAppStore((s) => s.selfTest);
  const brainSelfTest = useAppStore((s) => s.brainSelfTest);
  const brainCounts = useAppStore((s) => s.brainCounts);

  const ink = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = CANVAS;
    const ctx = canvas.getContext("2d")!;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return { canvas, ctx, tex };
  }, []);
  const wipe = () => {
    const { ctx, tex } = ink;
    ctx.fillStyle = "#0b0f16";
    ctx.fillRect(0, 0, CANVAS, CANVAS);
    tex.needsUpdate = true;
  };
  useEffect(() => {
    wipe();
    return () => ink.tex.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ink]);

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
    wipe();
    setWarning("");
  };

  const submit = () => {
    const pts: Point[][] = strokes.current
      .filter((s) => s.length > 0)
      // Canvas pixels, y down; scaled to the desktop pad's 280 px so the size checks match.
      .map((s) => s.map((p) => ({ x: (p.x * 280) / CANVAS, y: (p.y * 280) / CANVAS })));
    const all = pts.flat();
    if (all.length === 0) return setWarning("Nothing drawn yet");
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of all) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
    const size = Math.max(maxX - minX, maxY - minY);
    if (all.length < 5 || size < 5) return setWarning("Only a dot: draw a full digit");
    if (size < 20) return setWarning("Too small: draw bigger");
    setWarning("");
    run(preprocessStrokes(pts));
  };


  const { camera } = useThree();
  const padRef = useRef<THREE.Group>(null);
  const cursorRef = useRef<THREE.Mesh>(null);
  const lastTeleport = useRef(teleportEvents.done);
  const tv = useMemo(() => ({ head: new THREE.Vector3(), fwd: new THREE.Vector3(), m: new THREE.Matrix4(), n: new THREE.Vector3() }), []);

  /** Place the pad 70 cm in front of the head, 20 cm below eye height, facing the user and tilted slightly back. */
  const bringPad = () => {
    const pad = padRef.current;
    if (!pad) return;
    camera.getWorldPosition(tv.head);
    camera.getWorldDirection(tv.fwd);
    tv.fwd.y = 0;
    if (tv.fwd.lengthSq() < 1e-6) tv.fwd.set(0, 0, -1);
    tv.fwd.normalize();
    pad.position.set(tv.head.x + tv.fwd.x * PAD_DISTANCE, tv.head.y - CHEST_DROP, tv.head.z + tv.fwd.z * PAD_DISTANCE);
    pad.rotation.set(PAD_TILT, Math.atan2(-tv.fwd.x, -tv.fwd.z), 0, "YXZ");
    current.current = null;
  };

  useFrame((state, _delta, frame) => {
    // Reposition only once a teleport has fully finished (after the fade).
    if (teleportEvents.done !== lastTeleport.current) {
      lastTeleport.current = teleportEvents.done;
      bringPad();
    }
    const cursor = cursorRef.current;
    if (cursor) cursor.visible = false;
    if (!controller) return;
    const trigger = pressed(controller.gamepad["xr-standard-trigger"]);
    const a = pressed(controller.gamepad["a-button"]);
    const b = pressed(controller.gamepad["b-button"]);
    if (trigger && rightHand.mode === "idle") rightHand.mode = "draw";
    if (!trigger && rightHand.mode === "draw") rightHand.mode = "idle";

    const mesh = padMesh.current;
    let hit: THREE.Intersection | undefined;
    // One raycast per frame from the target-ray pose (the same pose the visible ray uses).
    const refSpace = state.gl.xr.getReferenceSpace();
    const xrFrame = frame as XRFrame | undefined;
    const pose = xrFrame && refSpace ? xrFrame.getPose(controller.inputSource.targetRaySpace, refSpace) : undefined;
    if (pose && mesh) {
      tv.m.fromArray(pose.transform.matrix);
      const origin = camera.parent;
      if (origin) {
        origin.updateWorldMatrix(true, false);
        tv.m.premultiply(origin.matrixWorld);
      }
      raycaster.ray.origin.setFromMatrixPosition(tv.m);
      raycaster.ray.direction.set(0, 0, -1).transformDirection(tv.m);
      hits.length = 0;
      mesh.updateWorldMatrix(true, false);
      mesh.raycast(raycaster, hits);
      hit = hits[0];
      if (hit && cursor) {
        // Exactly at the hit, lifted 2 mm along the pad normal.
        cursor.position.copy(hit.point);
        mesh.worldToLocal(cursor.position);
        cursor.position.z = 0.002;
        cursor.visible = true;
      }
    }

    if (trigger && rightHand.mode === "draw" && hit?.uv) {
      const x = hit.uv.x * CANVAS;
      const y = (1 - hit.uv.y) * CANVAS;
      if (!current.current) {
        current.current = [];
        strokes.current.push(current.current);
      }
      const stroke = current.current;
      const last = stroke[stroke.length - 1];
      const { ctx, tex } = ink;
      ctx.strokeStyle = GLOW;
      ctx.fillStyle = GLOW;
      ctx.lineWidth = INK_WIDTH;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (!last) {
        ctx.beginPath();
        ctx.arc(x, y, INK_WIDTH / 2, 0, Math.PI * 2);
        ctx.fill();
        stroke.push({ x, y });
        tex.needsUpdate = true;
      } else if (Math.abs(last.x - x) + Math.abs(last.y - y) > 1) {
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(x, y);
        ctx.stroke();
        stroke.push({ x, y });
        tex.needsUpdate = true;
      }
    } else {
      // Off the pad or trigger released: the stroke ends (ink is clipped at the edges).
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
    <group ref={padRef} position={PANEL_POS}>
      <mesh
        ref={padMesh}
        renderOrder={0}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
      >
        <planeGeometry args={[PANEL_SIZE, PANEL_SIZE]} />
        <meshBasicMaterial map={ink.tex} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <line>
        <primitive object={border} attach="geometry" />
        <lineBasicMaterial color="#ffffff" toneMapped={false} />
      </line>
      <Text position={[0, h + 0.02, 0]} fontSize={0.02} color={GLOW} anchorX="center" anchorY="middle">
        Draw here
      </Text>
      <Text position={[0, h + 0.05, 0]} fontSize={0.014} color={weightsStatus === "RANDOM WEIGHTS" ? "#ff5566" : "#7fe3a8"} anchorX="center" anchorY="middle">
        {`${weightsStatus}${selfTest ? "  ·  " + selfTest : ""}`}
      </Text>
      {warning && (
        <Text position={[0, -h + 0.03, 0.004]} fontSize={0.016} color="#ffb070" anchorX="center" anchorY="middle">
          {warning}
        </Text>
      )}
      <mesh ref={cursorRef} visible={false} raycast={() => null} renderOrder={5}>
        <circleGeometry args={[0.004, 12]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} depthTest={false} />
      </mesh>
      <VRButton label="Clear" position={[-0.07, -h - 0.04, 0]} onPress={clear} />
      <VRButton label="Run" position={[0.07, -h - 0.04, 0]} onPress={submit} />
      <VRButton label="Test digit" position={[-0.21, -h - 0.04, 0]} onPress={() => { clear(); run(goldenSeven()); }} />
      <VRButton label="Bring pad" position={[0.21, -h - 0.04, 0]} onPress={bringPad} />
      <VRButton
        label="Lesion mode"
        position={[-0.21, -h - 0.105, 0]}
        onPress={() => useAppStore.getState().toggleLesionMode()}
        active={lesionMode}
      />
      <VRButton label="Lesion 10 random" position={[-0.07, -h - 0.105, 0]} onPress={() => useAppStore.getState().lesionRandom(10)} />
      <VRButton label="Heal all" position={[0.07, -h - 0.105, 0]} onPress={() => useAppStore.getState().healAll()} />
      <VRButton
        label="Run again"
        position={[0.21, -h - 0.105, 0]}
        onPress={() => {
          const img = useAppStore.getState().inputImage;
          if (img) useAppStore.getState().run(img);
        }}
      />
      <Text position={[0, -h - 0.155, 0]} fontSize={0.016} color={lesionMode ? "#ff5566" : "#c9a0a6"} anchorX="center" anchorY="middle">
        {`Damaged: ${lesionedCount} / 64${brainSelfTest ? "  ·  " + brainSelfTest : ""}`}
      </Text>
      {brainCounts && (
        <Text position={[0, -h - 0.18, 0]} fontSize={0.014} color="#ffb070" anchorX="center" anchorY="middle">
          {`Brain vote  ${brainCounts.map((c, d) => `${d}:${c}`).join("  ")}`}
        </Text>
      )}
      <group position={[h + 0.09, 0, 0]}>
        <mesh>
          <planeGeometry args={[0.12, 0.12]} />
          <meshBasicMaterial map={texture} toneMapped={false} />
        </mesh>
        <Text position={[0, -0.075, 0]} fontSize={0.012} color="#9fb0c4" anchorX="center" anchorY="middle">
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
        <planeGeometry args={[0.13, 0.05]} />
        <meshBasicMaterial color={active ? (hover ? "#d6334a" : "#b3202f") : hover ? "#2c3f57" : "#162232"} side={THREE.DoubleSide} />
      </mesh>
      <Text position={[0, 0, 0.002]} fontSize={label.length > 12 ? 0.013 : 0.017} color="#ffffff" anchorX="center" anchorY="middle" raycast={() => null}>
        {label}
      </Text>
    </group>
  );
}
