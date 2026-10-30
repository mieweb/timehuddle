/**
 * Reminders about unread notifications (#784), for people who turned them on.
 *
 * A new notification starts the reminders unless they're already running: a
 * push 2 hours later if anything is still unread, then after 4, 8, 16 and 32
 * more hours, then none until the next notification. Reading everything stops
 * them. One Agenda job per user carries the step; the waits and the delivery
 * rule live in notification-prefs-core.js.
 */
import { rawDb } from './collections';
import { getPrefs } from './notification-prefs';
import {
  resolveDelivery,
  unreadReminderDelayMs,
  wantsUnreadReminders,
} from './notification-prefs-core';
import { sendToUser } from './push';

const UNREAD_REMINDER_JOB = 'unread-reminder';
const UNREAD_REMINDER_TYPE = 'unread-reminder';

/** Set by agenda.js once Agenda is up; until then nothing is scheduled. */
let _agenda;

function unreadCount(userId) {
  return rawDb().collection('notifications').countDocuments({ userId, read: false });
}

function reminderBody(count) {
  return count === 1
    ? 'You have 1 unread notification.'
    : `You have ${count} unread notifications.`;
}

/** Send one reminder if it's still wanted, then queue the next or end the run. */
async function runUnreadReminder(job) {
  const { userId, step = 0 } = job.attrs.data;
  const [count, prefs] = await Promise.all([unreadCount(userId), getPrefs(userId)]);
  if (!count || !wantsUnreadReminders(prefs)) {
    await job.remove();
    return;
  }
  // Quiet time holds a reminder like any pop-up; a held one is skipped, not delayed.
  const delivery = resolveDelivery(prefs, { type: UNREAD_REMINDER_TYPE, now: new Date() });
  if (delivery.desktop || delivery.phone) {
    await sendToUser(
      userId,
      {
        title: 'Huddle',
        body: reminderBody(count),
        // One shared tag: a new reminder replaces the last one rather than stacking.
        tag: UNREAD_REMINDER_TYPE,
        data: { type: UNREAD_REMINDER_TYPE, url: '/app/notifications' },
      },
      delivery,
    ).catch((err) => console.error('[unread-reminder] push failed:', err));
  }
  const nextDelay = unreadReminderDelayMs(step + 1);
  if (nextDelay === null) {
    await job.remove();
    return;
  }
  job.attrs.data = { userId, step: step + 1 };
  await job.schedule(new Date(Date.now() + nextDelay)).save();
}

/** Register the job on `agenda` and keep it for scheduling. Called from initAgenda. */
export function defineUnreadReminderJob(agenda) {
  _agenda = agenda;
  agenda.define(UNREAD_REMINDER_JOB, runUnreadReminder);
}

/** Start the reminders for a new notification, unless they're off or already running. */
export async function startUnreadReminders(userId) {
  if (!_agenda || !wantsUnreadReminders(await getPrefs(userId))) return;
  // With nothing else unread, a job still queued is left from a run whose
  // notifications were read or removed without cancelling it (a timesheet
  // prompt answered, a join request handled), so start again at 2 hours.
  // Otherwise keep the run: a notification arriving mid-run must not restart
  // the waits.
  const startOver = (await unreadCount(userId)) <= 1;
  await _agenda
    .create(UNREAD_REMINDER_JOB, { userId, step: 0 })
    .unique({ name: UNREAD_REMINDER_JOB, 'data.userId': userId }, { insertOnly: !startOver })
    .schedule(new Date(Date.now() + unreadReminderDelayMs(0)))
    .save();
}

/** Stop the reminders once nothing is unread, so the next notification starts again at 2 hours. */
export async function stopUnreadRemindersIfAllRead(userId) {
  if (!_agenda || (await unreadCount(userId)) > 0) return;
  await _agenda.cancel({ name: UNREAD_REMINDER_JOB, data: { userId } });
  // A notification that arrived between the count and the cancel lost its
  // job to the cancel; start it again.
  if ((await unreadCount(userId)) > 0) await startUnreadReminders(userId);
}
