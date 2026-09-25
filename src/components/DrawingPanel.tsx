import { useEffect, useRef } from "react";

import { preprocessStrokes, type Point } from "@/lib/preprocess";
import { useAppStore } from "@/lib/store";

const SIZE = 280;

export function DrawingPanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Point[][]>([]);
  const drawing = useRef(false);
  const run = useAppStore((s) => s.run);
  const inputImage = useAppStore((s) => s.inputImage);

  const redraw = () => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.strokeStyle = "#fff";
    ctx.fillStyle = "#fff";
    ctx.lineWidth = 18;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const s of strokes.current) {
      if (!s.length) continue;
      if (s.length === 1) {
        ctx.beginPath();
        ctx.arc(s[0]!.x, s[0]!.y, 9, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(s[0]!.x, s[0]!.y);
      for (let i = 1; i < s.length; i++) ctx.lineTo(s[i]!.x, s[i]!.y);
      ctx.stroke();
    }
  };

  useEffect(redraw, []);

  useEffect(() => {
    const ctx = previewRef.current?.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(28, 28);
    for (let i = 0; i < 784; i++) {
      const v = Math.round((inputImage?.[i] ?? 0) * 255);
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [inputImage]);

  const pt = (e: React.PointerEvent): Point => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * SIZE, y: ((e.clientY - r.top) / r.height) * SIZE };
  };

  const onDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    canvasRef.current!.setPointerCapture(e.pointerId);
    drawing.current = true;
    strokes.current.push([pt(e)]);
    redraw();
  };
  const onMove = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (!drawing.current) return;
    strokes.current[strokes.current.length - 1]!.push(pt(e));
    redraw();
  };
  const onUp = (e: React.PointerEvent) => {
    e.stopPropagation();
    drawing.current = false;
  };

  return (
    <div className="pointer-events-auto fixed bottom-4 left-4 flex items-end gap-3 rounded-lg border border-slate-700/60 bg-slate-950/80 p-3 font-mono text-xs text-slate-300">
      <div className="flex flex-col gap-2">
        <canvas
          ref={canvasRef}
          width={SIZE}
          height={SIZE}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onWheel={(e) => e.stopPropagation()}
          style={{ width: SIZE, height: SIZE, touchAction: "none", cursor: "crosshair" }}
          className="rounded border border-slate-700"
        />
        <div className="flex gap-2">
          <button
            onClick={() => {
              strokes.current = [];
              redraw();
            }}
            className="flex-1 rounded border border-slate-600 px-3 py-1.5 hover:bg-slate-800"
          >
            Clear
          </button>
          <button
            onClick={() => run(preprocessStrokes(strokes.current))}
            className="flex-1 rounded border border-cyan-300/50 bg-cyan-300/10 px-3 py-1.5 text-cyan-200 hover:bg-cyan-300/20"
          >
            Run
          </button>
        </div>
      </div>
      <div className="flex flex-col items-center gap-1">
        <canvas
          ref={previewRef}
          width={28}
          height={28}
          style={{ width: 112, height: 112, imageRendering: "pixelated" }}
          className="border border-slate-700"
        />
        <span className="opacity-60">28×28</span>
      </div>
    </div>
  );
}
