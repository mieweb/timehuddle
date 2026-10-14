/**
 * "One day, as TimeHuddle records it" — the example day from the hero, read
 * top to bottom as a ledger. Each entry pairs what happens with a small
 * drawing of what the app shows at that moment, built from the same example
 * data so the numbers agree with the hero.
 */
import React from 'react';

import { SITE_COPY } from '../copy';
import styles from '../site.module.css';
import { useReveal } from '../useReveal';
import {
  EXAMPLE_DAY,
  formatClock,
  formatDuration,
  redmineSummary,
  shiftMinutesAt,
  ticketMinutesAt,
} from './exampleDay';
import { SectionIntro } from './SectionIntro';

const copy = SITE_COPY.day;
const END_OF_DAY = 24 * 60;
const [firstSession, secondSession] = EXAMPLE_DAY.sessions;
const mealBreak = EXAMPLE_DAY.breaks[0];

type Track = 'shift' | 'ticket' | 'redmine';

interface Entry {
  at: number;
  track: Track;
  title: string;
  body: string;
  fragment: React.ReactNode;
}

const ENTRIES: Entry[] = [
  {
    at: EXAMPLE_DAY.shift.start,
    track: 'shift',
    ...copy.entries.clockIn,
    fragment: <ClockInFragment />,
  },
  {
    at: firstSession.start,
    track: 'ticket',
    ...copy.entries.timer,
    fragment: <TimerFragment />,
  },
  {
    at: secondSession.start,
    track: 'ticket',
    ...copy.entries.search,
    fragment: <SearchFragment />,
  },
  {
    at: mealBreak.start,
    track: 'shift',
    ...copy.entries.break,
    fragment: <BreakFragment />,
  },
  {
    at: EXAMPLE_DAY.shift.end,
    track: 'shift',
    ...copy.entries.clockOut,
    fragment: <ClockOutFragment />,
  },
  {
    at: EXAMPLE_DAY.sentToRedmineAt,
    track: 'redmine',
    ...copy.entries.send,
    fragment: <SendFragment />,
  },
];

const DOT: Record<Track, string> = {
  shift: 'bg-(--shift)',
  ticket: 'bg-(--ticket-soft) ring-2 ring-(--ticket)',
  redmine: 'bg-(--ticket)',
};

export const DaySection: React.FC = () => (
  <section
    id="day"
    aria-labelledby="day-heading"
    className="day-section scroll-mt-16 border-t border-(--rule) bg-(--paper-deep)/40"
  >
    <div className="day-grid mx-auto grid max-w-[88rem] gap-12 px-4 py-20 sm:px-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-20 lg:py-32">
      <div className="day-intro lg:sticky lg:top-28 lg:self-start">
        <SectionIntro
          id="day-heading"
          eyebrow={copy.eyebrow}
          title={copy.title}
          body={copy.intro}
        />
      </div>

      <ol className="day-ledger relative">
        {/* The day's spine */}
        <span
          className="absolute top-3 bottom-3 start-[4.6rem] w-px bg-(--rule) sm:start-[6.1rem]"
          aria-hidden="true"
        />
        {ENTRIES.map((entry) => (
          <LedgerEntry key={entry.at} entry={entry} />
        ))}
      </ol>
    </div>
  </section>
);

const LedgerEntry: React.FC<{ entry: Entry }> = ({ entry }) => {
  const reveal = useReveal<HTMLLIElement>();
  return (
    <li
      ref={reveal.ref}
      className={`${reveal.className} day-entry relative grid grid-cols-[4.6rem_minmax(0,1fr)] gap-x-6 pb-14 last:pb-0 sm:grid-cols-[6.1rem_minmax(0,1fr)] sm:gap-x-10`}
    >
      <time
        dateTime={`T${formatClock(entry.at)}`}
        className={`${styles.mono} day-entry-time pe-5 text-end text-lg leading-7 font-medium text-(--ink) sm:text-2xl sm:leading-8`}
      >
        {formatClock(entry.at)}
      </time>
      <span
        className={`absolute top-2.5 start-[4.6rem] size-3 -translate-x-1/2 rounded-full sm:top-3 sm:start-[6.1rem] rtl:translate-x-1/2 ${DOT[entry.track]}`}
        aria-hidden="true"
      />
      <div className="day-entry-content">
        <h3 className="text-xl font-semibold tracking-tight sm:text-2xl">{entry.title}</h3>
        <p className="mt-2 max-w-xl leading-relaxed text-(--ink-soft)">{entry.body}</p>
        {/* Illustrations of the app; the sentence above says what they show. */}
        <div className="day-entry-fragment mt-5 max-w-xl" aria-hidden="true">
          {entry.fragment}
        </div>
      </div>
    </li>
  );
};

// ─── Fragments ────────────────────────────────────────────────────────────────

const Frame: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = '',
}) => (
  <div
    className={`fragment-frame rounded-xl border border-(--rule) bg-(--card) shadow-[0_1px_0_var(--rule),0_12px_32px_-20px_rgb(19_33_43/0.35)] ${className}`}
  >
    {children}
  </div>
);

const Avatar: React.FC = () => (
  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-(--shift) text-sm font-semibold text-(--paper)">
    {copy.entries.timer.author[0]}
  </span>
);

function ClockInFragment() {
  const c = copy.entries.clockIn;
  return (
    <Frame className="p-4">
      <div className="flex items-center gap-3">
        <Avatar />
        <span className="text-sm font-medium">
          {copy.entries.timer.author} <span className="text-(--ink-faint)">· {c.teamName}</span>
        </span>
        <span
          className={`${styles.mono} ms-auto flex shrink-0 items-center gap-1.5 rounded-full whitespace-nowrap bg-(--shift-soft) px-2.5 py-1 text-xs text-(--shift)`}
        >
          <span className={`${styles.pulse} size-1.5 rounded-full bg-(--shift)`} />
          {c.status} {formatClock(EXAMPLE_DAY.shift.start)}
        </span>
      </div>
      <p className="mt-3 border-t border-(--rule) pt-3 text-sm text-(--ink-soft)">{c.plan}</p>
    </Frame>
  );
}

