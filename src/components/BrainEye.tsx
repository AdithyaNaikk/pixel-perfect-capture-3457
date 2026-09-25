import { useEffect, useMemo } from "react";
import * as THREE from "three";

import { EYE_RADIUS, EYE_Y, EYE_Z, NERVE_END_Z, NERVE_START_Z, rand01 } from "@/lib/brainGeometry";

const noRay = () => null;
const IRIS_IN = 0.55;
const IRIS_OUT = 0.72;
const IRIS_Z = Math.sqrt(EYE_RADIUS * EYE_RADIUS - IRIS_OUT * IRIS_OUT);

/** Procedural stylised eye around the Brain input retina. Purely visual, never raycast. */
export function BrainEye({ cx }: { cx: number }) {
  const geo = useMemo(() => {
    // Radial iris stripes.
    const stripes: number[] = [];
    for (let k = 0; k < 64; k++) {
      const a = (k / 64) * Math.PI * 2 + rand01(k) * 0.05;
      const r0 = IRIS_IN + 0.01 + rand01(k + 3) * 0.03;
      const r1 = IRIS_OUT - 0.01 - rand01(k + 5) * 0.04;
      stripes.push(Math.cos(a) * r0, Math.sin(a) * r0, 0.002, Math.cos(a) * r1, Math.sin(a) * r1, 0.002);
    }
    const stripeGeo = new THREE.BufferGeometry();
    stripeGeo.setAttribute("position", new THREE.Float32BufferAttribute(stripes, 3));

    // Wandering veins on the sclera, starting near the back.
    const veins: number[] = [];
    const p = new THREE.Vector3();
    const q = new THREE.Vector3();
    for (let v = 0; v < 7; v++) {
      let theta = rand01(v + 10) * Math.PI * 2;
      let phi = 2.3 + rand01(v + 20) * 0.6; // from back (phi ~ pi) toward the front
      p.setFromSphericalCoords(EYE_RADIUS * 0.995, phi, theta);
      for (let s = 0; s < 10; s++) {
        phi -= 0.1 + rand01(v * 31 + s) * 0.05;
        theta += (rand01(v * 17 + s) - 0.5) * 0.35;
        q.setFromSphericalCoords(EYE_RADIUS * 0.995, phi, theta);
        // spherical coords: phi measured from +Y; rotate so the "back" pole is -Z
        veins.push(p.x, p.z, p.y, q.x, q.z, q.y);
        p.copy(q);
      }
    }
    const veinGeo = new THREE.BufferGeometry();
    veinGeo.setAttribute("position", new THREE.Float32BufferAttribute(veins, 3));

    // Optic nerve: tapered tube from the back of the eye toward the hidden layer.
    const len = NERVE_START_Z - NERVE_END_Z;
    const nerve = new THREE.CylinderGeometry(0.13, 0.07, len, 12, 1, true);
    nerve.rotateX(Math.PI / 2);
    return { stripeGeo, veinGeo, nerve, nerveLen: len };
  }, []);
  useEffect(
    () => () => {
      geo.stripeGeo.dispose();
      geo.veinGeo.dispose();
      geo.nerve.dispose();
    },
    [geo],
  );

  return (
    <group position={[cx, EYE_Y, EYE_Z]}>
      {/* Sclera */}
      <mesh raycast={noRay} renderOrder={-2}>
        <sphereGeometry args={[EYE_RADIUS, 20, 14]} />
        <meshBasicMaterial color="#ffe8f4" transparent opacity={0.18} side={THREE.BackSide} depthWrite={false} />
      </mesh>
      <lineSegments geometry={geo.veinGeo} raycast={noRay} renderOrder={-2}>
        <lineBasicMaterial color="#ff4a5e" transparent opacity={0.35} depthWrite={false} />
      </lineSegments>
      {/* Iris with open pupil */}
      <group position={[0, 0, IRIS_Z]}>
        <mesh raycast={noRay}>
          <ringGeometry args={[IRIS_IN, IRIS_OUT, 48, 1]} />
          <meshBasicMaterial color="#ff5fc8" transparent opacity={0.75} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
        </mesh>
        <lineSegments geometry={geo.stripeGeo} raycast={noRay}>
          <lineBasicMaterial color="#ffc2ea" transparent opacity={0.55} depthWrite={false} toneMapped={false} />
        </lineSegments>
      </group>
      {/* Cornea dome */}
      <mesh raycast={noRay} position={[0, 0, IRIS_Z - 0.35]} rotation={[Math.PI / 2, 0, 0]}>
        <sphereGeometry args={[0.66, 16, 6, 0, Math.PI * 2, 0, 0.95]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.06} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      {/* Optic nerve */}
      <mesh
        geometry={geo.nerve}
        raycast={noRay}
        position={[0, 0, (NERVE_START_Z + NERVE_END_Z) / 2 - EYE_Z]}
      >
        <meshBasicMaterial color="#ff9fd6" transparent opacity={0.35} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
