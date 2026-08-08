type DoodleProps = {
  size?: number;
};

const strokeProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function FlowerDoodle({ size = 90 }: DoodleProps) {
  return (
    <svg className="doodle" width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <g {...strokeProps}>
        <path d="M50 14c-9 0-14 6-13 12-6-2-13 2-14 9s5 12 11 12c-3 5-1 13 6 15s13-3 14-9c3 5 10 7 15 3s5-12 1-16c6-1 10-7 8-13s-9-9-14-6c1-6-4-11-14-11Z" />
        <path d="M45 47c3-3 8-3 11 0s2 8-2 10-9 0-10-4 0-5 1-6Z" />
        <path d="M50 62c-1 9-2 17-2 26" />
        <path d="M48 74c-5-4-11-5-15-3 2 5 7 8 14 7" />
        <path d="M50 82c5-5 11-6 15-4-2 5-8 8-14 7" />
        <path d="M34 90c6-2 13-2 20 0 5 1 10 1 14-1" />
      </g>
    </svg>
  );
}

export function PencilDoodle({ size = 80 }: DoodleProps) {
  return (
    <svg className="doodle" width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <g {...strokeProps}>
        <path d="M22 78 33 45l32-31c4-4 10-4 14 0s4 10 0 14L48 60 22 78Z" />
        <path d="M33 45 48 60" />
        <path d="M22 78c4-1 8-3 11-6" />
        <path d="M14 90c8-4 18-5 26-2 7 3 15 3 22-1" />
      </g>
    </svg>
  );
}

export function HeartDoodle({ size = 40 }: DoodleProps) {
  return (
    <svg className="doodle" width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <g {...strokeProps}>
        <path d="M50 82C30 68 16 56 16 41c0-11 8-19 18-19 7 0 13 4 16 10 3-6 9-10 16-10 10 0 18 8 18 19 0 15-14 27-34 41Z" />
      </g>
    </svg>
  );
}

export function SparkDoodle({ size = 40 }: DoodleProps) {
  return (
    <svg className="doodle" width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <g {...strokeProps}>
        <path d="M50 12c4 20 18 34 38 38-20 4-34 18-38 38-4-20-18-34-38-38 20-4 34-18 38-38Z" />
      </g>
    </svg>
  );
}

export function SquiggleDoodle({ size = 90 }: DoodleProps) {
  return (
    <svg className="doodle" width={size} height={size / 2} viewBox="0 0 100 50" aria-hidden>
      <g {...strokeProps}>
        <path d="M6 32c10-20 20 18 30-2s20 16 30-4 18 6 28-4" />
      </g>
    </svg>
  );
}

export function SpeechDoodle({ size = 70 }: DoodleProps) {
  return (
    <svg className="doodle" width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <g {...strokeProps}>
        <path d="M18 22h64c5 0 8 4 8 9v30c0 5-3 9-8 9H46l-18 16 3-16h-13c-5 0-8-4-8-9V31c0-5 3-9 8-9Z" />
        <path d="M34 44h32M34 56h20" />
      </g>
    </svg>
  );
}

/** Faint sketches scattered in the page margins. Purely decorative. */
export function MarginDoodles() {
  return (
    <div className="margin-doodles" aria-hidden>
      <span style={{ top: '8%', left: '4%', transform: 'rotate(-12deg)' }}>
        <FlowerDoodle size={72} />
      </span>
      <span style={{ top: '24%', right: '5%', transform: 'rotate(14deg)' }}>
        <SpeechDoodle size={82} />
      </span>
      <span style={{ bottom: '18%', left: '7%', transform: 'rotate(8deg)' }}>
        <SquiggleDoodle size={110} />
      </span>
      <span style={{ bottom: '9%', right: '8%', transform: 'rotate(-10deg)' }}>
        <HeartDoodle size={60} />
      </span>
      <span style={{ top: '55%', left: '2%', transform: 'rotate(-6deg)' }}>
        <SparkDoodle size={44} />
      </span>
      <span style={{ top: '6%', right: '22%', transform: 'rotate(18deg)' }}>
        <SparkDoodle size={30} />
      </span>
    </div>
  );
}

/** Two chibi animals — a cat and a bunny — standing side by side, holding paws. */
export function ChibiPair({ width = 320 }: { width?: number }) {
  return (
    <svg
      className="doodle"
      width={width}
      height={width * 0.6}
      viewBox="0 0 200 120"
      aria-hidden
    >
      <g {...strokeProps} strokeWidth={3}>
        {/* cat */}
        <path d="M48 34 46 18l16 9" />
        <path d="M82 34 84 18l-16 9" />
        <circle cx="65" cy="46" r="21" />
        <path d="M61 55q4 4 8 0" />
        <path d="M42 46H32M42 53l-10 4M88 46h10M88 53l10 4" />
        <path d="M52 66q-5 24 3 30h20q8-6 3-30" />
        <path d="M58 98q4 4 8 0M68 98q4 4 8 0" />
        <path d="M79 88q16 3 13-14" />
        <path d="M78 80q10 5 18 1" />

        {/* bunny */}
        <path d="M128 30c-6-13-4-25 2-25s6 12 3 25" />
        <path d="M143 30c6-13 4-25-2-25s-6 12-3 25" />
        <circle cx="135" cy="48" r="20" />
        <path d="M132 56q3 3 6 0" />
        <path d="M122 68q-5 22 3 28h20q8-6 3-28" />
        <path d="M126 96q4 4 8 0M137 96q4 4 8 0" />
        <path d="M122 80q-10 5-18 1" />

        {/* ground */}
        <path d="M22 106c22-4 44-4 64 0s52 4 74-1c8-2 14-2 18 1" />
      </g>
      <g fill="currentColor" stroke="none">
        <circle cx="57" cy="45" r="2.6" />
        <circle cx="73" cy="45" r="2.6" />
        <circle cx="128" cy="47" r="2.4" />
        <circle cx="142" cy="47" r="2.4" />
      </g>
    </svg>
  );
}

export function HouseDoodle({ size = 110 }: DoodleProps) {
  return (
    <svg className="doodle" width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <g {...strokeProps}>
        <path d="M20 46 50 24l30 22" />
        <path d="M26 46v34h48V46" />
        <path d="M44 80V60h12v20" />
        <path d="M12 84c8-3 17-3 25-1 9 2 19 2 28-1 8-2 16-2 23 1" />
      </g>
    </svg>
  );
}
