import { useMemo, useState } from 'react';
import DrawCanvas from '../lab/DrawCanvas';
import AnimatedDrawing from '../lab/AnimatedDrawing';
import { DEFAULT_PRESET, PRESETS } from '../lab/presets';
import { vectorize, type RawStroke } from '../lab/strokes';
import { buildRig, type Role } from '../lab/rig';
import { sampleStickman } from '../lab/sample';
import type { Pt } from '../lab/geometry';

const CANVAS_W = 460;
const CANVAS_H = 480;
const ROLES: Role[] = ['core', 'appendage', 'detail'];

type LabProps = {
  onBack: () => void;
};

export default function Lab({ onBack }: LabProps) {
  const [raw, setRaw] = useState<RawStroke[]>([]);
  const [brush, setBrush] = useState(4);
  const [tolerance, setTolerance] = useState(3);
  const [jointGap, setJointGap] = useState(14);
  const [overrides, setOverrides] = useState<Record<string, Role>>({});
  const [preset, setPreset] = useState(DEFAULT_PRESET);
  const [boil, setBoil] = useState(DEFAULT_PRESET.boil ?? false);
  // off by default: it draws a static copy of every bone, which reads as a
  // duplicated limb once the real one starts swinging
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [playKey, setPlayKey] = useState(0);
  const [highlight, setHighlight] = useState<string | null>(null);

  const vectors = useMemo(
    () => raw.map((stroke) => vectorize(stroke, tolerance)),
    [raw, tolerance]
  );

  const rig = useMemo(
    () => buildRig(vectors, jointGap, overrides),
    [vectors, jointGap, overrides]
  );

  const rawPoints = raw.reduce((sum, stroke) => sum + stroke.points.length, 0);
  const curveCount = vectors.reduce((sum, stroke) => sum + stroke.curves.length, 0);
  const controlPoints = vectors.reduce((sum, stroke) => sum + stroke.curves.length * 3 + 1, 0);
  const shrink = rawPoints === 0 ? 0 : Math.round((1 - controlPoints / rawPoints) * 100);

  const details = rig.bones.filter((bone) => bone.role === 'detail').length;
  const rigless = rig.score === 0;

  function addStroke(points: Pt[], width: number) {
    setRaw((prev) => [...prev, { id: `s${prev.length}-${Date.now()}`, points, width }]);
  }

  /** everything needed to replay this exact drawing outside the browser */
  function diagnostics() {
    return JSON.stringify(
      {
        tolerance,
        jointGap,
        preset: preset.id,
        boil,
        devicePixelRatio: window.devicePixelRatio,
        hasWebAnimations: typeof Element.prototype.animate === 'function',
        rig: {
          score: rig.score,
          coreId: rig.coreId,
          joints: rig.joints.length,
          bones: rig.bones.map((bone) => ({
            id: bone.id,
            role: bone.role,
            parent: bone.parent,
            depth: bone.depth,
            pivot: [Math.round(bone.pivot.x), Math.round(bone.pivot.y)],
            length: Math.round(bone.length),
            curves: bone.stroke.curves.length,
          })),
        },
        strokes: raw.map((stroke) => ({
          id: stroke.id,
          width: stroke.width,
          points: stroke.points.map((p) => [Math.round(p.x), Math.round(p.y)]),
        })),
      },
      null,
      1
    );
  }

  function cycleRole(id: string, current: Role) {
    const next = ROLES[(ROLES.indexOf(current) + 1) % ROLES.length];
    setOverrides((prev) => ({ ...prev, [id]: next }));
    setPlayKey((key) => key + 1);
  }

  return (
    <div className="shell" style={{ maxWidth: 1120, gap: 26 }}>
      <div className="lab-head">
        <div className="stack" style={{ gap: 2 }}>
          <p className="eyebrow">experiment</p>
          <h2>animation lab</h2>
        </div>
        <button className="btn btn--ghost" type="button" onClick={onBack}>
          back to the app
        </button>
      </div>

      <div className="lab-grid">
        {/* ---- draw ---- */}
        <div className="card">
          <div className="stack" style={{ gap: 14 }}>
            <div className="lab-panel-head">
              <p className="hand">1 · draw</p>
              <p className="muted" style={{ fontSize: 12 }}>
                {raw.length} strokes · {rawPoints} points
              </p>
            </div>

            <DrawCanvas
              width={CANVAS_W}
              height={CANVAS_H}
              strokes={raw}
              brush={brush}
              onStrokeEnd={addStroke}
            />

            <div className="lab-tools">
              <label className="slider">
                brush
                <input
                  type="range"
                  min={2}
                  max={10}
                  value={brush}
                  onChange={(e) => setBrush(Number(e.target.value))}
                />
              </label>

              <label className="slider">
                smoothing
                <input
                  type="range"
                  min={1}
                  max={12}
                  value={tolerance}
                  onChange={(e) => setTolerance(Number(e.target.value))}
                />
              </label>

              <label className="slider">
                joint reach
                <input
                  type="range"
                  min={3}
                  max={40}
                  value={jointGap}
                  onChange={(e) => setJointGap(Number(e.target.value))}
                />
              </label>
            </div>

            <div className="lab-tools">
              <button
                className="btn btn--soft"
                type="button"
                onClick={() => setRaw((prev) => prev.slice(0, -1))}
                disabled={raw.length === 0}
              >
                undo
              </button>
              <button
                className="btn btn--soft"
                type="button"
                onClick={() => {
                  setRaw([]);
                  setOverrides({});
                }}
                disabled={raw.length === 0}
              >
                clear
              </button>
              <button
                className="btn btn--soft"
                type="button"
                onClick={() => {
                  setRaw(sampleStickman());
                  setOverrides({});
                  setPlayKey((key) => key + 1);
                }}
              >
                load sample
              </button>
              <button
                className="btn btn--soft"
                type="button"
                disabled={raw.length === 0}
                onClick={() => {
                  const dump = diagnostics();
                  navigator.clipboard?.writeText(dump).catch(() => undefined);
                  console.log(dump);
                }}
              >
                copy diagnostics
              </button>
            </div>
          </div>
        </div>

        {/* ---- animate ---- */}
        <div className="card">
          <div className="stack" style={{ gap: 14 }}>
            <div className="lab-panel-head">
              <p className="hand">2 · smoothed &amp; animated</p>
              <p className="muted" style={{ fontSize: 12 }}>
                {curveCount} curves · {controlPoints} control points
                {shrink > 0 ? ` · ${shrink}% lighter` : ''}
              </p>
            </div>

            <div className="stage" style={{ height: CANVAS_H }}>
              {rig.bones.length === 0 ? (
                <p className="hand muted center" style={{ padding: 40 }}>
                  draw anything —
                  <br />
                  creature, blob, house, scribble
                </p>
              ) : (
                <AnimatedDrawing
                  rig={rig}
                  preset={preset}
                  boil={boil}
                  playKey={playKey}
                  width={CANVAS_W}
                  height={CANVAS_H}
                  highlight={highlight}
                  showSkeleton={showSkeleton}
                  onPick={(id) => {
                    const bone = rig.byId.get(id);
                    if (bone) cycleRole(id, bone.role);
                  }}
                />
              )}
            </div>

            <div className="options">
              {PRESETS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`option${item.id === preset.id ? ' option--selected' : ''}${
                    item.needsRig ? ' option--rigged' : ''
                  }`}
                  onClick={() => {
                    setPreset(item);
                    setBoil(item.boil ?? false);
                    setPlayKey((key) => key + 1);
                  }}
                >
                  {item.name}
                  {item.needsRig && <span className="option__mark">◆</span>}
                </button>
              ))}
            </div>

            <p className="muted" style={{ fontSize: 12 }}>
              {preset.blurb}
              {preset.needsRig && rigless && rig.bones.length > 0 && (
                <>
                  {' '}
                  <strong>no skeleton found here — only the whole-figure motion will play.</strong>
                </>
              )}
            </p>

            <div className="lab-tools">
              <label className="slider slider--inline">
                <input type="checkbox" checked={boil} onChange={(e) => setBoil(e.target.checked)} />
                boiling line
              </label>
              <label className="slider slider--inline">
                <input
                  type="checkbox"
                  checked={showSkeleton}
                  onChange={(e) => setShowSkeleton(e.target.checked)}
                />
                show skeleton
              </label>
              <button
                className="btn btn--soft"
                type="button"
                onClick={() => setPlayKey((key) => key + 1)}
              >
                replay
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ---- rig ---- */}
      <div className="card">
        <div className="stack" style={{ gap: 14 }}>
          <div className="lab-panel-head">
            <p className="hand">3 · skeleton</p>
            <div className="lab-tools">
              <span className={`score${rigless ? ' score--none' : ''}`}>
                riggability {Math.round(rig.score * 100)}%
              </span>
              <button
                className="btn btn--soft"
                type="button"
                disabled={Object.keys(overrides).length === 0}
                onClick={() => {
                  setOverrides({});
                  setPlayKey((key) => key + 1);
                }}
              >
                reset roles
              </button>
            </div>
          </div>

          {rig.bones.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>
              wherever one stroke ends on top of another, that's a joint. the most connected
              stroke becomes the core and everything else hangs off it. no part names, so a
              blob with no limbs and a squid with forty both work.
            </p>
          ) : (
            <>
              <p className="muted" style={{ fontSize: 12 }}>
                core: {rig.coreId ? '1 stroke' : 'none'} · appendages: {rig.appendages.length} ·
                details: {details} · joints: {rig.joints.length} — click a stroke in the stage,
                or a chip below, to cycle its role
              </p>

              <div className="parts">
                {rig.bones.map((bone, index) => (
                  <button
                    key={bone.id}
                    type="button"
                    className={`part-row part-row--${bone.role}`}
                    onMouseEnter={() => setHighlight(bone.id)}
                    onMouseLeave={() => setHighlight(null)}
                    onClick={() => cycleRole(bone.id, bone.role)}
                  >
                    <span className="part-row__name">
                      stroke {index + 1}
                      <span className="muted">
                        {' '}
                        · {bone.parent ? `depth ${bone.depth}` : 'unattached'}
                      </span>
                    </span>
                    <span className="role-tag">{bone.role}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
