import {
  labelComponents,
  otsuThreshold,
  skeletonStrokes,
  thinZhangSuen,
  traceContour,
} from '../src/trace/tracer';
import type { Pt } from '../src/lab/geometry';

const W = 48;
const H = 48;
const mask = new Uint8Array(W * H);
const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : mask[y * W + x]);
const set = (x: number, y: number) => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix >= 0 && iy >= 0 && ix < W && iy < H) mask[iy * W + ix] = 1;
};

// 1) a thick ring (annulus) centered at (24, 24), inner r=7 outer r=10
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const d = Math.hypot(x - 24, y - 24);
    if (d >= 7 && d <= 10) set(x, y);
  }
}
// 2) a diagonal stroke from (4, 40) to (14, 6), thickness 3
for (let t = 0; t <= 100; t++) {
  const x = 4 + ((14 - 4) * t) / 100;
  const y = 40 - ((40 - 6) * t) / 100;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) set(x + dx, y + dy);
}
// 3) a 3x3 dot at (38, 8)
for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) set(38 + dx, 8 + dy);

const skel = thinZhangSuen(mask, W, H);
const at2 = (x: number, y: number) =>
  x < 0 || y < 0 || x >= W || y >= H ? 0 : skel[y * W + x];
const deg = (p: Pt) => {
  let d = 0;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++)
      if (!(dx === 0 && dy === 0) && at2(p.x + dx, p.y + dy)) d++;
  return d;
};

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

// --- components ---
const labels = labelComponents(mask, W, H);
check('3 components detected', labels.count === 3, `count=${labels.count}`);
const sizes = Array.from(labels.sizes).slice(1).sort((a, b) => a - b);
check(
  'component sizes are ring > line > dot',
  sizes[0] < sizes[1] && sizes[1] < sizes[2],
  `sizes=${sizes}`
);

// --- otsu on a clean bimodal histogram ---
{
  const gray = new Uint8ClampedArray(10000).fill(20);
  for (let i = 5000; i < 10000; i++) gray[i] = 220;
  const t = otsuThreshold(gray);
  check('otsu lands in the valley of a bimodal histogram', t >= 20 && t <= 220, `t=${t}`);
}

// --- thinning ---
const skelCount = Array.from(skel).reduce((a, b) => a + b, 0);
const ringPts: Pt[] = [];
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    if (skel[y * W + x] && Math.hypot(x - 24, y - 24) < 12) ringPts.push({ x, y });
  }
check('skeleton thinned substantially', skelCount < 700 && skelCount > 40, `skel px=${skelCount}`);
check(
  'ring skeleton is a pure loop (all deg 2)',
  ringPts.length > 20 && ringPts.every((p) => deg(p) === 2),
  `ring skel px=${ringPts.length}`
);

// --- skeleton -> polylines ---
const { segs, closed, dots } = skeletonStrokes(skel, W, H, labels, 2);
const closedLoops = segs.filter((_, i) => closed[i]);
const openSegs = segs.filter((_, i) => !closed[i]);
check('ring becomes one closed segment', closedLoops.length === 1, `closed=${closedLoops.length}`);
check('line becomes one open segment', openSegs.length === 1, `open=${openSegs.length}`);
check('dot becomes a dot', dots.length === 1, `dots=${dots.length}`);
if (closedLoops.length === 1) {
  const loop = closedLoops[0];
  const joined =
    loop[0].x === loop[loop.length - 1].x && loop[0].y === loop[loop.length - 1].y;
  check('closed segment joins back on itself', joined, `len=${loop.length}`);
}
if (openSegs.length === 1) {
  const seg = openSegs[0];
  const endDeg = [seg[0], seg[seg.length - 1]].map(deg);
  check('open segment starts & ends at endpoints', endDeg.every((d) => d === 1), `ends=${endDeg}`);
}

// --- contour tracing on a solid square ---
{
  const sq = new Uint8Array(W * H);
  for (let y = 10; y <= 14; y++) for (let x = 10; x <= 14; x++) sq[y * W + x] = 1;
  const contour = traceContour(sq, W, H, { x: 10, y: 10 });
  const closedLoop =
    contour.length > 10 &&
    contour[0].x === contour[contour.length - 1].x &&
    contour[0].y === contour[contour.length - 1].y;
  check('contour of a 5x5 square is a closed loop', closedLoop, `pts=${contour.length}`);
  // every contour point must be a boundary pixel (has a background 4-neighbour)
  const allBoundary = contour.every((p) => {
    const isInk = sq[p.y * W + p.x] === 1;
    const touchesPaper =
      p.x === 0 ||
      p.y === 0 ||
      p.x === W - 1 ||
      p.y === H - 1 ||
      !sq[p.y * W + p.x - 1] ||
      !sq[p.y * W + p.x + 1] ||
      !sq[(p.y - 1) * W + p.x] ||
      !sq[(p.y + 1) * W + p.x];
    return isInk && touchesPaper;
  });
  check('contour hugs the boundary', allBoundary);
}

// --- annulus contour: Moore tracing follows the foreground/background
//     border, which on a thick ring includes both edges as one loop.
//     This is correct — both edges are where ink meets paper.
{
  const start = { x: 24, y: 14 };
  const contour = traceContour(mask, W, H, start);
  const ds = contour.map((p) => Math.hypot(p.x - 24, p.y - 24));
  const closed =
    contour.length > 10 &&
    contour[0].x === contour[contour.length - 1].x &&
    contour[0].y === contour[contour.length - 1].y;
  check('annulus contour is a closed loop', closed, `pts=${contour.length}`);
  check('contour spans outer edge', ds.some((d) => d > 9.4));
  check('contour spans inner edge', ds.some((d) => d < 7.6));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
