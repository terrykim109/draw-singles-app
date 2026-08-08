import {
  boxOf,
  fitCurve,
  pathData,
  simplify,
  smoothPolyline,
  type Box,
  type Cubic,
  type Pt,
} from '../lab/geometry';

/* ================================================================== *
 * image → smooth SVG collection
 *
 * pipeline: grayscale → box-blur (kills photo noise) → Otsu threshold →
 * connected components → per-component vectorization:
 *   · skeleton mode — Zhang–Suen thinning, then skeleton polylines
 *                     (the line-drawing look; best for most doodles)
 *   · outline mode  — Moore boundary tracing (the filled-shape look)
 * → the lab's own geometry (smoothPolyline / simplify / fitCurve) turns
 *   every blob into the same smooth cubic strokes the animation lab uses.
 * ================================================================== */

export type TraceMode = 'skeleton' | 'outline';

export type TraceOptions = {
  mode: TraceMode;
  /** box-blur radius in px applied before thresholding — photo cleanup */
  blur: number;
  /** added to the Otsu threshold (−60..60). negative = stricter, positive = looser */
  thresholdOffset: number;
  /** white ink on dark paper */
  invert: boolean;
  /** drop connected components smaller than this many ink pixels */
  minArea: number;
  /** curve-fitting tolerance, the same idea as the lab's smoothing slider */
  tolerance: number;
  /** stroke width used for display + export */
  strokeWidth: number;
};

export const DEFAULT_TRACE_OPTIONS: TraceOptions = {
  mode: 'skeleton',
  blur: 1,
  thresholdOffset: 0,
  invert: false,
  minArea: 4,
  tolerance: 3,
  strokeWidth: 4,
};

export type TracedStroke = {
  id: string;
  /** simplified polyline the curves were fitted to (pixel coords) */
  points: Pt[];
  curves: Cubic[];
  /** SVG path data */
  d: string;
  box: Box;
  closed: boolean;
  inkPixels: number;
  /** specks too small to vectorize render as dots instead of paths */
  dot: { cx: number; cy: number; r: number } | null;
};

export type TraceResult = {
  strokes: TracedStroke[];
  box: Box;
  width: number;
  height: number;
  inkRatio: number;
  threshold: number;
};

/* ------------------------------------------------------------------ *
 * loading
 * ------------------------------------------------------------------ */

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('image failed to load'));
    image.src = src;
  });
}

/** downscale + flatten transparency onto white (screenshots, PNGs) */
export function canvasFromImage(
  image: HTMLImageElement,
  maxDimension: number
): HTMLCanvasElement {
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
  const w = Math.max(1, Math.round(image.naturalWidth * scale));
  const h = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(image, 0, 0, w, h);
  return canvas;
}

/* ------------------------------------------------------------------ *
 * preprocessing
 * ------------------------------------------------------------------ */

function grayscale(data: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const gray = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) {
    const j = i * 4;
    gray[i] = (data[j] * 0.299 + data[j + 1] * 0.587 + data[j + 2] * 0.114 + 0.5) | 0;
  }
  return gray;
}

/** separable box blur — cheap and good enough to smooth out sensor noise */
function boxBlur(gray: Uint8ClampedArray, w: number, h: number, radius: number): Uint8ClampedArray {
  if (radius < 1) return gray;
  const tmp = new Uint8ClampedArray(gray.length);
  const out = new Uint8ClampedArray(gray.length);

  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = -radius; x <= radius; x++) {
      sum += gray[row + Math.min(w - 1, Math.max(0, x))];
    }
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / (radius * 2 + 1);
      const add = Math.min(w - 1, x + radius + 1);
      const rem = Math.max(0, x - radius);
      sum += gray[row + add] - gray[row + rem];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) {
      sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    }
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / (radius * 2 + 1);
      const add = Math.min(h - 1, y + radius + 1);
      const rem = Math.max(0, y - radius);
      sum += tmp[add * w + x] - tmp[rem * w + x];
    }
  }
  return out;
}

