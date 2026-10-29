/**
 * Window event fired when a notification is marked read outside the
 * Notifications page (tapping its push), so an open inbox can update the row.
 * `detail` is `{ id }`.
 */
export const NOTIFICATION_READ_EVENT = 'timehuddle:notificationRead';
