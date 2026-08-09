import { ChibiPair } from '../components/Doodles';

type IntroProps = {
  onStart: () => void;
};

export default function Intro({ onStart }: IntroProps) {
  return (
    <div className="shell shell--narrow" style={{ gap: 26 }}>
      <div className="stack center" style={{ gap: 10, alignItems: 'center' }}>
        <div className="doodle--wiggle">
          <ChibiPair width={300} />
        </div>
        <p className="counter">
          Over <strong>52,218</strong> drawings sketched
        </p>
      </div>

      <div className="card center">
        <div className="stack" style={{ gap: 20, alignItems: 'center' }}>
          <h2>hey there</h2>

          <p className="lede" style={{ maxWidth: '38ch' }}>
            lorem ipsum dolor sit amet. no selfies, no filters — you draw something, and
            the drawings do the flirting.
          </p>

          <hr className="rule" />

          <div className="stack center" style={{ gap: 4, alignItems: 'center' }}>
            <p className="hand">next up: your profile</p>
            <p className="muted" style={{ fontSize: 13 }}>
              a drawing, a name, three questions.
            </p>
          </div>
        </div>
      </div>

      <button className="btn btn--primary" type="button" onClick={onStart}>
        Let's start
      </button>
    </div>
  );
}
