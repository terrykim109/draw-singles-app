import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { Pt } from './geometry';
import type { RawStroke } from './strokes';

type DrawCanvasProps = {
  width: number;
  height: number;
  strokes: RawStroke[];
  brush: number;
  onStrokeEnd: (points: Pt[], width: number) => void;
};

function paint(
  ctx: CanvasRenderingContext2D,
  strokes: { points: Pt[]; width: number }[],
  color: string
) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;

  for (const stroke of strokes) {
    const { points } = stroke;
    if (points.length === 0) continue;
    ctx.lineWidth = stroke.width;
    ctx.beginPath();

    if (points.length < 3) {
      ctx.moveTo(points[0].x, points[0].y);
      ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
    } else {
      // midpoint quadratics — keeps the live line from looking polygonal
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length - 1; i++) {
        const mid = {
          x: (points[i].x + points[i + 1].x) / 2,
          y: (points[i].y + points[i + 1].y) / 2,
        };
        ctx.quadraticCurveTo(points[i].x, points[i].y, mid.x, mid.y);
      }
      ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
    }
    ctx.stroke();
  }
}

export default function DrawCanvas({
  width,
  height,
  strokes,
  brush,
  onStrokeEnd,
}: DrawCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /* The in-progress stroke lives in a ref, not state. It used to be state, and
     the stroke was committed from inside the setState updater — but StrictMode
     deliberately calls updaters twice to surface impurity, so every stroke was
     being handed upstream twice and the canvas quietly filled with duplicates. */
  const liveRef = useRef<Pt[]>([]);
  const [, repaint] = useState(0);
  const drawing = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const ink = getComputedStyle(canvas).getPropertyValue('--ink').trim() || '#2b18e0';
    paint(ctx, strokes, ink);
    if (liveRef.current.length > 0) {
      paint(ctx, [{ points: liveRef.current, width: brush }], ink);
    }
  });

  function positionOf(event: PointerEvent<HTMLCanvasElement>): Pt {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  /** hand the finished stroke upstream — once, and only if it drew anything */
  function finish() {
    if (!drawing.current) return;
    drawing.current = false;

    const points = liveRef.current;
    liveRef.current = [];
    repaint((n) => n + 1);

    if (points.length < 2) return;
    // a stub too short to fit a curve to is a stray tap, not a stroke
    let travelled = 0;
    for (let i = 1; i < points.length; i++) {
      travelled += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    }
    if (travelled < 3) return;

    onStrokeEnd(points, brush);
  }

  return (
    <canvas
      ref={canvasRef}
      className="draw-canvas"
      style={{ width, height }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drawing.current = true;
        liveRef.current = [positionOf(event)];
        repaint((n) => n + 1);
      }}
      onPointerMove={(event) => {
        if (!drawing.current) return;
        const point = positionOf(event);
        const last = liveRef.current[liveRef.current.length - 1];
        // throttle by distance so we don't store 400 points per centimetre
        if (last && Math.hypot(point.x - last.x, point.y - last.y) < 1.5) return;
        liveRef.current = [...liveRef.current, point];
        repaint((n) => n + 1);
      }}
      onPointerUp={finish}
      onPointerLeave={() => {
        finish();
      }}
    />
  );
}
