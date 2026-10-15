/**
 * Picking when a Huddle post is delivered (#596): the values behind the
 * schedule dialog, kept apart from React so they can be tested directly.
 */
import type { HuddleDeliveryMode } from '@lib/api';

export interface PostSchedule {
  deliverAt: Date;
  deliveryMode: HuddleDeliveryMode;
}

/** The server accepts any future time; the dialog asks for a minute of lead so a send can't race it. */
export const MIN_LEAD_MS = 60_000;
export const MAX_AHEAD_MS = 365 * 24 * 60 * 60 * 1000;

/** User-facing text for scheduling, kept in one place for translation. */
export const SCHEDULE_TEXT = {
  schedule: 'Schedule',
  scheduleAria: 'Schedule this post for later',
  scheduledAria: (when: string) => `Scheduled for ${when}. Change the schedule`,
  dialogTitle: 'Schedule Post',
  rescheduleTitle: 'Reschedule Post',
  when: 'Send at',
  modeLabel: 'Until then',
  modeSilent: 'Show it now, notify at that time',
  modeHidden: 'Keep it hidden until that time',
  presetInAnHour: 'In 1 hour',
  presetTomorrow: 'Tomorrow 9:00',
  presetMonday: 'Monday 9:00',
  presetsLabel: 'Quick picks',
  confirm: 'Schedule',
  confirmReschedule: 'Reschedule',
  clear: 'Send right away',
  cancel: 'Cancel',
  errorMissing: 'Pick a date and time.',
  errorPast: 'Pick a time at least a minute from now.',
  errorTooFar: 'Pick a time within the next year.',
  pendingCount: (count: number) => `Scheduled (${count})`,
  pendingAria: (count: number) => `${count} scheduled post${count === 1 ? '' : 's'}`,
  sheetTitle: 'Scheduled Posts',
  sheetEmpty: 'Nothing scheduled.',
  sendNow: 'Send now',
  reschedule: 'Reschedule',
  delete: 'Delete',
  deleteTitle: 'Delete this scheduled post?',
  deleteDescription: 'It will not be sent, and this cannot be undone.',
  actionFailed: 'That didn’t work. Please try again.',
} as const;

const pad = (n: number) => String(n).padStart(2, '0');

/** "YYYY-MM-DDTHH:mm" in local time — the value a datetime-local input holds. */
export function toLocalInputValue(date: Date): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** The local Date a datetime-local value names, or null when it isn't one. */
export function parseLocalInputValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day, hour, minute);
  // Reject roll-overs like Feb 30 → Mar 2.
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

/** Why `deliverAt` can't be used, or null when it can. */
export function scheduleError(deliverAt: Date | null, now: number): string | null {
  if (!deliverAt) return SCHEDULE_TEXT.errorMissing;
  if (deliverAt.getTime() < now + MIN_LEAD_MS) return SCHEDULE_TEXT.errorPast;
  if (deliverAt.getTime() > now + MAX_AHEAD_MS) return SCHEDULE_TEXT.errorTooFar;
  return null;
}

/** Quick picks: an hour out (to the next 5 minutes), tomorrow 9:00, next Monday 9:00. */
export function schedulePresets(now: Date): { id: string; label: string; at: Date }[] {
  const inAnHour = new Date(now.getTime() + 60 * 60_000);
  inAnHour.setSeconds(0, 0);
  inAnHour.setMinutes(Math.ceil(inAnHour.getMinutes() / 5) * 5);

  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0);

  const daysToMonday = (8 - now.getDay()) % 7 || 7;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysToMonday, 9, 0);

  return [
    { id: 'hour', label: SCHEDULE_TEXT.presetInAnHour, at: inAnHour },
    { id: 'tomorrow', label: SCHEDULE_TEXT.presetTomorrow, at: tomorrow },
    { id: 'monday', label: SCHEDULE_TEXT.presetMonday, at: monday },
  ];
}
