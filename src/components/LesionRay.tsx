import { useFrame, useThree } from "@react-three/fiber";
import { useXR, useXRInputSourceState } from "@react-three/xr";
import { useMemo, useRef } from "react";
import * as THREE from "three";

import { HIDDEN_RADIUS } from "@/lib/layout";
import { useAppStore } from "@/lib/store";

const MAX_LEN = 8;
/** Extra tolerance around each neuron so small far-away spheres are easy to hit. */
const PICK_RADIUS = HIDDEN_RADIUS * 1.8;

/** VR lesion selection: left-controller ray + trigger toggles AI hidden neurons (shared lesion mask). */
export function LesionRay() {
  const mode = useXR((s) => s.mode);
  if (mode !== "immersive-vr") return null;
  return <LesionRayInner />;
}

function LesionRayInner() {
  const left = useXRInputSourceState("controller", "left");
  const { gl, camera } = useThree();
  const prevTrigger = useRef(false);
  const prevX = useRef(false);
  const lineRef = useRef<THREE.Line>(null);
  const dotRef = useRef<THREE.Mesh>(null);
  const tmp = useMemo(
    () => ({ m: new THREE.Matrix4(), o: new THREE.Vector3(), d: new THREE.Vector3(), p: new THREE.Vector3(), q: new THREE.Vector3(), ray: new THREE.Ray() }),
    [],
  );
  const lineGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
    return g;
  }, []);

  useFrame(({ scene }) => {
    const st = useAppStore.getState();
    const x = left?.gamepad["x-button"]?.state === "pressed";
    if (x && !prevX.current) st.toggleLesionMode();
    prevX.current = x;

    const line = lineRef.current;
    const dot = dotRef.current;
    const trigger = left?.gamepad["xr-standard-trigger"]?.state === "pressed";
    const show = st.lesionMode && !!left;
    if (line) line.visible = show;
    if (dot) dot.visible = false;
    if (!show) {
      prevTrigger.current = trigger;
      return;
    }

    // Ray from the controller's target-ray pose (reference space), moved into world space by the XR origin.
    const frame = gl.xr.getFrame();
    const ref = gl.xr.getReferenceSpace();
    const pose = frame && ref ? frame.getPose(left.inputSource.targetRaySpace, ref) : undefined;
    if (pose) {
      tmp.m.fromArray(pose.transform.matrix);
      if (camera.parent) tmp.m.premultiply(camera.parent.matrixWorld);
    } else if (left.object) {
      left.object.updateWorldMatrix(true, false);
      tmp.m.copy(left.object.matrixWorld);
    } else return;
    tmp.o.setFromMatrixPosition(tmp.m);
    tmp.d.set(0, 0, -1).transformDirection(tmp.m);
    tmp.ray.set(tmp.o, tmp.d);

    // Nearest hidden neuron within PICK_RADIUS of the ray.
    const mesh = scene.getObjectByName("ai-hidden-neurons") as THREE.InstancedMesh | undefined;
    let best = -1;
    let bestT = MAX_LEN;
    if (mesh) {
      mesh.updateWorldMatrix(true, false);
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, tmp.m);
        tmp.p.setFromMatrixPosition(tmp.m).applyMatrix4(mesh.matrixWorld);
        const t = tmp.q.copy(tmp.p).sub(tmp.o).dot(tmp.d);
        if (t <= 0 || t >= bestT) continue;
        if (tmp.ray.distanceSqToPoint(tmp.p) <= PICK_RADIUS * PICK_RADIUS) {
          best = i;
          bestT = t;
        }
      }
    }
    st.setHoverHidden(best >= 0 ? best : null);

    if (line) {
      const a = lineGeo.attributes["position"]!.array as Float32Array;
      tmp.p.copy(tmp.d).multiplyScalar(bestT).add(tmp.o);
      a[0] = tmp.o.x; a[1] = tmp.o.y; a[2] = tmp.o.z;
      a[3] = tmp.p.x; a[4] = tmp.p.y; a[5] = tmp.p.z;
      lineGeo.attributes["position"]!.needsUpdate = true;
      if (dot && best >= 0) {
        dot.position.copy(tmp.p);
        dot.visible = true;
      }
    }
    if (trigger && !prevTrigger.current && best >= 0) st.toggleLesion(best);
    prevTrigger.current = trigger;
  });

  return (
    <>
      {/* @ts-expect-error three line element */}
      <line ref={lineRef} geometry={lineGeo} frustumCulled={false} visible={false} raycast={() => null}>
        <lineBasicMaterial color="#ff4a5a" transparent opacity={0.8} toneMapped={false} />
      </line>
      <mesh ref={dotRef} visible={false} raycast={() => null}>
        <sphereGeometry args={[0.02, 8, 6]} />
        <meshBasicMaterial color="#ff4a5a" toneMapped={false} />
      </mesh>
    </>
  );
}
