import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { MOCK_PROFILES } from '../mockMatches';
import { QUESTIONS, type MatchProfile, type Profile } from '../types';
import { CATEGORIES, CATEGORY_BY_ID } from '../categories';
import { getVectors, type ApiVectorProfile } from '../api';
import {
  clusterHue,
  clusterNodes,
  groupBySupertype,
  embed,
  knnLinks,
  sharedTraits,
  similarity,
  tiersFor,
  type Cluster,
  type Node as EmbeddedNode,
} from '../similarity';

type ConstellationProps = {
  you: Profile;
  /** backend account id. Available right after signup, whereas you.id only
      appears once the profile POST resolves — so prefer it for identity. */
  userId?: string;
  onDone: (liked: MatchProfile[]) => void;
};

const YOU = '__you__';

type Body = { id: string; x: number; y: number; vx: number; vy: number; pinned: boolean };
type View = 'map' | 'types';

const SHORT_LABEL: Record<string, string> = {
  medium: 'draws with',
  style: 'stranger says',
  looking: 'here for',
};

/* ---- convex hull, so a group can be drawn as one blob ---------------- */
function hull(points: { x: number; y: number }[]): { x: number; y: number }[] {
  if (points.length < 3) return points;
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: any, a: any, b: any) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const build = (list: typeof sorted) => {
    const out: typeof sorted = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };

  return [...build(sorted), ...build([...sorted].reverse())];
}

function blobPath(points: { x: number; y: number }[], pad: number): string {
  if (points.length === 0) return '';
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;

  if (points.length < 3) {
    // one or two members: a soft circle around them reads better than a sliver
    const radius = Math.max(...points.map((p) => Math.hypot(p.x - cx, p.y - cy))) + pad;
    return `M ${cx - radius} ${cy} a ${radius} ${radius} 0 1 0 ${radius * 2} 0 a ${radius} ${radius} 0 1 0 ${-radius * 2} 0`;
  }

  const ring = hull(points).map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const d = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / d) * pad, y: p.y + (dy / d) * pad };
  });

  // midpoint quadratics — a rounded outline instead of a hard polygon
  let path = `M ${(ring[0].x + ring[ring.length - 1].x) / 2} ${(ring[0].y + ring[ring.length - 1].y) / 2}`;
  for (let i = 0; i < ring.length; i++) {
    const current = ring[i];
    const next = ring[(i + 1) % ring.length];
    path += ` Q ${current.x} ${current.y} ${(current.x + next.x) / 2} ${(current.y + next.y) / 2}`;
  }
  return `${path} Z`;
}

