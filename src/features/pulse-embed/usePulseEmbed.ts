/**
 * Pulse in the app, as the rest of TimeHuddle reads it: the provider's state
 * (usePulseEmbed), queue-aware navigation (useQueuedNavigate), this phone's
 * drafts for a place (usePulseDrafts), and the signed-in account
 * (setPulseAccount, which the session calls).
 *
 * Nothing here imports Pulse's client at runtime, so the session module can
 * report the account without pulling Pulse into the first screen's bundle.
 */
import type {
  DraftFilter,
  DraftSummary,
  FlowResult,
  OpenRequest,
  PulseAccount,
  PulseClient,
  PulseInfo,
  Usage,
} from '@mieweb/pulse-embed';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

import { METEOR_API_BASE, type PulseTeamSettings, type PulseUploadTypeInfo } from '../../lib/api';
import { closeForSignOut, type Navigate, type NavigationQueue } from './navigationQueue';

// ─── The provider's state ─────────────────────────────────────────────────────

export type PulseEmbedStatus =
  /** Not the native app (a browser, the desktop): Pulse is never touched. */
  | 'off'
  /** Looking for the plugin, configuring, or waiting for the account. */
  | 'starting'
  /** No plugin (an older app build), or Pulse can't run on this device. */
  | 'unavailable'
  /** Configured, with the signed-in account applied: reads and flows may run. */
  | 'ready';

export interface PulseEmbed {
  status: PulseEmbedStatus;
  /** The client, once `ready`; null before. */
  client: PulseClient | null;
  info: PulseInfo | null;
  /** `setAccount` answered `restart_required`: recording needs the app reopened. */
  restartRequired: boolean;
  /** `pulseUploadTypes.list`: null until the server has answered. */
  runtimePaused: boolean | null;
  teams: Record<string, PulseTeamSettings> | null;
  types: PulseUploadTypeInfo[] | null;
  /** `usage()` of the signed-in account's namespace. */
  usage: Usage | null;
  /** The Unsent videos surfaces show (visibility.ts, §7.2). */
  surfacesVisible: boolean;
  /** Pulse has a flow on screen. */
  isOpen: boolean;
  /**
   * Open a Pulse flow. Resolves with its result, or null when it couldn't
   * open (the reason is already shown to the person).
   */
  open(request: OpenRequest): Promise<FlowResult | null>;
  /** Navigate, or hold the navigation while Pulse is open ("Opens when you finish"). */
  navigate(path: string, navigate: Navigate): void;
  /** Show a failed Pulse call to the person (pulseErrors.ts copy, in a toast). */
  reportError(error: unknown): void;
  /** Read the server's settings and Pulse's usage again. */
  refresh(): void;
}

export const PULSE_EMBED_OFF: PulseEmbed = Object.freeze({
  status: 'off',
  client: null,
  info: null,
  restartRequired: false,
  runtimePaused: null,
  teams: null,
  types: null,
  usage: null,
  surfacesVisible: false,
  isOpen: false,
  open: async () => null,
  navigate: (path: string, navigate: Navigate) => navigate(path),
  reportError: () => {},
  refresh: () => {},
});

export const PulseEmbedContext = createContext<PulseEmbed>(PULSE_EMBED_OFF);

/** Pulse in the app; `status: 'off'` outside the provider and outside the native app. */
export const usePulseEmbed = (): PulseEmbed => useContext(PulseEmbedContext);

/**
 * `navigate`, held while Pulse is open and applied when the flow ends (§5.3).
 * The same function outside the native app.
 */
export function useQueuedNavigate(navigate: Navigate): Navigate {
  const { navigate: queued } = usePulseEmbed();
  return useCallback((path: string) => queued(path, navigate), [queued, navigate]);
}

// ─── This phone's drafts ──────────────────────────────────────────────────────

export interface PulseDrafts {
  drafts: DraftSummary[];
  loading: boolean;
  error: unknown;
}

const NO_DRAFTS: PulseDrafts = { drafts: [], loading: false, error: null };

/**
 * The drafts (and receipts, when `filter.states` asks for them) on this phone
 * for a place, re-read whenever Pulse reports a change. Reads nothing until
 * the provider is ready: the signed-in account is applied first, so a read
 * never sees another account's drafts.
 */
export function usePulseDrafts(filter: DraftFilter | null): PulseDrafts {
  const { client, status } = usePulseEmbed();
  const ready = status === 'ready' && client !== null && filter !== null;
  const filterKey = JSON.stringify(filter);
  const [state, setState] = useState<PulseDrafts>(NO_DRAFTS);

  useEffect(() => {
    if (!ready || !client) {
      setState(NO_DRAFTS);
      return;
    }
    const wanted = JSON.parse(filterKey) as DraftFilter;
    let alive = true;
    let running = false;
    let again = false;
    // One read at a time; changes during a read make exactly one more
    // (upload progress comes several times a second).
    const load = async () => {
      if (running) {
        again = true;
        return;
      }
      running = true;
      do {
        again = false;
        try {
          const drafts = await client.listDrafts(wanted);
          if (alive) setState({ drafts, loading: false, error: null });
        } catch (error) {
          if (alive) setState((prev) => ({ ...prev, loading: false, error }));
        }
      } while (again && alive);
      running = false;
    };
    setState((prev) => ({ ...prev, loading: true }));
    const offs = [client.on('draftsChanged', load), client.on('uploadProgress', load)];
    void load();
    return () => {
      alive = false;
      offs.forEach((off) => off());
    };
  }, [ready, client, filterKey]);

  return state;
}

