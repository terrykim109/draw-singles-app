import { ALL_TAGS, CATEGORIES, CATEGORY_BY_ID } from './categories';
import { dominantSupertype, supertypeOf, type Supertype } from './classTypes';
import { QUESTIONS, type Profile } from './types';

/**
 * Stand-in for the trained embedding.
 *
 * Everything downstream — neighbours, rarity, the constellation layout — only
 * needs a vector per profile, so when the sketch model (or the description
 * embedding) is ready, replace the body of `embed` and nothing else changes.
 *
 * For now the vector is a one-hot of the three answers, plus a small
 * deterministic wobble derived from the id. The wobble is there purely to break
 * ties: with three categorical answers a lot of pairs score identically, and a
 * layout full of exact ties collapses into a stack.
 */
export function embed(profile: Profile & { id?: string }): number[] {
  const vector: number[] = [];

  /* What the drawing IS dominates. Tags rather than one-hot categories, so a
     cat sits nearer a fish than a house — with one-hot every category would be
     exactly as far from every other and the groups would carry no meaning. */
  const category = profile.category ? CATEGORY_BY_ID.get(profile.category) : undefined;
  for (const tag of ALL_TAGS) {
    vector.push(category?.tags.includes(tag) ? 1 : 0);
  }
  // the exact category still counts, so two cats beat a cat and a fish
  for (const option of CATEGORIES) {
    vector.push(profile.category === option.id ? 0.7 : 0);
  }

  // how you draw is a much weaker signal than what you drew
  for (const question of QUESTIONS) {
    for (const option of question.options) {
      vector.push(profile.answers[question.id] === option ? 0.22 : 0);
    }
  }

  const seed = hash(profile.id ?? profile.name);
  for (let i = 0; i < 4; i++) {
    vector.push(0.05 * (((seed >> (i * 5)) % 32) / 32 - 0.5));
  }

  return normalize(vector);
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function normalize(vector: number[]): number[] {
  const length = Math.hypot(...vector) || 1;
  return vector.map((v) => v / length);
}

/** cosine similarity — both vectors are unit length, so it's just the dot */
export function similarity(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) sum += a[i] * b[i];
  return sum;
}

export type Node<T> = {
  item: T;
  id: string;
  vector: number[];
};

export type Link = { a: string; b: string; similarity: number };

/**
 * k-nearest-neighbour graph: every node keeps an edge to its k most similar
 * neighbours. Connecting everything to everything is a hairball; kNN keeps the
 * shape of the population readable.
 */
export function knnLinks<T>(nodes: Node<T>[], k = 3, minSimilarity = 0): Link[] {
  const seen = new Map<string, Link>();

  for (const node of nodes) {
    const ranked = nodes
      .filter((other) => other.id !== node.id)
      .map((other) => ({ other, score: similarity(node.vector, other.vector) }))
      .sort((x, y) => y.score - x.score)
      .slice(0, k)
      // a link across classes scores ~0.07 — drawing it says nothing and the
      // canvas turns to spaghetti once there are more than a handful of people
      .filter(({ score }) => score >= minSimilarity);

    for (const { other, score } of ranked) {
      const key = [node.id, other.id].sort().join('|');
      if (!seen.has(key)) seen.set(key, { a: node.id, b: other.id, similarity: score });
    }
  }

  return [...seen.values()];
}

/**
 * Rarity = how empty your neighbourhood is. Mean distance to the k nearest
 * neighbours, so a single near-duplicate can't declare you unoriginal.
 */
export function rarityScore<T>(node: Node<T>, population: Node<T>[], k = 3): number {
  const distances = population
    .filter((other) => other.id !== node.id)
    .map((other) => 1 - similarity(node.vector, other.vector))
    .sort((a, b) => a - b);

  if (distances.length === 0) return 0;
  const near = distances.slice(0, Math.min(k, distances.length));
  return near.reduce((sum, d) => sum + d, 0) / near.length;
}

export const TIERS = ['common', 'uncommon', 'rare', 'legendary'] as const;
export type Tier = (typeof TIERS)[number];

/**
 * Tiers come from percentile within the population, not absolute cutoffs —
 * absolute thresholds go stale the moment the population shifts.
 */
