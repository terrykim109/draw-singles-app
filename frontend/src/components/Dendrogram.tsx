import { useMemo, useRef, type PointerEvent } from 'react';
import {
  buildDendrogram,
  clusterHue,
  cutDendrogram,
  leavesOf,
  type Dendro,
  type Node as EmbeddedNode,
} from '../similarity';
import type { MatchProfile } from '../types';

type DendrogramProps = {
  nodes: EmbeddedNode<MatchProfile>[];
  groupCount: number;
  onGroupCount: (k: number) => void;
  selected: string | null;
  onSelect: (id: string) => void;
  youId: string;
  width?: number;
  height?: number;
};

type Placed = { x: number; y: number };

export default function Dendrogram({
  nodes,
  groupCount,
  onGroupCount,
  selected,
  onSelect,
  youId,
  width = 720,
  height = 460,
}: DendrogramProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  const tree = useMemo(() => buildDendrogram(nodes), [nodes]);

  const layout = useMemo(() => {
    if (!tree) return null;

    const leafRow = height - 96;
    const top = 42;

    // leaf order comes from walking the tree, so branches never cross
    const order = leavesOf(tree);
    const step = width / (order.length + 1);
    const leafX = new Map(order.map((leaf, index) => [leaf.id, step * (index + 1)]));

    const sims: number[] = [];
    const collect = (t: Dendro<MatchProfile>) => {
      if (t.kind === 'merge') {
        sims.push(t.similarity);
        collect(t.left);
        collect(t.right);
      }
    };
    collect(tree);

    const hi = Math.max(...sims, 1);
    const lo = Math.min(...sims, 0);
    // merged-late (least similar) sits high up; merged-early sits near the leaves
    const yFor = (similarity: number) =>
      top + ((hi - similarity) / (hi - lo || 1)) * (leafRow - top - 26);

    const place = new Map<string, Placed>();
    const walk = (t: Dendro<MatchProfile>): Placed => {
      if (t.kind === 'leaf') {
        const spot = { x: leafX.get(t.id) ?? width / 2, y: leafRow };
        place.set(t.id, spot);
        return spot;
      }
      const a = walk(t.left);
      const b = walk(t.right);
      const spot = { x: (a.x + b.x) / 2, y: yFor(t.similarity) };
      place.set(t.id, spot);
      return spot;
    };
    walk(tree);

    return { place, leafRow, top, order, yFor, sims: [...sims].sort((a, b) => a - b) };
  }, [tree, width, height]);

  const groups = useMemo(
    () => (tree ? cutDendrogram(tree, groupCount) : []),
    [tree, groupCount]
  );

  /** which group each subtree id belongs to, so branches can take its colour */
  const colourOf = useMemo(() => {
    const map = new Map<string, string>();
    groups.forEach((group, index) => {
      const hue = clusterHue(index, groups.length);
      const paint = (t: Dendro<MatchProfile>) => {
        map.set(t.id, hue);
        if (t.kind === 'merge') {
          paint(t.left);
          paint(t.right);
        }
      };
      paint(group);
    });
    return map;
  }, [groups]);

  if (!tree || !layout) return null;

  /** y of the cut line for a given k: midway between the merges it separates */
  const cutY = (k: number) => {
    const { sims, yFor, top } = layout;
    if (k <= 1) return top - 14;
    const below = sims[k - 2]; // weakest merge that gets cut
    const above = sims[k - 1]; // strongest merge still standing
    if (below === undefined) return top - 14;
    if (above === undefined) return yFor(below) + 12;
    return (yFor(below) + yFor(above)) / 2;
  };

  const maxGroups = Math.min(nodes.length, 6);

  function pickGroupFromY(clientY: number) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const y = ((clientY - rect.top) / rect.height) * height;

    let best = groupCount;
    let bestGap = Infinity;
    for (let k = 2; k <= maxGroups; k++) {
      const gap = Math.abs(cutY(k) - y);
      if (gap < bestGap) {
        bestGap = gap;
        best = k;
      }
    }
    if (best !== groupCount) onGroupCount(best);
  }

  const dragging = useRef(false);
  const line = cutY(groupCount);

  const branches: JSX.Element[] = [];
  const drawBranch = (t: Dendro<MatchProfile>) => {
    if (t.kind === 'leaf') return;
    const self = layout.place.get(t.id)!;
    const a = layout.place.get(t.left.id)!;
    const b = layout.place.get(t.right.id)!;
    const cut = self.y < line; // merges above the line were severed
    const colour = cut ? 'var(--ink-muted)' : colourOf.get(t.id) ?? 'var(--ink)';

    branches.push(
      <path
        key={t.id}
        d={`M ${a.x} ${a.y} V ${self.y} H ${b.x} V ${b.y}`}
        fill="none"
        stroke={colour}
        strokeWidth={cut ? 1.5 : 2.5}
        strokeDasharray={cut ? '5 5' : undefined}
        opacity={cut ? 0.5 : 1}
        strokeLinecap="round"
      />
    );
    drawBranch(t.left);
    drawBranch(t.right);
  };
  drawBranch(tree);

  return (
    <svg
      ref={svgRef}
      className="dendro"
      viewBox={`0 0 ${width} ${height}`}
      onPointerMove={(event: PointerEvent<SVGSVGElement>) => {
        if (dragging.current) pickGroupFromY(event.clientY);
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onPointerLeave={() => {
        dragging.current = false;
      }}
    >
      {branches}

      {/* group labels sit just under the cut, above each surviving subtree */}
      {groups.map((group, index) => {
        const members = leavesOf(group);
        const xs = members.map((m) => layout.place.get(m.id)?.x ?? 0);
        const cx = xs.reduce((s, x) => s + x, 0) / Math.max(xs.length, 1);
        return (
          <text
            key={group.id}
            className="dendro__group"
            x={cx}
            y={line + 18}
            textAnchor="middle"
            fill={clusterHue(index, groups.length)}
          >
            {members.length}
          </text>
        );
      })}

      {/* the cut — drag it to change how many types there are */}
      <g
        className="dendro__cut"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          dragging.current = true;
        }}
      >
        <line x1={0} y1={line} x2={width} y2={line} className="dendro__cut-hit" />
        <line x1={8} y1={line} x2={width - 8} y2={line} className="dendro__cut-line" />
        <rect x={width - 96} y={line - 13} width={88} height={26} rx={7} className="dendro__cut-tag" />
        <text x={width - 52} y={line + 5} textAnchor="middle" className="dendro__cut-text">
          {groupCount} types
        </text>
      </g>

      {/* leaves */}
      {layout.order.map((leaf) => {
        const spot = layout.place.get(leaf.id)!;
        const isYou = leaf.id === youId;
        const isSelected = selected === leaf.id;
        return (
          <g
            key={leaf.id}
            transform={`translate(${spot.x} ${spot.y})`}
            className={`dendro__leaf${isSelected ? ' dendro__leaf--on' : ''}`}
            onClick={() => onSelect(leaf.id)}
          >
            <clipPath id={`dclip-${leaf.id}`}>
              <circle r={21} />
            </clipPath>
            <circle r={24} className="dendro__leaf-halo" />
            {leaf.item.photo && (
              <image
                href={leaf.item.photo}
                x={-21}
                y={-21}
                width={42}
                height={42}
                clipPath={`url(#dclip-${leaf.id})`}
                preserveAspectRatio="xMidYMid slice"
              />
            )}
            <circle r={21} className="dendro__leaf-ring" />
            <text y={44} textAnchor="middle" className="dendro__leaf-name">
              {isYou ? 'you' : leaf.item.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
