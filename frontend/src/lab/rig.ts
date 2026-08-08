import {
  add,
  boxOf,
  fitCurve,
  len,
  mul,
  norm,
  pathData,
  sub,
  type Box,
  type Cubic,
  type Pt,
} from './geometry';
import type { VectorStroke } from './strokes';

/**
 * Role vocabulary is deliberately tiny and species-agnostic. A tentacle, a leg,
 * a petal and a whisker are all just "appendage" — geometry decides how they
 * move, not what we call them.
 */
export type Role = 'core' | 'appendage' | 'detail';

export type Bone = {
  id: string;
  stroke: VectorStroke;
  role: Role;
  parent: string | null;
  children: string[];
  /** joint this bone rotates about — where its ink meets its parent's */
  pivot: Pt;
  /** far end of the bone, away from the pivot */
  tip: Pt;
  direction: Pt;
  length: number;
  depth: number;
  closed: boolean;
  box: Box;
};

export type Rig = {
  bones: Bone[];
  byId: Map<string, Bone>;
  roots: string[];
  coreId: string | null;
  /** appendages ranked longest-first — presets phase-offset along this order */
  appendages: Bone[];
  joints: Pt[];
  score: number;
};

const SAMPLES_PER_CURVE = 10;

function flatten(curves: Cubic[]): Pt[] {
  if (curves.length === 0) return [];
  const points: Pt[] = [curves[0][0]];
  for (const c of curves) {
    for (let i = 1; i <= SAMPLES_PER_CURVE; i++) {
      const t = i / SAMPLES_PER_CURVE;
      const mt = 1 - t;
      points.push(
        add(
          add(mul(c[0], mt * mt * mt), mul(c[1], 3 * mt * mt * t)),
          add(mul(c[2], 3 * mt * t * t), mul(c[3], t * t * t))
        )
      );
    }
  }
  return points;
}

function polylineLength(points: Pt[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += len(sub(points[i], points[i - 1]));
  return total;
}

function nearestOnPolyline(p: Pt, poly: Pt[]): { point: Pt; dist: number } {
  let best = { point: poly[0], dist: Infinity };
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1];
    const b = poly[i];
    const ab = sub(b, a);
    const l2 = ab.x * ab.x + ab.y * ab.y;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / l2));
    const point = add(a, mul(ab, t));
    const dist = len(sub(p, point));
    if (dist < best.dist) best = { point, dist };
  }
  return best;
}

const areaOf = (box: Box) => Math.max(box.w, 1) * Math.max(box.h, 1);

function contains(outer: Box, inner: Box, pad: number): boolean {
  return (
    inner.x > outer.x - pad &&
    inner.y > outer.y - pad &&
    inner.x + inner.w < outer.x + outer.w + pad &&
    inner.y + inner.h < outer.y + outer.h + pad
  );
}

type Edge = { a: number; b: number; at: Pt; dist: number; endpointOfA: 0 | 1 };

/* ------------------------------------------------------------------ *
 * Splitting strokes at crossings.
 *
 * People draw a stickman's arms as ONE line straight through the torso, and
 * the legs as ONE V whose apex touches the body. Neither has an endpoint at
 * the joint, so endpoint-only detection finds nothing and the whole stroke
 * ends up hinged at a hand or a foot. Cutting strokes where they cross turns
 * one arms-line into two arms that each meet the torso end-on.
 * ------------------------------------------------------------------ */

const MIN_PIECE = 14;
const MAX_CUTS_PER_STROKE = 4;

/** where two segments cross, as fractions along each */
function segmentCross(p1: Pt, p2: Pt, p3: Pt, p4: Pt): { t: number; u: number } | null {
  const r = sub(p2, p1);
  const s = sub(p4, p3);
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < 1e-9) return null;
  const qp = sub(p3, p1);
  const t = (qp.x * s.y - qp.y * s.x) / denom;
  const u = (qp.x * r.y - qp.y * r.x) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u };
}

function pointAlong(poly: Pt[], position: number): Pt {
  const index = Math.floor(position);
  if (index >= poly.length - 1) return poly[poly.length - 1];
  return add(poly[index], mul(sub(poly[index + 1], poly[index]), position - index));
}

function lengthOf(poly: Pt[]): number {
  let total = 0;
  for (let i = 1; i < poly.length; i++) total += len(sub(poly[i], poly[i - 1]));
  return total;
}

/**
 * Cut every stroke where another stroke crosses it or ends on its interior.
 * Returns fresh VectorStrokes — ids get a `#n` suffix so pieces stay traceable
 * back to the stroke the user actually drew.
 */
