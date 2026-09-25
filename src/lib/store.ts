import { create } from "zustand";

interface AppState {
  inputImage: Float32Array | null;
  runId: number;
  run: (img: Float32Array) => void;
}

export const useAppStore = create<AppState>((set) => ({
  inputImage: null,
  runId: 0,
  run: (img) => set((s) => ({ inputImage: img, runId: s.runId + 1 })),
}));