export default function Constellation({ you, userId, onDone }: ConstellationProps) {
  const [liked, setLiked] = useState<MatchProfile[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [view, setView] = useState<View>('map');
  const [groupCount, setGroupCount] = useState(3);
  const [, tick] = useState(0);

  /* The classifier will fill this in from the drawing. Until then you pick it,
     which is also the override you want for when the model gets it wrong. */
  const [yourCategory, setYourCategory] = useState<string>(you.category ?? 'squiggle');

  const yourProfile = useMemo<MatchProfile>(
    () => ({ ...you, id: YOU, note: 'this is you', category: yourCategory }),
    [you, yourCategory]
  );

  /* ---- live data ---------------------------------------------------- *
   * The backend holds the real 250-dim vectors from the classifier. Poll for
   * them, because classification runs in the background after signup and this
   * screen opens immediately. Until your own drawing lands in the index we stay
   * on the bundled sample profiles — mixing a locally-embedded vector with the
   * model's would compare two different spaces and produce quiet nonsense. */
  const myId = userId ?? you.id;

  const [live, setLive] = useState<ApiVectorProfile[] | null>(null);
  /* 'waiting' and 'offline' are different failures and used to be reported
     identically as "backend offline" — which sent me hunting a server problem
     when the server was fine and the drawing simply had no vector. */
  const [source, setSource] = useState<'loading' | 'live' | 'waiting' | 'offline'>('loading');

  useEffect(() => {
    let stopped = false;
    let attempts = 0;

    const poll = async () => {
      let reachable = false;
      try {
        const response = await getVectors();
        reachable = true;
        const mine = myId && response.profiles.some((p) => p.id === myId);
        if (!stopped && response.profiles.length > 0 && mine) {
          setLive(response.profiles);
          setSource('live');
          return;
        }
      } catch {
        reachable = false;
      }
      if (stopped) return;
      attempts += 1;
      if (attempts < 10) window.setTimeout(poll, 1500);
      else
        setSource((current) =>
          current === 'live' ? current : reachable ? 'waiting' : 'offline'
        );
    };

    poll();
    return () => {
      stopped = true;
    };
  }, [myId]);

  const nodes = useMemo<EmbeddedNode<MatchProfile>[]>(() => {
    if (live && live.length > 0) {
      return live.map((profile) => {
        const isYou = profile.id === myId;
        return {
          id: isYou ? YOU : profile.id,
          vector: profile.vector,
          item: {
            id: isYou ? YOU : profile.id,
            name: profile.name || 'someone',
            photo: profile.drawing_url,
            answers: {},
            category: profile.class ?? undefined,
            note: profile.top_k?.[0]
              ? `the model is ${Math.round(profile.top_k[0].p * 100)}% sure`
              : undefined,
          },
        };
      });
    }

    return [yourProfile, ...MOCK_PROFILES].map((item) => ({
      item,
      id: item.id,
      vector: embed(item),
    }));
  }, [live, yourProfile, myId]);

  /* Canvas and node size scale with the crowd: 31 people at R=32 in a 720x520
     box overlap badly. Links get a similarity floor for the same reason — a
     cross-class link is ~0.07 and only adds noise. */
  const crowd = Math.max(nodes.length, 1);
  const R = crowd > 26 ? 18 : crowd > 16 ? 24 : 32;
  const W = crowd > 16 ? 960 : 720;
  const H = crowd > 16 ? 680 : 520;
  const showNames = crowd <= 20;

  const links = useMemo(
    () => knnLinks(nodes, crowd > 20 ? 2 : 3, 0.35),
    [nodes, crowd]
  );
  const tiers = useMemo(() => tiersFor(nodes, 3), [nodes]);
  // Types come from the label when we have one. Clustering the vector only
  // recovers "same class" — see groupBySupertype for the measurements.
  const labelled = nodes.some((n) => n.item.category);
  const clusters = useMemo(
    () => (labelled ? groupBySupertype(nodes) : clusterNodes(nodes, groupCount)),
    [nodes, groupCount, labelled]
  );

  const clusterOf = useMemo(() => {
    const map = new Map<string, Cluster<MatchProfile>>();
    for (const cluster of clusters) for (const member of cluster.members) map.set(member.id, cluster);
    return map;
  }, [clusters]);

  const yourCluster = clusterOf.get(YOU) ?? null;

  const neighbours = useMemo(() => {
    const yours = nodes.find((n) => n.id === YOU);
    if (!yours) return [];
    return nodes
      .filter((n) => n.id !== YOU)
      .map((n) => ({ node: n, score: similarity(yours.vector, n.vector) }))
      .sort((a, b) => b.score - a.score);
  }, [nodes]);

  /* ---- force layout, with groups pulled together ------------------- */
  const bodies = useRef<Map<string, Body>>(new Map());
  const dragged = useRef<string | null>(null);

  if (bodies.current.size !== nodes.length) {
    const next = new Map<string, Body>();
    nodes.forEach((node, index) => {
      const angle = (index / Math.max(nodes.length - 1, 1)) * Math.PI * 2;
      next.set(
        node.id,
        bodies.current.get(node.id) ?? {
          id: node.id,
          x: node.id === YOU ? W / 2 : W / 2 + Math.cos(angle) * 190,
          y: node.id === YOU ? H / 2 : H / 2 + Math.sin(angle) * 150,
          vx: 0,
          vy: 0,
          pinned: node.id === YOU,
        }
      );
    });
    bodies.current = next;
  }

  useEffect(() => {
    if (view !== 'map') return;
    let frame = 0;
    let settled = 0;

    // each group gets its own anchor, so types land in their own patch of canvas
    const anchors = new Map<number, { x: number; y: number }>();
    clusters.forEach((cluster, index) => {
      const angle = (index / Math.max(clusters.length, 1)) * Math.PI * 2 - Math.PI / 2;
      anchors.set(cluster.id, {
        x: W / 2 + Math.cos(angle) * W * 0.3,
        y: H / 2 + Math.sin(angle) * H * 0.31,
      });
    });

    const step = () => {
      const list = [...bodies.current.values()];
      let motion = 0;

      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i];
          const b = list[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let dist = Math.hypot(dx, dy) || 0.01;
          if (dist < 1) {
            dx = Math.random() - 0.5;
            dy = Math.random() - 0.5;
            dist = 1;
          }
          const push = (2600 + crowd * 90) / (dist * dist);
          a.vx -= (dx / dist) * push;
          a.vy -= (dy / dist) * push;
          b.vx += (dx / dist) * push;
          b.vy += (dy / dist) * push;
        }
      }

      for (const link of links) {
        const a = bodies.current.get(link.a);
        const b = bodies.current.get(link.b);
        if (!a || !b) continue;
        const rest = 200 - 110 * Math.max(0, Math.min(1, link.similarity));
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.01;
        const pull = (dist - rest) * 0.011;
        a.vx += (dx / dist) * pull;
        a.vy += (dy / dist) * pull;
        b.vx -= (dx / dist) * pull;
        b.vy -= (dy / dist) * pull;
      }

      for (const body of list) {
        if (body.pinned || body.id === dragged.current) {
          body.vx = 0;
          body.vy = 0;
          continue;
        }
        const anchor = anchors.get(clusterOf.get(body.id)?.id ?? -1) ?? { x: W / 2, y: H / 2 };
        body.vx += (anchor.x - body.x) * 0.008;
        body.vy += (anchor.y - body.y) * 0.008;
        body.vx *= 0.86;
        body.vy *= 0.86;
        body.x = Math.max(R + 8, Math.min(W - R - 8, body.x + body.vx));
        body.y = Math.max(R + 8, Math.min(H - R - 8, body.y + body.vy));
        motion += Math.abs(body.vx) + Math.abs(body.vy);
      }

      tick((n) => n + 1);
      settled = motion < 0.4 ? settled + 1 : 0;
      if (settled < 40 || dragged.current) frame = requestAnimationFrame(step);
      else frame = 0;
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [links, clusters, clusterOf, view]);

  const svgRef = useRef<SVGSVGElement>(null);

  function pointAt(event: PointerEvent): { x: number; y: number } {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * W,
      y: ((event.clientY - rect.top) / rect.height) * H,
    };
  }

  const selectedNode = nodes.find((n) => n.id === selected) ?? null;
  const isLiked = (id: string) => liked.some((m) => m.id === id);

  function toggleLike(profile: MatchProfile) {
    setLiked((prev) =>
      prev.some((m) => m.id === profile.id)
        ? prev.filter((m) => m.id !== profile.id)
        : [...prev, profile]
    );
  }

  return (
    <div className="shell" style={{ maxWidth: 1120, gap: 24 }}>
      <div className="stack center" style={{ gap: 8, alignItems: 'center' }}>
        <p className="eyebrow">step 2 of 3</p>
        <h1 className="underlined">
          you're {yourCluster ? `a ${yourCluster.name}` : 'unclassified'}
        </h1>
        <p className="hand muted">
          the drawings sorted themselves into groups. nobody wrote the categories.
        </p>
        <span className={`feed feed--${source}`}>
          {source === 'live'
            ? `live · ${nodes.length} drawings classified by the model`
            : source === 'loading'
              ? 'classifying your drawing…'
              : source === 'waiting'
                ? 'sample data · your drawing has no vector yet'
                : 'sample data · backend offline'}
        </span>
      </div>

      <div className="graph-grid">
        <div className="card">
          <div className="stack" style={{ gap: 14 }}>
            <div className="lab-panel-head">
              <div className="options">
                <button
                  className={`option${view === 'map' ? ' option--selected' : ''}`}
                  type="button"
                  onClick={() => setView('map')}
                >
                  map
                </button>
                <button
                  className={`option${view === 'types' ? ' option--selected' : ''}`}
                  type="button"
                  onClick={() => setView('types')}
                >
                  types
                </button>
              </div>
              {labelled ? (
                <span className="muted" style={{ fontSize: 12 }}>
                  {clusters.length} types
                </span>
              ) : (
                <label className="slider">
                  groups
                  <input
                    type="range"
                    min={2}
                    max={5}
                    value={groupCount}
                    onChange={(e) => setGroupCount(Number(e.target.value))}
                  />
                  {groupCount}
                </label>
              )}
            </div>

            {view === 'types' ? (
              <div className="type-board">
                {clusters.map((cluster, index) => {
                  const colour = clusterHue(index, clusters.length);
                  const mine = cluster.members.some((m) => m.id === YOU);
                  return (
                    <div
                      className={`type-card${mine ? ' type-card--mine' : ''}`}
                      key={cluster.id}
                      style={{ borderColor: colour }}
                    >
                      <div className="type-card__head">
                        <span className="type-card__name" style={{ color: colour }}>
                          {cluster.name}
                        </span>
                        <span className="muted" style={{ fontSize: 12 }}>
                          {cluster.members.length}
                          {mine ? ' · you' : ''}
                        </span>
                      </div>

                      <p className="muted" style={{ fontSize: 12 }}>
                        {cluster.tags.slice(0, 3).join(' · ') || 'nothing in common yet'}
                      </p>

                      <div className="type-card__members">
                        {cluster.members.map((member) => (
                          <button
                            key={member.id}
                            type="button"
                            className={`type-chip${selected === member.id ? ' type-chip--on' : ''}`}
                            onClick={() => setSelected(member.id)}
                            title={member.item.name}
                          >
                            {member.item.photo && (
                              <img src={member.item.photo} alt={member.item.name} />
                            )}
                            <span>{member.id === YOU ? 'you' : member.item.name}</span>
                            {isLiked(member.id) && <em>♥</em>}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <svg
                ref={svgRef}
                className="graph-svg"
                viewBox={`0 0 ${W} ${H}`}
                onPointerMove={(event) => {
                  if (!dragged.current) return;
                  const body = bodies.current.get(dragged.current);
                  if (!body) return;
                  const p = pointAt(event);
                  body.x = Math.max(R, Math.min(W - R, p.x));
                  body.y = Math.max(R, Math.min(H - R, p.y));
                  tick((n) => n + 1);
                }}
                onPointerUp={() => {
                  dragged.current = null;
                }}
                onPointerLeave={() => {
                  dragged.current = null;
                }}
              >
                {clusters.map((cluster, index) => {
                  const points = cluster.members
                    .map((m) => bodies.current.get(m.id))
                    .filter(Boolean)
                    .map((b) => ({ x: b!.x, y: b!.y }));
                  if (points.length === 0) return null;
                  const colour = clusterHue(index, clusters.length);
                  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
                  const top = Math.min(...points.map((p) => p.y));
                  return (
                    <g key={cluster.id}>
                      <path
                        d={blobPath(points, R + 14)}
                        fill={colour}
                        fillOpacity={0.09}
                        stroke={colour}
                        strokeOpacity={0.5}
                        strokeWidth={2}
                        strokeDasharray="7 6"
                      />
                      <text
                        className="type-label"
                        x={cx}
                        y={top - R - 30}
                        textAnchor="middle"
                        fill={colour}
                      >
                        {cluster.name}
                      </text>
                    </g>
                  );
                })}

                {links.map((link) => {
                  const a = bodies.current.get(link.a);
                  const b = bodies.current.get(link.b);
                  if (!a || !b) return null;
                  return (
                    <line
                      key={`${link.a}|${link.b}`}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      className="graph-link"
                      strokeWidth={1 + link.similarity * 3}
                      opacity={selected === null || link.a === selected || link.b === selected ? 0.5 : 0.12}
                    />
                  );
                })}

                {nodes.map((node) => {
                  const body = bodies.current.get(node.id);
                  if (!body) return null;
                  const tier = tiers.get(node.id)?.tier ?? 'common';
                  const isYou = node.id === YOU;
                  return (
                    <g
                      key={node.id}
                      transform={`translate(${body.x} ${body.y})`}
                      className={`graph-node graph-node--${tier}${isYou ? ' graph-node--you' : ''}`}
                      opacity={selected !== null && selected !== node.id ? 0.5 : 1}
                      onPointerDown={(event) => {
                        event.currentTarget.setPointerCapture(event.pointerId);
                        dragged.current = node.id;
                        setSelected(node.id);
                      }}
                      onMouseEnter={() => setHovered(node.id)}
                      onMouseLeave={() => setHovered((current) => (current === node.id ? null : current))}
                    >
                      <clipPath id={`clip-${node.id}`}>
                        <circle r={R} />
                      </clipPath>
                      <circle className="graph-node__halo" r={R + 5} />
                      {node.item.photo && (
                        <image
                          href={node.item.photo}
                          x={-R}
                          y={-R}
                          width={R * 2}
                          height={R * 2}
                          clipPath={`url(#clip-${node.id})`}
                          preserveAspectRatio="xMidYMid slice"
                        />
                      )}
                      <circle className="graph-node__ring" r={R} />
                      {isLiked(node.id) && (
                        <text className="graph-node__heart" y={-R - 10} textAnchor="middle">
                          ♥
                        </text>
                      )}
                      {(showNames || selected === node.id || hovered === node.id) && (
                        <text className="graph-node__name" y={R + 15} textAnchor="middle">
                          {isYou ? 'you' : node.item.name}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
            )}

            <p className="muted" style={{ fontSize: 12 }}>
              {view === 'types'
                ? 'types come from what the classifier saw. the drawing vectors tell you who is nearest, but they carry no notion of a cat being closer to a rabbit than to a candle — so the type comes from the label.'
                : 'each group drifts to its own patch. links join a drawing to its 3 nearest neighbours; ring style is rarity.'}
            </p>
          </div>
        </div>

        {/* ---- reading panel ---- */}
        <div className="card">
          <div className="stack" style={{ gap: 14 }}>
            <div className="lab-panel-head">
              <p className="hand">{selectedNode && selected !== YOU ? 'this one' : 'you'}</p>
              {selected && (
                <button className="btn btn--ghost" type="button" onClick={() => setSelected(null)}>
                  clear
                </button>
              )}
            </div>

            {(() => {
              // prefer the live node: yourProfile is the local placeholder and
              // carries none of the model's output
              const shown =
                selectedNode?.item ?? nodes.find((n) => n.id === YOU)?.item ?? yourProfile;
              const tier = tiers.get(shown.id)?.tier ?? 'common';
              const score = tiers.get(shown.id)?.score ?? 0;
              const group = clusterOf.get(shown.id);
              const shared = shown.id === YOU ? [] : sharedTraits(you, shown);
              const match =
                shown.id === YOU ? null : neighbours.find((n) => n.node.id === shown.id)?.score ?? 0;

              return (
                <>
                  {shown.photo && (
                    <img className="graph-portrait" src={shown.photo} alt={`${shown.name}'s drawing`} />
                  )}

                  <div className="stack" style={{ gap: 4 }}>
                    <p className="hand" style={{ fontSize: 30 }}>
                      {shown.id === YOU ? you.name : shown.name}
                    </p>
                    {group && (
                      <p
                        style={{ fontSize: 13 }}
                        // colour ties the panel back to the group on the board
                      >
                        <span
                          style={{
                            color: clusterHue(
                              clusters.findIndex((c) => c.id === group.id),
                              clusters.length
                            ),
                          }}
                        >
                          {group.name}
                        </span>
                        <span className="muted"> · {group.members.length} in this type</span>
                      </p>
                    )}
                    {shown.note && (
                      <p className="muted" style={{ fontSize: 13 }}>
                        {shown.note}
                      </p>
                    )}
                  </div>

                  <div className="lab-tools">
                    {nodes.length >= 4 ? (
                      <>
                        <span className={`tier tier--${tier}`}>{tier}</span>
                        <span className="muted" style={{ fontSize: 12 }}>
                          novelty {(score * 100).toFixed(0)}
                        </span>
                      </>
                    ) : (
                      <span className="muted" style={{ fontSize: 12 }}>
                        rarity needs a crowd — {nodes.length} of 4 drawings so far
                      </span>
                    )}
                    {match !== null && (
                      <span className="muted" style={{ fontSize: 12 }}>
                        · {(match * 100).toFixed(0)}% like you
                      </span>
                    )}
                  </div>

                  {shared.length > 0 && (
                    <div className="panel">
                      <p className="muted" style={{ fontSize: 12 }}>
                        you two share
                      </p>
                      <p>{shared.join(' · ')}</p>
                    </div>
                  )}

                  <div className="stack" style={{ gap: 8 }}>
                    <p style={{ fontSize: 13 }}>
                      <span className="muted">drew: </span>
                      {CATEGORY_BY_ID.get(shown.category ?? '')?.label ??
                        shown.category ??
                        'something unclassified'}
                      {source === 'live' && <span className="muted"> · classifier</span>}
                    </p>
                    {QUESTIONS.some((question) => shown.answers[question.id]) && (
                      <p className="muted" style={{ fontSize: 11 }}>
                        answered by them, not the model
                      </p>
                    )}
                    {QUESTIONS.filter((question) => shown.answers[question.id]).map((question) => (
                      <p key={question.id} style={{ fontSize: 13 }}>
                        <span className="muted">{SHORT_LABEL[question.id] ?? question.id}: </span>
                        {shown.answers[question.id]}
                      </p>
                    ))}
                  </div>

                  {shown.id === YOU && source !== 'live' && (
                    <div className="panel">
                      <div className="stack" style={{ gap: 8 }}>
                        <p className="muted" style={{ fontSize: 12 }}>
                          what did you draw? (the classifier's job — set it by hand for now)
                        </p>
                        <div className="options">
                          {CATEGORIES.map((option) => (
                            <button
                              key={option.id}
                              type="button"
                              className={`option${yourCategory === option.id ? ' option--selected' : ''}`}
                              style={{ fontSize: 12, padding: '6px 10px' }}
                              onClick={() => setYourCategory(option.id)}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {shown.id !== YOU && (
                    <button
                      className={isLiked(shown.id) ? 'btn btn--soft' : 'btn btn--primary'}
                      type="button"
                      onClick={() => toggleLike(shown)}
                    >
                      {isLiked(shown.id) ? '♥ liked — undo' : 'like this drawing'}
                    </button>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="stack" style={{ gap: 10 }}>
          <p className="muted" style={{ fontSize: 13 }}>
            {yourCluster
              ? `you landed with ${yourCluster.members.length - 1} other ${
                  yourCluster.members.length === 2 ? 'drawing' : 'drawings'
                } in ${yourCluster.name}.`
              : 'no group yet.'}{' '}
            {liked.length > 0 ? `you have liked ${liked.length}.` : 'like a few before you move on.'}
          </p>
          <div className="lab-tools">
            <button className="btn btn--primary" type="button" onClick={() => onDone(liked)}>
              done exploring
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
