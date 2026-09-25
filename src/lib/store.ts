import { create } from "zustand";

import { resumeAudio } from "./neuronAudio";

export type PlaybackSpeed = 0 | 0.25 | 1;

export interface SpikingStatus {
  done: boolean;
  prediction: number | null;
}

interface AppState {
  inputImage: Float32Array | null;
  runId: number;
  replayId: number;
  speed: PlaybackSpeed;
  /** AI forward-pass prediction for the current run. */
  aiAnswer: number | null;
  /** Spiking playback status for the current run. */
  spiking: SpikingStatus | null;
  run: (img: Float32Array) => void;
  replay: () => void;
  setSpeed: (speed: PlaybackSpeed) => void;
  setAiAnswer: (answer: number) => void;
  setSpiking: (status: SpikingStatus | null) => void;
  lesionMode: boolean;
  /** Hidden neurons lesioned in BOTH networks. Replaced (never mutated) on change. */
  lesioned: Set<number>;
  /** True when the current run was triggered by a lesion change. */
  lesionRerun: boolean;
  hoverHidden: number | null;
  setHoverHidden: (h: number | null) => void;
  toggleLesionMode: () => void;
  toggleLesion: (h: number) => void;
  lesionRandom: (n: number) => void;
  healAll: () => void;
  debugGuides: boolean;
  toggleDebugGuides: () => void;
  weightsStatus: string;
  selfTest: string;
  setDiagnostics: (weightsStatus: string, selfTest: string) => void;
  brainSelfTest: string;
  setBrainSelfTest: (s: string) => void;
  /** Final output spike counts of the last brain run (the brain's vote). */
  brainCounts: number[] | null;
  setBrainCounts: (c: number[] | null) => void;
  soundOn: boolean;
  toggleSound: () => void;
}

const HIDDEN_COUNT = 64;

export const useAppStore = create<AppState>((set, get) => {
  const applyLesions = (lesioned: Set<number>) =>
    set((s) =>
      s.inputImage
        ? { lesioned, runId: s.runId + 1, aiAnswer: null, spiking: null, lesionRerun: true }
        : { lesioned },
    );
  return {
  inputImage: null,
  runId: 0,
  replayId: 0,
  speed: 1,
  aiAnswer: null,
  spiking: null,
  run: (img) => {
    resumeAudio();
    set((s) => ({
      inputImage: img,
      runId: s.runId + 1,
      aiAnswer: null,
      spiking: null,
      lesionRerun: false,
    }));
  },
  replay: () => set((s) => ({ replayId: s.replayId + 1 })),
  setSpeed: (speed) => set({ speed }),
  setAiAnswer: (answer) => set({ aiAnswer: answer }),
  setSpiking: (status) => set({ spiking: status }),
  lesionMode: false,
  lesioned: new Set<number>(),
  lesionRerun: false,
  hoverHidden: null,
  setHoverHidden: (h) => set((s) => (s.hoverHidden === h ? s : { hoverHidden: h })),
  toggleLesionMode: () => set((s) => ({ lesionMode: !s.lesionMode })),
  toggleLesion: (h) => {
    const next = new Set(get().lesioned);
    if (next.has(h)) next.delete(h);
    else next.add(h);
    applyLesions(next);
  },
  lesionRandom: (n) => {
    const next = new Set(get().lesioned);
    const free: number[] = [];
    for (let h = 0; h < HIDDEN_COUNT; h++) if (!next.has(h)) free.push(h);
    for (let k = 0; k < n && free.length > 0; k++) {
      const j = Math.floor(Math.random() * free.length);
      next.add(free[j]!);
      free.splice(j, 1);
    }
    applyLesions(next);
  },
  debugGuides: false,
  toggleDebugGuides: () => set((s) => ({ debugGuides: !s.debugGuides })),
  weightsStatus: "loading weights…",
  selfTest: "",
  setDiagnostics: (weightsStatus, selfTest) => set({ weightsStatus, selfTest }),
  brainSelfTest: "",
  setBrainSelfTest: (brainSelfTest) => set({ brainSelfTest }),
  brainCounts: null,
  setBrainCounts: (brainCounts) => set({ brainCounts }),
  soundOn: true,
  toggleSound: () => { resumeAudio(); set((s) => ({ soundOn: !s.soundOn })); },
  healAll: () => {
    if (get().lesioned.size > 0) applyLesions(new Set<number>());
  },
  };
});
