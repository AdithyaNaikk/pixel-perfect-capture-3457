import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { preprocessStrokes, type Point } from "@/lib/preprocess";
import { useAppStore } from "@/lib/store";

const SIZE = 280;

interface DrawingPanelProps {
  /** Optional content shown directly above the panel (e.g. playback controls). */
  top?: import("react").ReactNode;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}

export function DrawingPanel({ expanded, onExpandedChange, top }: DrawingPanelProps) {
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
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * SIZE, y: ((e.clientY - r.top) / r.height) * SIZE };
  };

  const onDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    canvasRef.current?.setPointerCapture(e.pointerId);
    drawing.current = true;
    strokes.current.push([pt(e)]);
    redraw();
  };
  const onMove = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (!drawing.current) return;
    const stroke = strokes.current.at(-1);
    if (!stroke) return;
    stroke.push(pt(e));
    redraw();
  };
  const onUp = (e: React.PointerEvent) => {
    e.stopPropagation();
    drawing.current = false;
  };

  return (
    <div className="pointer-events-auto fixed bottom-3 left-1/2 z-10 -translate-x-1/2 font-mono text-xs text-slate-300">
      <div className="flex flex-col items-center gap-2">
        {top}
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={expanded}
          onClick={() => onExpandedChange(!expanded)}
          className="h-8 border-slate-600 bg-slate-950/90 px-3 font-mono text-slate-200 hover:bg-slate-800 hover:text-slate-100"
        >
          ✎ Draw
        </Button>

        {expanded && (
          <div className="rounded-lg border border-slate-700/60 bg-slate-950/90 p-2.5 shadow-xl">
            <div className="flex items-start justify-center gap-2.5">
              <canvas
                ref={canvasRef}
                width={SIZE}
                height={SIZE}
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
                onWheel={(e) => e.stopPropagation()}
                style={{ width: 180, height: 180, touchAction: "none", cursor: "crosshair" }}
                className="shrink-0 rounded border border-slate-700"
              />
              <div className="flex shrink-0 flex-col items-center gap-1">
                <canvas
                  ref={previewRef}
                  width={28}
                  height={28}
                  style={{ width: 84, height: 84, imageRendering: "pixelated" }}
                  className="border border-slate-700"
                />
                <span className="opacity-60">28×28</span>
              </div>
            </div>
            <div className="mt-2 flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  strokes.current = [];
                  redraw();
                }}
                className="h-8 flex-1 border-slate-600 bg-transparent font-mono text-slate-200 hover:bg-slate-800 hover:text-slate-100"
              >
                Clear
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => run(preprocessStrokes(strokes.current))}
                className="h-8 flex-1 border-cyan-300/50 bg-cyan-300/10 font-mono text-cyan-200 hover:bg-cyan-300/20 hover:text-cyan-100"
              >
                Run
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
