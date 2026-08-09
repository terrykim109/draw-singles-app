import { useRef, useState, type DragEvent } from 'react';
import { QUESTIONS, type Profile } from '../types';

type CreateProfileProps = {
  onSubmit: (profile: Profile) => void;
  onBack: () => void;
};

export default function CreateProfile({ onSubmit, onBack }: CreateProfileProps) {
  const [name, setName] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const answeredAll = QUESTIONS.every((question) => answers[question.id]);
  const canSubmit = name.trim() !== '' && photo !== null && answeredAll;

  function readFile(file: File | undefined) {
    if (!file || !file.type.startsWith('image/')) return;
    setFile(file);
    const reader = new FileReader();
    reader.onload = () => setPhoto(reader.result as string);
    reader.readAsDataURL(file);
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
                <img src={photo} alt="your drawing" />
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
          disabled={!canSubmit}
          onClick={() => onSubmit({ name: name.trim(), photo, answers, file })}
        >
          Continue
        </button>
        <button className="btn btn--ghost" type="button" onClick={onBack}>
          back
        </button>
      </div>
    </div>
  );
}
