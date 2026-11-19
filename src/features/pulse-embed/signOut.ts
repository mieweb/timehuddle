/**
 * Unsent Pulse videos at sign-out (PLAN §5.1 Sign-out, Q4, O7, AD25; TH-9).
 *
 * - Only a sign-out the person starts (the user menu, Settings' Sign out)
 *   asks: "3 videos haven't been sent: Send now / Keep for next sign-in /
 *   Delete". On a shared phone (any of the person's teams has "Shared
 *   phones" on) it reads "This phone is shared, so 3 unsent videos will be
 *   deleted: Send now / Delete and sign out / Cancel".
 * - Every other sign-out (a password change, the username gate, the session
 *   expiring) keeps the drafts: Pulse closes from Huddle's side and the take
 *   is kept (usePulseEmbed's `setPulseAccount(null)`). On a shared phone a
 *   session the server ended deletes them instead, and a take open at that
 *   moment is discarded, with a notice on the sign-in screen.
 * - Deleting the account purges this account's videos from the phone.
 *
 * The decision is pure (`decideSignOut`); the steps that act on Pulse never
 * reject, so a sign-out always goes on whatever Pulse answers. Nothing here
 * imports Pulse's client at runtime: the session module reports through it.
 */
import type { DraftState, DraftSummary, PulseClient } from '@mieweb/pulse-embed';

import type { PulseTeamSettings } from '../../lib/api';
import { setPulseAccount } from './usePulseEmbed';

// ─── Words ────────────────────────────────────────────────────────────────────

const videos = (n: number) => (n === 1 ? '1 video' : `${n} videos`);

/** Every word the sign-out warning and its notices say, kept together for translation. */
export const SIGN_OUT_TEXT = {
  title: (n: number) => `${videos(n)} ${n === 1 ? "hasn't" : "haven't"} been sent`,
  personalBody: 'Kept videos stay on this phone, and only you see them when you sign in again.',
  sharedTitle: (n: number) =>
    `This phone is shared, so ${n === 1 ? '1 unsent video' : `${n} unsent videos`} will be deleted`,
  sharedBody: 'Send them now to keep them.',
  sendNow: 'Send now',
  sending: 'Sending…',
  keep: 'Keep for next sign-in',
  delete: 'Delete',
  deleteAndSignOut: 'Delete and sign out',
  deleting: 'Deleting…',
  cancel: 'Cancel',
  signOut: 'Sign out',
  offline: "You're offline. Videos will send next time you sign in.",
  /** Send now queued what it could; these stay on this phone. */
  notSent: (n: number) =>
    `${videos(n)} couldn't be sent and ${n === 1 ? 'is' : 'are'} still on this phone.`,
  /** Send now couldn't read the videos on this phone. */
  sendFailed: "The videos couldn't be sent. They're still on this phone.",
  deleteFailed: "The videos couldn't be deleted. Try again.",
  /** A shared phone's session ended while a take was open. */
  discardedOnExpiry: 'Signed out. The recording was deleted because this phone is shared.',
  /** A shared phone's session ended while a take was open, with other unsent videos too. */
  discardedAndDeletedOnExpiry: (n: number) =>
    `Signed out. The recording and ${videos(n)} that ${n === 1 ? "wasn't" : "weren't"} sent were deleted because this phone is shared.`,
  /** A shared phone's session ended with unsent videos. */
  deletedOnExpiry: (n: number) =>
    `Signed out. ${videos(n)} that ${n === 1 ? "wasn't" : "weren't"} sent ${
      n === 1 ? 'was' : 'were'
    } deleted because this phone is shared.`,
  dismiss: 'Dismiss',
};

// ─── The decision ─────────────────────────────────────────────────────────────

/**
 * Who ended the session:
 * - `user`: the person tapped Sign out (the user menu, Settings);
 * - `programmatic`: the app signed out (a password change, the username gate);
 * - `expiry`: the session ended without this page asking (expired, revoked);
 * - `accountDeleted`: the person deleted their account.
 */
export type SignOutInitiator = 'user' | 'programmatic' | 'expiry' | 'accountDeleted';

export interface SignOutFacts {
  initiator: SignOutInitiator;
  /** Pulse is ready for the signed-in account on this phone. */
  available: boolean;
  /** Any of the person's teams has "Shared phones" on (O7). */
  shared: boolean;
  /** `usage().unsent`; null when it couldn't be read. */
  unsent: number | null;
  online: boolean;
}

