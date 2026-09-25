import * as THREE from "three";

/** Shared Web Audio context (via three's AudioContext). Created/resumed only after a user action. */
export function resumeAudio() {
  if (typeof window === "undefined") return;
  try {
    const ctx = THREE.AudioContext.getContext() as unknown as BaseAudioContext;
    if (ctx.state !== "running") void ctx.resume();
  } catch {
    /* audio unavailable */
  }
}

/** ~8 ms burst of band-passed noise with a fast exponential decay: a neuron "crackle". */
export function makeClickBuffer(ctx: AudioContext): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * 0.008);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let lp = 0, prev = 0;
  for (let i = 0; i < len; i++) {
    const n = Math.random() * 2 - 1;
    lp += 0.45 * (n - lp); // low-pass
    const hp = lp - prev; // high-pass -> band-passed crackle
    prev = lp;
    d[i] = hp * 2.2 * Math.exp(-i / (len * 0.22));
  }
  return buf;
}
