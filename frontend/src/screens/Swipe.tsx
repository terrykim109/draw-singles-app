import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { api } from '../api';
import type { MatchProfile, Profile } from '../types';

type SwipeProps = {
  you: Profile;
  userId: string;
  onDone: (liked: MatchProfile[]) => void;
};

const THRESHOLD = 110;
const FLY = 640;

type Decision = { profile: MatchProfile; liked: boolean };

const SHORT_LABEL: Record<string, string> = {
  medium: 'draws with',
  style: 'stranger says',
  looking: 'here for',
};

export default function Swipe({ you, userId, onDone }: SwipeProps) {
  const [deck, setDeck] = useState<MatchProfile[]>([]);
  const [liked, setLiked] = useState<MatchProfile[]>([]);
  const [history, setHistory] = useState<Decision[]>([]);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  const busy = useRef(false);
  const pointerId = useRef<number | null>(null);
  const grab = useRef({ x: 0, y: 0 });
  const pos = useRef({ x: 0, y: 0 });

  const top = deck[0];

  useEffect(() => {
    api.getFeed(userId).then(setDeck);
  }, [userId]);

  async function fly(direction: 'left' | 'right') {
    if (!top || busy.current) return;
    busy.current = true;

    await api.swipe(userId, top.id, direction);

    const to = { x: direction === 'right' ? FLY : -FLY, y: 24 };
    pos.current = to;
    setOffset(to);
    setHistory((prev) => [...prev, { profile: top, liked: direction === 'right' }]);
    if (direction === 'right') setLiked((prev) => [...prev, top]);
    window.setTimeout(() => {
      setDeck((prev) => prev.slice(1));
      pos.current = { x: 0, y: 0 };
      setOffset({ x: 0, y: 0 });
      busy.current = false;
    }, 320);
  }

  function undo() {
    if (busy.current || history.length === 0) return;
    const last = history[history.length - 1];
    setHistory((prev) => prev.slice(0, -1));
    if (last.liked) setLiked((prev) => prev.filter((p) => p.id !== last.profile.id));
    setDeck((prev) => [last.profile, ...prev]);
  }

  function replay() {
    setLiked([]);
    setHistory([]);
    pos.current = { x: 0, y: 0 };
    setOffset({ x: 0, y: 0 });
    api.getFeed(userId).then(setDeck);
  }

  // keyboard: ← nope · → like · ↑ undo
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft') fly('left');
      else if (e.key === 'ArrowRight') fly('right');
      else if (e.key === 'ArrowUp') undo();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (!top || busy.current || e.button !== 0) return;
    pointerId.current = e.pointerId;
    grab.current = { x: e.clientX - pos.current.x, y: e.clientY - pos.current.y };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (pointerId.current !== e.pointerId) return;
    const next = { x: e.clientX - grab.current.x, y: (e.clientY - grab.current.y) * 0.35 };
    pos.current = next;
    setOffset(next);
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    if (pointerId.current !== e.pointerId) return;
    pointerId.current = null;
    setDragging(false);
    const { x } = pos.current;
    if (x > THRESHOLD) fly('right');
    else if (x < -THRESHOLD) fly('left');
    else {
      pos.current = { x: 0, y: 0 };
      setOffset({ x: 0, y: 0 });
    }
  }

  const progress = Math.min(Math.abs(pos.current.x) / THRESHOLD, 1);
  const tilt = pos.current.x / 14;

  if (deck.length === 0) {
    return (
      <div className="shell shell--narrow" style={{ gap: 26 }}>
        <div className="stack center" style={{ gap: 8, alignItems: 'center' }}>
          <p className="eyebrow">step 2 of 3</p>
          <h1 className="underlined">that's everyone</h1>
          <p className="hand muted">you made it through the whole pile.</p>
        </div>

        <div className="card center">
          <div className="stack" style={{ gap: 16, alignItems: 'center' }}>
            {liked.length > 0 ? (
              <>
                <p className="lede" style={{ maxWidth: '38ch' }}>
                  you liked <strong>{liked.length}</strong>{' '}
                  {liked.length === 1 ? 'drawing' : 'drawings'}. the feelings are probably
                  mutual.
                </p>
                <div className="matches">
                  {liked.map((match) => (
                    <div className="match-card" key={match.id}>
                      <img src={match.photo ?? undefined} alt={`${match.name}'s drawing`} />
                      <p className="match-card__name">{match.name}</p>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="lede" style={{ maxWidth: '38ch' }}>
                zero likes. brutal, but the pile resets — second chances exist.
              </p>
            )}
          </div>
        </div>

        <div className="stack" style={{ maxWidth: 420, gap: 8 }}>
          <button className="btn btn--primary" type="button" onClick={() => onDone(liked)}>
            see your matches
          </button>
          <button className="btn btn--ghost" type="button" onClick={replay}>
            replay the pile
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <div className="stack center" style={{ gap: 8, alignItems: 'center' }}>
        <p className="eyebrow">step 2 of 3</p>
        <h1 className="underlined">swipe the drawings</h1>
        <p className="hand muted">left to pass, right to like — the drawings do the flirting.</p>
        <p className="muted" style={{ fontSize: 12 }}>
          swiping as {you.name} · your drawing is out there somewhere
        </p>
      </div>

      <p className="counter">
        <strong>{deck.length}</strong>
        {deck.length === 1 ? 'drawing left' : 'drawings left'}
      </p>

      <div className="swipe-stage">
        {deck.slice(0, 4).map((profile, index) => {
          const isTop = index === 0;
          const transform = isTop
            ? `translate(${offset.x}px, ${offset.y}px) rotate(${tilt}deg)`
            : `translateY(${index * 16}px) scale(${1 - index * 0.05}) rotate(${[2, -2, 1.5][index - 1] ?? 0}deg)`;
          return (
            <div
              key={profile.id}
              className={`swipe-card${isTop ? ' swipe-card--top' : ''}`}
              style={{
                transform,
                zIndex: 10 - index,
                transition:
                  isTop && dragging
                    ? 'none'
                    : 'transform 0.32s cubic-bezier(0.18, 0.9, 0.32, 1.25)',
              }}
              {...(isTop
                ? {
                    onPointerDown,
                    onPointerMove,
                    onPointerUp,
                    onPointerCancel: onPointerUp,
                    onDragStart: (e: React.DragEvent) => e.preventDefault(),
                  }
                : {})}
            >
              {isTop && (
                <>
                  <div
                    className="swipe-badge swipe-badge--nope"
                    style={{
                      opacity: offset.x < -18 ? progress : 0,
                      transform: `rotate(${-10 + tilt}deg)`,
                    }}
                  >
                    nope
                  </div>
                  <div
                    className="swipe-badge swipe-badge--like"
                    style={{
                      opacity: offset.x > 18 ? progress : 0,
                      transform: `rotate(${10 + tilt}deg)`,
                    }}
                  >
                    like
                  </div>
                </>
              )}

              <figure className="swipe-card__art">
                <img
                  src={profile.photo ?? undefined}
                  alt={`${profile.name}'s drawing`}
                  draggable={false}
                />
              </figure>

              <div className="swipe-card__body">
                <h2 className="swipe-card__name">{profile.name}</h2>
                {profile.note && <p className="swipe-card__note">“{profile.note}”</p>}
                <div className="swipe-card__qa">
                  {Object.entries(SHORT_LABEL).map(([id, label]) => (
                    <div className="swipe-card__qa-row" key={id}>
                      <span>{label}</span>
                      <b>{profile.answers[id]}</b>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="swipe-controls">
        <button
          className="swipe-btn swipe-btn--undo"
          type="button"
          aria-label="undo last swipe"
          onClick={undo}
          disabled={history.length === 0 || busy.current}
        >
          ↶
        </button>
        <button
          className="swipe-btn swipe-btn--nope"
          type="button"
          aria-label="nope — swipe left"
          onClick={() => fly('left')}
          disabled={busy.current}
        >
          ✕
        </button>
        <button
          className="swipe-btn swipe-btn--like"
          type="button"
          aria-label="like — swipe right"
          onClick={() => fly('right')}
          disabled={busy.current}
        >
          ♥
        </button>
      </div>

      <p className="muted center" style={{ fontSize: 12 }}>
        ← swipe left · swipe right → · ↑ undo
      </p>
    </div>
  );
}