/** Otsu's method — pick the threshold that best splits ink from paper */
export function otsuThreshold(gray: Uint8ClampedArray): number {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];

  let sumB = 0;
  let wB = 0;
  let best = 0;
  let bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) {
      bestVar = between;
      best = t;
    }
  }
  return best;
}

function binarize(
  gray: Uint8ClampedArray,
  w: number,
  h: number,
  threshold: number,
  invert: boolean
): Uint8Array {
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    // <= (not <) so a threshold that lands exactly on a gray level still
    // captures that level — degenerate bimodal inputs (a clean scan) hit this
    mask[i] = invert ? (gray[i] >= threshold ? 1 : 0) : (gray[i] <= threshold ? 1 : 0);
  }
  return mask;
}

/* ------------------------------------------------------------------ *
 * connected components (8-connectivity)
 * ------------------------------------------------------------------ */

export type ComponentMap = {
  labels: Int32Array;
  count: number;
  sizes: Int32Array;
  /** pixels[label] = pixel indices of that component (pixels[0] unused) */
  pixels: number[][];
};

export function labelComponents(mask: Uint8Array, w: number, h: number): ComponentMap {
  const labels = new Int32Array(w * h).fill(-1);
  const pixels: number[][] = [[]];
  const sizes: number[] = [0];
  let count = 0;

  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || labels[i] !== -1) continue;
    count++;
    const list: number[] = [];
    const queue = [i];
    labels[i] = count;
    while (queue.length > 0) {
      const p = queue.pop()!;
      list.push(p);
      const x = p % w;
      const y = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (mask[q] && labels[q] === -1) {
            labels[q] = count;
            queue.push(q);
          }
        }
      }
    }
    sizes.push(list.length);
    pixels.push(list);
  }

  return { labels, count, sizes: Int32Array.from(sizes), pixels };
}

/* ------------------------------------------------------------------ *
 * Zhang–Suen thinning → 1px skeletons
 * ------------------------------------------------------------------ */

export function thinZhangSuen(mask: Uint8Array, w: number, h: number): Uint8Array {
  const img = new Uint8Array(mask);
  let changed = true;

  while (changed) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      const marking: number[] = [];
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const p = y * w + x;
          if (!img[p]) continue;
          const p2 = img[(y - 1) * w + x];
          const p3 = img[(y - 1) * w + x + 1];
          const p4 = img[y * w + x + 1];
          const p5 = img[(y + 1) * w + x + 1];
          const p6 = img[(y + 1) * w + x];
          const p7 = img[(y + 1) * w + x - 1];
          const p8 = img[y * w + x - 1];
          const p9 = img[(y - 1) * w + x - 1];

          const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (B < 2 || B > 6) continue;

          const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
          let A = 0;
          for (let i = 0; i < 8; i++) {
            if (seq[i] === 0 && seq[i + 1] === 1) A++;
          }
          if (A !== 1) continue;

          if (pass === 0) {
            if (p2 * p4 * p6 !== 0) continue;
            if (p4 * p6 * p8 !== 0) continue;
          } else {
            if (p2 * p4 * p8 !== 0) continue;
            if (p2 * p6 * p8 !== 0) continue;
          }
          marking.push(p);
        }
      }
      if (marking.length > 0) {
        changed = true;
        for (const p of marking) img[p] = 0;
      }
    }
  }
  return img;
}

/* ------------------------------------------------------------------ *
 * skeleton → polylines
 *
 * Each connected skeleton pixel gets a degree (8-neighbour count).
 * Endpoints (degree 1) and branch points (degree ≥ 3) never get consumed,
 * so several segments can share a branch — visually connected. Segments
 * that return to their start without hitting a branch are closed loops.
 * ------------------------------------------------------------------ */

