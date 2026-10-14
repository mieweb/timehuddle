/**
 * The hero's instrument: one example day on a ruler, with the shift on one
 * track and the ticket timers on the track beneath it.
 *
 * Drag (or arrow-key) the playhead and both clocks update, which shows the
 * product's actual rule more plainly than a sentence could: the shift clock
 * and the ticket timers are different numbers, and only ticket time on
 * Redmine issues is sent to Redmine.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';

import styles from '../site.module.css';
import { SITE_COPY } from '../copy';
import {
  DAY_WINDOW,
  EXAMPLE_DAY,
  formatClock,
  formatDuration,
  runningSessionAt,
  shiftMinutesAt,
  ticketMinutesAt,
  type Span,
} from './exampleDay';

const SPAN = DAY_WINDOW.end - DAY_WINDOW.start;
const HOURS = Array.from({ length: SPAN / 60 + 1 }, (_, i) => DAY_WINDOW.start + i * 60);
/** Where the playhead rests after its opening sweep. */
const RESTING_AT = 15 * 60 + 12;
const STEP = 5;

const pct = (minutes: number) => `${((minutes - DAY_WINDOW.start) / SPAN) * 100}%`;
const width = (span: Span) => `${((span.end - span.start) / SPAN) * 100}%`;
const clamp = (minutes: number) => Math.min(DAY_WINDOW.end, Math.max(DAY_WINDOW.start, minutes));

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export const DayScrubber: React.FC = () => {
  const copy = SITE_COPY.hero.scrubber;
  const trackRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() =>
    prefersReducedMotion() ? RESTING_AT : EXAMPLE_DAY.shift.start,
  );
  const [touched, setTouched] = useState(false);

  // Opening sweep from clock-in to mid-afternoon, so the numbers visibly run.
  useEffect(() => {
    if (touched || prefersReducedMotion()) return;
    const from = EXAMPLE_DAY.shift.start;
    const duration = 2600;
    let frame = 0;
    const startedAt = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - startedAt) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setNow(from + (RESTING_AT - from) * eased);
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    const delay = window.setTimeout(() => (frame = requestAnimationFrame(tick)), 500);
    return () => {
      window.clearTimeout(delay);
      cancelAnimationFrame(frame);
    };
  }, [touched]);

  const moveTo = useCallback((clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTouched(true);
    setNow(clamp(DAY_WINDOW.start + ((clientX - rect.left) / rect.width) * SPAN));
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    moveTo(e.clientX);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) moveTo(e.clientX);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const delta = { ArrowLeft: -STEP, ArrowRight: STEP, PageDown: -60, PageUp: 60 }[e.key];
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      setTouched(true);
      setNow(e.key === 'Home' ? DAY_WINDOW.start : DAY_WINDOW.end);
    } else if (delta) {
      e.preventDefault();
      setTouched(true);
      setNow((n) => clamp(Math.round(n / STEP) * STEP + delta));
    }
  };

  const shift = shiftMinutesAt(EXAMPLE_DAY, now);
  const tickets = ticketMinutesAt(EXAMPLE_DAY, now);
  const running = runningSessionAt(EXAMPLE_DAY, now);
  const onBreak = EXAMPLE_DAY.breaks.some((b) => now >= b.start && now < b.end);
  const clockedOut = now >= EXAMPLE_DAY.shift.end;
  const status =
    now < EXAMPLE_DAY.shift.start
      ? copy.notYet
      : clockedOut
        ? copy.clockedOut
        : onBreak
          ? copy.onBreak
          : running
            ? `${copy.timing} ${running.ref} · ${running.title}`
            : copy.clockedInNoTimer;

  return (
    <figure className="day-scrubber m-0" aria-labelledby="day-scrubber-caption">
      <div className="day-scrubber-readouts grid grid-cols-2 gap-px overflow-hidden rounded-t-2xl border border-b-0 border-(--rule) bg-(--rule) sm:grid-cols-[1fr_1fr_1.4fr]">
        <Readout label={copy.shiftClock} value={formatDuration(shift)} tone="shift" />
        <Readout label={copy.ticketTimers} value={formatDuration(tickets)} tone="ticket" />
        <div className="day-scrubber-status col-span-2 flex flex-col justify-between gap-2 bg-(--card) p-4 sm:col-span-1 sm:p-5">
          <span
            className={`${styles.mono} text-[0.7rem] tracking-[0.14em] text-(--ink-faint) uppercase`}
          >
            {copy.at} {formatClock(now)}
          </span>
          <span className="flex items-center gap-2 text-sm text-(--ink)" aria-live="polite">
            {running && !onBreak && (
              <span
                className={`${styles.pulse} size-2 shrink-0 rounded-full bg-(--ticket)`}
                aria-hidden="true"
              />
            )}
            <span className="truncate">{status}</span>
          </span>
        </div>
      </div>

      <div className="day-scrubber-board relative rounded-b-2xl border border-(--rule) bg-(--card) px-4 pt-8 pb-5 sm:px-6">
        <div
          ref={trackRef}
          className="day-scrubber-track relative cursor-ew-resize touch-none select-none"
          role="slider"
          tabIndex={0}
          aria-label={copy.sliderLabel}
          aria-valuemin={DAY_WINDOW.start}
          aria-valuemax={DAY_WINDOW.end}
          aria-valuenow={Math.round(now)}
          aria-valuetext={`${formatClock(now)} — ${copy.shiftClock} ${formatDuration(shift)}, ${copy.ticketTimers} ${formatDuration(tickets)}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onKeyDown={onKeyDown}
        >
          {/* Hour rules */}
          <div
            className="day-scrubber-hours pointer-events-none absolute inset-x-0 -top-6 bottom-0"
            aria-hidden="true"
          >
            {HOURS.map((h) => (
              <div key={h} className="absolute top-0 bottom-0" style={{ left: pct(h) }}>
                <span
                  className={`${styles.mono} absolute -top-0.5 -translate-x-1/2 text-[0.65rem] text-(--ink-faint) ${(h / 60) % 2 ? 'hidden sm:inline' : ''}`}
                >
                  {String(h / 60).padStart(2, '0')}
                </span>
                <span className="absolute top-4 bottom-0 w-px bg-(--rule)/70" />
              </div>
            ))}
          </div>

          <Lane label={copy.shiftLane}>
            <span
              className="absolute inset-y-0 rounded-md bg-(--shift)"
              style={{ left: pct(EXAMPLE_DAY.shift.start), width: width(EXAMPLE_DAY.shift) }}
            />
            {EXAMPLE_DAY.breaks.map((b) => (
              <span
                key={b.start}
                className={`${styles.hatched} absolute inset-y-0 bg-(--card)`}
                style={{ left: pct(b.start), width: width(b) }}
                title={copy.breakTitle}
              />
            ))}
          </Lane>

          <Lane label={copy.ticketLane}>
            {EXAMPLE_DAY.sessions.map((s) => (
              <span
                key={s.start}
                className={`absolute inset-y-0 overflow-hidden rounded-md px-1.5 ${
                  s.source === 'redmine'
                    ? 'bg-(--ticket)'
                    : 'bg-(--ticket-soft) ring-1 ring-(--ticket) ring-inset'
                }`}
                style={{ left: pct(s.start), width: width(s) }}
              >
                <span
                  className={`${styles.mono} hidden text-[0.65rem] leading-7 text-(--ink) md:inline`}
                >
                  {s.ref}
                </span>
              </span>
            ))}
          </Lane>

          {/* Playhead */}
          <div
            className="day-scrubber-playhead pointer-events-none absolute -top-7 -bottom-2 w-0"
            style={{ left: pct(now) }}
            aria-hidden="true"
          >
            <span className="absolute inset-y-0 -left-px w-0.5 bg-(--ink)" />
            <span className="absolute -top-1 -left-1.5 size-3 rounded-full border-2 border-(--ink) bg-(--paper)" />
          </div>
        </div>

        <figcaption
          id="day-scrubber-caption"
          className="day-scrubber-legend mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-(--ink-soft)"
        >
          <LegendSwatch className="bg-(--shift)">{copy.legendShift}</LegendSwatch>
          <LegendSwatch className={`${styles.hatched} ring-1 ring-(--shift-soft)`}>
            {copy.legendBreak}
          </LegendSwatch>
          <LegendSwatch className="bg-(--ticket)">{copy.legendRedmine}</LegendSwatch>
          <LegendSwatch className="bg-(--ticket-soft) ring-1 ring-(--ticket) ring-inset">
            {copy.legendHuddle}
          </LegendSwatch>
          <span className="ms-auto hidden text-(--ink-faint) sm:inline">{copy.hint}</span>
        </figcaption>
      </div>
    </figure>
  );
};

const Readout: React.FC<{ label: string; value: string; tone: 'shift' | 'ticket' }> = ({
  label,
  value,
  tone,
}) => (
  <div className="day-scrubber-readout bg-(--card) p-4 sm:p-5">
    <span className="flex items-center gap-2 text-xs font-medium text-(--ink-soft)">
      <span
        className={`size-2 rounded-full ${tone === 'shift' ? 'bg-(--shift)' : 'bg-(--ticket)'}`}
        aria-hidden="true"
      />
      {label}
    </span>
    <span
      className={`${styles.mono} mt-1 block text-[clamp(2.25rem,6vw,4rem)] leading-none font-medium tracking-tight`}
    >
      {value}
    </span>
  </div>
);

const Lane: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="day-scrubber-lane relative mb-2 h-7 last:mb-0">
    <span className="sr-only">{label}</span>
    {children}
  </div>
);

const LegendSwatch: React.FC<{ className: string; children: React.ReactNode }> = ({
  className,
  children,
}) => (
  <span className="flex items-center gap-1.5">
    <span className={`inline-block h-2.5 w-4 rounded-sm ${className}`} aria-hidden="true" />
    {children}
  </span>
);
