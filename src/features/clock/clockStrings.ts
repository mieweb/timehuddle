/**
 * Every user-facing string on the Clock page's status line, composer and
 * Recent sessions table.
 *
 * The translation seam, like `timers/ticketTimerStrings.ts`: components read
 * this text only from here, and anything built from values is a function, so
 * a translation controls the whole sentence — word order and plural rules
 * included — rather than English fragments glued together in JSX.
 */

/** Which composer is open: a plan before clock-in, or a wrap-up before clock-out. */
export type ComposerMode = 'plan' | 'wrapup';

/**
 * The locale every Clock date and time is formatted in. One place to change
 * once the app picks a locale from user settings; until then it matches the
 * rest of the app, which formats in US English.
 */
export const CLOCK_LOCALE = 'en-US';

/** Marks where the Huddle link goes in `clockText.destination`. */
export const HUDDLE_LINK_TOKEN = '{huddle}';

export const clockText = {
  loading: 'Loading…',

  // ── Status line ──
  status: (state: 'clockedOut' | 'onBreak' | 'clockedIn') =>
    ({ clockedOut: 'Clocked out', onBreak: 'On break', clockedIn: 'Clocked in' })[state],
  today: 'Today',
  last7Days: 'Last 7 days',
  since: (time: string) => `since ${time}`,
  /** Which team the clock action targets — beside the Clock in/out controls. */
  team: (clockedIn: boolean, teamName: string) =>
    clockedIn ? `Clocked in to ${teamName}` : `Clocking in to ${teamName}`,
  planRequired: 'Plan required for this team',
  openTicket: (title: string) => `Open ticket: ${title}`,

  // ── Clock actions ──
  clockIn: 'Clock in',
  clockOut: 'Clock out',
  takeBreak: 'Take a break',
  /** The break button's accessible name — the same as the header's break control. */
  takeBreakLabel: 'Start break',
  resumeWork: 'Resume work',

  // ── Composer ──
  prompt: (mode: ComposerMode) =>
    mode === 'plan' ? 'What are you working on?' : 'What did you work on?',
  /**
   * Where the post goes. `HUDDLE_LINK_TOKEN` marks the link; `teamName` is
   * given when a wrap-up posts to a team other than the one selected.
   */
  destination: (mode: ComposerMode, teamName?: string) => {
    const what = mode === 'plan' ? 'Your plan' : 'Your wrap-up';
    const where = teamName ? ` in "${teamName}"` : '';
    return `${what} goes to ${HUDDLE_LINK_TOKEN}${where} so the team can see it`;
  },
  huddleLink: 'Huddle',
  placeholder: (mode: ComposerMode) => (mode === 'plan' ? "Today I'll…" : 'I worked on…'),
  /** The collapsed one-line stand-in's accessible name. */
  writeLabel: (mode: ComposerMode) => (mode === 'plan' ? 'Write a plan' : 'Write a wrap-up'),
  submit: (mode: ComposerMode) =>
    mode === 'plan' ? 'Clock in with a plan' : 'Clock out with a wrap-up',
  pulse: (clockedIn: boolean) => (clockedIn ? 'Clock out with Pulse' : 'Clock in with Pulse'),
  /** Between the two ways to clock in or out: "Clock in with a plan or Clock in with Pulse". */
  or: 'or',
  loadingPlan: 'Loading your plan…',
  postFailed: 'Failed to post. Please try again.',
  noWrapUpTeam: 'No team for this session — cannot post a wrap-up.',
  shortcutHint: (mode: ComposerMode, empty: boolean) => {
    const action = mode === 'plan' ? 'clock in' : 'clock out';
    if (!empty) return `⌘↵ to post and ${action}`;
    const first = mode === 'plan' ? 'Write a plan first' : 'Write a wrap-up first';
    return `${first} · ⌘↵ to post and ${action}`;
  },

  // ── Recent sessions ──
  recentSessions: 'Recent sessions',
  viewAll: 'View all',
  loadingSessions: 'Loading sessions…',
  noSessions: 'No sessions in the last 7 days.',
  columnDay: 'Day',
  columnTime: 'Time',
  columnTracked: 'Tracked',
  timeRange: (start: string, end: string) => `${start} – ${end}`,
  todayLabel: (date: string) => `Today · ${date}`,
  dayLabel: (weekday: string, date: string) => `${weekday} · ${date}`,
  /** The sub-minute sessions note, as one whole message per count and state. */
  shortSessions: (count: number, shown: boolean) => {
    if (shown) {
      return count === 1
        ? '1 session under 1 minute shown'
        : `${count} sessions under 1 minute shown`;
    }
    return count === 1
      ? '1 session under 1 minute hidden'
      : `${count} sessions under 1 minute hidden`;
  },
  showShortSessions: (shown: boolean) => (shown ? 'Hide' : 'Show'),
} as const;