export function tiersFor<T>(nodes: Node<T>[], k = 3): Map<string, { score: number; tier: Tier }> {
  const scored = nodes.map((node) => ({ id: node.id, score: rarityScore(node, nodes, k) }));
  const sorted = [...scored].sort((a, b) => a.score - b.score);

  const out = new Map<string, { score: number; tier: Tier }>();
  for (const entry of scored) {
    const rank = sorted.findIndex((s) => s.id === entry.id);
    const percentile = sorted.length < 2 ? 0.5 : rank / (sorted.length - 1);
    const tier =
      percentile >= 0.9 ? 'legendary' : percentile >= 0.7 ? 'rare' : percentile >= 0.4 ? 'uncommon' : 'common';
    out.set(entry.id, { score: entry.score, tier });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * grouping — the population sorts itself into types
 * ------------------------------------------------------------------ */

export type Cluster<T> = {
  id: number;
  members: Node<T>[];
  centroid: number[];
  /** dominant answer per question — kept for the profile panel */
  traits: Record<string, string>;
  /** what the group's drawings have in common, e.g. creature / animal */
  tags: string[];
  name: string;
};

function centroidOf<T>(members: Node<T>[]): number[] {
  const dims = members[0]?.vector.length ?? 0;
  const sum = new Array(dims).fill(0);
  for (const member of members) {
    for (let i = 0; i < dims; i++) sum[i] += member.vector[i];
  }
  return normalize(sum.map((v) => v / Math.max(members.length, 1)));
}

/** average similarity between every pair across two groups */
function linkage<T>(a: Node<T>[], b: Node<T>[]): number {
  let total = 0;
  for (const x of a) for (const y of b) total += similarity(x.vector, y.vector);
  return total / (a.length * b.length);
}

/**
 * The merge tree produced by clustering. Groups aren't a flat list — they're a
 * hierarchy, and "how many types are there" is just a question of where you cut
 * it. Keeping the tree lets the UI show that instead of hiding it.
 */
export type Dendro<T> =
  | { kind: 'leaf'; id: string; node: Node<T>; size: 1 }
  | { kind: 'merge'; id: string; left: Dendro<T>; right: Dendro<T>; similarity: number; size: number };

export function leavesOf<T>(tree: Dendro<T>): Node<T>[] {
  return tree.kind === 'leaf' ? [tree.node] : [...leavesOf(tree.left), ...leavesOf(tree.right)];
}

/**
 * Agglomerative clustering, average linkage: everyone starts alone, then the
 * two most similar groups merge, repeatedly, until one tree remains.
 *
 * Chosen over k-means because it is deterministic — k-means seeds randomly, so
 * types would rename themselves on every render, which is unusable when the
 * group is meant to be part of someone's identity.
 */
export function buildDendrogram<T>(nodes: Node<T>[]): Dendro<T> | null {
  if (nodes.length === 0) return null;

  let parts: { tree: Dendro<T>; members: Node<T>[] }[] = nodes.map((node) => ({
    tree: { kind: 'leaf', id: node.id, node, size: 1 },
    members: [node],
  }));

  let counter = 0;
  while (parts.length > 1) {
    let bestScore = -Infinity;
    let pair: [number, number] = [0, 1];

    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        const score = linkage(parts[i].members, parts[j].members);
        if (score > bestScore) {
          bestScore = score;
          pair = [i, j];
        }
      }
    }

    const [i, j] = pair;
    const merged: Dendro<T> = {
      kind: 'merge',
      id: `m${counter++}`,
      left: parts[i].tree,
      right: parts[j].tree,
      similarity: bestScore,
      size: parts[i].tree.size + parts[j].tree.size,
    };
    const members = [...parts[i].members, ...parts[j].members];
    parts = parts
      .map((part, index) => (index === i ? { tree: merged, members } : part))
      .filter((_, index) => index !== j);
  }

  return parts[0].tree;
}

/** every merge in the tree, weakest first — these are the cuts, in order */
export function mergesOf<T>(tree: Dendro<T>): Extract<Dendro<T>, { kind: 'merge' }>[] {
  if (tree.kind === 'leaf') return [];
  return [tree, ...mergesOf(tree.left), ...mergesOf(tree.right)].sort(
    (a, b) => a.similarity - b.similarity
  );
}

