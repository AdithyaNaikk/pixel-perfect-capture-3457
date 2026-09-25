import { useFrame } from "@react-three/fiber";
import { useXR, useXRInputSourceState } from "@react-three/xr";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";

import { rightHand, teleportEvents } from "@/lib/rightHand";

const ARC_POINTS = 48;
const SPEED = 7;
const G = -9.8;
const FADE_S = 0.1;
const VALID = new THREE.Color("#4aa8ff");
const INVALID = new THREE.Color("#ff4455");

function isValidSpot(x: number, z: number) {
  if (Math.hypot(x, z) > 6) return false;
  if (x > -4.0 && x < -0.8 && z > -5.5 && z < 0.4) return false; // AI network
  if (x > 0.8 && x < 4.3 && z > -5.5 && z < 0.4) return false; // Brain neuron / figure
  if (Math.abs(x) < 0.8 && Math.abs(z - 1.6) < 0.45) return false; // drawing panel
  return true;
}

/** Right-grip teleport with an arc, floor ring and short fade. VR only. */
export function Teleport({ originRef }: { originRef: RefObject<THREE.Group | null> }) {
  const mode = useXR((s) => s.mode);
  if (mode !== "immersive-vr") return null;
  return <TeleportInner originRef={originRef} />;
}

function TeleportInner({ originRef }: { originRef: RefObject<THREE.Group | null> }) {
  const right = useXRInputSourceState("controller", "right");
  const lineRef = useRef<THREE.Line>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const fadeRef = useRef<THREE.Mesh>(null);
  const state = useRef({ aiming: false, valid: false, fade: -1, moved: false });
  const tmp = useMemo(() => ({ o: new THREE.Vector3(), d: new THREE.Vector3(), p: new THREE.Vector3(), target: new THREE.Vector3(), head: new THREE.Vector3() }), []);
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(ARC_POINTS * 3), 3));
    g.setDrawRange(0, 0);
    return g;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => { if (rightHand.mode === "teleport") rightHand.mode = "idle"; }, []);

  useFrame(({ camera }, delta) => {
    const s = state.current;
    const line = lineRef.current;
    const ring = ringRef.current;
    const fade = fadeRef.current;
    if (!line || !ring || !fade) return;

    // Fade to black and back; move the origin at full black.
    if (s.fade >= 0) {
      s.fade += delta;
      if (!s.moved && s.fade >= FADE_S) {
        const origin = originRef.current;
        if (origin) {
          camera.getWorldPosition(tmp.head);
          origin.position.x += tmp.target.x - tmp.head.x;
          origin.position.z += tmp.target.z - tmp.head.z;
        }
        s.moved = true;
      }
      const k = s.fade < FADE_S ? s.fade / FADE_S : Math.max(0, 1 - (s.fade - FADE_S) / FADE_S);
      camera.getWorldPosition(fade.position);
      (fade.material as THREE.MeshBasicMaterial).opacity = k;
      fade.visible = true;
      if (s.fade >= FADE_S * 2) { s.fade = -1; fade.visible = false; teleportEvents.done++; }
    }

    const grip = right?.gamepad["xr-standard-squeeze"]?.state === "pressed";
    const obj = right?.object;
    if (grip && rightHand.mode === "idle") rightHand.mode = "teleport";
    const aiming = grip && rightHand.mode === "teleport" && !!obj;

    if (!aiming) {
      if (s.aiming && s.valid && s.fade < 0) { s.fade = 0; s.moved = false; }
      if (!grip && rightHand.mode === "teleport") rightHand.mode = "idle";
      s.aiming = false;
      line.visible = false;
      ring.visible = false;
      return;
    }
    s.aiming = true;
    obj!.updateWorldMatrix(true, false);
    obj!.getWorldPosition(tmp.o);
    tmp.d.set(0, 0, -1).transformDirection(obj!.matrixWorld).multiplyScalar(SPEED);
    const arr = geometry.attributes["position"]!.array as Float32Array;
    let n = 0;
    let hit = false;
    for (let i = 0; i < ARC_POINTS; i++) {
      const t = i * 0.035;
      tmp.p.set(tmp.o.x + tmp.d.x * t, tmp.o.y + tmp.d.y * t + 0.5 * G * t * t, tmp.o.z + tmp.d.z * t);
      if (tmp.p.y <= 0) {
        // Clamp the last point onto the floor.
        const prevY = n > 0 ? arr[(n - 1) * 3 + 1]! : tmp.o.y;
        const f = prevY / Math.max(1e-6, prevY - tmp.p.y);
        if (n > 0) tmp.p.set(arr[(n - 1) * 3]! + (tmp.p.x - arr[(n - 1) * 3]!) * f, 0, arr[(n - 1) * 3 + 2]! + (tmp.p.z - arr[(n - 1) * 3 + 2]!) * f);
        else tmp.p.y = 0;
        arr[n * 3] = tmp.p.x; arr[n * 3 + 1] = 0.01; arr[n * 3 + 2] = tmp.p.z;
        n++;
        hit = true;
        break;
      }
      arr[n * 3] = tmp.p.x; arr[n * 3 + 1] = tmp.p.y; arr[n * 3 + 2] = tmp.p.z;
      n++;
    }
    geometry.setDrawRange(0, n);
    geometry.attributes["position"]!.needsUpdate = true;
    s.valid = hit && isValidSpot(tmp.p.x, tmp.p.z);
    if (hit) tmp.target.set(tmp.p.x, 0, tmp.p.z);
    const color = s.valid ? VALID : INVALID;
    (line.material as THREE.LineBasicMaterial).color.copy(color);
    (ring.material as THREE.MeshBasicMaterial).color.copy(color);
    line.visible = true;
    ring.visible = hit;
    ring.position.set(tmp.p.x, 0.015, tmp.p.z);
  });

  return (
    <>
      {/* @ts-expect-error three line element */}
      <line ref={lineRef} geometry={geometry} frustumCulled={false} visible={false} raycast={() => null}>
        <lineBasicMaterial color={VALID} toneMapped={false} />
      </line>
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} visible={false} raycast={() => null}>
        <ringGeometry args={[0.16, 0.22, 32]} />
        <meshBasicMaterial color={VALID} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={fadeRef} visible={false} renderOrder={1000} raycast={() => null}>
        <sphereGeometry args={[0.3, 12, 8]} />
        <meshBasicMaterial color="#000" transparent opacity={0} side={THREE.BackSide} depthTest={false} depthWrite={false} />
      </mesh>
    </>
  );
}
