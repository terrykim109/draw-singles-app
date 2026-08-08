import { useState, type FormEvent } from 'react';
import { PencilDoodle, SparkDoodle, SquiggleDoodle } from '../components/Doodles';
import type { Account } from '../types';

type SignUpProps = {
  onSubmit: (account: Account) => void;
};

export default function SignUp({ onSubmit }: SignUpProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  const canSubmit = email.trim() !== '' && password !== '' && confirm !== '';

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!email.includes('@')) {
      setError('that does not look like an email');
      return;
    }
    if (password.length < 8) {
      setError('password needs at least 8 characters');
      return;
    }
    if (password !== confirm) {
      setError('passwords do not match');
      return;
    }
    setError(null);
    onSubmit({ email: email.trim(), password });
  }

  return (
    <div className="split">
      {/* left: the pitch */}
      <div className="stack" style={{ gap: 22 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
          <PencilDoodle size={78} />
          <SparkDoodle size={26} />
        </div>

        <h1>
          draw
          <br />
          <span className="underlined">singles</span>
        </h1>

        <p className="hand muted" style={{ maxWidth: '18ch' }}>
          match with someone over a bad drawing
        </p>

        <SquiggleDoodle size={140} />

        <p className="lede muted" style={{ fontSize: 13 }}>
          no filters. no angles. one pen, one piece of paper, and whatever comes out of it.
        </p>
      </div>

      {/* right: the form, taped to the page */}
      <form className="card card--tilt" onSubmit={handleSubmit} noValidate>
        <div className="stack" style={{ gap: 22 }}>
          <div className="stack" style={{ gap: 2 }}>
            <p className="eyebrow">new here</p>
            <h2>make an account</h2>
          </div>

          <div className="field">
            <label htmlFor="email">email</label>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="password">password</label>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete="new-password"
              placeholder="at least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="confirm">say it again</label>
            <input
              id="confirm"
              className="input"
              type="password"
              autoComplete="new-password"
              placeholder="one more time"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>

          {error && <p className="error">{error}</p>}

          <button className="btn btn--primary" type="submit" disabled={!canSubmit}>
            Create account
          </button>

          <p className="muted center" style={{ fontSize: 13 }}>
            already drawing here?{' '}
            <button className="btn btn--ghost" type="button">
              log in
            </button>
          </p>
        </div>
      </form>
    </div>
  );
}
