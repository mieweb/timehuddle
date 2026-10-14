/**
 * The example day the landing page draws — one shift, one meal break, and the
 * ticket timers run inside it.
 *
 * It is shaped like what TimeHuddle records, so the hero can show the product's
 * real rule rather than a slogan: the shift clock and the ticket timers are two
 * different numbers, and only ticket time is sent to Redmine. Times are minutes
 * since midnight so the arithmetic stays trivial and testable.
 */

export interface Span {
  start: number;
  end: number;
}

export interface TicketSession extends Span {
  /** As the ticket table shows it: a Huddle ref is the id's last five characters, a Redmine ref the issue number. */
  ref: string;
  title: string;
  source: 'huddle' | 'redmine';
}

export interface ExampleDay {
  shift: Span;
  breaks: Span[];
  sessions: TicketSession[];
  /** When the hours are sent to Redmine, after clocking out. */
  sentToRedmineAt: number;
}

const at = (hours: number, minutes = 0) => hours * 60 + minutes;

export const EXAMPLE_DAY: ExampleDay = {
  shift: { start: at(8, 52), end: at(17, 34) },
  breaks: [{ start: at(12, 30), end: at(13, 5) }],
  sessions: [
    {
      ref: '#3fa2c',
      title: 'CSV export rounds totals early',
      source: 'huddle',
      start: at(9, 5),
      end: at(10, 40),
    },
    {
      ref: '#2217',
      title: 'Overtime report for payroll',
      source: 'redmine',
      start: at(10, 52),
      end: at(12, 30),
    },
    {
      ref: '#3fa2c',
      title: 'CSV export rounds totals early',
      source: 'huddle',
      start: at(13, 10),
      end: at(14, 25),
    },
    {
      ref: '#2217',
      title: 'Overtime report for payroll',
      source: 'redmine',
      start: at(14, 40),
      end: at(16, 15),
    },
    {
      ref: '#2240',
      title: 'Holiday calendar import',
      source: 'redmine',
      start: at(16, 25),
      end: at(17, 30),
    },
  ],
  sentToRedmineAt: at(17, 36),
};

/** The window the hero's ruler spans. */
export const DAY_WINDOW: Span = { start: at(8), end: at(18) };

/** Minutes of `span` that have elapsed by `now`. */
export function elapsedWithin(span: Span, now: number): number {
  return Math.max(0, Math.min(now, span.end) - span.start);
}

/**
 * The shift clock at `now`: time since clocking in, minus meal breaks. (Breaks
 * under 20 minutes count as worked in the product; the example's one break is
 * a meal.)
 */
export function shiftMinutesAt(day: ExampleDay, now: number): number {
  const worked = elapsedWithin(day.shift, now);
  const onBreak = day.breaks.reduce((sum, b) => sum + elapsedWithin(b, now), 0);
  return worked - onBreak;
}

/** All ticket timers at `now`, summed. */
export function ticketMinutesAt(day: ExampleDay, now: number): number {
  return day.sessions.reduce((sum, s) => sum + elapsedWithin(s, now), 0);
}

/** The session running at `now`, if any. */
export function runningSessionAt(day: ExampleDay, now: number): TicketSession | undefined {
  return day.sessions.find((s) => now >= s.start && now < s.end);
}

/**
 * What "Send work entries to Redmine" would offer for this day: one row per
 * Redmine issue, its timers summed. Huddle tickets never leave TimeHuddle.
 */
export function redmineSummary(day: ExampleDay): { ref: string; title: string; minutes: number }[] {
  const rows = new Map<string, { ref: string; title: string; minutes: number }>();
  for (const s of day.sessions) {
    if (s.source !== 'redmine') continue;
    const row = rows.get(s.ref) ?? { ref: s.ref, title: s.title, minutes: 0 };
    row.minutes += s.end - s.start;
    rows.set(s.ref, row);
  }
  return [...rows.values()];
}

/** `527` → `8:47` — hours are not zero-padded, minutes are. */
export function formatDuration(minutes: number): string {
  const whole = Math.round(minutes);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** `532` → `08:52` — a wall-clock time. */
export function formatClock(minutes: number): string {
  const whole = Math.round(minutes);
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}
