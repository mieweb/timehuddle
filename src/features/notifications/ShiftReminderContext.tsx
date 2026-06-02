/**
 * ShiftReminderContext — global provider for the shift-end reminder modal.
 *
 * Mounts once in AppLayoutContent so the modal is reachable from every page.
 * When a `shift-end-reminder` notification arrives via the WebSocket stream the
 * modal pops up automatically, regardless of which page the user is on.
 *
 * NotificationsPage uses `useShiftReminder().openModal(notif)` when the user
 * manually taps an existing reminder row in the inbox.
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

import { notificationApi, type Notification } from '../../lib/api';
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

  // Deduplicate: track the last notification id we showed so a page reload
  // of the same SSE event doesn't re-open an already-dismissed modal.
  const shownIds = useRef<Set<string>>(new Set());

  // Global WebSocket listener — opens on sign-in, closes on sign-out.
  useEffect(() => {
    if (!user) return;

    const ws = notificationApi.openStream();
    ws.onmessage = (e) => {
      try {
        const n = JSON.parse(e.data) as Notification;
        if (
          n.data?.type === 'shift-end-reminder' &&
          !shownIds.current.has(n.id)
        ) {
          shownIds.current.add(n.id);
          setPendingNotif(n);
          setRespondError(null);
        }
      } catch {
        /* ignore malformed frames */
      }
    };
    return () => ws.close();
  }, [user]);

  const openModal = useCallback((notif: Notification) => {
    shownIds.current.add(notif.id);
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
      setRespondLoading(true);
      try {
        await notificationApi.respondToShiftReminder(pendingNotif.id, action);
        closeModal();
        // Broadcast so open inboxes can remove the notification from their list.
        window.dispatchEvent(
          new CustomEvent('timehuddle:shiftReminderHandled', {
            detail: { id: pendingNotif.id },
          }),
        );
      } catch (err: unknown) {
        setRespondError(
          err instanceof Error ? err.message : 'Failed to process response',
        );
      } finally {
        setRespondLoading(false);
      }
    },
    [pendingNotif, closeModal],
  );

  return (
    <ShiftReminderContext.Provider value={{ openModal, closeModal }}>
      {children}

      <Modal
        open={!!pendingNotif}
        onOpenChange={(open) => !open && closeModal()}
        size="lg"
      >
        <ModalHeader>
          <ModalTitle>Shift End Reminder</ModalTitle>
          <ModalClose />
        </ModalHeader>
        <ModalBody>
          <div className="space-y-3">
            <Text size="sm">{pendingNotif?.body}</Text>
            <Text size="sm" variant="muted">
              Agreeing will automatically clock you out when you reach 8 hours of work
              time. Choosing &ldquo;Continue Working&rdquo; will send another reminder in
              2 hours.
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
            isLoading={respondLoading}
            aria-label="Continue working — reminder in 2 hours"
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
