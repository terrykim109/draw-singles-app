import { traceContour } from '../src/trace/tracer';

const W = 48, H = 48;
const mask = new Uint8Array(W * H);
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const d = Math.hypot(x - 24, y - 24);
    if (d >= 7 && d <= 10) mask[y * W + x] = 1;
  }
const start = { x: 24, y: 14 };
const c = traceContour(mask, W, H, start);
// print points with distance, flag inner-edge (d<8) ones
c.forEach((p, i) => {
  const d = Math.hypot(p.x - 24, p.y - 24);
  if (d < 8) console.log(`inner pt ${i}: (${p.x},${p.y}) d=${d.toFixed(2)}`);
});
// show where in the sequence: print d for all, grouped
let last = 10;
const ranges: string[] = [];
let cur: string | null = null;
for (const p of c) {
  const d = Math.hypot(p.x - 24, p.y - 24);
  const tag = d < 8 ? 'INNER' : d < 9 ? 'mid' : 'outer';
  if (tag !== cur) { if (cur) ranges.push(cur); cur = tag; }
}
if (cur) ranges.push(cur);
console.log('sequence:', ranges.join(' -> '));
