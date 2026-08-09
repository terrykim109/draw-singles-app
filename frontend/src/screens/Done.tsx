import { HouseDoodle } from '../components/Doodles';
import { QUESTIONS, type MatchProfile, type Profile } from '../types';

type DoneProps = {
  profile: Profile;
  liked: MatchProfile[];
  onKeepSwiping: () => void;
  onRestart: () => void;
};

export default function Done({ profile, liked, onKeepSwiping, onRestart }: DoneProps) {
  return (
    <div className="shell shell--narrow">
      <div className="stack center" style={{ gap: 8, alignItems: 'center' }}>
        <HouseDoodle />
        <p className="eyebrow">step 3 of 3</p>
        <h1 className="underlined">you're in, {profile.name}</h1>
        <p className="hand muted">matches land here.</p>
      </div>

      <div className="card">
        <div className="stack" style={{ gap: 20 }}>
          <div className="stack" style={{ gap: 14 }}>
            <p className="muted" style={{ fontSize: 13 }}>
              your profile is live.{' '}
              {liked.length > 0
                ? `you liked ${liked.length} ${
                    liked.length === 1 ? 'drawing' : 'drawings'
                  } this round — keep an eye on this spot.`
                : 'you did not like anyone this round, but the pile is always re-drawable.'}
            </p>
            {liked.length > 0 && (
              <div className="matches">
                {liked.map((match) => (
                  <div className="match-card" key={match.id}>
                    <img src={match.photo ?? undefined} alt={`${match.name}'s drawing`} />
                    <p className="match-card__name">{match.name}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <hr className="rule" />

          <div className="stack" style={{ gap: 4 }}>
            <p className="muted" style={{ fontSize: 13 }}>
              this is the drawing the world sees:
            </p>
            {profile.photo && (
              <img
                src={profile.photo}
                alt="your drawing"
                style={{ width: '100%', borderRadius: 14, display: 'block' }}
              />
            )}
          </div>

          {QUESTIONS.map((question) => (
            <div className="panel" key={question.id}>
              <p className="muted" style={{ fontSize: 13 }}>
                {question.prompt}
              </p>
              <p>{profile.answers[question.id]}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="stack" style={{ maxWidth: 420, gap: 8 }}>
        <button className="btn btn--soft" type="button" onClick={onKeepSwiping}>
          keep swiping
        </button>
        <button className="btn btn--ghost" type="button" onClick={onRestart}>
          start over
        </button>
      </div>
    </div>
  );
}