/** What "Send now" does: queue every unsent video, or (offline) keep them with a notice. */
export type SendNowMode = 'queue' | 'offline';

export type SignOutPlan =
  /** Sign out as without Pulse: the drafts are kept, and an open take is kept. */
  | { kind: 'signOut' }
  /** Ask first (the dialog). */
  | { kind: 'ask'; variant: 'personal' | 'shared'; unsent: number; sendNow: SendNowMode }
  /** Shared phone, session ended: discard an open take and delete the unsent videos. */
  | { kind: 'discard' }
  /** Account deleted: purge this account's videos from the phone. */
  | { kind: 'purge' };

export const sendNowMode = (online: boolean): SendNowMode => (online ? 'queue' : 'offline');

export function decideSignOut(facts: SignOutFacts): SignOutPlan {
  if (!facts.available) return { kind: 'signOut' };
  switch (facts.initiator) {
    case 'accountDeleted':
      return { kind: 'purge' };
    case 'programmatic':
      return { kind: 'signOut' };
    case 'expiry':
      return facts.shared ? { kind: 'discard' } : { kind: 'signOut' };
    case 'user': {
      // An unknown count keeps the drafts: nothing is lost by not asking.
      if (facts.unsent === null || facts.unsent <= 0) return { kind: 'signOut' };
      return {
        kind: 'ask',
        variant: facts.shared ? 'shared' : 'personal',
        unsent: facts.unsent,
        sendNow: sendNowMode(facts.online),
      };
    }
  }
}

/** Any of the person's teams has "Shared phones" on (O7: per team, any one counts). */
export function anyTeamSharedDevice(
  teams: Readonly<Record<string, Partial<PulseTeamSettings>>> | null,
): boolean {
  return !!teams && Object.values(teams).some((settings) => settings?.pulseSharedDevice === true);
}

// ─── Send now ─────────────────────────────────────────────────────────────────

/** States "Send now" queues (a failed one is tried again, as Send from the list does). */
const SENDABLE: ReadonlySet<DraftState> = new Set(['draft', 'ready', 'failed']);
/** States already on their way (a paused job resumes at the next sign-in of this account). */
const ON_THE_WAY: ReadonlySet<DraftState> = new Set([
  'preparing',
  'queued',
  'waiting_network',
  'uploading',
  'delivering',
  'needs_credentials',
]);

export interface SendNowPlan {
  /** Drafts to queue with `upload(id)`. */
  send: string[];
  /** Already queued or uploading. */
  onTheWay: number;
  /** In a state this build doesn't know (a newer Pulse): left as it is. */
  stuck: number;
}

export function planSendNow(drafts: readonly DraftSummary[]): SendNowPlan {
  const plan: SendNowPlan = { send: [], onTheWay: 0, stuck: 0 };
  for (const draft of drafts) {
    if (draft.state === 'sent') continue;
    if (SENDABLE.has(draft.state)) plan.send.push(draft.id);
    else if (ON_THE_WAY.has(draft.state)) plan.onTheWay += 1;
    else plan.stuck += 1;
  }
  return plan;
}

type SendClient = Pick<PulseClient, 'listDrafts' | 'upload'>;

/**
 * Queues every unsent draft. Resolves how many are not on their way: 0 means
 * every unsent video is queued or uploading, and the sign-out may go on;
 * null means the drafts couldn't be read (nothing was sent). Never rejects.
 */
export async function sendUnsent(client: SendClient): Promise<{ notSent: number | null }> {
  let drafts: DraftSummary[];
  try {
    drafts = await client.listDrafts();
  } catch (error) {
    console.warn('[pulse-embed] listDrafts at sign-out failed:', error);
    return { notSent: null };
  }
  const plan = planSendNow(drafts);
  const results = await Promise.allSettled(plan.send.map((id) => client.upload(id)));
  // `draft.locked`: it started sending meanwhile (preparing, uploading), so it is on its way.
  const refused = results.filter(
    (r): r is PromiseRejectedResult =>
      r.status === 'rejected' && (r.reason as { code?: unknown } | null)?.code !== 'draft.locked',
  );
  refused.forEach((r) => console.warn('[pulse-embed] upload at sign-out failed:', r.reason));
  return { notSent: plan.stuck + refused.length };
}

/** Deletes this account's videos from the phone. Resolves whether it did. */
export async function deleteUnsent(client: Pick<PulseClient, 'purge'>): Promise<boolean> {
  try {
    await client.purge();
    return true;
  } catch (error) {
    console.warn('[pulse-embed] purge at sign-out failed:', error);
    return false;
  }
}

