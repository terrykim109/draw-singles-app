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
  const [live, setLive] = useState<Pt[]>([]);
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
    if (live.length > 0) paint(ctx, [{ points: live, width: brush }], ink);
  }, [strokes, live, width, height, brush]);

  function positionOf(event: PointerEvent<HTMLCanvasElement>): Pt {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  return (
    <canvas
      ref={canvasRef}
      className="draw-canvas"
      style={{ width, height }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drawing.current = true;
        setLive([positionOf(event)]);
      }}
      onPointerMove={(event) => {
        if (!drawing.current) return;
        const point = positionOf(event);
        setLive((prev) => {
          const last = prev[prev.length - 1];
          // throttle by distance so we don't store 400 points per centimetre
          if (last && Math.hypot(point.x - last.x, point.y - last.y) < 1.5) return prev;
          return [...prev, point];
        });
      }}
      onPointerUp={() => {
        drawing.current = false;
        setLive((points) => {
          if (points.length > 1) onStrokeEnd(points, brush);
          return [];
        });
      }}
      onPointerLeave={() => {
        if (!drawing.current) return;
        drawing.current = false;
        setLive((points) => {
          if (points.length > 1) onStrokeEnd(points, brush);
          return [];
        });
      }}
    />
  );
}
