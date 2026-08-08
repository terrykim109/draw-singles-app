import { useEffect, useMemo, useRef, useState } from 'react';
import type { Preset } from './presets';
import type { Bone, Rig } from './rig';
import { boilVariant } from './strokes';

type AnimatedDrawingProps = {
  rig: Rig;
  preset: Preset;
  boil: boolean;
  playKey: number;
  width: number;
  height: number;
  highlight?: string | null;
  showSkeleton?: boolean;
  onPick?: (id: string) => void;
};

const BOIL_FRAMES = 3;
/** hard cap on independently animated groups — a 100-tentacle squid still needs 60fps */
const MAX_ANIMATED = 24;

export default function AnimatedDrawing({
  rig,
  preset,
  boil,
  playKey,
  width,
  height,
  highlight,
  showSkeleton,
  onPick,
}: AnimatedDrawingProps) {
  const rootRef = useRef<SVGGElement>(null);
  const boneRefs = useRef(new Map<string, SVGGElement>());
  const [frame, setFrame] = useState(0);

  const variants = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const bone of rig.bones) {
      const frames = [bone.stroke.d];
      for (let i = 1; i < BOIL_FRAMES; i++) frames.push(boilVariant(bone.stroke, i, 2.4));
      map.set(bone.id, frames);
    }
    return map;
  }, [rig]);

  useEffect(() => {
    if (!boil) {
      setFrame(0);
      return;
    }
    const id = window.setInterval(() => setFrame((prev) => (prev + 1) % BOIL_FRAMES), 110);
    return () => window.clearInterval(id);
  }, [boil]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const running: Animation[] = [];
    root.getAnimations().forEach((animation) => animation.cancel());

    if (preset.root) running.push(root.animate(preset.root.keyframes, preset.root.options));

    const maxLength = Math.max(...rig.bones.map((bone) => bone.length), 1);
    const animated = rig.appendages.slice(0, MAX_ANIMATED);
    const rank = new Map(animated.map((bone, index) => [bone.id, index]));

    for (const bone of rig.bones) {
      const element = boneRefs.current.get(bone.id);
      if (!element) continue;
      element.getAnimations().forEach((animation) => animation.cancel());

      if (bone.role === 'appendage' && !rank.has(bone.id)) continue; // over the cap: rides parent

      const anim = preset.bone?.(bone, {
        rig,
        index: rank.get(bone.id) ?? 0,
        count: Math.max(animated.length, 1),
        maxLength,
      });
      if (anim) running.push(element.animate(anim.keyframes, anim.options));
    }

    const paths = Array.from(root.querySelectorAll<SVGPathElement>('path'));
    if (preset.drawOn) {
      const total = 1400 + paths.length * 170 + 700;
      paths.forEach((path, index) => {
        const length = path.getTotalLength();
        path.style.strokeDasharray = `${length}`;
        const start = Math.min(0.98, (index * 170) / total);
        const end = Math.min(1, (index * 170 + 750) / total);
        running.push(
          path.animate(
            [
              { strokeDashoffset: length, offset: 0 },
              { strokeDashoffset: length, offset: start },
              { strokeDashoffset: 0, offset: end },
              { strokeDashoffset: 0, offset: 1 },
            ],
            { duration: total, iterations: Infinity, easing: 'ease-in-out' }
          )
        );
      });
    } else {
      paths.forEach((path) => {
        path.style.strokeDasharray = '';
        path.style.strokeDashoffset = '';
      });
    }

    return () => running.forEach((animation) => animation.cancel());
  }, [rig, preset, playKey]);

  function renderBone(bone: Bone): JSX.Element {
    const frames = variants.get(bone.id);
    const children = bone.children
      .map((id) => rig.byId.get(id))
      .filter((child): child is Bone => Boolean(child));

    return (
      <g
        key={bone.id}
        ref={(element) => {
          if (element) boneRefs.current.set(bone.id, element);
          else boneRefs.current.delete(bone.id);
        }}
        className={`stage-bone${highlight === bone.id ? ' stage-bone--lit' : ''}`}
        style={{
          transformBox: 'view-box',
          transformOrigin: `${bone.pivot.x}px ${bone.pivot.y}px`,
        }}
        onClick={onPick ? () => onPick(bone.id) : undefined}
      >
        <path
          d={frames?.[frame] ?? bone.stroke.d}
          fill="none"
          stroke="currentColor"
          strokeWidth={bone.stroke.width}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {children.map(renderBone)}
      </g>
    );
  }

  const roots = rig.roots
    .map((id) => rig.byId.get(id))
    .filter((bone): bone is Bone => Boolean(bone));

  return (
    <svg
      className={`stage-svg${showSkeleton ? ' stage-svg--rig' : ''}`}
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      style={{ maxHeight: height }}
      aria-label="animated drawing"
    >
      <g ref={rootRef} style={{ transformBox: 'view-box', transformOrigin: '50% 60%' }}>
        {roots.map(renderBone)}
      </g>

      {showSkeleton && (
        <g className="skeleton" aria-hidden>
          {rig.bones
            .filter((bone) => bone.role !== 'detail')
            .map((bone) => (
              <line
                key={`b-${bone.id}`}
                x1={bone.pivot.x}
                y1={bone.pivot.y}
                x2={bone.tip.x}
                y2={bone.tip.y}
                className={bone.role === 'core' ? 'skeleton__core' : 'skeleton__bone'}
              />
            ))}
          {rig.joints.map((joint, index) => (
            <circle key={`j-${index}`} cx={joint.x} cy={joint.y} r={5} className="skeleton__joint" />
          ))}
        </g>
      )}
    </svg>
  );
}
