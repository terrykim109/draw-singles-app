import { useRef, useState, type DragEvent } from 'react';
import { QUESTIONS, type Profile } from '../types';
import PeelStage from '../trace/PeelStage';
import { traceImage, traceImageToPng } from '../trace/rasterise';
import type { TraceResult } from '../trace/tracer';
import { storedPalette } from '../palettes';

type CreateProfileProps = {
  onSubmit: (profile: Profile) => void;
  onBack: () => void;
};

/** heavier than the tracer's default — thin lines look like scanner noise */
const PEEL_STROKE = 7;

export default function CreateProfile({ onSubmit, onBack }: CreateProfileProps) {
  const [name, setName] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [dragging, setDragging] = useState(false);
  const [traced, setTraced] = useState<TraceResult | null>(null);
  const [tracing, setTracing] = useState(false);
  const [peelKey, setPeelKey] = useState(0);
  /** true once `photo` is the traced drawing rather than the uploaded photo */
  const [isDrawing, setIsDrawing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const ink = storedPalette().ink;
  const fileInput = useRef<HTMLInputElement>(null);

  const answeredAll = QUESTIONS.every((question) => answers[question.id]);
  const canSubmit = name.trim() !== '' && photo !== null && answeredAll;

  function readFile(file: File | undefined) {
    if (!file || !file.type.startsWith('image/')) return;
    setFile(file);
    setTraced(null);   // a new drawing needs a new trace
    setPeelKey(0);
    setIsDrawing(false);
    const reader = new FileReader();
    reader.onload = () => setPhoto(reader.result as string);
    reader.readAsDataURL(file);
  }

  /** Trace the upload in the browser, then play draw-on + peel. */
  async function peelOffThePage() {
    if (!photo || tracing) return;
    if (traced) {
      setPeelKey((key) => key + 1);
      return;
    }
    setTracing(true);
    try {
      const result = await traceImage(photo);
      setTraced(result);
      setPeelKey((key) => key + 1);
    } catch {
      // tracing failed — leave the plain preview in place
    } finally {
      setTracing(false);
    }
  }

  /**
   * Hand the drawing forward, not the photograph. If the peel was never played
   * we still trace on the way out, so every screen after this one — and the
   * classifier — sees line art rather than a picture of paper.
   */
  async function submit() {
    if (!photo) return;
    if (isDrawing) {
      onSubmit({ name: name.trim(), photo, answers, file: null });
      return;
    }
    setSubmitting(true);
    try {
      const png = await traceImageToPng(photo, PEEL_STROKE, ink);
      onSubmit({ name: name.trim(), photo: png, answers, file: null });
    } catch {
      onSubmit({ name: name.trim(), photo, answers, file }); // tracing failed — send the photo
    } finally {
      setSubmitting(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    readFile(event.dataTransfer.files[0]);
  }

  return (
    <div className="shell">
      <div className="stack center" style={{ gap: 8, alignItems: 'center' }}>
        <p className="eyebrow">step 1 of 3</p>
        <h1 className="underlined">make your profile</h1>
        <p className="hand muted">a picture, a name, three questions. that is it.</p>
      </div>

      <div className="card">
        <div className="profile-grid">
          <div className="stack" style={{ gap: 12 }}>
          <div
            className={`dropzone${dragging ? ' dropzone--active' : ''}`}
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && fileInput.current?.click()}
          >
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              onChange={(e) => readFile(e.target.files?.[0])}
            />
            {photo ? (
              <>
                <PeelStage
                  imageUrl={photo}
                  result={traced}
                  strokeWidth={PEEL_STROKE}
                  playKey={peelKey}
                  ink={ink}
                  onSettled={(png) => {
                    // the drawing becomes the profile image from here on: it is
                    // what gets uploaded, classified and shown across the app
                    setPhoto(png);
                    setFile(null);
                    setIsDrawing(true);
                    // keep `traced` and `peelKey` so the overlay stays mounted
                    // and the line goes on breathing
                  }}
                />
                <span className="dropzone__replace">click to replace</span>
              </>
            ) : (
              <>
                <span className="hand" style={{ fontSize: 44 }}>+</span>
                <span className="dropzone__hint">
                  drop a drawing here
                  <br />
                  or click to pick one
                </span>
              </>
            )}
          </div>

          {photo && (
            <button
              className="btn btn--soft peel-button"
              type="button"
              onClick={peelOffThePage}
              disabled={tracing}
            >
              {tracing ? 'tracing…' : '✧ peel it off the page'}
            </button>
          )}
          </div>

          <div className="stack" style={{ gap: 32 }}>
            <div className="field">
              <label htmlFor="name">what should we call you?</label>
              <input
                id="name"
                className="input"
                type="text"
                placeholder="your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            {QUESTIONS.map((question) => (
              <div className="field" key={question.id}>
                <label>{question.prompt}</label>
                <div className="options">
                  {question.options.map((option) => {
                    const selected = answers[question.id] === option;
                    return (
                      <button
                        key={option}
                        type="button"
                        className={`option${selected ? ' option--selected' : ''}`}
                        aria-pressed={selected}
                        onClick={() =>
                          setAnswers((prev) => ({ ...prev, [question.id]: option }))
                        }
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="stack" style={{ maxWidth: 420, gap: 8 }}>
        <button
          className="btn btn--primary"
          type="button"
          disabled={!canSubmit || submitting}
          onClick={submit}
        >
          {submitting ? 'turning it into a drawing…' : 'Continue'}
        </button>
        <button className="btn btn--ghost" type="button" onClick={onBack}>
          back
        </button>
      </div>
    </div>
  );
}
