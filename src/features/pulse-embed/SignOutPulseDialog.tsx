/**
 * The sign-out warning for unsent Pulse videos (PLAN §5.1 Sign-out; TH-9),
 * and the notice a shared phone shows after its session ended.
 *
 * - `SignOutPulseDialog` only shows: a variant, a count, a step and the
 *   person's choices as callbacks.
 * - `usePulseSignOut` is what the user menu and Settings call instead of the
 *   session's `signOut`: it reads this account's unsent count, signs out at
 *   once when there is nothing to ask (no Pulse, nothing unsent), and
 *   otherwise runs the dialog. It also keeps signOut.ts's snapshot fresh, so
 *   a session that ends on its own still knows whether this phone is shared.
 * - `PulseSignOutNotice` is mounted by the session, outside the app, so it
 *   shows on the sign-in screen.
 */
import {
  Alert,
  AlertDescription,
  Button,
  ButtonGroup,
  ModalBody,
  ModalClose,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Text,
} from '@mieweb/ui';
import type { PulseClient } from '@mieweb/pulse-embed';
import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

import { AppModal } from '../../ui/AppModal';
import {
  anyTeamSharedDevice,
  decideSignOut,
  deleteUnsent,
  dismissPulseSignOutNotice,
  pulseSignOutNotice,
  rememberPulseForSignOut,
  sendNowMode,
  sendUnsent,
  SIGN_OUT_TEXT,
  subscribePulseSignOutNotice,
} from './signOut';
import { usePulseEmbed } from './usePulseEmbed';

// ─── The dialog ───────────────────────────────────────────────────────────────

export type SignOutDialogStep =
  /** The person chooses. */
  | 'choose'
  /** Send now is queueing the videos. */
  | 'sending'
  /** Delete is removing them. */
  | 'deleting'
  /** Send now while offline: the videos are kept, and the person signs out or stays. */
  | 'offline';

export interface SignOutPulseDialogProps {
  open: boolean;
  variant: 'personal' | 'shared';
  /** Unsent videos on this phone for this account. */
  unsent: number;
  step: SignOutDialogStep;
  /** What went wrong with the last choice (announced), or null. */
  error: string | null;
  onSendNow: () => void;
  /** Personal: Keep for next sign-in. Offline step: Sign out (the videos are kept). */
  onKeep: () => void;
  onDelete: () => void;
  onCancel: () => void;
}

