import { create } from "zustand";

export type PlaybackSpeed = 0 | 0.25 | 1;

interface AppState {
  inputImage: Float32Array | null;
  runId: number;
  replayId: number;
  speed: PlaybackSpeed;
  run: (img: Float32Array) => void;
  replay: () => void;
  setSpeed: (speed: PlaybackSpeed) => void;
}

export const useAppStore = create<AppState>((set) => ({
  inputImage: null,
  runId: 0,
  replayId: 0,
  speed: 1,
  run: (img) => set((s) => ({ inputImage: img, runId: s.runId + 1 })),
  replay: () => set((s) => ({ replayId: s.replayId + 1 })),
  setSpeed: (speed) => set({ speed }),
}));
