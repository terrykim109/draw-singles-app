export type Pt = { x: number; y: number };
export type Cubic = [Pt, Pt, Pt, Pt];
export type Box = { x: number; y: number; w: number; h: number };

export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
export const mul = (a: Pt, s: number): Pt => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
export const len = (a: Pt) => Math.hypot(a.x, a.y);

export function norm(a: Pt): Pt {
  const l = len(a);
  return l === 0 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

/** Drop consecutive duplicates — zero-length segments break tangent maths. */
export function dedupe(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || len(sub(p, last)) > 0.4) out.push(p);
  }
  return out;
}

/**
 * Low-pass the ink. Hand tremor is high-frequency noise sitting on top of the
 * line you meant to draw; without this the curve fitter treats every wobble as
 * a corner and splits there, turning one stroke into dozens of segments.
 * Endpoints are pinned and the window shrinks near them, so real corners at the
 * ends of a stroke survive.
 */
export function smoothPolyline(points: Pt[], window: number): Pt[] {
  if (points.length < 3 || window < 1) return points.slice();

  const out: Pt[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const half = Math.min(window, i, points.length - 1 - i);
    let sx = 0;
    let sy = 0;
    for (let k = -half; k <= half; k++) {
      sx += points[i + k].x;
      sy += points[i + k].y;
    }
    const count = half * 2 + 1;
    out.push({ x: sx / count, y: sy / count });
  }
  out.push(points[points.length - 1]);
  return out;
}

/* ------------------------------------------------------------------ *
 * Ramer–Douglas–Peucker: throw away points that sit on a straight run
 * ------------------------------------------------------------------ */

function perpDistance(p: Pt, a: Pt, b: Pt): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 === 0) return len(sub(p, a));
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return len(sub(p, add(a, mul(ab, t))));
}

export function simplify(points: Pt[], epsilon: number): Pt[] {
  if (points.length < 3) return points.slice();

  let maxDist = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDistance(points[i], points[0], points[points.length - 1]);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }

  if (maxDist <= epsilon) return [points[0], points[points.length - 1]];

  const left = simplify(points.slice(0, index + 1), epsilon);
  const right = simplify(points.slice(index), epsilon);
  return [...left.slice(0, -1), ...right];
}

/* ------------------------------------------------------------------ *
 * Schneider curve fitting — least-squares cubic Béziers with recursive
 * splitting at the worst-fitting point. Same algorithm paper.js uses.
 * ------------------------------------------------------------------ */

function bezier(b: Cubic, t: number): Pt {
  const mt = 1 - t;
  return add(
    add(mul(b[0], mt * mt * mt), mul(b[1], 3 * mt * mt * t)),
    add(mul(b[2], 3 * mt * t * t), mul(b[3], t * t * t))
  );
}

function bezierPrime(b: Cubic, t: number): Pt {
  const mt = 1 - t;
  return add(
    add(mul(sub(b[1], b[0]), 3 * mt * mt), mul(sub(b[2], b[1]), 6 * mt * t)),
    mul(sub(b[3], b[2]), 3 * t * t)
  );
}

function bezierPrimePrime(b: Cubic, t: number): Pt {
  return add(
    mul(add(sub(b[2], mul(b[1], 2)), b[0]), 6 * (1 - t)),
    mul(add(sub(b[3], mul(b[2], 2)), b[1]), 6 * t)
  );
}

function chordLengthParameterize(points: Pt[]): number[] {
  const u = [0];
  for (let i = 1; i < points.length; i++) {
    u.push(u[i - 1] + len(sub(points[i], points[i - 1])));
  }
  const total = u[u.length - 1] || 1;
  return u.map((value) => value / total);
}

function generateBezier(points: Pt[], u: number[], leftTangent: Pt, rightTangent: Pt): Cubic {
  const first = points[0];
  const last = points[points.length - 1];

  let c00 = 0;
  let c01 = 0;
  let c11 = 0;
  let x0 = 0;
  let x1 = 0;

  for (let i = 0; i < points.length; i++) {
    const t = u[i];
    const mt = 1 - t;
    const a0 = mul(leftTangent, 3 * mt * mt * t);
    const a1 = mul(rightTangent, 3 * mt * t * t);

    c00 += dot(a0, a0);
    c01 += dot(a0, a1);
    c11 += dot(a1, a1);

    const onCurve = add(
      add(mul(first, mt * mt * mt), mul(first, 3 * mt * mt * t)),
      add(mul(last, 3 * mt * t * t), mul(last, t * t * t))
    );
    const diff = sub(points[i], onCurve);
    x0 += dot(a0, diff);
    x1 += dot(a1, diff);
  }

  const detC = c00 * c11 - c01 * c01;
  const detXC1 = x0 * c11 - x1 * c01;
  const detC0X = c00 * x1 - c01 * x0;

  const alphaL = detC === 0 ? 0 : detXC1 / detC;
  const alphaR = detC === 0 ? 0 : detC0X / detC;

  const segLength = len(sub(last, first));
  // degenerate solve — fall back to the classic third-of-the-chord heuristic
  if (alphaL < 1e-6 * segLength || alphaR < 1e-6 * segLength) {
    const d = segLength / 3;
    return [first, add(first, mul(leftTangent, d)), add(last, mul(rightTangent, d)), last];
  }

  return [first, add(first, mul(leftTangent, alphaL)), add(last, mul(rightTangent, alphaR)), last];
}