type Junctions = { polys: Pt[][]; cuts: number[][]; contacts: Set<number>[] };

function analyseJunctions(strokes: VectorStroke[], tolerance: number): Junctions {

  const polys = strokes.map((stroke) => flatten(stroke.curves));
  const closed = polys.map(
    (poly) => poly.length > 2 && len(sub(poly[0], poly[poly.length - 1])) < 0.22 * lengthOf(poly)
  );

  const cuts: number[][] = strokes.map(() => []);
  const contacts: Set<number>[] = strokes.map(() => new Set());

  for (let i = 0; i < strokes.length; i++) {
    if (closed[i]) continue; // don't slice up heads, eyes, buttons
    for (let j = 0; j < strokes.length; j++) {
      if (i === j) continue;

      // (a) j's endpoints landing on i's interior — the V-apex case
      if (!closed[j]) {
        for (const endpoint of [polys[j][0], polys[j][polys[j].length - 1]]) {
          let bestIndex = -1;
          let bestDist = Infinity;
          for (let k = 0; k < polys[i].length; k++) {
            const d = len(sub(polys[i][k], endpoint));
            if (d < bestDist) {
              bestDist = d;
              bestIndex = k;
            }
          }
          if (bestDist <= tolerance) {
            cuts[i].push(bestIndex);
            contacts[i].add(j);
          }
        }
      }

      // (b) true crossings — the arms-through-torso case
      for (let a = 1; a < polys[i].length; a++) {
        for (let b = 1; b < polys[j].length; b++) {
          const hit = segmentCross(polys[i][a - 1], polys[i][a], polys[j][b - 1], polys[j][b]);
          if (hit) {
            cuts[i].push(a - 1 + hit.t);
            contacts[i].add(j);
          }
        }
      }
    }
  }

  return { polys, cuts, contacts };
}

/**
 * Cut the strokes, optionally keeping one whole. Which stroke to protect is not
 * decidable locally — on a stickman the torso *ends* on the legs-V while the
 * arms *cross* the torso — so the caller tries the candidates and keeps the
 * rig that scores best.
 */
function piecesFrom(
  strokes: VectorStroke[],
  { polys, cuts }: Junctions,
  protect: number | null
): VectorStroke[] {
  const out: VectorStroke[] = [];

  strokes.forEach((stroke, i) => {
    const poly = polys[i];
    const total = lengthOf(poly);
    if (i === protect || cuts[i].length === 0) {
      out.push(stroke);
      return;
    }

    // drop cuts too close to the ends or to each other, keep the strongest few
    const sorted = [...new Set(cuts[i].map((c) => Math.round(c * 4) / 4))].sort((a, b) => a - b);
    const kept: number[] = [];
    for (const cut of sorted) {
      const head = lengthOf(poly.slice(0, Math.ceil(cut) + 1));
      if (head < MIN_PIECE || total - head < MIN_PIECE) continue;
      if (kept.length > 0) {
        const prev = kept[kept.length - 1];
        if (lengthOf(poly.slice(Math.floor(prev), Math.ceil(cut) + 1)) < MIN_PIECE) continue;
      }
      kept.push(cut);
      if (kept.length >= MAX_CUTS_PER_STROKE) break;
    }

    if (kept.length === 0) {
      out.push(stroke);
      return;
    }

    const bounds = [0, ...kept, poly.length - 1];
    for (let p = 0; p < bounds.length - 1; p++) {
      const from = bounds[p];
      const to = bounds[p + 1];
      const piece: Pt[] = [pointAlong(poly, from)];
      for (let k = Math.ceil(from); k <= Math.floor(to); k++) piece.push(poly[k]);
      piece.push(pointAlong(poly, to));

      if (piece.length < 2 || lengthOf(piece) < MIN_PIECE) continue;

      const curves = fitCurve(piece, 2);
      if (curves.length === 0) continue;

      out.push({
        id: `${stroke.id}#${p}`,
        curves,
        d: pathData(curves),
        width: stroke.width,
        box: boxOf(piece),
        rawCount: piece.length,
      });
    }
  });

  return out;
}

/**
 * How good is this skeleton? Rewards a big core with lots of limbs hanging
 * straight off it, punishes deep chains and strokes left floating.
 */
