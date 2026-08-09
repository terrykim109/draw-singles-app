import { len, sub } from './geometry';
import type { Bone, Rig } from './rig';

export type PartAnim = {
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
};

export type BoneContext = {
  rig: Rig;
  /** rank among appendages, longest first — used to phase-offset motion */
  index: number;
  count: number;
  maxLength: number;
};

export type Preset = {
  id: string;
  name: string;
  blurb: string;
  /** true when the preset moves parts relative to each other */
  needsRig?: boolean;
  /** stagger each stroke's dashoffset — the drawing draws itself */
  drawOn?: boolean;
  /** default state of the boiling-line toggle */
  boil?: boolean;
  /** applied to the whole drawing */
  root?: PartAnim;
  /** applied per bone. Returning null leaves the bone riding its parent. */
  bone?: (bone: Bone, ctx: BoneContext) => PartAnim | null;
};

const loop = (duration: number, extra: KeyframeAnimationOptions = {}): KeyframeAnimationOptions => ({
  duration,
  iterations: Infinity,
  easing: 'ease-in-out',
  ...extra,
});

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/** negative delay = start mid-cycle, which is how we phase-offset N appendages */
const phase = (duration: number, index: number, count: number, spread = 0.5) =>
  -((index / Math.max(count, 1)) * duration * spread);

/**
 * 1 for a straight limb, near 0 for a closed loop (a head, a body, an eye).
 * Loops should nod; limbs should swing. Cheap stand-in for knowing what a part is.
 */
const straightness = (bone: Bone) =>
  clamp(len(sub(bone.tip, bone.pivot)) / Math.max(bone.length, 1), 0.25, 1);

const swing = (degrees: number): Keyframe[] => [
  { transform: `rotate(${-degrees}deg)` },
  { transform: `rotate(${degrees}deg)` },
  { transform: `rotate(${-degrees}deg)` },
];

export const PRESETS: Preset[] = [
  /* ---------------- rig-free: work on literally any drawing ------------- */
  {
    id: 'boil',
    name: 'boil',
    blurb: 'the line never sits still. works on anything, rig or no rig.',
    boil: true,
  },
  {
    id: 'draw-on',
    name: 'draw on',
    blurb: 'redraws itself stroke by stroke, in the order you drew them.',
    drawOn: true,
  },
  {
    id: 'breathe',
    name: 'breathe',
    blurb: 'slow idle bob. good default for a profile card.',
    root: {
      keyframes: [
        { transform: 'translateY(0) scale(1)' },
        { transform: 'translateY(-4px) scale(1.015)' },
        { transform: 'translateY(0) scale(1)' },
      ],
      options: loop(2800),
    },
  },
  {
    id: 'jump',
    name: 'jump',
    blurb: 'squash, launch, land. whole-figure, no rig needed.',
    root: {
      keyframes: [
        { transform: 'translateY(0) scale(1, 1)', offset: 0 },
        { transform: 'translateY(4px) scale(1.06, 0.92)', offset: 0.18 },
        { transform: 'translateY(-34px) scale(0.96, 1.06)', offset: 0.5 },
        { transform: 'translateY(4px) scale(1.06, 0.92)', offset: 0.82 },
        { transform: 'translateY(0) scale(1, 1)', offset: 1 },
      ],
      options: loop(1200, { easing: 'cubic-bezier(.35,0,.35,1)' }),
    },
  },
  {
    id: 'smitten',
    name: 'smitten',
    blurb: 'heartbeat pulse. the dating-app one.',
    root: {
      keyframes: [
        { transform: 'scale(1)', offset: 0 },
        { transform: 'scale(1.07)', offset: 0.14 },
        { transform: 'scale(1)', offset: 0.28 },
        { transform: 'scale(1.05)', offset: 0.42 },
        { transform: 'scale(1)', offset: 0.6 },
        { transform: 'scale(1)', offset: 1 },
      ],
      options: loop(1600, { easing: 'ease-out' }),
    },
  },

  /* ---------------- rigged: rules over N appendages, whatever N is ------ */
  {
    id: 'wave',
    name: 'wave',
    blurb:
      'only limbs swing — body strokes ride along. two limbs reads as waving; twenty reads as an anemone.',
    needsRig: true,
    root: {
      keyframes: [
        { transform: 'translateY(0)' },
        { transform: 'translateY(-3px)' },
        { transform: 'translateY(0)' },
      ],
      options: loop(2200),
    },
    bone: (bone, ctx) => {
      if (bone.role !== 'appendage') return null;
      const reach = clamp(bone.length / Math.max(ctx.maxLength, 1), 0.25, 1);
      // You wave with the limbs that aren't holding you up. Anything hanging
      // straight down off its joint is a leg, whatever species it belongs to.
      const standing = clamp(bone.direction.y, 0, 1);
      const amplitude =
        ((9 + 17 * reach) / (1 + 0.35 * (bone.depth - 1))) *
        straightness(bone) *
        (1 - 0.78 * standing);
      const duration = 1000 + reach * 500;
      return {
        keyframes: swing(amplitude),
        options: loop(duration, { delay: phase(duration, ctx.index, ctx.count, 0.65) }),
      };
    },
  },
  {
    id: 'wind',
    name: 'wind',
    blurb: 'a gust travels outward from the core. petals, hair, tentacles, fringe.',
    needsRig: true,
    bone: (bone, ctx) => {
      if (bone.role === 'detail') return null;
      const reach = clamp(bone.length / Math.max(ctx.maxLength, 1), 0.2, 1);
      const base = (4 + 9 * reach + 2 * bone.depth) * straightness(bone);
      // body parts sway with the figure, they don't flap off it
      const amplitude =
        bone.role === 'core' ? 2.5 : bone.role === 'body' ? Math.min(base * 0.3, 3) : base;
      const duration = 2400;
      // phase by attach position, so the wave sweeps across the figure
      const acrossX = clamp(bone.pivot.x / 460, 0, 1);
      return {
        keyframes: swing(amplitude),
        options: loop(duration, { delay: -acrossX * duration * 0.5 }),
      };
    },
  },
  {
    id: 'walk',
    name: 'walk',
    blurb:
      'appendages pointing down alternate like legs, the rest counter-swing. no labels — just direction.',
    needsRig: true,
    root: {
      keyframes: [
        { transform: 'translateY(0) rotate(-1deg)' },
        { transform: 'translateY(-5px) rotate(1deg)' },
        { transform: 'translateY(0) rotate(-1deg)' },
      ],
      options: loop(760),
    },
    bone: (bone, ctx) => {
      if (bone.role !== 'appendage') return null;
      const duration = 760;
      const downward = bone.direction.y > 0.25;
      const amplitude = (downward ? 16 : 7) * straightness(bone);
      const flipped = ctx.index % 2 === 1;
      const keyframes = swing(flipped ? -amplitude : amplitude);
      return { keyframes, options: loop(duration) };
    },
  },
];

export const DEFAULT_PRESET = PRESETS[2];
