import type { Pt } from './geometry';
import type { RawStroke } from './strokes';

/* deterministic wobble so the sample looks hand-drawn but never changes */
function wobble(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296 - 0.5;
  };
}

function trace(way: Pt[], tremor: number, seed: number, id: string): RawStroke {
  const rand = wobble(seed);
  const points: Pt[] = [];
  for (let s = 0; s < way.length - 1; s++) {
    const a = way[s];
    const b = way[s + 1];
    const steps = Math.max(2, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 2));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      points.push({
        x: a.x + (b.x - a.x) * t + rand() * tremor,
        y: a.y + (b.y - a.y) * t + rand() * tremor,
      });
    }
  }
  return { id, points, width: 4 };
}

function ring(cx: number, cy: number, radius: number, seed: number, id: string): RawStroke {
  const rand = wobble(seed);
  const points: Pt[] = [];
  for (let i = 0; i <= 90; i++) {
    const a = (i / 90) * Math.PI * 2;
    points.push({
      x: cx + Math.cos(a) * radius + rand() * 2,
      y: cy + Math.sin(a) * radius + rand() * 2,
    });
  }
  return { id, points, width: 4 };
}

/**
 * A stickman drawn the way people actually draw one: arms are a single line
 * straight through the torso, legs are a single V. Known-good reference — if
 * this rigs and animates but your own drawing doesn't, the difference is in
 * the strokes, not in the animation code.
 */
export function sampleStickman(): RawStroke[] {
  return [
    ring(230, 110, 38, 5, 'sample-head'),
    trace([{ x: 230, y: 148 }, { x: 230, y: 290 }], 2, 3, 'sample-torso'),
    trace([{ x: 150, y: 240 }, { x: 312, y: 232 }], 2, 7, 'sample-arms'),
    trace(
      [{ x: 178, y: 384 }, { x: 230, y: 290 }, { x: 284, y: 380 }],
      2,
      11,
      'sample-legs'
    ),
  ];
}