export function SignOutPulseDialog({
  open,
  variant,
  unsent,
  step,
  error,
  onSendNow,
  onKeep,
  onDelete,
  onCancel,
}: SignOutPulseDialogProps) {
  const busy = step === 'sending' || step === 'deleting';
  const shared = variant === 'shared';
  const title = shared ? SIGN_OUT_TEXT.sharedTitle(unsent) : SIGN_OUT_TEXT.title(unsent);
  const body = shared ? SIGN_OUT_TEXT.sharedBody : SIGN_OUT_TEXT.personalBody;

  const sendNow = (
    <Button
      type="button"
      variant="primary"
      onClick={onSendNow}
      disabled={busy}
      isLoading={step === 'sending'}
      loadingText={SIGN_OUT_TEXT.sending}
    >
      {SIGN_OUT_TEXT.sendNow}
    </Button>
  );
  const remove = (
    <Button
      type="button"
      variant="danger"
      onClick={onDelete}
      disabled={busy}
      isLoading={step === 'deleting'}
      loadingText={SIGN_OUT_TEXT.deleting}
    >
      {shared ? SIGN_OUT_TEXT.deleteAndSignOut : SIGN_OUT_TEXT.delete}
    </Button>
  );
  const cancel = (
    <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
      {SIGN_OUT_TEXT.cancel}
    </Button>
  );

  let actions: React.ReactNode;
  if (step === 'offline') {
    actions = (
      <>
        {cancel}
        <Button type="button" variant="primary" onClick={onKeep}>
          {SIGN_OUT_TEXT.signOut}
        </Button>
      </>
    );
  } else if (shared) {
    actions = (
      <>
        {cancel}
        {remove}
        {sendNow}
      </>
    );
  } else {
    actions = (
      <>
        {remove}
        <Button type="button" variant="outline" onClick={onKeep} disabled={busy}>
          {SIGN_OUT_TEXT.keep}
        </Button>
        {sendNow}
      </>
    );
  }

  // On the body: the user menu sits in the sticky header, whose layer would
  // otherwise cover the dialog.
  return createPortal(
    <AppModal
      open={open}
      onOpenChange={(next) => !next && !busy && onCancel()}
      size="md"
      closeOnOverlayClick={!busy}
      closeOnEscape={!busy}
    >
      <ModalHeader>
        <ModalTitle>{title}</ModalTitle>
        <ModalClose aria-label={SIGN_OUT_TEXT.cancel} disabled={busy} />
      </ModalHeader>
      <ModalBody className="sign-out-pulse-dialog flex flex-col gap-3">
        <Text size="sm" variant="muted">
          {body}
        </Text>
        {/* Always mounted, so a notice placed in it is announced. */}
        <div role="status" aria-live="polite" className="sign-out-pulse-status">
          {step === 'offline' && (
            <Alert variant="warning" role="none">
              <AlertDescription>{SIGN_OUT_TEXT.offline}</AlertDescription>
            </Alert>
          )}
        </div>
        {error && (
          <Alert variant="danger" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </ModalBody>
      <ModalFooter>
        <ButtonGroup>{actions}</ButtonGroup>
      </ModalFooter>
    </AppModal>,
    document.body,
  );
}

// ─── The hook the sign-out buttons use ────────────────────────────────────────

export interface UsePulseSignOutOptions {
  /** The signed-in person (useSession's user id). */
  userId: string | null;
  /** The session's `signOut`. */
  signOut: () => Promise<void>;
  /** Default: `navigator.onLine`. */
  online?: () => boolean;
  /** How long Sign out waits for a fresh count before it uses the last one. Default 2 s. */
  usageWaitMs?: number;
}

export interface PulseSignOut {
  /** The person tapped Sign out: warn about unsent videos, or sign out at once. */
  requestSignOut: () => Promise<void>;
  /** The account was deleted: purge its videos from this phone (call before signing out). */
  purgeDeletedAccount: () => Promise<void>;
  /** The warning; render it next to the Sign out control. */
  dialog: React.ReactNode;
}

interface Asking {
  variant: 'personal' | 'shared';
  unsent: number;
  step: SignOutDialogStep;
  error: string | null;
}

const navigatorOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine);

/** `usage().unsent`, or `fallback` when Pulse fails or doesn't answer within `waitMs`. */
function freshUnsent(
  client: PulseClient,
  fallback: number | null,
  waitMs: number,
): Promise<number | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    client.usage().then(
      (usage) => usage.unsent,
      () => fallback,
    ),
    new Promise<number | null>((resolve) => {
      timer = setTimeout(() => resolve(fallback), waitMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

export function usePulseSignOut({
  userId,
  signOut,
  online = navigatorOnline,
  usageWaitMs = 2000,
}: UsePulseSignOutOptions): PulseSignOut {
  const embed = usePulseEmbed();
  const client = embed.status === 'ready' ? embed.client : null;
  const shared = anyTeamSharedDevice(embed.teams);
  const knownUnsent = embed.usage?.unsent ?? null;

  // For a session that ends on its own, after the app has unmounted.
  useEffect(() => {
    if (userId && client) rememberPulseForSignOut({ userId, client, shared });
  }, [userId, client, shared]);

  const [asking, setAsking] = useState<Asking | null>(null);
  const live = useRef({ client, shared, knownUnsent, signOut, online, usageWaitMs });
  live.current = { client, shared, knownUnsent, signOut, online, usageWaitMs };

  const finish = useCallback(async () => {
    setAsking(null);
    await live.current.signOut();
  }, []);

  const requestSignOut = useCallback(async () => {
    const { client: c, shared: isShared, knownUnsent: known, online: isOnline } = live.current;
    // A fresh count: the provider's is read a moment after each change.
    const unsent = c ? await freshUnsent(c, known, live.current.usageWaitMs) : known;
    const plan = decideSignOut({
      initiator: 'user',
      available: c !== null,
      shared: isShared,
      unsent,
      online: isOnline(),
    });
    if (plan.kind !== 'ask') {
      await finish();
      return;
    }
    setAsking({ variant: plan.variant, unsent: plan.unsent, step: 'choose', error: null });
  }, [finish]);

  const purgeDeletedAccount = useCallback(async () => {
    const c = live.current.client;
    const plan = decideSignOut({
      initiator: 'accountDeleted',
      available: c !== null,
      shared: live.current.shared,
      unsent: null,
      online: true,
    });
    if (plan.kind === 'purge' && c) await deleteUnsent(c);
  }, []);

  const onSendNow = useCallback(async () => {
    const c = live.current.client;
    if (!c) return finish();
    if (sendNowMode(live.current.online()) === 'offline') {
      setAsking((prev) => prev && { ...prev, step: 'offline', error: null });
      return;
    }
    setAsking((prev) => prev && { ...prev, step: 'sending', error: null });
    const { notSent } = await sendUnsent(c);
    if (notSent === 0) return finish();
    setAsking(
      (prev) =>
        prev && {
          ...prev,
          step: 'choose',
          error: notSent === null ? SIGN_OUT_TEXT.sendFailed : SIGN_OUT_TEXT.notSent(notSent),
        },
    );
  }, [finish]);

  const onDelete = useCallback(async () => {
    const c = live.current.client;
    if (!c) return finish();
    setAsking((prev) => prev && { ...prev, step: 'deleting', error: null });
    if (await deleteUnsent(c)) return finish();
    setAsking((prev) => prev && { ...prev, step: 'choose', error: SIGN_OUT_TEXT.deleteFailed });
  }, [finish]);

  const dialog = asking ? (
    <SignOutPulseDialog
      open
      variant={asking.variant}
      unsent={asking.unsent}
      step={asking.step}
      error={asking.error}
      onSendNow={() => void onSendNow()}
      onKeep={() => void finish()}
      onDelete={() => void onDelete()}
      onCancel={() => setAsking(null)}
    />
  ) : null;

  return { requestSignOut, purgeDeletedAccount, dialog };
}

// ─── The notice on the sign-in screen ─────────────────────────────────────────

/** "Signed out. The recording was deleted because this phone is shared." Mounted by the session. */
export function PulseSignOutNotice() {
  const notice = useSyncExternalStore(
    subscribePulseSignOutNotice,
    pulseSignOutNotice,
    pulseSignOutNotice,
  );
  if (!notice) return null;
  return (
    <div className="pulse-sign-out-notice fixed inset-x-4 top-[calc(env(safe-area-inset-top)+1rem)] z-50 mx-auto max-w-md">
      <Alert
        variant="warning"
        dismissible
        onDismiss={dismissPulseSignOutNotice}
        dismissLabel={SIGN_OUT_TEXT.dismiss}
      >
        <AlertDescription>{notice}</AlertDescription>
      </Alert>
    </div>
  );
}
