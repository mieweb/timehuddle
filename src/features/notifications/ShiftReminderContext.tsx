/**
 * ShiftReminderContext — global provider for the shift-end reminder modal.
 *
 * Mounts once in AppLayoutContent so the modal is reachable from every page.
 * The modal is triggered in two ways:
 *  1. Live SSE: a `shift-end-reminder` notification arrives on the WebSocket
 *     stream while the user's tab is open.
 *  2. Missed: on app load, we check the notification inbox for any unread
 *     `shift-end-reminder` notifications (i.e. the user was offline when the
 *     job fired). If found the modal pops up so they can still respond.
 *     If the 8-hour window has already elapsed, the server's `shift-missed-clockout`
 *     job will have auto-clocked them out, so no modal is shown in that case.
 *
 * Architecture:
 * - "Continue Working" calls `clock.respondShiftReminder` with 'disagree', which
 *   records the answer, cancels the 8h auto clock-out and deletes the reminder.
 * - "Agree to Clock Out" calls `clock.agreeAutoClockout`, which flags the clock
 *   event; the `shift-auto-clockout` job clocks the user out at 8h.
 * - Closing the modal without answering leaves the 8h auto clock-out in place.
 * - The modal also closes by itself when its clock session ends (e.g. the 8h
 *   auto clock-out fires while it is open).
 * - After agreeing, the persisted notification is marked as read so it
 *   doesn't reappear on the next session.
 */
import {
  Button,
  ModalBody,
  ModalClose,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Text,
} from '@mieweb/ui';
import { AppModal } from '@ui/AppModal';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

import { ApiError, notificationApi, type Notification } from '../../lib/api';
import { subscribeNewNotifications } from '../../lib/ddp';
import { useTeam } from '../../lib/TeamContext';
import { useSession } from '../../lib/useSession';

// ─── Context ──────────────────────────────────────────────────────────────────

interface ShiftReminderCtx {
  /** Open the modal for a specific notification (used by NotificationsPage on row click). */
  openModal: (notif: Notification) => void;
  /** Dismiss the modal without taking an action. */
  closeModal: () => void;
}

const ShiftReminderContext = createContext<ShiftReminderCtx>({
  openModal: () => {},
  closeModal: () => {},
});

