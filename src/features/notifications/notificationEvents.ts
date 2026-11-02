import { notificationApi } from '../../lib/api';

/**
 * Window event fired when a notification is marked read outside the
 * Notifications page (tapping its pop-up), so an open inbox can update the row.
 * `detail` is `{ id }`.
 */
export const NOTIFICATION_READ_EVENT = 'timehuddle:notificationRead';

/**
 * Tapping a notification's pop-up opens what it's about; it should also mark it
 * read in the inbox. Used by every pop-up path: native and web push taps, the
 * in-app banner, and an open tab's own desktop alert (src/main.tsx).
 */
export function markTappedNotificationRead(data: { notificationId?: unknown; type?: unknown }) {
  const id = data.notificationId;
  if (typeof id !== 'string' || !id) return;
  // The shift-end prompt opens from unread reminders and marks its own read
  // once answered; reading it here first would stop the prompt opening.
  if (data.type === 'shift-end-reminder') return;
  notificationApi
    .markOneRead(id)
    // An open Notifications page only hears about new rows; tell it this one is read.
    .then(() => window.dispatchEvent(new CustomEvent(NOTIFICATION_READ_EVENT, { detail: { id } })))
    .catch((err) =>
      console.error('[notifications] marking the tapped notification read failed:', err),
    );
}