export function skeletonStrokes(
  skel: Uint8Array,
  w: number,
  h: number,
  inkLabels: ComponentMap,
  minArea: number
): { segs: Pt[][]; closed: boolean[]; dots: { pt: Pt; size: number }[] } {
  const visited = new Uint8Array(w * h);
  const segs: Pt[][] = [];
  const closed: boolean[] = [];
  const dots: { pt: Pt; size: number }[] = [];

  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : skel[y * w + x]);
  const deg = (x: number, y: number) => {
    let d = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (at(x + dx, y + dy)) d++;
      }
    }
    return d;
  };
  const nbrs = (x: number, y: number): Pt[] => {
    const list: Pt[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (at(x + dx, y + dy)) list.push({ x: x + dx, y: y + dy });
      }
    }
    return list;
  };
  const idx = (p: Pt) => p.y * w + p.x;
  const adjacent = (a: Pt, b: Pt) => Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1;

  /**
   * Prefer the most straight-on continuation. Thinning a diagonal line leaves
   * a staircase whose corners look like branches (degree 3); if we stop there
   * every stair becomes its own stroke. Preferring the straight continuation
   * walks the whole staircase as one polyline — the curve fitter smooths it.
   */
  const pickNext = (cur: Pt, options: Pt[], cameFrom: Pt | null): Pt => {
    if (!cameFrom) return options[0];
    const dx = cur.x - cameFrom.x;
    const dy = cur.y - cameFrom.y;
    let best = options[0];
    let bestScore = Infinity;
    for (const nb of options) {
      const ndx = nb.x - cur.x;
      const ndy = nb.y - cur.y;
      const denom = Math.hypot(dx, dy) * Math.hypot(ndx, ndy);
      // 0 = perfectly straight, 2 = U-turn
      const angle = denom === 0 ? 2 : 1 - (dx * ndx + dy * ndy) / denom;
      // mild penalty for degree-3 pixels: prefer clean chains when tied
      const score = angle + (deg(nb.x, nb.y) === 2 ? 0 : 0.4);
      if (score < bestScore) {
        bestScore = score;
        best = nb;
      }
    }
    return best;
  };

  /**
   * Walks from a seed through every unvisited pixel. Stops only at endpoints
   * (degree 1); junctions are crossed, not split — one drawn line stays one
   * stroke, and crossings pass through each other.
   */
  const walk = (start: Pt): { seg: Pt[]; closed: boolean } | null => {
    if (visited[idx(start)]) return null;
    const seg: Pt[] = [start];
    visited[idx(start)] = 1;
    let cur = start;
    let cameFrom: Pt | null = null;
    let stoppedAtEndpoint = false;

    for (let guard = 0; guard < 200000; guard++) {
      const options = nbrs(cur.x, cur.y).filter((nb) => !visited[idx(nb)]);
      if (options.length === 0) break;
      const next = pickNext(cur, options, cameFrom);
      seg.push(next);
      visited[idx(next)] = 1;
      if (deg(next.x, next.y) === 1) {
        stoppedAtEndpoint = true;
        break;
      }
      cameFrom = cur;
      cur = next;
    }
    if (seg.length < 2) return null;
    const last = seg[seg.length - 1];
    const closed = !stoppedAtEndpoint && adjacent(last, start);
    if (closed) seg.push(start);
    return { seg, closed };
  };

  for (let label = 1; label <= inkLabels.count; label++) {
    if (inkLabels.sizes[label] < minArea) continue;
    const skelPts: Pt[] = [];
    for (const p of inkLabels.pixels[label]) {
      if (skel[p]) skelPts.push({ x: p % w, y: (p / w) | 0 });
    }
    if (skelPts.length === 0) continue;
    if (skelPts.length === 1) {
      dots.push({ pt: skelPts[0], size: inkLabels.sizes[label] });
      continue;
    }

    const endpoints: Pt[] = [];
    for (const p of skelPts) {
      const d = deg(p.x, p.y);
      if (d === 1) endpoints.push(p);
    }
    for (const end of endpoints) {
      const result = walk(end);
      if (result) {
        segs.push(result.seg);
        closed.push(result.closed);
      }
    }
    // loops and branch-to-branch chains have no endpoints — seed from any
    // unvisited pass pixel that still has an unvisited pass neighbour
    for (const p of skelPts) {
      if (visited[p.y * w + p.x]) continue;
      if (deg(p.x, p.y) !== 2) continue;
      const hasUnvisitedPass = nbrs(p.x, p.y).some(
        (nb) => !visited[nb.y * w + nb.x] && deg(nb.x, nb.y) === 2
      );
      if (!hasUnvisitedPass) continue;
      const result = walk(p);
      if (result) {
        segs.push(result.seg);
        closed.push(result.closed);
      }
    }
  }

  return { segs, closed, dots };
}

