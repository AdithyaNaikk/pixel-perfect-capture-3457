import { create } from "zustand";

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
}

export const useAppStore = create<AppState>((set) => ({
  inputImage: null,
  runId: 0,
  replayId: 0,
  speed: 1,
  aiAnswer: null,
  spiking: null,
  run: (img) =>
    set((s) => ({
      inputImage: img,
      runId: s.runId + 1,
      aiAnswer: null,
      spiking: null,
    })),
  replay: () => set((s) => ({ replayId: s.replayId + 1 })),
  setSpeed: (speed) => set({ speed }),
  setAiAnswer: (answer) => set({ aiAnswer: answer }),
  setSpiking: (status) => set({ spiking: status }),
}));