function newtonRaphson(b: Cubic, point: Pt, t: number): number {
  const d = sub(bezier(b, t), point);
  const d1 = bezierPrime(b, t);
  const d2 = bezierPrimePrime(b, t);
  const numerator = dot(d, d1);
  const denominator = dot(d1, d1) + dot(d, d2);
  return denominator === 0 ? t : t - numerator / denominator;
}

function computeMaxError(points: Pt[], b: Cubic, u: number[]): [number, number] {
  let maxDist = 0;
  let splitPoint = Math.floor(points.length / 2);

  for (let i = 1; i < points.length - 1; i++) {
    const diff = sub(bezier(b, u[i]), points[i]);
    const dist = dot(diff, diff);
    if (dist > maxDist) {
      maxDist = dist;
      splitPoint = i;
    }
  }
  return [maxDist, splitPoint];
}

function fitCubic(points: Pt[], leftTangent: Pt, rightTangent: Pt, error: number): Cubic[] {
  if (points.length === 2) {
    const d = len(sub(points[1], points[0])) / 3;
    return [
      [
        points[0],
        add(points[0], mul(leftTangent, d)),
        add(points[1], mul(rightTangent, d)),
        points[1],
      ],
    ];
  }

  let u = chordLengthParameterize(points);
  let curve = generateBezier(points, u, leftTangent, rightTangent);
  let [maxError, splitPoint] = computeMaxError(points, curve, u);

  if (maxError < error) return [curve];

  // close enough to converge — nudge the parameterisation before splitting
  if (maxError < error * error) {
    for (let i = 0; i < 20; i++) {
      u = u.map((ui, index) => newtonRaphson(curve, points[index], ui));
      curve = generateBezier(points, u, leftTangent, rightTangent);
      [maxError, splitPoint] = computeMaxError(points, curve, u);
      if (maxError < error) return [curve];
    }
  }

  const centerTangent = norm(sub(points[splitPoint - 1], points[splitPoint + 1]));
  return [
    ...fitCubic(points.slice(0, splitPoint + 1), leftTangent, centerTangent, error),
    ...fitCubic(points.slice(splitPoint), mul(centerTangent, -1), rightTangent, error),
  ];
}

export function fitCurve(points: Pt[], error: number): Cubic[] {
  const pts = dedupe(points);
  if (pts.length < 2) return [];
  const leftTangent = norm(sub(pts[1], pts[0]));
  const rightTangent = norm(sub(pts[pts.length - 2], pts[pts.length - 1]));
  return fitCubic(pts, leftTangent, rightTangent, error * error);
}

/* ------------------------------------------------------------------ *
 * SVG output
 * ------------------------------------------------------------------ */

const r = (n: number) => Math.round(n * 10) / 10;

export function pathData(curves: Cubic[]): string {
  if (curves.length === 0) return '';
  let d = `M ${r(curves[0][0].x)} ${r(curves[0][0].y)}`;
  for (const [, c1, c2, end] of curves) {
    d += ` C ${r(c1.x)} ${r(c1.y)}, ${r(c2.x)} ${r(c2.y)}, ${r(end.x)} ${r(end.y)}`;
  }
  return d;
}

/*
 * Loops, not `Math.min(...points)`. Spreading an array into a call passes one
 * argument per element, and V8 throws "Maximum call stack size exceeded" past
 * roughly 130k of them — which a traced photo reaches easily.
 */
export function boxOf(points: Pt[]): Box {
  if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function mergeBoxes(boxes: Box[]): Box {
  if (boxes.length === 0) return { x: 0, y: 0, w: 0, h: 0 };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.w > maxX) maxX = b.x + b.w;
    if (b.y + b.h > maxY) maxY = b.y + b.h;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function boxesOverlap(a: Box, b: Box, pad: number): boolean {
  return (
    a.x - pad < b.x + b.w &&
    a.x + a.w + pad > b.x &&
    a.y - pad < b.y + b.h &&
    a.y + a.h + pad > b.y
  );
}
