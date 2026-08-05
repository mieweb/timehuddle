/**
 * ClockStrand — the shift-state strand.
 *
 * A line that travels left while the clock counts, and settles flat the moment
 * it stops. Motion is the signal: a static icon looks identical whether the
 * clock is running or frozen mid-break.
 *
 * Two shapes:
 *   • "snake" (default) — one line snaking horizontally. The right call almost
 *     everywhere: it reads at a glance and survives being squeezed into a pill.
 *   • "helix" — two strands wound together with rungs between. Only earns its
 *     keep at the width of the desktop toolbar, where the detail is legible.
 *
 * The stroke is a fixed multi-stop gradient rather than a state colour, so it
 * reads as one continuous ribbon. Running vs paused is carried by movement, and
 * in text beside it.
 *
 * Purely decorative — `aria-hidden` throughout.
 */
import { cn } from '@mieweb/ui';
import React, { useId } from 'react';

// Geometry, in user units. The path spans twice SHIFT so the half overhanging
// the viewBox is what travels in; SHIFT is a whole number of periods, so the
// loop lands on an identical phase and never shows a seam.
const PERIOD = 24;
const AMPLITUDE = 7;
const MID = 12;
const SHIFT = 96;
const TOTAL = SHIFT * 2;

const waveAt = (x: number) => AMPLITUDE * Math.sin((2 * Math.PI * x) / PERIOD);

/** One strand. `phase` of -1 gives the mirrored partner used by the helix. */
function buildStrand(phase: 1 | -1): string {
  const points: string[] = [];
  for (let x = 0; x <= TOTAL; x += 2) {
    points.push(`${x} ${(MID + phase * waveAt(x)).toFixed(2)}`);
  }
  return `M${points.join(' L')}`;
}

/** The rungs between helix strands, skipped where the two cross. */
function buildRungs(): string {
  const segments: string[] = [];
  for (let x = 0; x <= TOTAL; x += 4) {
    const dy = waveAt(x);
    if (Math.abs(dy) < 1) continue;
    segments.push(`M${x} ${(MID - dy).toFixed(2)}L${x} ${(MID + dy).toFixed(2)}`);
  }
  return segments.join('');
}

const STRAND_A = buildStrand(1);
const STRAND_B = buildStrand(-1);
const RUNGS = buildRungs();
const FLAT = `M0 ${MID}H${SHIFT}`;

interface Props {
  /** Travelling while the clock counts; a still flat line when it isn't. */
  active: boolean;
  /** Shape. Defaults to the single snaking line. */
  variant?: 'snake' | 'helix';
  /** Sizing utilities — the strand stretches to fill whatever box it's given. */
  className?: string;
}

export const ClockStrand: React.FC<Props> = ({ active, variant = 'snake', className }) => {
  // Gradient defs are document-global, so each instance needs its own id —
  // several of these can be mounted at once.
  const gradientId = `clock-strand-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const stroke = `url(#${gradientId})`;

  return (
    <svg
      viewBox={`0 0 ${SHIFT} ${MID * 2}`}
      preserveAspectRatio="none"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={cn('overflow-hidden', className)}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#8b5cf6" />
          <stop offset="25%" stopColor="#d946ef" />
          <stop offset="50%" stopColor="#0ea5e9" />
          <stop offset="75%" stopColor="#10b981" />
          <stop offset="100%" stopColor="#f59e0b" />
        </linearGradient>
      </defs>

      {!active ? (
        <path d={FLAT} stroke={stroke} strokeWidth={2} strokeLinecap="round" opacity={0.5} />
      ) : variant === 'helix' ? (
        <g className="clock-strand-travel" stroke={stroke}>
          <path d={RUNGS} strokeWidth={1} strokeLinecap="round" opacity={0.45} />
          <path d={STRAND_A} strokeWidth={2} strokeLinecap="round" />
          <path d={STRAND_B} strokeWidth={2} strokeLinecap="round" opacity={0.75} />
        </g>
      ) : (
        <g className="clock-strand-travel" stroke={stroke}>
          <path d={STRAND_A} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}
    </svg>
  );
};