function quality(rig: Rig): number {
  if (!rig.coreId) return -Infinity;
  const core = rig.byId.get(rig.coreId);
  if (!core) return -Infinity;

  const longest = Math.max(...rig.bones.map((bone) => bone.length), 1);
  const maxDepth = Math.max(...rig.bones.map((bone) => bone.depth), 0);
  const floating = rig.bones.filter((bone) => bone.parent === null).length - 1;

  return (
    core.children.length +
    3 * (core.length / longest) -
    0.5 * maxDepth -
    1.0 * Math.max(floating, 0)
  );
}

export function buildRig(
  input: VectorStroke[],
  jointTolerance: number,
  overrides: Record<string, Role> = {},
  split = true
): Rig {
  if (!split || input.length < 2) return assemble(input, jointTolerance, overrides);

  const junctions = analyseJunctions(input, jointTolerance);

  // candidates: leave everything cut, or keep one of the contacted strokes whole
  const contacted = input
    .map((_, i) => i)
    .filter((i) => junctions.contacts[i].size > 0)
    .sort((a, b) => junctions.contacts[b].size - junctions.contacts[a].size)
    .slice(0, 8);

  let best: Rig | null = null;
  let bestScore = -Infinity;

  for (const protect of [null, ...contacted]) {
    const rig = assemble(piecesFrom(input, junctions, protect), jointTolerance, overrides);
    const score = quality(rig);
    if (score > bestScore) {
      bestScore = score;
      best = rig;
    }
  }

  return best ?? assemble(input, jointTolerance, overrides);
}

/**
 * Junction-graph rig. Strokes are bones; wherever one stroke's endpoint lands on
 * another stroke, that's a joint. The most connected stroke becomes the core and
 * everything else hangs off it in a tree.
 */
