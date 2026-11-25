import type { Notification } from '../../lib/api';

/**
 * The inbox list with one live notification applied. An auto clock-out notice
 * replaces its session's shift-end reminder on the server, and the live feed
 * only reports additions, so the reminder is dropped here too.
 */
export function applyLiveNotification(inbox: Notification[], incoming: Notification) {
  if (inbox.some((n) => n.id === incoming.id)) return inbox;
  const rest =
    incoming.data?.type === 'auto-clock-out'
      ? inbox.filter(
          (n) =>
            !(
              n.data?.type === 'shift-end-reminder' &&
              n.data?.clockEventId === incoming.data?.clockEventId
            ),
        )
      : inbox;
  return [incoming, ...rest];
}