// ─── The signed-in account (called by the session) ────────────────────────────

interface AccountBinding {
  client: Pick<PulseClient, 'setAccount' | 'isOpen' | 'close'>;
  queue?: NavigationQueue | null;
  /** `setAccount` succeeded for `account` (null: signed out). */
  onApplied?: (account: PulseAccount | null) => void;
  /** `setAccount` failed (e.g. `restart_required`). */
  onError?: (error: unknown, account: PulseAccount | null) => void;
}

/** undefined: the session hasn't said yet. */
let wanted: PulseAccount | null | undefined;
let binding: AccountBinding | null = null;
/** The account each client has applied (its userId, or null when signed out). */
let appliedFor = new WeakMap<object, string | null>();
/**
 * The error `setAccount` answered when it applied `appliedFor`'s account
 * (`restart_required`), kept so a provider that attaches later hears it too:
 * the call may have gone through an unmounted provider's binding (one person
 * signed out and another signed in before the new provider started).
 */
let appliedWithError = new WeakMap<object, unknown>();
let chain: Promise<void> = Promise.resolve();
/** `setAccount` answered `busy`: it is tried again once the flow on screen ends. */
let waitingForFlow = false;
/** Bumped by resetPulseAccount, so a watch from before stops. */
let generation = 0;
let watching = false;

/** How often `isOpen` is asked while `setAccount` waits for a flow to end. */
export const FLOW_END_POLL_MS = 500;

/** The server's origin (scheme, host, port), which with the user id names the account. */
export function pulseServerOrigin(): string {
  const base =
    METEOR_API_BASE ||
    (typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
  try {
    return new URL(base, typeof window !== 'undefined' ? window.location.href : undefined).origin;
  } catch {
    return base;
  }
}

function sync(): Promise<void> {
  chain = chain.then(async () => {
    const b = binding;
    const account = wanted;
    if (!b || account === undefined) return;
    const key = account?.userId ?? null;
    if (appliedFor.has(b.client) && appliedFor.get(b.client) === key) {
      // Already applied on this client (a provider mounted again): say so,
      // with the error it was applied with.
      b.onApplied?.(account);
      if (appliedWithError.has(b.client)) b.onError?.(appliedWithError.get(b.client), account);
      return;
    }
    // Signed out or the session expired: Pulse closes from Huddle's side
    // first (the take is kept), then forgets the account (§5.3).
    if (account === null) await closeForSignOut(b.client, b.queue);
    try {
      await b.client.setAccount(account);
      waitingForFlow = false;
      appliedFor.set(b.client, key);
      appliedWithError.delete(b.client);
      b.onApplied?.(account);
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (code === 'busy') {
        // A flow is still on screen: the page reloaded (a capgo update) while
        // Pulse was open. Not a failure: the account is applied once the
        // flow ends (its result, or `isOpen` turning false), and nothing is
        // shown to the person meanwhile.
        waitingForFlow = true;
        watchForFlowEnd(b.client);
        return;
      }
      waitingForFlow = false;
      // After the runtime booted for another account the switch still takes
      // for reads; only recording waits for the app to reopen (§6.4).
      if (code === 'restart_required') {
        appliedFor.set(b.client, key);
        appliedWithError.set(b.client, error);
        b.onApplied?.(account);
      }
      b.onError?.(error, account);
    }
  });
  return chain;
}

/**
 * While `setAccount` waits on an open flow: ask `isOpen` every
 * FLOW_END_POLL_MS and try again once it is false. The flow's result
 * usually comes first (retryPulseAccount); this covers a result that no
 * event carried.
 */
function watchForFlowEnd(client: AccountBinding['client']): void {
  if (watching) return;
  watching = true;
  const mine = generation;
  void (async () => {
    let open = true;
    while (open && waitingForFlow && mine === generation && binding?.client === client) {
      await new Promise((resolve) => setTimeout(resolve, FLOW_END_POLL_MS));
      open = await client.isOpen().catch(() => false);
    }
    if (mine !== generation) return;
    watching = false;
    if (waitingForFlow) void sync();
  })();
}

/**
 * A Pulse flow ended (its result arrived): if `setAccount` was refused as
 * `busy` while the flow was on screen, apply the account now.
 */
export function retryPulseAccount(): Promise<void> {
  return waitingForFlow ? sync() : chain;
}

/**
 * The session's signed-in person, on sign-in, session restore, sign-out and
 * expiry (null). Pulse gets it before its first read; before Pulse has
 * started, it is held until the provider attaches.
 */
export function setPulseAccount(userId: string | null): Promise<void> {
  const next = userId ? { serverOrigin: pulseServerOrigin(), userId } : null;
  if (wanted !== undefined && (wanted?.userId ?? null) === (next?.userId ?? null)) return chain;
  wanted = next;
  return sync();
}

/**
 * The provider hands over its client: the account the session reported is
 * applied now, and later changes as they come. The binding stays after the
 * provider unmounts (the client is the page's), so a sign-out that unmounts
 * the app still reaches Pulse.
 */
export function attachPulseAccount(next: AccountBinding): Promise<void> {
  binding = next;
  return sync();
}

/** Tests only: forget every account and binding. */
export function resetPulseAccount(): void {
  wanted = undefined;
  binding = null;
  appliedFor = new WeakMap();
  appliedWithError = new WeakMap();
  chain = Promise.resolve();
  waitingForFlow = false;
  watching = false;
  generation += 1;
}