// ─── Session ends (the session module reports here) ───────────────────────────

type EndClient = Pick<PulseClient, 'isOpen' | 'close' | 'usage' | 'purge'>;

/**
 * Shared phone, the session ended: discard an open take
 * (`close({reason: 'host', discard: true})`), then delete the unsent videos.
 * Resolves the notice to show on the sign-in screen, or null when nothing
 * was deleted. Never rejects.
 */
export async function discardOnSharedPhone(client: EndClient): Promise<string | null> {
  let open = false;
  try {
    open = await client.isOpen();
    if (open) await client.close({ reason: 'host', discard: true });
  } catch (error) {
    console.warn('[pulse-embed] discarding the open take failed:', error);
  }
  let unsent: number | null = null;
  try {
    unsent = (await client.usage()).unsent;
  } catch (error) {
    console.warn('[pulse-embed] usage at session end failed:', error);
  }
  // Unknown counts as some: a shared phone keeps nothing back.
  const purged = unsent !== 0 && (await deleteUnsent(client));
  if (open && purged && unsent) return SIGN_OUT_TEXT.discardedAndDeletedOnExpiry(unsent);
  if (open) return SIGN_OUT_TEXT.discardedOnExpiry;
  if (purged && unsent) return SIGN_OUT_TEXT.deletedOnExpiry(unsent);
  return null;
}

/** What the session-end path needs, kept fresh while someone is signed in (usePulseSignOut). */
export interface PulseSignOutSnapshot {
  userId: string;
  client: EndClient;
  shared: boolean;
}

let snapshot: PulseSignOutSnapshot | null = null;
/** The account last reported (null: signed out). */
let reported: string | null = null;
/** The server answered that no one is signed in (the session expired or was revoked). */
let serverEnded = false;
let order: Promise<void> = Promise.resolve();

let notice: string | null = null;
const listeners = new Set<() => void>();
function setNotice(next: string | null) {
  notice = next;
  listeners.forEach((listener) => listener());
}

/** The signed-in person's Pulse, as the app sees it. Kept after the app unmounts. */
export function rememberPulseForSignOut(next: PulseSignOutSnapshot | null): void {
  snapshot = next;
}

/**
 * The server refused the stored session (the session module calls this only
 * when the resume token was dropped by a refused login): the account going
 * away now is an expiry. Nothing else is (a `signOut` call, a network error
 * that leaves the token in place): those keep the drafts.
 *
 * Known gap: an expiry while the app is closed isn't seen here (this state
 * starts empty at launch), so a shared phone keeps that account's unsent
 * videos, unreadable to anyone else, until that account signs in again (the
 * PLAN §6.4 stale-namespace sweep skips namespaces with unsent drafts).
 */
export function noteSessionExpired(): void {
  serverEnded = true;
}

/**
 * The session's signed-in person (null: signed out), in order. A signed-in
 * session the server ended (noteSessionExpired) is an expiry: on a shared
 * phone the open take is discarded and the unsent videos deleted before
 * Pulse forgets the account. Otherwise this is `setPulseAccount`.
 */
export function reportPulseAccount(userId: string | null): Promise<void> {
  order = order.then(async () => {
    const previous = reported;
    const expired = userId === null && previous !== null && serverEnded;
    reported = userId;
    serverEnded = false;
    if (userId) setNotice(null);
    const mine = snapshot && snapshot.userId === previous ? snapshot : null;
    if (expired && mine) {
      const plan = decideSignOut({
        initiator: 'expiry',
        available: true,
        shared: mine.shared,
        unsent: null,
        online: true,
      });
      if (plan.kind === 'discard') setNotice(await discardOnSharedPhone(mine.client));
    }
    await setPulseAccount(userId);
  });
  // The next report still runs if this one failed.
  order = order.catch((error) =>
    console.warn('[pulse-embed] reporting the account failed:', error),
  );
  return order;
}

/** The notice for the sign-in screen (a shared phone's session ended), or null. */
export const pulseSignOutNotice = (): string | null => notice;

export function dismissPulseSignOutNotice(): void {
  setNotice(null);
}

export function subscribePulseSignOutNotice(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Tests only. */
export function resetPulseSignOut(): void {
  snapshot = null;
  reported = null;
  serverEnded = false;
  order = Promise.resolve();
  notice = null;
  listeners.clear();
}
