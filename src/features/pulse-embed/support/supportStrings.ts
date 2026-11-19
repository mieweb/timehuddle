/**
 * Every word of Pulse support on TimeHuddle's side (TH-4, D9): the Pulse
 * uploads section team admins see in Settings → Team, and the "Share the
 * Pulse log" row in Report an Issue. Kept in one place for translation, and
 * out of the logic.
 */
import type { PulseUploadState, PulseUploadTypeId } from '../../../lib/api';

export const SUPPORT_TEXT = {
  // ── Settings → Team: the section ──
  title: 'Pulse videos from the app',
  hint: 'Find a video someone sent from the app that never arrived: by person, ticket or clock session.',
  open: 'Show Pulse uploads',
  loading: 'Loading Pulse uploads…',
  loadFailed: "Couldn't load Pulse uploads.",
  retry: 'Try again',
  /** Announced when a search finishes. */
  found: (n: number) => (n === 1 ? '1 upload found' : `${n} uploads found`),

  // ── Searching ──
  findBy: 'Find by',
  modes: {
    recent: 'Most recent',
    person: 'Person',
    ticket: 'Ticket',
    session: 'Clock session',
  },
  personLabel: 'Person',
  personPlaceholder: 'Choose a person',
  ticketLabel: 'Ticket link or id',
  ticketPlaceholder: 'Paste the ticket’s link',
  sessionLabel: 'Clock session id',
  sessionPlaceholder: 'Paste the session’s id',
  find: 'Find',
  badTicket: "That isn't a ticket link or id.",
  badSession: "That isn't a clock session id.",
  noRows: 'No Pulse uploads match.',
  gridTitle: 'Pulse uploads',
  gridLabel: 'Pulse uploads for support',

  // ── Metrics (PLAN §7.2) ──
  metricsTitle: 'Last 30 days',
  metricsLoading: 'Loading metrics…',
  metricsFailed: "Couldn't load the metrics.",
  metricsNone: 'No videos sent from the app in the last 30 days.',
  metricsTruncated: 'Only the newest uploads were counted.',
  metric: {
    sent: 'Sent',
    attached: 'Attached',
    timeToAttach: 'Time to attach (median · p95)',
    failed: 'Failed',
    overdue: 'Overdue',
    abandoned: 'Abandoned',
    duplicates: 'Duplicate attachments',
  },

  // ── The table ──
  columns: {
    sentAt: 'Sent',
    userName: 'Person',
    type: 'Kind',
    place: 'Sent to',
    state: 'State',
    flags: 'Flags',
    reason: 'Reason',
    updatedAt: 'Updated',
    device: 'Device',
    id: 'Upload id',
  },
  flags: {
    overdue: 'Overdue',
    abandoned: 'Abandoned',
    late: 'Arrived late',
  },
  states: {
    intent: 'Waiting to start',
    reserved: 'Waiting for the phone',
    uploading: 'Uploading',
    processing: 'Processing',
    delivered: 'Attached',
    kept: 'Kept in library',
    canceled: 'Cancelled',
    failed: 'Failed',
    abandoned: 'Abandoned',
  } satisfies Record<PulseUploadState, string>,
  types: {
    'ticket.video': 'Ticket video',
    'clock.session': 'Session video',
    'clock.wrapup': 'Wrap-up',
    'clock.plan': 'Plan',
    'huddle.post': 'Post',
    'library.video': 'Library',
  } satisfies Record<PulseUploadTypeId, string>,
  unknownPerson: 'Unknown',

  // ── Report an Issue (ReportIssueModal) ──
  log: {
    title: 'Share the Pulse log',
    description: 'Attach this file to your report: it shows what Pulse did on this phone.',
    sharing: 'Preparing the Pulse log…',
    shared: 'Pulse log ready to attach.',
    failed: "Couldn't share the Pulse log.",
    fileTitle: 'Pulse log',
  },
};
