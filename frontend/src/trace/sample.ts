import type { Pt } from '../lab/geometry';

/**
 * A hand-drawn-looking cat-creature rendered straight to a canvas, so the
 * pipeline can be demoed without hunting for a photo of a drawing.
 */
export function makeSampleDrawing(ink: string, w = 640, h = 720): string {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const poly = (pts: Pt[]) => {
    if (pts.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  };

  const ring = (cx: number, cy: number, rx: number, ry: number, n = 44) => {
    const pts: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
    }
    poly(pts);
  };

  const arc = (cx: number, cy: number, rx: number, ry: number, a0: number, a1: number) => {
    const pts: Pt[] = [];
    const n = 18;
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
    }
    poly(pts);
  };

  const dot = (x: number, y: number, rad: number) => {
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  };

  const cx = w / 2;

  // head
  ring(cx, 300, 150, 125);
  // ears
  poly([
    { x: cx - 95, y: 215 },
    { x: cx - 118, y: 118 },
    { x: cx - 28, y: 186 },
  ]);
  poly([
    { x: cx + 95, y: 215 },
    { x: cx + 118, y: 118 },
    { x: cx + 28, y: 186 },
  ]);
  // eyes
  dot(cx - 55, 290, 14);
  dot(cx + 55, 290, 14);
  // smile
  arc(cx, 320, 58, 34, Math.PI * 0.18, Math.PI * 0.82);
  // whiskers
  for (let i = 0; i < 3; i++) {
    poly([
      { x: cx - 162, y: 300 + i * 16 },
      { x: cx - 234, y: 300 + i * 22 },
    ]);
    poly([
      { x: cx + 162, y: 300 + i * 16 },
      { x: cx + 234, y: 300 + i * 22 },
    ]);
  }
  // body
  ring(cx, 560, 120, 95);
  // legs
  poly([
    { x: cx - 70, y: 648 },
    { x: cx - 70, y: 706 },
  ]);
  poly([
    { x: cx + 70, y: 648 },
    { x: cx + 70, y: 706 },
  ]);
  // tail
  arc(cx + 112, 600, 40, 96, -Math.PI * 0.45, Math.PI * 0.35);

  return canvas.toDataURL('image/png');
}