/* ------------------------------------------------------------------ *
 * Moore boundary tracing — closed contour of a component (outline mode)
 * ------------------------------------------------------------------ */

const DIRS: Pt[] = [
  { x: 0, y: -1 }, // N
  { x: 1, y: -1 }, // NE
  { x: 1, y: 0 }, // E
  { x: 1, y: 1 }, // SE
  { x: 0, y: 1 }, // S
  { x: -1, y: 1 }, // SW
  { x: -1, y: 0 }, // W
  { x: -1, y: -1 }, // NW
];

function topmostLeftmost(pixels: number[], w: number): Pt {
  let best = pixels[0];
  for (const p of pixels) {
    const x = p % w;
    const y = (p / w) | 0;
    const bx = best % w;
    const by = (best / w) | 0;
    if (y < by || (y === by && x < bx)) best = p;
  }
  return { x: best % w, y: (best / w) | 0 };
}

export function traceContour(mask: Uint8Array, w: number, h: number, start: Pt): Pt[] | null {
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : mask[y * w + x]);
  const contour: Pt[] = [start];
  let B = start;
  let cin = 6; // W — as if we walked in from the left
  let b1: Pt | null = null;
  const maxPts = Math.min(w * h, 12000);

  for (let guard = 0; guard < maxPts; guard++) {
    let next: Pt | null = null;
    let c = 0;
    for (let k = 1; k <= 8; k++) {
      const di = (cin + k) % 8;
      const nx = B.x + DIRS[di].x;
      const ny = B.y + DIRS[di].y;
      if (at(nx, ny)) {
        next = { x: nx, y: ny };
        c = (cin + k - 1) % 8;
        break;
      }
    }
    if (!next) return null; // isolated pixel — caller will skip
    if (b1 === null) {
      b1 = next;
    } else if (
      B.x === start.x && B.y === start.y &&
      next.x === b1.x && next.y === b1.y
    ) {
      break; // loop complete
    }
    contour.push(next);
    B = next;
    cin = c;
  }

  const last = contour[contour.length - 1];
  if (contour.length < 3 || (last.x === start.x && last.y === start.y)) return contour;
  contour.push(start);
  return contour;
}

/* ------------------------------------------------------------------ *
 * curve fitting + SVG output
 * ------------------------------------------------------------------ */

const r = (n: number) => Math.round(n * 10) / 10;

function fitStroke(
  id: string,
  points: Pt[],
  closed: boolean,
  inkPixels: number,
  tol: number
): TracedStroke | null {
  if (points.length < 2) return null;
  // Long contours can overflow the recursive RDP / curve-fitter stack.
  // In practice a sane boundary is < 4000 pts; anything larger means the
  // Moore trace failed to terminate and we should skip this component.
  if (points.length > 8000) return null;
  const settled = smoothPolyline(points, Math.max(1, Math.round(tol * 1.4)));
  const thinned = simplify(settled, tol * 0.5);
  if (thinned.length < 2) return null;
  const curves = fitCurve(thinned, tol * 0.9);
  if (curves.length === 0) return null;
  return {
    id,
    points: thinned,
    curves,
    d: pathData(curves),
    box: boxOf(thinned),
    closed,
    inkPixels,
    dot: null,
  };
}

function dotStroke(id: string, x: number, y: number, inkPixels: number): TracedStroke {
  const rad = Math.max(1.2, Math.sqrt(inkPixels / Math.PI));
  return {
    id,
    points: [{ x, y }],
    curves: [],
    d: '',
    box: { x: x - rad, y: y - rad, w: rad * 2, h: rad * 2 },
    closed: true,
    inkPixels,
    dot: { cx: x, cy: y, r: rad },
  };
}

/* ------------------------------------------------------------------ *
 * the pipeline
 * ------------------------------------------------------------------ */

