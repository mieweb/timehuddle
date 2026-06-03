/**
 * ShiftReminderContext — global provider for the shift-end reminder modal.
 *
 * Mounts once in AppLayoutContent so the modal is reachable from every page.
 * When a `shift-end-reminder` notification arrives via the WebSocket stream the
 * modal pops up automatically, regardless of which page the user is on.
 *
 * Architecture:
 * - Shift reminders are broadcast-only (NOT persisted to the notification inbox).
 * - "Continue Working" is a pure UI action — no API call needed.
 * - "Agree to Clock Out" calls POST /v1/clock/events/:id/agree-clockout which
 *   sets a flag on the clock event; the clock-monitor job fires the clockout at 8h.
 */
import {
  Button,
  Modal,
  ModalBody,
  ModalClose,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Text,
} from '@mieweb/ui';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

import { ApiError, notificationApi, type Notification } from '../../lib/api';
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
  const [pendingNotif, setPendingNotif] = useState<Notification | null>(null);
  const [respondLoading, setRespondLoading] = useState(false);
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

  useEffect(() => {
    if (!user) return;

    const ws = notificationApi.openStream();
    ws.onmessage = (e) => {
      try {
        const n = JSON.parse(e.data) as Notification;
        if (n.data?.type !== 'shift-end-reminder') return;
        const clockEventId = n.data?.clockEventId as string | undefined;
        const dedupeKey = clockEventId ?? n.id;
        if (shownIds.current.has(dedupeKey)) return;
        shownIds.current.add(dedupeKey);
        setPendingNotif(n);
        setRespondError(null);
      } catch {
        /* ignore malformed frames */
      }
    };
    return () => ws.close();
  }, [user]);

  const openModal = useCallback((notif: Notification) => {
    const clockEventId = notif.data?.clockEventId as string | undefined;
    const dedupeKey = clockEventId ?? notif.id;
    shownIds.current.add(dedupeKey);
    setPendingNotif(notif);
    setRespondError(null);
  }, []);

  const closeModal = useCallback(() => {
    setPendingNotif(null);
    setRespondError(null);
  }, []);

  const handleAction = useCallback(
    async (action: 'agree' | 'disagree') => {
      if (!pendingNotif) return;

      if (action === 'disagree') {
        // "Continue Working" — purely local, no server call.
        closeModal();
        return;
      }

      // "Agree to Clock Out" — persist the flag so the job can fire at 8h.
      const clockEventId = pendingNotif.data?.clockEventId as string | undefined;
      if (!clockEventId) {
        closeModal();
        return;
      }

      setRespondLoading(true);
      try {
        await notificationApi.agreeClockout(clockEventId);
        closeModal();
      } catch (err: unknown) {
        // 404 means the clock event is already ended (e.g. cleaned up by a test
        // or the user clocked out another way). Nothing to agree to — dismiss silently.
        if (err instanceof ApiError && err.status === 404) {
          closeModal();
          return;
        }
        setRespondError(err instanceof Error ? err.message : 'Failed to process response');
      } finally {
        setRespondLoading(false);
      }
    },
    [pendingNotif, closeModal],
  );

  return (
    <ShiftReminderContext.Provider value={{ openModal, closeModal }}>
      {children}

      <Modal open={!!pendingNotif} onOpenChange={(open) => !open && closeModal()} size="lg">
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
            aria-label="Continue working — stay clocked in"
          >
            Continue Working
          </Button>
          <Button
            variant="primary"
            onClick={() => handleAction('agree')}
            isLoading={respondLoading}
            aria-label="Agree to auto clock out at 8 hours"
          >
            Agree to Clock Out
          </Button>
        </ModalFooter>
      </Modal>
    </ShiftReminderContext.Provider>
  );
};
