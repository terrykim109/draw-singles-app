import { useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import type { RawStroke } from '../lab/strokes';
import type { Pt } from '../lab/geometry';
import {
  DEFAULT_TRACE_OPTIONS,
  buildStrokeSvgDoc,
  buildSvgDoc,
  canvasFromImage,
  loadImage,
  trace,
  type TraceMode,
  type TraceOptions,
  type TracedStroke,
} from '../trace/tracer';
import { makeSampleDrawing } from '../trace/sample';
import PeelStage from '../trace/PeelStage';
import { storedPalette } from '../palettes';

const MAX_DIM = 1000;
/** each card renders its own inline SVG, so this list has to stay bounded */
const MAX_CARDS = 60;

type TraceProps = {
  onBack: () => void;
  onAnimate?: (strokes: RawStroke[]) => void;
};

function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Trace({ onBack, onAnimate }: TraceProps) {
  const [source, setSource] = useState<{
    url: string;
    image: HTMLImageElement;
    name: string;
  } | null>(null);
  const [options, setOptions] = useState<TraceOptions>(DEFAULT_TRACE_OPTIONS);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [peelKey, setPeelKey] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const canvas = useMemo(
    () => (source ? canvasFromImage(source.image, MAX_DIM) : null),
    [source]
  );
  const result = useMemo(() => {
    if (!canvas) return null;
    try {
      return trace(canvas, options);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('trace failed', err);
      return null;
    }
  }, [canvas, options]);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const url = URL.createObjectURL(file);
      const image = await loadImage(url);
      setSource({ url, image, name: file.name });
      setSelected(null);
    } catch {
      setError('could not read that image — try a png or jpg of a drawing');
    }
  }

  function handlePick(event: ChangeEvent<HTMLInputElement>) {
    handleFile(event.target.files?.[0]);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    handleFile(event.dataTransfer.files?.[0]);
  }

  function trySample() {
    setError(null);
    const url = makeSampleDrawing(storedPalette().ink);
    loadImage(url)
      .then((image) => {
        setSource({ url, image, name: 'sample-drawing.png' });
        setSelected(null);
      })
      .catch(() => setError('could not build the sample'));
  }

  const ink = storedPalette().ink;
  const baseName = (source?.name ?? 'drawing').replace(/\.[^.]+$/, '');

  const curves = result?.strokes.reduce((sum, s) => sum + s.curves.length, 0) ?? 0;
  const rawPts = result?.strokes.reduce((sum, s) => sum + s.points.length, 0) ?? 0;
  const controlPts =
    result?.strokes.reduce((sum, s) => sum + (s.dot ? 1 : s.curves.length * 3 + 1), 0) ?? 0;
  const lighter = rawPts > 0 ? Math.round((1 - controlPts / rawPts) * 100) : 0;

  const pad = Math.ceil(options.strokeWidth) + 2;
  const previewVb = result
    ? `${result.box.x - pad} ${result.box.y - pad} ${result.box.w + pad * 2} ${result.box.h + pad * 2}`
    : '0 0 10 10';

  function downloadCombined() {
    if (!result) return;
    download(
      `${baseName}-vectorized.svg`,
      buildSvgDoc(result, options.strokeWidth, ink),
      'image/svg+xml'
    );
  }

  function downloadStroke(stroke: TracedStroke, index: number) {
    download(
      `${baseName}-stroke-${index + 1}.svg`,
      buildStrokeSvgDoc(stroke, options.strokeWidth, ink),
      'image/svg+xml'
    );
  }

  async function copySvg() {
    if (!result) return;
    const svg = buildSvgDoc(result, options.strokeWidth, ink);
    try {
      await navigator.clipboard.writeText(svg);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard blocked (http) — fall back to a textarea copy
      const textarea = document.createElement('textarea');
      textarea.value = svg;
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      } catch {
        setError('could not copy — clipboard needs a secure context');
      }
      textarea.remove();
    }
  }

  const set = <K extends keyof TraceOptions>(key: K, value: TraceOptions[K]) =>
    setOptions((prev) => ({ ...prev, [key]: value }));

  /** convert traced strokes → RawStroke[] for the animation lab, scaled to fit 460×480 */
  function buildAnimateStrokes(): RawStroke[] | null {
    if (!result || result.strokes.length === 0) return null;
    const LAB_W = 460;
    const LAB_H = 480;
    const pad = 40;
    const bw = result.box.w || 1;
    const bh = result.box.h || 1;
    const scale = Math.min((LAB_W - pad * 2) / bw, (LAB_H - pad * 2) / bh, 1);
    const ox = (LAB_W - bw * scale) / 2 - result.box.x * scale;
    const oy = (LAB_H - bh * scale) / 2 - result.box.y * scale;

    const tr = (p: Pt): Pt => ({ x: p.x * scale + ox, y: p.y * scale + oy });

    return result.strokes.map((s) => {
      if (s.dot) {
        // turn a dot into a small ring the lab can see
        const cx = s.dot.cx * scale + ox;
        const cy = s.dot.cy * scale + oy;
        const r = Math.max(2, s.dot.r * scale);
        const n = 14;
        const ring: Pt[] = [];
        for (let j = 0; j <= n; j++) {
          const a = (j / n) * Math.PI * 2;
          ring.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
        }
        return { id: s.id, points: ring, width: options.strokeWidth };
      }
      return {
        id: s.id,
        points: s.points.map(tr),
        width: options.strokeWidth,
      };
    });
  }

  return (
    <div className="shell" style={{ maxWidth: 1120, gap: 26 }}>
      <div className="lab-head">
        <div className="stack" style={{ gap: 2 }}>
          <p className="eyebrow">experiment</p>
          <h2>image → svg</h2>
        </div>
        <button className="btn btn--ghost" type="button" onClick={onBack}>
          back to the app
        </button>
      </div>

      <div className="lab-grid">
        {/* ---- input ---- */}
        <div className="card">
          <div className="stack" style={{ gap: 14 }}>
            <div className="lab-panel-head">
              <p className="hand">1 · bring a drawing</p>
              <button className="btn btn--soft" type="button" onClick={trySample}>
                ✎ try a sample
              </button>
            </div>

            {!source ? (
              <div
                className={`dropzone${dragging ? ' dropzone--active' : ''}`}
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
              >
                <p className="dropzone__hint">
                  drop a photo of a drawing, or click to pick one
                </p>
                <input ref={fileRef} type="file" accept="image/*" onChange={handlePick} />
              </div>
            ) : (
              <div className="stack" style={{ gap: 14 }}>
                <div className="trace-source">
                  <PeelStage
                    imageUrl={source.url}
                    result={result}
                    strokeWidth={options.strokeWidth}
                    playKey={peelKey}
                    ink={ink}
                  />
                  <div className="lab-tools">
                    <button
                      className="btn btn--primary"
                      type="button"
                      style={{ width: 'auto' }}
                      disabled={!result || result.strokes.length === 0}
                      onClick={() => setPeelKey((key) => key + 1)}
                    >
                      ✧ peel it off the page
                    </button>
                    <button
                      className="btn btn--soft"
                      type="button"
                      onClick={() => {
                        URL.revokeObjectURL(source.url);
                        setSource(null);
                        setSelected(null);
                      }}
                    >
                      choose another
                    </button>
                    <button className="btn btn--soft" type="button" onClick={trySample}>
                      try the sample
                    </button>
                  </div>
                </div>

                <div className="trace-controls">
                  <div className="seg" role="group" aria-label="tracing mode">
                    {(['skeleton', 'outline'] as TraceMode[]).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        className={`option${options.mode === mode ? ' option--selected' : ''}`}
                        onClick={() => set('mode', mode)}
                      >
                        {mode === 'skeleton' ? 'skeleton · line look' : 'outline · shape look'}
                      </button>
                    ))}
                  </div>

                  <div className="lab-tools" style={{ gap: 16 }}>
                    <label className="slider">
                      cleanup
                      <input
                        type="range"
                        min={0}
                        max={4}
                        value={options.blur}
                        onChange={(e) => set('blur', Number(e.target.value))}
                      />
                    </label>
                    <label className="slider">
                      threshold {options.thresholdOffset >= 0 ? '+' : ''}
                      {options.thresholdOffset}
                      <input
                        type="range"
                        min={-60}
                        max={60}
                        value={options.thresholdOffset}
                        onChange={(e) => set('thresholdOffset', Number(e.target.value))}
                      />
                    </label>
                    <label className="slider">
                      drop specks {options.minArea}px
                      <input
                        type="range"
                        min={2}
                        max={60}
                        value={options.minArea}
                        onChange={(e) => set('minArea', Number(e.target.value))}
                      />
                    </label>
                  </div>

                  <div className="lab-tools" style={{ gap: 16 }}>
                    <label className="slider">
                      smoothing
                      <input
                        type="range"
                        min={1}
                        max={10}
                        value={options.tolerance}
                        onChange={(e) => set('tolerance', Number(e.target.value))}
                      />
                    </label>
                    <label className="slider">
                      stroke width
                      <input
                        type="range"
                        min={1}
                        max={10}
                        value={options.strokeWidth}
                        onChange={(e) => set('strokeWidth', Number(e.target.value))}
                      />
                    </label>
                    <label className="slider slider--inline">
                      <input
                        type="checkbox"
                        checked={options.invert}
                        onChange={(e) => set('invert', e.target.checked)}
                      />
                      white ink on dark paper
                    </label>
                    <label className="slider slider--inline">
                      <input
                        type="checkbox"
                        checked={options.evenLighting}
                        onChange={(e) => set('evenLighting', e.target.checked)}
                      />
                      even out lighting
                    </label>
                  </div>
                </div>
              </div>
            )}

            {error && <p className="error">{error}</p>}
          </div>
        </div>

        {/* ---- output ---- */}
        <div className="card">
          <div className="stack" style={{ gap: 14 }}>
            <div className="lab-panel-head">
              <p className="hand">2 · smooth svg</p>
              <p className="muted" style={{ fontSize: 12 }}>
                {result
                  ? `${result.strokes.length} strokes · ${curves} curves · ${controlPts} control pts · ${lighter}% lighter` +
                    (result.dropped > 0 ? ` · ${result.dropped} tiny marks dropped` : '')
                  : 'waiting for a drawing'}
              </p>
            </div>

            <div className="trace-preview">
              {result ? (
                <svg
                  viewBox={previewVb}
                  className="trace-svg"
                  aria-label="vectorized drawing"
                >
                  {result.strokes.map((stroke) =>
                    stroke.dot ? (
                      <circle
                        key={stroke.id}
                        cx={stroke.dot.cx}
                        cy={stroke.dot.cy}
                        r={stroke.dot.r}
                        className="stroke-ink"
                        fill="none"
                        strokeWidth={options.strokeWidth}
                        style={{
                          opacity: selected && selected !== stroke.id ? 0.12 : 1,
                        }}
                      />
                    ) : (
                      <path
                        key={stroke.id}
                        d={stroke.d}
                        className="stroke-ink"
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={options.strokeWidth}
                        style={{
                          opacity: selected && selected !== stroke.id ? 0.12 : 1,
                        }}
                      />
                    )
                  )}
                </svg>
              ) : (
                <p className="hand muted center" style={{ padding: 40 }}>
                  upload a drawing —
                  <br />
                  pen, pencil, crayon, all fine
                </p>
              )}
            </div>

            <div className="lab-tools">
              <button
                className="btn btn--soft"
                type="button"
                disabled={!result}
                onClick={downloadCombined}
              >
                ↓ combined .svg
              </button>
              <button className="btn btn--soft" type="button" disabled={!result} onClick={copySvg}>
                {copied ? 'copied ✓' : 'copy svg code'}
              </button>
              {onAnimate && (
                <button
                  className="btn btn--primary"
                  style={{ width: 'auto', padding: '10px 18px', fontSize: 14 }}
                  type="button"
                  disabled={!result || result.strokes.length === 0}
                  onClick={() => {
                    const strokes = buildAnimateStrokes();
                    if (strokes) onAnimate(strokes);
                  }}
                >
                  ✎ animate these strokes
                </button>
              )}
              <span className="muted" style={{ fontSize: 12 }}>
                ink {Math.round((result?.inkRatio ?? 0) * 100)}% · threshold {result?.threshold}
              </span>
            </div>

            <p className="muted" style={{ fontSize: 12 }}>
              every connected blob of ink becomes its own smooth cubic bézier — the same
              fitter the animation lab uses. skeleton mode follows the line through the
              middle of each stroke; outline mode traces around filled shapes.
            </p>
          </div>
        </div>
      </div>

      {/* ---- the collection ---- */}
      <div className="card">
        <div className="stack" style={{ gap: 14 }}>
          <div className="lab-panel-head">
            <p className="hand">3 · the collection</p>
            <p className="muted" style={{ fontSize: 12 }}>
              one svg per stroke — click to find it in the preview
            </p>
          </div>

          {!result || result.strokes.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>
              nothing traced yet. add a drawing and each separate mark will show up here as
              its own svg, sized to its own box.
            </p>
          ) : (
            <div className="svg-grid">
              {result.strokes.slice(0, MAX_CARDS).map((stroke, index) => {
                const b = stroke.box;
                const p = Math.ceil(options.strokeWidth) + 2;
                const vb = `${b.x - p} ${b.y - p} ${b.w + p * 2} ${b.h + p * 2}`;
                return (
                  <div
                    key={stroke.id}
                    className={`svg-card${selected === stroke.id ? ' svg-card--selected' : ''}`}
                    onClick={() => setSelected(selected === stroke.id ? null : stroke.id)}
                  >
                    <svg viewBox={vb} className="stroke-svg">
                      {stroke.dot ? (
                        <circle
                          cx={stroke.dot.cx}
                          cy={stroke.dot.cy}
                          r={stroke.dot.r}
                          className="stroke-ink"
                          fill="none"
                          strokeWidth={options.strokeWidth}
                        />
                      ) : (
                        <path
                          d={stroke.d}
                          className="stroke-ink"
                          fill="none"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={options.strokeWidth}
                        />
                      )}
                    </svg>
                    <div className="svg-card__foot">
                      <span>
                        stroke {index + 1}
                        {stroke.closed ? ' ●' : ''}
                      </span>
                      <button
                        className="svg-card__save"
                        type="button"
                        title="download this svg"
                        onClick={(e) => {
                          e.stopPropagation();
                          downloadStroke(stroke, index);
                        }}
                      >
                        ↓
                      </button>
                    </div>
                  </div>
                );
              })}
              {result.strokes.length > MAX_CARDS && (
                <p className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>
                  + {result.strokes.length - MAX_CARDS} more strokes (not shown — they are
                  still in the combined .svg)
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
