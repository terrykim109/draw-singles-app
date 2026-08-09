import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null; stack: string | null };

/**
 * Without this, any thrown error unmounts the whole tree and you get a white
 * page with nothing to go on. Show the message and the component stack, and
 * make them copyable — a crash report beats a blank screen.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ stack: info.componentStack ?? null });
    // eslint-disable-next-line no-console
    console.error('crash', error, info.componentStack);
  }

  render() {
    const { error, stack } = this.state;
    if (!error) return this.props.children;

    const report = `${error.name}: ${error.message}\n\n${error.stack ?? ''}\n\ncomponents:${stack ?? ''}`;

    return (
      <div className="app">
        <div className="shell shell--narrow">
          <div className="stack center" style={{ gap: 8, alignItems: 'center' }}>
            <h2>well, that broke</h2>
            <p className="muted">the drawing is fine — this screen is not.</p>
          </div>

          <div className="card">
            <div className="stack" style={{ gap: 14 }}>
              <p style={{ fontWeight: 700 }}>
                {error.name}: {error.message}
              </p>
              <pre className="crash-trace">{report}</pre>
              <div className="lab-tools">
                <button
                  className="btn btn--soft"
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(report).catch(() => undefined)}
                >
                  copy crash report
                </button>
                <button
                  className="btn btn--soft"
                  type="button"
                  onClick={() => this.setState({ error: null, stack: null })}
                >
                  try again
                </button>
                <button
                  className="btn btn--ghost"
                  type="button"
                  onClick={() => window.location.reload()}
                >
                  reload
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
