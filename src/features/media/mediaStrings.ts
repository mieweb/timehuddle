/**
 * Every word the Media page says (PLAN §5.1 Unsent videos and Move to…,
 * §5.2, §5.3): its nav entry, the Unsent videos section, a row's ⋯ menu,
 * the per-state sheets, Move to…, rename, the undo toasts and the offline
 * notice, and "Your library" below. The row chips are PULSE_EMBED_TEXT's,
 * shared with the "On this phone" rows. Kept in one place for translation,
 * so business logic holds no text.
 */
const MEDIA_ATTENTION = (n: number) => `${n} ${n === 1 ? 'video needs' : 'videos need'} attention`;

export const MEDIA_TEXT = {
  // ── The page and its nav entry ──
  title: 'Media',
  /** The nav entry's accessible name, with its attention count. */
  navLabel: (attention: number) =>
    attention > 0 ? `Media, ${MEDIA_ATTENTION(attention)}` : 'Media',
  /** The phone's More tab while Media (inside it) has videos that need attention. */
  moreLabel: (more: string, attention: number) =>
    attention > 0 ? `${more}, ${MEDIA_ATTENTION(attention)}` : more,
  /** The badge on the nav entry and on More. */
  navBadge: (attention: number) => (attention > 99 ? '99+' : String(attention)),
  checking: 'Checking for videos on this phone',

  // ── Unsent videos (§5.1) ──
  unsent: {
    heading: 'Unsent videos',
    /** The heading with its count: "Unsent videos (3)". */
    headingCount: (count: number) => `Unsent videos (${count})`,
    listLabel: 'Unsent videos',
    loading: 'Loading the videos on this phone',
    loadFailed: "Couldn't load the videos on this phone.",
    empty:
      "Videos you record in TimeHuddle stay here until they're sent. " +
      'Videos recorded in the Pulse app stay in that app.',
    /** §5.3: the section renders from this phone alone. */
    offline: 'Offline: showing videos on this phone',
    filterLabel: 'Show',
  },

  /** Group headings and filter names, by place. */
  group: {
    all: 'All',
    ticket: 'Tickets',
    clock: 'Clock sessions',
    post: 'Posts',
    library: 'Library',
    other: 'Other videos',
  },
  /** The filter chip for a group (shorter than its heading where it reads better). */
  filter: {
    all: 'All',
    ticket: 'Tickets',
    clock: 'Clock',
    post: 'Posts',
    library: 'Library',
    other: 'Other',
  },

  // ── One row ──
  row: {
    /** Where the video is for: "For Fix login". */
    place: (label: string) => (label ? `For ${label}` : ''),
    open: (name: string) => `Open ${name}`,
    more: (name: string) => `More for ${name}`,
    /** How long ago it was recorded. */
    age: (ms: number) => {
      const minutes = Math.floor(Math.max(0, ms) / 60_000);
      if (minutes < 1) return 'Just now';
      if (minutes < 60) return `${minutes} min ago`;
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return `${hours} h ago`;
      const days = Math.floor(hours / 24);
      return days === 1 ? 'Yesterday' : `${days} days ago`;
    },
    untitled: 'Video',
  },

  // ── Actions (the ⋯ menu and the sheets) ──
  action: {
    send: 'Send',
    move: 'Move to…',
    rename: 'Rename',
    delete: 'Delete',
    cancel: 'Cancel sending',
    edit: 'Edit video',
    resume: 'Resume',
    retry: 'Retry',
    open: 'Open',
    dismiss: 'Dismiss',
    trim: 'Trim',
    close: 'Close',
  },

  // ── The per-state sheet (§5.2) ──
  sheet: {
    /** Its progress bar's accessible name. */
    progress: (name: string) => `Sending ${name}`,
    preparing: 'Getting the video ready to send.',
    queued: 'Waiting to send. It sends as soon as it can.',
    waitingNetwork: 'Waiting for a connection. It sends once you are back online.',
    uploading: 'Sending now. You can leave this page; it keeps going.',
    delivering: 'Every byte is in. TimeHuddle is finishing it up.',
    pausedAuto: 'Paused. It resumes by itself.',
    pausedTap: 'Paused. Tap Resume to keep sending.',
    failed: "This video didn't send. It's still on this phone.",
    kept: (reason: string | null) =>
      reason
        ? `This video is in your library: ${reason.replace(/\.$/, '')}. Move it somewhere else, or dismiss this.`
        : 'This video is in your library. Move it somewhere else, or dismiss this.',
  },

  /** O13: a clock draft whose clock action ran stays with that clock-in or clock-out. */
  clockBound: (kind: 'out' | 'in' | null, time: string | null) => {
    const what = kind === 'in' ? 'clock-in' : kind === 'out' ? 'clock-out' : 'clock session';
    return time ? `Belongs to your ${time} ${what}` : `Belongs to your ${what}`;
  },

  // ── Move to… ──
  move: {
    title: 'Move to…',
    /** Under the title: which video. */
    subtitle: (name: string) => `Choose where ${name} goes.`,
    searchLabel: 'Search tickets',
    searchPlaceholder: 'Ticket title, ID or link',
    searchHint: 'Type at least 3 letters, or a ticket ID.',
    searching: 'Searching tickets',
    noTickets: 'No tickets match.',
    ticketsHeading: 'Tickets',
    elsewhereHeading: 'Somewhere else',
    session: (label: string) => `Your open session · ${label}`,
    sessionLabel: (teamName: string | null) => (teamName ? `${teamName} session` : 'Open session'),
    library: 'My library',
    /** Announced, and toasted, after a move. */
    moved: (label: string) => `Moved to ${label} · Sending`,
    movedKept: (label: string) => `Moved to ${label}`,
    cancel: 'Cancel',
    /** The place it is for now, which isn't offered again. */
    current: 'Current place',
  },

  // ── Rename ──
  rename: {
    title: 'Rename video',
    label: 'Video name',
    save: 'Save',
    cancel: 'Cancel',
  },

  // ── Undo (§5.3: undo, not confirm) ──
  undo: {
    action: 'Undo',
    deleted: (name: string) => `Deleted ${name}`,
    sending: 'Sending…',
    undone: 'Undone',
    dismissed: 'Dismissed',
  },

  // ── Your library (media.list) ──
  library: {
    heading: 'Your library',
    listLabel: 'Your library',
    loading: 'Loading your library',
    loadFailed: "Couldn't load your library.",
    retry: 'Try again',
    empty: 'Videos you keep in your library show here.',
    /** A video kept in the library because its place was gone. */
    kept: (reason: string) => `Kept here: ${reason.replace(/\.$/, '')}`,
    untitled: 'Untitled video',
    open: (name: string) => `Watch ${name}`,
  },

  /** The kept-video toast's action (PulseEmbedProvider). */
  view: 'View',
};
