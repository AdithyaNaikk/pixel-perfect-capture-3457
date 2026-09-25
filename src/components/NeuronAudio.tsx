import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { makeClickBuffer } from "@/lib/neuronAudio";
import { useAppStore } from "@/lib/store";

/** Live audio drive written by the neuron playback each frame. */
export const neuronSound = { spikes: 0, potential: 0 };

const HUM_BASE = 70;
const HUM_RISE = 18;

/** Spatial click + soft hum at the cell body. Listener rides on the camera (headset in VR). */
export function NeuronAudio({ position }: { position: [number, number, number] }) {
  const { camera } = useThree();
  const group = useRef<THREE.Group>(null);
  const soundOn = useAppStore((s) => s.soundOn);

  const nodes = useMemo(() => {
    const listener = new THREE.AudioListener();
    const ctx = listener.context;
    const click = new THREE.PositionalAudio(listener);
    const hum = new THREE.PositionalAudio(listener);
    for (const a of [click, hum]) {
      a.setDistanceModel("inverse");
      a.setRefDistance(0.6);
      a.setRolloffFactor(2.2);
      a.setMaxDistance(30);
    }
    const buffer = makeClickBuffer(ctx);
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = HUM_BASE;
    const humGain = ctx.createGain();
    humGain.gain.value = 0.035;
    osc.connect(humGain);
    hum.setNodeSource(humGain as unknown as AudioBufferSourceNode);
    osc.start();
    return { listener, ctx, click, hum, buffer, osc };
  }, []);

  useEffect(() => {
    const { listener, click, hum, osc } = nodes;
    camera.add(listener);
    const g = group.current;
    g?.add(click, hum);
    return () => {
      camera.remove(listener);
      g?.remove(click, hum);
      try { osc.stop(); } catch { /* already stopped */ }
      click.disconnect();
      hum.disconnect();
    };
  }, [camera, nodes]);

  useEffect(() => {
    nodes.listener.setMasterVolume(soundOn ? 1 : 0);
  }, [soundOn, nodes]);

  const lastSpikes = useRef(neuronSound.spikes);
  useFrame(() => {
    const { ctx, click, buffer, osc } = nodes;
    if (ctx.state !== "running") return;
    osc.frequency.setTargetAtTime(HUM_BASE + HUM_RISE * neuronSound.potential, ctx.currentTime, 0.05);
    if (neuronSound.spikes !== lastSpikes.current) {
      lastSpikes.current = neuronSound.spikes;
      if (!useAppStore.getState().soundOn) return;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = 0.9 + Math.random() * 0.25;
      src.connect(click.getOutput());
      src.start();
    }
  });

  return <group ref={group} position={position} />;
}
