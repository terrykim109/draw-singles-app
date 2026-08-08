import { labelComponents, traceContour } from '../src/trace/tracer';
import { fitCurve, pathData, simplify, smoothPolyline } from '../src/lab/geometry';

const W = 48, H = 48;
const mask = new Uint8Array(W * H);

// filled circle radius 6 (like a small eye)
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (Math.hypot(x - 24, y - 24) <= 6) mask[y * W + x] = 1;
}

const labels = labelComponents(mask, W, H);
console.error('components:', labels.count, 'size:', labels.sizes[1]);

const pixels = labels.pixels[1];
let best = pixels[0];
for (const p of pixels) {
  const y = (p / W) | 0, x = p % W;
  const by = (best / W) | 0, bx = best % W;
  if (y < by || (y === by && x < bx)) best = p;
}
const start = { x: best % W, y: (best / W) | 0 };
console.error('start:', start);
const contour = traceContour(mask, W, H, start);
console.error('traceContour result:', contour);

if (contour) {
  const tol = 3;
  const settled = smoothPolyline(contour, Math.max(1, Math.round(tol * 1.4)));
  const thinned = simplify(settled, tol * 0.5);
  console.error('settled:', settled.length, 'thinned:', thinned.length);
  const curves = fitCurve(thinned, tol * 0.9);
  console.error('curves:', curves.length, 'd:', pathData(curves).slice(0, 80));
}
