/**
 * Every word clocking in and out with a Pulse video says on TimeHuddle's side
 * (PLAN §5.1 B2 and B3, O14; TH-11): the Clock page's two buttons, the toasts
 * after the flow, and the notes a session post shows for its video. Pulse's
 * own screens (the banner, "Clock out & send", "Couldn't clock out") are
 * Pulse's. Kept in one place for translation, and out of the flow logic.
 */
export const CLOCK_PULSE_TEXT = {
  // ── The Clock page's buttons (B2, B3) ──
  clockOut: 'Clock out with a Pulse video',
  clockIn: 'Clock in with a Pulse video',
  /** Offline: clocking needs the server, as the plain clock actions do. */
  needsConnection: 'Needs a connection',

  // ── After the flow (toasts) ──
  /** Send clocked out: the time is the session's end as the server recorded it. */
  clockedOut: (time: string | null) =>
    time ? `Clocked out at ${time} · video sending` : 'Clocked out · video sending',
  /** Send clocked in: the time is the session's start as the server recorded it. */
  clockedIn: (time: string | null) =>
    time ? `Clocked in at ${time} · video sending` : 'Clocked in · video sending',
  /** The wrap-up was kept (X → Keep draft): nothing was clocked. */
  stillClockedIn: 'Still clocked in',
  /** The toast's action after a kept wrap-up: a plain clock-out, no video. */
  clockOutNow: 'Clock out now',
  /** The plan was kept: nothing was clocked. */
  stillClockedOut: 'Still clocked out',

  // ── A session post's video (huddle-server §9.4, O14) ──
  note: {
    /** Sent at a clock action; the video hasn't landed yet. */
    onItsWay: 'Video on its way',
    /** Still on its way 24 h after Send. */
    overdue: (role: 'plan' | 'wrapup') =>
      role === 'plan' ? "Plan video hasn't arrived yet" : "Wrap-up video hasn't arrived yet",
    /** Deleted, or its sending was cancelled: it won't come. */
    missing: (role: 'plan' | 'wrapup') =>
      role === 'plan' ? "Plan video didn't arrive" : "Wrap-up video didn't arrive",
  },
};