export function trace(canvas: HTMLCanvasElement, options: TraceOptions): TraceResult {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2d context');

  const data = ctx.getImageData(0, 0, w, h).data;
  const gray = grayscale(data, w, h);
  const blurred = boxBlur(gray, w, h, options.blur);
  const threshold = Math.max(0, Math.min(255, otsuThreshold(blurred) + options.thresholdOffset));
  const mask = binarize(blurred, w, h, threshold, options.invert);
  const labels = labelComponents(mask, w, h);

  let ink = 0;
  for (let i = 0; i < mask.length; i++) ink += mask[i];

  const strokes: TracedStroke[] = [];
  const tol = Math.max(0.5, options.tolerance);

  if (options.mode === 'skeleton') {
    const skel = thinZhangSuen(mask, w, h);
    const { segs, closed, dots } = skeletonStrokes(skel, w, h, labels, options.minArea);
    segs.forEach((seg, i) => {
      const fitted = fitStroke(`s${i}`, seg, closed[i], 0, tol);
      if (fitted) strokes.push(fitted);
    });
    dots.forEach((dot, i) => {
      if (labels.sizes.length > 0) strokes.push(dotStroke(`d${i}`, dot.pt.x, dot.pt.y, dot.size));
    });
  } else {
    for (let label = 1; label <= labels.count; label++) {
      const size = labels.sizes[label];
      if (size < options.minArea) continue;
      const pixels = labels.pixels[label];
      if (size < 4) {
        const p = pixels[0];
        strokes.push(dotStroke(`d${label}`, p % w, (p / w) | 0, size));
        continue;
      }
      const start = topmostLeftmost(pixels, w);
      const contour = traceContour(mask, w, h, start);
      if (!contour || contour.length < 4) continue;
      const fitted = fitStroke(`c${label}`, contour, true, size, tol);
      if (fitted) strokes.push(fitted);
    }
  }

  if (strokes.length === 0) {
    return { strokes, box: { x: 0, y: 0, w: 1, h: 1 }, width: w, height: h, inkRatio: ink / (w * h), threshold };
  }
  const box = boxOf(strokes.flatMap((s) => s.points));
  return { strokes, box, width: w, height: h, inkRatio: ink / (w * h), threshold };
}

/* ------------------------------------------------------------------ *
 * SVG export
 * ------------------------------------------------------------------ */

export function svgPathFor(stroke: TracedStroke, width: number, ink: string): string {
  if (stroke.dot) {
    const { cx, cy, r: rad } = stroke.dot;
    return (
      `<circle cx="${r(cx)}" cy="${r(cy)}" r="${r(Math.max(rad, 1.5))}" ` +
      `fill="none" stroke="${ink}" stroke-width="${width}" stroke-linecap="round"/>`
    );
  }
  return (
    `<path d="${stroke.d}" fill="none" stroke="${ink}" stroke-width="${width}" ` +
    `stroke-linecap="round" stroke-linejoin="round"/>`
  );
}

export function buildSvgDoc(result: TraceResult, width: number, ink: string): string {
  const pad = Math.ceil(width);
  const b = result.box;
  const vb = `${b.x - pad} ${b.y - pad} ${b.w + pad * 2} ${b.h + pad * 2}`;
  const body = result.strokes.map((s) => svgPathFor(s, width, ink)).join('\n  ');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" ` +
    `width="${Math.round(b.w + pad * 2)}" height="${Math.round(b.h + pad * 2)}">\n  ` +
    body +
    `\n</svg>`
  );
}

export function buildStrokeSvgDoc(stroke: TracedStroke, width: number, ink: string): string {
  const pad = Math.ceil(width) + 2;
  const b = stroke.box;
  const vb = `${b.x - pad} ${b.y - pad} ${b.w + pad * 2} ${b.h + pad * 2}`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" ` +
    `width="${Math.round(b.w + pad * 2)}" height="${Math.round(b.h + pad * 2)}">\n  ` +
    svgPathFor(stroke, width, ink) +
    `\n</svg>`
  );
}