function TimerFragment() {
  const c = copy.entries.timer;
  return (
    <Frame className="flex gap-3 p-4">
      <Avatar />
      <div className="min-w-0 text-sm">
        <p className="text-(--ink-faint)">
          <span className="font-medium text-(--ink)">{c.author}</span> · {c.meta} ·{' '}
          <span className={styles.mono}>{formatClock(firstSession.start)}</span>
        </p>
        <p className="mt-1">
          {c.update}{' '}
          <span className={`${styles.mono} rounded bg-(--ticket-soft) px-1 text-(--ink)`}>
            {firstSession.ref}
          </span>
          : {firstSession.title}
        </p>
      </div>
    </Frame>
  );
}

function SearchFragment() {
  const c = copy.entries.search;
  const rows = [secondSession, firstSession];
  return (
    <Frame className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-(--rule) px-4 py-3">
        <span className="text-(--ink-faint)">⌕</span>
        <span className={`${styles.mono} text-sm`}>
          {c.query}
          <span
            className={`${styles.pulse} ms-px inline-block h-4 w-px translate-y-0.5 bg-(--ink)`}
          />
        </span>
        <span className="ms-auto rounded-full bg-(--paper-deep) px-2 py-0.5 text-[0.7rem] text-(--ink-soft)">
          {c.assigned}
        </span>
      </div>
      {rows.map((row, i) => (
        <div
          key={row.ref}
          className={`grid grid-cols-[4rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 text-sm ${i === 0 ? 'bg-(--ticket-soft)/50' : ''}`}
        >
          <span className={`${styles.mono} text-(--ink-soft)`}>{row.ref}</span>
          <span className="truncate">{row.title}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-[0.7rem] font-medium ${
              row.source === 'redmine'
                ? 'bg-(--ticket) text-(--ink)'
                : 'bg-(--shift-soft) text-(--shift)'
            }`}
          >
            {row.source === 'redmine' ? c.sourceRedmine : c.sourceHuddle}
          </span>
        </div>
      ))}
    </Frame>
  );
}

function BreakFragment() {
  const c = copy.entries.break;
  return (
    <Frame className="flex items-center gap-4 p-4">
      <span
        className={`${styles.hatched} h-10 w-16 shrink-0 rounded-md ring-1 ring-(--shift-soft)`}
      />
      <span className="text-sm text-(--ink-soft)">
        {c.paused}{' '}
        <span className={`${styles.mono} text-(--ink)`}>{formatClock(mealBreak.start)}</span>
      </span>
      <span className="ms-auto rounded-full bg-(--ink) px-4 py-1.5 text-sm font-medium text-(--paper)">
        {c.resume}
      </span>
    </Frame>
  );
}

function ClockOutFragment() {
  const c = copy.entries.clockOut;
  return (
    <Frame className="overflow-hidden">
      <div className="grid grid-cols-2 divide-x divide-(--rule) border-b border-(--rule) rtl:divide-x-reverse">
        {[
          { label: c.shift, value: shiftMinutesAt(EXAMPLE_DAY, END_OF_DAY), dot: 'bg-(--shift)' },
          {
            label: c.tickets,
            value: ticketMinutesAt(EXAMPLE_DAY, END_OF_DAY),
            dot: 'bg-(--ticket)',
          },
        ].map((m) => (
          <div key={m.label} className="px-4 py-3">
            <span className="flex items-center gap-1.5 text-xs text-(--ink-soft)">
              <span className={`size-1.5 rounded-full ${m.dot}`} />
              {m.label}
            </span>
            <span className={`${styles.mono} text-3xl font-medium tracking-tight`}>
              {formatDuration(m.value)}
            </span>
          </div>
        ))}
      </div>
      <p className="px-4 py-3 text-sm text-(--ink-soft)">{c.wrapUp}</p>
    </Frame>
  );
}

function SendFragment() {
  const c = copy.entries.send;
  const rows = redmineSummary(EXAMPLE_DAY);
  return (
    <Frame className="overflow-hidden">
      <p className="border-b border-(--rule) px-4 py-3 text-sm font-semibold">{c.heading}</p>
      <div className="px-4 py-2 text-sm">
        <div
          className={`${styles.mono} grid grid-cols-[minmax(0,1fr)_3.5rem_6.5rem] gap-3 py-1.5 text-[0.68rem] tracking-[0.1em] text-(--ink-faint) uppercase`}
        >
          <span>{c.issue}</span>
          <span className="text-end">{c.hours}</span>
          <span className="hidden sm:block">{c.activity}</span>
        </div>
        {rows.map((row) => (
          <div
            key={row.ref}
            className="grid grid-cols-[minmax(0,1fr)_3.5rem_6.5rem] items-center gap-3 border-t border-(--rule) py-2"
          >
            <span className="truncate">
              <span className={`${styles.mono} text-(--ink-soft)`}>{row.ref}</span> {row.title}
            </span>
            <span className={`${styles.mono} text-end`}>{formatDuration(row.minutes)}</span>
            <span className="hidden truncate text-(--ink-soft) sm:block">{c.activityValue}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-(--rule) bg-(--paper)/60 px-4 py-3">
        <span className="text-xs text-(--ink-faint)">{c.stays}</span>
        <span className="ms-auto rounded-full bg-(--ticket) px-4 py-1.5 text-sm font-semibold text-(--ink)">
          {c.confirm}
        </span>
      </div>
    </Frame>
  );
}
