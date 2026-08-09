import { useEffect, useState } from 'react';
import { PALETTES, applyPalette, storedPalette, type Palette } from '../palettes';

/** Dev-only accent picker. Delete this component once a colour is chosen. */
export default function ColorLab() {
  const [active, setActive] = useState<Palette>(() => storedPalette());
  const [open, setOpen] = useState(false);

  useEffect(() => {
    applyPalette(active);
  }, [active]);

  return (
    <div className={`colorlab${open ? ' colorlab--open' : ''}`}>
      <button
        className="colorlab__toggle"
        type="button"
        onClick={() => setOpen((prev) => !prev)}
      >
        {open ? 'close' : 'accent'}
      </button>

      {open && (
        <div className="colorlab__body">
          <p className="colorlab__label">{active.name}</p>
          <div className="colorlab__swatches">
            {PALETTES.map((palette) => (
              <button
                key={palette.id}
                type="button"
                title={palette.name}
                aria-label={palette.name}
                aria-pressed={palette.id === active.id}
                className={`swatch${palette.id === active.id ? ' swatch--on' : ''}`}
                style={{ background: palette.ink }}
                onClick={() => setActive(palette)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