export function useShiftReminder(): ShiftReminderCtx {
  return useContext(ShiftReminderContext);
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export const ShiftReminderProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useSession();
  const { activeClockEvent, clockReady } = useTeam();
  const [pendingNotif, setPendingNotif] = useState<Notification | null>(null);
  const [respondingTo, setRespondingTo] = useState<'agree' | 'disagree' | null>(null);
  const [respondError, setRespondError] = useState<string | null>(null);

  // Deduplicate by clockEventId so the same reminder isn't shown twice in a
  // single browser session (e.g. two WebSocket reconnections in the same tick).
  const shownIds = useRef<Set<string>>(new Set());

  // Global WebSocket listener — opens on sign-in, closes on sign-out.
  // Reset dedup set whenever user changes so stale event IDs from a previous
  // session don't block legitimate reminders for new sessions.
  useEffect(() => {
    shownIds.current = new Set();
  }, [user?.id]);

  // On mount (and whenever clock state is ready), check the notification inbox
  // for any unread shift-end-reminder that was persisted while the tab was
  // closed. This surfaces the "missed notification" modal on return.
  //
  // Guard: only show the modal if the user is *still clocked in* for that
  // event. If the clock event is already closed (shift-missed-clockout fired
  // while they were offline), the modal is meaningless and skipped.
  useEffect(() => {
    if (!user || !clockReady) return;
    let cancelled = false;
    notificationApi
      .getInbox()
      .then((notifications: Notification[]) => {
        if (cancelled) return;
        const missed = notifications.find(
          (n: Notification) => !n.read && n.data?.type === 'shift-end-reminder',
        );
        if (!missed) return;
        const clockEventId = missed.data?.clockEventId as string | undefined;
        // Skip if the clock event is already closed — auto-clockout already ran
        if (!activeClockEvent || activeClockEvent.id !== clockEventId) return;
        const dedupeKey = clockEventId ?? missed.id;
        if (shownIds.current.has(dedupeKey)) return;
        shownIds.current.add(dedupeKey);
        setPendingNotif(missed);
        setRespondError(null);
      })
      .catch(() => {
        /* silently ignore — the inbox may not be available yet */
      });
    return () => {
      cancelled = true;
    };
    // Re-run once clockReady flips to true so we have the authoritative clock state
  }, [user?.id, clockReady]);

  useEffect(() => {
    if (!user) return;

    return subscribeNewNotifications((n) => {
      if (n.data?.type !== 'shift-end-reminder') return;
      const clockEventId = n.data?.clockEventId as string | undefined;
      const dedupeKey = clockEventId ?? n.id;
      if (shownIds.current.has(dedupeKey)) return;
      shownIds.current.add(dedupeKey);
      setPendingNotif(n);
      setRespondError(null);
    });
  }, [user]);

  const openModal = useCallback((notif: Notification) => {
    const clockEventId = notif.data?.clockEventId as string | undefined;
    const dedupeKey = clockEventId ?? notif.id;
    shownIds.current.add(dedupeKey);
    setPendingNotif(notif);
    setRespondError(null);
  }, []);

  // Push notification tap (web SW postMessage or native Capacitor) dispatches
  // 'timehuddle:openShiftReminder' — find the matching inbox notification and open the modal.
  useEffect(() => {
    if (!user) return;
    const handler = (e: Event) => {
      const { clockEventId } = (e as CustomEvent<{ clockEventId?: string; teamId?: string }>)
        .detail;
      notificationApi
        .getInbox()
        .then((notifications: Notification[]) => {
          const match = notifications.find(
            (n) => n.data?.type === 'shift-end-reminder' && n.data?.clockEventId === clockEventId,
          );
          if (!match) return;
          const dedupeKey = clockEventId ?? match.id;
          // Allow re-opening via tap even if already deduped in this session
          shownIds.current.delete(dedupeKey);
          openModal(match);
        })
        .catch(() => {});
    };
    window.addEventListener('timehuddle:openShiftReminder', handler);
    return () => window.removeEventListener('timehuddle:openShiftReminder', handler);
  }, [user, openModal]);

  const closeModal = useCallback(() => {
    setPendingNotif(null);
    setRespondError(null);
  }, []);

  // The reminder is moot once its session ends (e.g. the 8h auto clock-out
  // fires while the modal is open), so dismiss it instead of leaving it up.
  const pendingClockEventId = pendingNotif?.data?.clockEventId as string | undefined;
  useEffect(() => {
    if (!pendingNotif || !clockReady) return;
    if (pendingClockEventId && activeClockEvent?.id !== pendingClockEventId) closeModal();
  }, [pendingNotif, pendingClockEventId, activeClockEvent?.id, clockReady, closeModal]);

  const handleAction = useCallback(
    async (action: 'agree' | 'disagree') => {
      if (!pendingNotif) return;

      // "Agree" needs the clock event; "Continue Working" answers the reminder itself.
      const clockEventId = pendingNotif.data?.clockEventId as string | undefined;
      if (action === 'agree' && !clockEventId) {
        closeModal();
        return;
      }

      setRespondingTo(action);
      try {
        if (action === 'agree') {
          await notificationApi.agreeClockout(clockEventId!);
          // Continue Working deletes the reminder server-side; agreeing keeps it, so mark it read.
          notificationApi.markOneRead(pendingNotif.id).catch(() => {});
        } else {
          await notificationApi.respondShiftReminder(pendingNotif.id, 'disagree');
        }
        closeModal();
      } catch (err: unknown) {
        // Already clocked out, or the reminder was answered elsewhere: nothing
        // left to answer — dismiss silently. The Meteor wormhole surfaces these
        // as a "not-found" / "already clocked out" reason on a 500.
        if (
          err instanceof ApiError &&
          (err.status === 404 || /not[-\s]?found|already clocked out/i.test(err.message))
        ) {
          closeModal();
          return;
        }
        setRespondError(err instanceof Error ? err.message : 'Failed to process response');
      } finally {
        setRespondingTo(null);
      }
    },
    [pendingNotif, closeModal],
  );

  return (
    <ShiftReminderContext.Provider value={{ openModal, closeModal }}>
      {children}

      <AppModal open={!!pendingNotif} onOpenChange={(open) => !open && closeModal()} size="lg">
        <ModalHeader>
          <ModalTitle>Shift End Reminder</ModalTitle>
          <ModalClose />
        </ModalHeader>
        <ModalBody>
          <div className="space-y-3">
            <Text size="sm">{pendingNotif?.body}</Text>
            <Text size="sm" variant="muted">
              Agreeing will automatically clock you out when you reach 8 hours. Choosing
              &ldquo;Continue Working&rdquo; will keep you clocked in.
            </Text>
            {respondError && (
              <Text size="sm" variant="destructive">
                {respondError}
              </Text>
            )}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button
            variant="outline"
            onClick={() => handleAction('disagree')}
            isLoading={respondingTo === 'disagree'}
            disabled={respondingTo !== null}
            aria-label="Continue working — stay clocked in"
          >
            Continue Working
          </Button>
          <Button
            variant="primary"
            onClick={() => handleAction('agree')}
            isLoading={respondingTo === 'agree'}
            disabled={respondingTo !== null}
            aria-label="Agree to auto clock out at 8 hours"
          >
            Agree to Clock Out
          </Button>
        </ModalFooter>
      </AppModal>
    </ShiftReminderContext.Provider>
  );
};
