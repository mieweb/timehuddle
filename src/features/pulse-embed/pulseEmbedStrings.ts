/**
 * Every word Pulse in the app says on TimeHuddle's side (PLAN §5): the row
 * chips, the "On this phone" rows, the "Unsent videos" link, the toasts after
 * a flow, and the copy for each Pulse error. Kept in one place for
 * translation, so the same thing is said the same way everywhere, and so
 * business logic holds no text.
 */
import { UPLOAD_TEXT } from '../huddle/uploadText';

export const PULSE_EMBED_TEXT = {
  /** What Pulse calls TimeHuddle where it means the app ("Back to TimeHuddle"). */
  hostName: 'TimeHuddle',

  // ── Row chips (§5.2) ──
  chip: {
    draft: 'Draft',
    ready: 'Ready to send',
    preparing: 'Preparing…',
    queued: 'Waiting to send',
    waitingNetwork: 'Waiting for network',
    /** "Uploading 37%", in the composer's words. */
    uploading: (percent: number | null) =>
      percent === null ? 'Uploading' : UPLOAD_TEXT.waiting(percent).replace(/…$/, ''),
    /** Every byte is in; the server is making it ready. */
    delivering: UPLOAD_TEXT.processing,
    /** PulseKit resumes on its own (it can run without a screen). */
    pausedAuto: 'Paused · resumes automatically',
    /** PulseKit needs a screen to resume. */
    pausedTap: 'Paused · Tap to resume',
    failed: "Didn't send",
    tooLarge: 'Too large to send · Trim',
    sent: 'Attached ✓',
    /** A video kept in the library because its place was gone at delivery. */
    kept: (reason: string | null) =>
      reason ? `Saved to your library (${reason.replace(/\.$/, '')})` : 'Saved to your library',
    /** Someone's video on its way, seen from another device. */
    uploadingElsewhere: 'Uploading from iPhone…',
    /** A clock action ran at Send; its video hasn't started uploading yet. */
    waitingForVideo: 'Video on its way',
  },

  // ── "On this phone" rows ──
  rows: {
    heading: 'On this phone',
    /** The list's accessible name. */
    listLabel: 'Videos on this phone',
    loading: 'Loading videos on this phone',
    loadFailed: "Couldn't load the videos on this phone.",
    /** A row's poster, for screen readers. */
    poster: (name: string) => `${name}, poster`,
    /** Announced when a row changes state. */
    changed: (name: string, chip: string) => `${name}: ${chip}`,
    /** A row's duration, "0:42". */
    duration: (ms: number) => {
      const total = Math.max(0, Math.round(ms / 1000));
      const minutes = Math.floor(total / 60);
      const seconds = String(total % 60).padStart(2, '0');
      return `${minutes}:${seconds}`;
    },
    open: (name: string) => `Open ${name}`,
    /** A row whose name the server doesn't know (someone else's video). */
    untitled: 'Video',
  },

  // ── The "Unsent videos (n)" link ──
  unsent: {
    link: (count: number) => `Unsent videos (${count})`,
    attention: (count: number) => (count === 1 ? '1 needs attention' : `${count} need attention`),
  },

  // ── After a flow (toasts, announced through the toast region) ──
  flow: {
    sending: (label: string) => (label ? `Sending to ${label}` : 'Sending your video'),
    kept: 'Saved to Unsent videos',
    /** A notification or link tapped while Pulse is open. */
    opensWhenDone: 'Opens when you finish',
  },

  // ── What each Pulse error says (pulseErrors.ts maps codes to these) ──
  error: {
    unavailable: "Pulse isn't available right now. Try again in a moment.",
    unsupported: "Pulse can't record on this device. Use the Pulse link instead.",
    appTooOld: "This version of TimeHuddle can't do that with Pulse. Update TimeHuddle to use it.",
    busy: 'Pulse is busy with another video. Finish it, then try again.',
    invalidOptions: "Pulse couldn't open that. Try again, or report it if it keeps happening.",
    notFound: "That video isn't on this phone any more.",
    locked: "This video is sending, so it can't be changed right now.",
    clockBound: 'This video belongs to a clock-in or clock-out, so it stays where it is.',
    hostUnavailable: "Couldn't reach TimeHuddle. Check your connection and try again.",
    restartRequired: 'Close and reopen TimeHuddle to record',
    hostMisconfigured: "TimeHuddle couldn't take this video. Try again later.",
    noAccount: 'Sign in to TimeHuddle to send your videos.',
    timeout: 'Pulse took too long to answer. Try again.',
    storageFull: 'Your phone is out of space. Free up some space, then try again.',
    newerSchema:
      'A newer TimeHuddle made this video. You can send or delete it here; update TimeHuddle to edit it.',
    damaged: "Pulse couldn't read the videos on this phone. Report it so we can help.",
    unknown: 'Something went wrong with Pulse. Try again.',
    runtimePaused: 'Recording with Pulse is paused for now. Your videos are safe on this phone.',
    camera: 'TimeHuddle needs the camera to record. Turn it on in Settings.',
    microphone: 'TimeHuddle needs the microphone to record sound. Turn it on in Settings.',
    exportFailed: "Your video couldn't be prepared. It's saved; try again.",
    uploadFailed: "Your video didn't send. It's saved on this phone.",
    uploadRefused: "TimeHuddle didn't take this video. Move it somewhere else, or delete it.",
    destinationGone: 'Where this video was going is gone. Move it somewhere else.',
    credentialsExpired: 'Sign in again to finish sending your video.',
    runtimeError: 'Pulse stopped unexpectedly. Your video is saved.',
    tooLarge: 'This video is too large to send to TimeHuddle. Trim it, then send it.',
  },

  // ── Error actions (pulseErrors.ts) ──
  action: {
    retry: 'Try again',
    settings: 'Open Settings',
    restart: 'Close and reopen TimeHuddle',
    update: 'Update TimeHuddle',
    signIn: 'Sign in',
    trim: 'Trim',
    move: 'Move to…',
    freeSpace: 'Free up space',
    dismiss: 'OK',
  },
};
