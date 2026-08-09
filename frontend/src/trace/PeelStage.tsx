import { useEffect, useMemo, useRef, useState } from 'react';
import { boilVariant } from '../lab/strokes';
import type { TraceResult } from './tracer';
import { rasteriseResult } from './rasterise';

type PeelStageProps = {
  imageUrl: string;
  result: TraceResult | null;
  strokeWidth: number;
  /** bump to play the sequence */
  playKey: number;
  ink?: string;
  /** the traced drawing, rasterised, once the photo has peeled away */
  onSettled?: (pngDataUrl: string) => void;
};

type Phase = 'idle' | 'drawing' | 'boiling' | 'peeling' | 'settled' | 'alive';

const DRAW_MS = 550;
const BOIL_MS = 1100;
const PEEL_MS = 1700;
const BOIL_FRAMES = 3;

export default function PeelStage({
  imageUrl,
  result,
  strokeWidth,
  playKey,
  ink = '#242424',
  onSettled,
}: PeelStageProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [frame, setFrame] = useState(0);
  const timers = useRef<number[]>([]);

  const strokes = result?.strokes ?? [];
  const stagger = Math.min(45, 2000 / Math.max(strokes.length, 1));
  const drawTotal = DRAW_MS + stagger * strokes.length;

  /* Boiling needs the path data itself to wobble — the same jitter the
     animation lab uses, precomputed once and cycled. */
  const variants = useMemo(() => {
    // jitter in canvas units: 1.6px on a 900px canvas shown ~300px wide is a
    // third of a pixel on screen, which is why the boil was invisible
    const wobble = Math.max(3, (result?.width ?? 600) / 110);
    return strokes.map((stroke) => {
      if (stroke.dot || stroke.curves.length === 0) return [stroke.d];
      const frames = [stroke.d];
      for (let i = 1; i < BOIL_FRAMES; i++) {
        frames.push(boilVariant(stroke as never, i, wobble));
      }
      return frames;
    });
  }, [strokes, result?.width]);

  useEffect(() => {
    if (playKey === 0 || strokes.length === 0 || !result) return;

    timers.current.forEach(window.clearTimeout);
    timers.current = [];
    setPhase('drawing');

    const boilAt = drawTotal + 120;
    const peelAt = boilAt + BOIL_MS;
    const doneAt = peelAt + PEEL_MS;

    timers.current.push(window.setTimeout(() => setPhase('boiling'), boilAt));
    timers.current.push(window.setTimeout(() => setPhase('peeling'), peelAt));
    timers.current.push(
      window.setTimeout(() => {
        setPhase('settled');
        if (!onSettled) return;
        // hand the drawing over and drop back to idle in the same update, so the
        // new image appears exactly as the overlay and the peeled page go away
        rasteriseResult(result, strokeWidth, ink)
          .then((png) => {
            onSettled(png);
            // stay on the live overlay rather than the flat PNG, so the line
            // keeps moving; the PNG is what gets uploaded and shown elsewhere
            setPhase('alive');
          })
          .catch(() => setPhase('idle')); // keep the photo if rasterising fails
      }, doneAt)
    );

    return () => {
      timers.current.forEach(window.clearTimeout);
      timers.current = [];
    };
    // onSettled is intentionally excluded: it is re-created every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playKey, drawTotal, strokes.length, result, strokeWidth, ink]);

  // a new upload resets the stage, otherwise stale ink hangs over the new photo
  useEffect(() => {
    if (playKey === 0) setPhase('idle');
  }, [playKey]);

  // the line keeps breathing from the boil onwards
  useEffect(() => {
    const moving =
      phase === 'boiling' || phase === 'peeling' || phase === 'settled' || phase === 'alive';
    // a very busy trace would repaint hundreds of paths nine times a second
    if (!moving || strokes.length > 90) {
      setFrame(0);
      return;
    }
    const id = window.setInterval(() => setFrame((n) => (n + 1) % BOIL_FRAMES), 110);
    return () => window.clearInterval(id);
  }, [phase, strokes.length]);

  const showInk = result && strokes.length > 0 && phase !== 'idle';

  return (
    <div className={`peel peel--${phase}`}>
      <img className="peel__page" src={imageUrl} alt="your drawing" />

      {showInk && (
        <svg
          className="peel__ink"
          viewBox={`0 0 ${result.width} ${result.height}`}
          style={{ ['--draw-ms' as string]: `${DRAW_MS}ms`, color: ink }}
          aria-hidden
        >
          {strokes.map((stroke, index) =>
            stroke.dot ? (
              <circle
                key={stroke.id}
                cx={stroke.dot.cx}
                cy={stroke.dot.cy}
                r={Math.max(stroke.dot.r, 1.5)}
                strokeWidth={strokeWidth}
                style={{ animationDelay: `${index * stagger}ms` }}
              />
            ) : (
              <path
                key={stroke.id}
                d={variants[index]?.[frame] ?? stroke.d}
                /* pathLength normalises every stroke to 1, so one keyframe
                   draws them all whatever their real length */
                pathLength={1}
                strokeWidth={strokeWidth}
                style={{ animationDelay: `${index * stagger}ms` }}
              />
            )
          )}
        </svg>
      )}
    </div>
  );
}