/** Cut the k-1 weakest merges — what's left dangling below is the groups. */
export function cutDendrogram<T>(tree: Dendro<T>, k: number): Dendro<T>[] {
  let parts: Dendro<T>[] = [tree];

  while (parts.length < Math.max(1, k)) {
    // split whichever standing group was merged at the lowest similarity
    let weakest = -1;
    let weakestScore = Infinity;
    parts.forEach((part, index) => {
      if (part.kind === 'merge' && part.similarity < weakestScore) {
        weakestScore = part.similarity;
        weakest = index;
      }
    });
    if (weakest < 0) break; // everything is a leaf, cannot split further

    const target = parts[weakest] as Extract<Dendro<T>, { kind: 'merge' }>;
    parts = [...parts.slice(0, weakest), target.left, target.right, ...parts.slice(weakest + 1)];
  }

  return parts;
}

export function clusterNodes<T extends Profile & { id: string }>(
  nodes: Node<T>[],
  k: number
): Cluster<T>[] {
  const tree = buildDendrogram(nodes);
  if (!tree) return [];

  return cutDendrogram(tree, k).map((part, id) => {
    const members = leavesOf(part);
    const profiles = members.map((m) => m.item);
    const classes = profiles.map((p) => p.category);
    // Name from the supertype the members mostly share. Tags alone let a single
    // taxonomy-matching member (one cat) name a group of twenty aeroplanes.
    const name = `${dominantSupertype(classes)} type`;

    // subtitle: what people in here actually drew, commonest first
    const counts = new Map<string, number>();
    for (const c of classes) if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    const drawn = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);

    return {
      id,
      members,
      centroid: centroidOf(members),
      traits: dominantTraits(profiles),
      tags: drawn.length > 0 ? drawn : sharedTags(profiles),
      name,
    };
  });
}

/** the tags a group holds in common, most widely shared first */
export function sharedTags(profiles: Profile[]): string[] {
  const counts = new Map<string, number>();
  for (const profile of profiles) {
    const category = profile.category ? CATEGORY_BY_ID.get(profile.category) : undefined;
    for (const tag of category?.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag);
}

/** the most common answer to each question within a group */
function dominantTraits(profiles: Profile[]): Record<string, string> {
  const traits: Record<string, string> = {};
  for (const question of QUESTIONS) {
    const counts = new Map<string, number>();
    for (const profile of profiles) {
      const answer = profile.answers[question.id];
      if (answer) counts.set(answer, (counts.get(answer) ?? 0) + 1);
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best) traits[question.id] = best[0];
  }
  return traits;
}

/** distinct-but-on-brand colour per group, rotated off the current accent */
export function clusterHue(index: number, total: number): string {
  const step = 360 / Math.max(total, 1);
  return `hsl(${(index * step + 250) % 360} 70% 45%)`;
}

/** what two profiles actually have in common — the explainable half of a match */
export function sharedTraits(a: Profile, b: Profile): string[] {
  return QUESTIONS.filter((q) => a.answers[q.id] && a.answers[q.id] === b.answers[q.id]).map(
    (q) => b.answers[q.id]
  );
}


/**
 * Group by the classifier's label, not by clustering the vector.
 *
 * Measured on real data: same-class pairs score ~0.999 and *every* different-class
 * pair scores ~0.07, related or not — a cat sits as far from a rabbit as from a
 * candle. Recomputing from the stored logits at temperatures from 1.5 to 30 moves
 * the same-supertype/different-supertype gap by under 0.01, so the 250-dim
 * probability vector carries class identity and no semantic structure. Clustering
 * it can only recover "same class", and forcing three groups chains everything
 * into one blob.
 *
 * The vector keeps doing what it is good at — neighbours, rarity, ranking — and
 * the type comes from the label.
 */
export function groupBySupertype<T extends Profile & { id: string }>(
  nodes: Node<T>[]
): Cluster<T>[] {
  const buckets = new Map<Supertype, Node<T>[]>();
  for (const node of nodes) {
    const supertype = supertypeOf(node.item.category);
    const bucket = buckets.get(supertype);
    if (bucket) bucket.push(node);
    else buckets.set(supertype, [node]);
  }

  return [...buckets.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([supertype, members], id) => {
      const profiles = members.map((m) => m.item);
      const counts = new Map<string, number>();
      for (const p of profiles) {
        if (p.category) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
      }
      return {
        id,
        members,
        centroid: centroidOf(members),
        traits: dominantTraits(profiles),
        tags: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c),
        name: `${supertype} type`,
      };
    });
}