function assemble(
  strokes: VectorStroke[],
  jointTolerance: number,
  overrides: Record<string, Role> = {}
): Rig {
  const empty: Rig = {
    bones: [],
    byId: new Map(),
    roots: [],
    coreId: null,
    appendages: [],
    joints: [],
    score: 0,
  };
  if (strokes.length === 0) return empty;

  const polys = strokes.map((stroke) => flatten(stroke.curves));
  const lengths = polys.map(polylineLength);
  const boxes = strokes.map((stroke) => stroke.box);
  const drawingBox = boxOf(polys.flat());
  const drawingArea = areaOf(drawingBox);

  const closed = polys.map(
    (poly, i) =>
      poly.length > 2 && len(sub(poly[0], poly[poly.length - 1])) < 0.22 * Math.max(lengths[i], 1)
  );

  /* --- pass 1: pull out details (eyes, buttons, freckles) --------------- *
   * Small closed marks sitting inside a bigger stroke ride along rigidly.
   * Getting this wrong is what makes rigs look broken — eyes flying off a face. */
  const detailParent = new Map<number, number>();
  strokes.forEach((_, i) => {
    if (!closed[i]) return;
    if (areaOf(boxes[i]) > 0.14 * drawingArea) return;

    let host: number | null = null;
    let hostArea = Infinity;
    strokes.forEach((__, j) => {
      if (i === j) return;
      const outerArea = areaOf(boxes[j]);
      if (outerArea < areaOf(boxes[i]) * 1.6) return;
      if (!contains(boxes[j], boxes[i], 6)) return;
      if (outerArea < hostArea) {
        host = j;
        hostArea = outerArea;
      }
    });
    if (host !== null) detailParent.set(i, host);
  });

  const structural = strokes
    .map((_, i) => i)
    .filter((i) => !detailParent.has(i) && overrides[strokes[i].id] !== 'detail');

  /* --- pass 2: find joints between structural strokes ------------------- */
  const edges: Edge[] = [];
  for (const i of structural) {
    const poly = polys[i];
    const ends: [Pt, 0 | 1][] = [
      [poly[0], 0],
      [poly[poly.length - 1], 1],
    ];
    for (const j of structural) {
      if (i === j) continue;
      for (const [endpoint, which] of ends) {
        const near = nearestOnPolyline(endpoint, polys[j]);
        if (near.dist <= jointTolerance) {
          edges.push({
            a: i,
            b: j,
            at: mul(add(endpoint, near.point), 0.5),
            dist: near.dist,
            endpointOfA: which,
          });
        }
      }
    }
  }

  const adjacency = new Map<number, Edge[]>();
  for (const edge of edges) {
    const list = adjacency.get(edge.a) ?? [];
    list.push(edge);
    adjacency.set(edge.a, list);

    const mirrored = adjacency.get(edge.b) ?? [];
    mirrored.push({ ...edge, a: edge.b, b: edge.a });
    adjacency.set(edge.b, mirrored);
  }

  /* --- pass 3: pick the core, then grow a tree outward ------------------ */
  const forcedCore = structural.find((i) => overrides[strokes[i].id] === 'core');
  const maxLength = Math.max(...lengths, 1);
  const core =
    forcedCore ??
    structural
      .slice()
      .sort((a, b) => {
        const degree = (adjacency.get(b)?.length ?? 0) - (adjacency.get(a)?.length ?? 0);
        if (degree !== 0) return degree;
        return lengths[b] - lengths[a];
      })[0];

  const bones = new Map<number, Bone>();
  const joints: Pt[] = [];
  const visited = new Set<number>();

  function makeBone(index: number, parent: number | null, pivot: Pt, depth: number, role: Role) {
    const poly = polys[index];
    const first = poly[0];
    const last = poly[poly.length - 1];
    const tip = len(sub(first, pivot)) > len(sub(last, pivot)) ? first : last;
    bones.set(index, {
      id: strokes[index].id,
      stroke: strokes[index],
      role,
      parent: parent === null ? null : strokes[parent].id,
      children: [],
      pivot,
      tip,
      direction: norm(sub(tip, pivot)),
      length: lengths[index],
      depth,
      closed: closed[index],
      box: boxes[index],
    });
  }

  if (core !== undefined) {
    const coreBox = boxes[core];
    makeBone(core, null, { x: coreBox.x + coreBox.w / 2, y: coreBox.y + coreBox.h / 2 }, 0, 'core');
    visited.add(core);

    const queue: number[] = [core];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edge of adjacency.get(current) ?? []) {
        const next = edge.b;
        if (visited.has(next)) continue;
        visited.add(next);
        joints.push(edge.at);
        makeBone(next, current, edge.at, (bones.get(current)?.depth ?? 0) + 1, 'appendage');
        bones.get(current)?.children.push(strokes[next].id);
        queue.push(next);
      }
    }
  }

  // strokes that touch nothing: still swing, hinged at whichever end faces the core
  for (const i of structural) {
    if (visited.has(i)) continue;
    const poly = polys[i];
    const corePoly = core === undefined ? null : polys[core];
    const pivot =
      corePoly === null
        ? { x: boxes[i].x + boxes[i].w / 2, y: boxes[i].y + boxes[i].h / 2 }
        : nearestOnPolyline(poly[0], corePoly).dist <
            nearestOnPolyline(poly[poly.length - 1], corePoly).dist
          ? poly[0]
          : poly[poly.length - 1];
    makeBone(i, null, pivot, 1, 'appendage');
  }

  // details last — parented rigidly, never rotated on their own
  for (const [child, host] of detailParent) {
    const box = boxes[child];
    makeBone(child, host, { x: box.x + box.w / 2, y: box.y + box.h / 2 }, (bones.get(host)?.depth ?? 0) + 1, 'detail');
    bones.get(host)?.children.push(strokes[child].id);
  }

  // any stroke the passes above missed (e.g. forced to detail by the user)
  strokes.forEach((_, i) => {
    if (bones.has(i)) return;
    const box = boxes[i];
    makeBone(i, null, { x: box.x + box.w / 2, y: box.y + box.h / 2 }, 1, 'detail');
  });

  const ordered = strokes.map((_, i) => bones.get(i)!).filter(Boolean);
  const withOverrides = ordered.map((bone) =>
    overrides[bone.id] ? { ...bone, role: overrides[bone.id] } : bone
  );

  const byId = new Map(withOverrides.map((bone) => [bone.id, bone]));
  // re-point children at the override-applied copies
  for (const bone of withOverrides) {
    bone.children = bone.children.filter((id) => byId.has(id));
  }

  const appendages = withOverrides
    .filter((bone) => bone.role === 'appendage')
    .sort((a, b) => b.length - a.length);

  const coreBone = withOverrides.find((bone) => bone.role === 'core') ?? null;

  /* how much of a skeleton did we actually find? drives which tier fires */
  let score = 0;
  if (coreBone && appendages.length > 0) {
    const jointed = appendages.filter((bone) => bone.parent !== null).length;
    score = Math.min(
      1,
      0.3 + 0.14 * Math.min(appendages.length, 4) + 0.14 * Math.min(jointed, 3)
    );
    if (coreBone.length < maxLength * 0.35) score *= 0.7;
  }

  return {
    bones: withOverrides,
    byId,
    roots: withOverrides.filter((bone) => bone.parent === null).map((bone) => bone.id),
    coreId: coreBone?.id ?? null,
    appendages,
    joints,
    score: Math.round(score * 100) / 100,
  };
}
