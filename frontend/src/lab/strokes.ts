import {
  boxOf,
  fitCurve,
  pathData,
  simplify,
  smoothPolyline,
  type Box,
  type Cubic,
  type Pt,
} from './geometry';

export type RawStroke = {
  id: string;
  points: Pt[];
  width: number;
};

export type VectorStroke = {
  id: string;
  curves: Cubic[];
  d: string;
  width: number;
  box: Box;
  rawCount: number;
};

/** Raw pointer trail -> de-tremored -> simplified -> smooth cubics. */
export function vectorize(stroke: RawStroke, tolerance: number): VectorStroke {
  // window/epsilon tuned by grid search: enough to kill hand tremor, small
  // enough that a head-sized circle keeps its shape and corners stay corners
  const settled = smoothPolyline(stroke.points, Math.max(1, Math.round(tolerance * 0.7)));
  const thinned = simplify(settled, tolerance * 0.5);
  const curves = fitCurve(thinned, tolerance * 0.8);
  return {
    id: stroke.id,
    curves,
    d: pathData(curves),
    width: stroke.width,
    box: boxOf(stroke.points),
    rawCount: stroke.points.length,
  };
}

/* deterministic jitter so the "boil" frames are stable between renders */
function lcg(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296 - 0.5;
  };
}

/** Nudge every control point a hair — the classic hand-drawn boiling line. */
export function boilVariant(stroke: VectorStroke, seed: number, amount: number): string {
  const rand = lcg(seed * 7919 + stroke.curves.length * 31 + 13);
  const jittered = stroke.curves.map(
    (curve) =>
      curve.map((point) => ({
        x: point.x + rand() * amount,
        y: point.y + rand() * amount,
      })) as Cubic
  );
  return pathData(jittered);
}
