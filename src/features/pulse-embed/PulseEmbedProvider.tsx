/**
 * Starts Pulse for the signed-in person and keeps it in step with TimeHuddle
 * (PLAN §5.3, §6.3, §6.4; TH-7). Mounted once in AppLayout, so it runs only
 * while someone is signed in, and only in the native app (or a fake-Pulse
 * test build): in a browser it never touches Pulse.
 *
 * On start, in this order:
 *  1. find the plugin (`isAvailable`); without one, Pulse stays hidden;
 *  2. `configure` (TimeHuddle's host id and name, uploads through Huddle, the
 *     brand's look, share and Save to Photos on, captions model on Wi-Fi) and
 *     hand Pulse Huddle's upload services (grants.ts);
 *  3. `setAccount` for the signed-in person, before any read;
 *  4. drain the results inbox (a flow that ended across a WebView reload),
 *     acknowledging each result once;
 *  5. read `pulseUploadTypes.list` and, unless Pulse is paused for everyone
 *     (AD34), `resumeOutbox`, `prewarm` and purge stale namespaces. The
 *     "Pulse in the app" setting never stops this (AD25).
 * On every return to the foreground it drains the inbox and resumes again.
 */
import { useOptionalToast } from '@mieweb/ui';
import type {
  ConfigureOptions,
  FlowResult,
  HostServices,
  OpenRequest,
  PulseAccount,
  PulseClient,
  PulseInfo,
  ThemeBridge,
  Usage,
} from '@mieweb/pulse-embed';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  pulseUploadApi,
  type PulseTeamSettings,
  type PulseUploadTypeInfo,
  type PulseUploadTypesList,
} from '../../lib/api';
import { isNativeApp } from '../../lib/device';
import { useTeam } from '../../lib/TeamContext';
import { useRouter } from '../../ui/router';
import { MEDIA_TEXT } from '../media/mediaStrings';
import { MEDIA_PATH } from '../media/mediaVisibility';
import { getPulse } from './client';
import { createGrants } from './grants';
import { PULSE_HOST_ID, staleNamespaces } from './namespaces';
import { createNavigationQueue, type Navigate } from './navigationQueue';
import { PULSE_EMBED_TEXT } from './pulseEmbedStrings';
import { pulseErrorCopy } from './pulseErrors';
import { installTestAdapter, pulseFakeEnabled } from './testAdapter';
import {
  attachPulseAccount,
  PulseEmbedContext,
  retryPulseAccount,
  type PulseEmbed,
  type PulseEmbedStatus,
} from './usePulseEmbed';
import { backgroundWorkAllowed, pulseSurfacesVisible, recordingAllowed } from './visibility';

// ─── Look (F6) ────────────────────────────────────────────────────────────────

const HEX_RE = /^#[0-9a-f]{6}$/i;

/** A computed CSS colour as '#rrggbb', or undefined when it isn't an opaque sRGB colour. */
export function cssColorToHex(color: string): string | undefined {
  const value = color.trim();
  if (HEX_RE.test(value)) return value.toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
  if (short)
    return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i.exec(value);
  if (!rgb) return undefined;
  if (rgb[4] !== undefined && parseFloat(rgb[4]) < (rgb[4].endsWith('%') ? 100 : 1)) {
    return undefined;
  }
  return `#${[rgb[1], rgb[2], rgb[3]]
    .map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0'))
    .join('')}`;
}

/** The brand's look, read from its CSS tokens (never a hard-coded colour). */
export function pulseTheme(doc: Document | undefined = globalThis.document): ThemeBridge {
  if (!doc?.body) return {};
  const probe = doc.createElement('span');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText =
    'position:absolute;width:0;height:0;overflow:hidden;color:var(--color-primary);' +
    'background-color:var(--color-destructive);border-radius:var(--mieweb-radius-md)';
  doc.body.appendChild(probe);
  try {
    const style = getComputedStyle(probe);
    const theme: ThemeBridge = {
      appearance: doc.documentElement.classList.contains('dark') ? 'dark' : 'light',
    };
    const accent = cssColorToHex(style.color);
    const destructive = cssColorToHex(style.backgroundColor);
    const radius = parseFloat(style.borderTopLeftRadius);
    if (accent) theme.accent = accent;
    if (destructive) theme.destructive = destructive;
    if (Number.isFinite(radius) && radius > 0) theme.buttonRadius = radius;
    return theme;
  } finally {
    probe.remove();
  }
}

/** What TimeHuddle tells Pulse once per WebView load. */
export function pulseConfigureOptions(theme: ThemeBridge = pulseTheme()): ConfigureOptions {
  return {
    hostId: PULSE_HOST_ID,
    hostName: PULSE_EMBED_TEXT.hostName,
    uploadMode: 'pulse',
    theme,
    policy: { allowShare: true, allowSaveToPhotos: true },
    // O6: the captions model downloads on Wi-Fi the first time Pulse opens.
    captions: { autoDownload: 'wifi' },
  };
}

// ─── Provider ─────────────────────────────────────────────────────────────────

/** How long after the last draft change usage is read again. */
const USAGE_DEBOUNCE_MS = 500;

export interface PulseEmbedProviderProps {
  children: React.ReactNode;
  /**
   * Whether Pulse runs at all. Default: inside the native app, or in a
   * fake-Pulse test build. Never on the web or the desktop.
   */
  enabled?: boolean;
  /** Default: the page's client (`getPulse()`), after a test build installs its fake. */
  client?: PulseClient;
  /** Default: grants.ts for this client. */
  services?: HostServices;
  /** Default: `pulseUploadApi.types`. */
  loadTypes?: () => Promise<PulseUploadTypesList>;
  now?: () => number;
}

export const PulseEmbedProvider: React.FC<PulseEmbedProviderProps> = ({
  children,
  enabled = isNativeApp() || pulseFakeEnabled(),
  client: givenClient,
  services,
  loadTypes = pulseUploadApi.types,
  now = Date.now,
}) => {
  const toast = useOptionalToast();
  const { refetchClock } = useTeam();
  const { navigate: routerNavigate } = useRouter();

  const [status, setStatus] = useState<PulseEmbedStatus>(enabled ? 'starting' : 'off');
  const [client, setClient] = useState<PulseClient | null>(null);
  const [info, setInfo] = useState<PulseInfo | null>(null);
  const [account, setAccount] = useState<PulseAccount | null>(null);
  const [restartRequired, setRestartRequired] = useState(false);
  const [types, setTypes] = useState<PulseUploadTypeInfo[] | null>(null);
  const [teams, setTeams] = useState<Record<string, PulseTeamSettings> | null>(null);
  const [runtimePaused, setRuntimePaused] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  // What callbacks registered once read now.
  const live = useRef({ toast, refetchClock, loadTypes, now, restartRequired, routerNavigate });
  live.current = { toast, refetchClock, loadTypes, now, restartRequired, routerNavigate };
  /** The server's pause, as soon as it answers (state lags a render behind). */
  const pausedRef = useRef<boolean | null>(null);

  const clientRef = useRef<PulseClient | null>(null);
  const configuredRef = useRef(false);
  const handled = useRef(new Set<string>());
  const cleanedFor = useRef<string | null>(null);
  /** This page's `setAccount` has applied a signed-in account: usage may be read. */
  const accountApplied = useRef(false);

  const say = useCallback((message: string, variant: 'info' | 'error' = 'info') => {
    live.current.toast?.toast({ message, variant });
  }, []);

  const reportError = useCallback(
    (error: unknown) => {
      const shown = pulseErrorCopy(error);
      console.warn('[pulse-embed]', shown.code, error);
      say(shown.copy, 'error');
    },
    [say],
  );

  const queue = useMemo(
    () => createNavigationQueue({ onQueued: () => say(PULSE_EMBED_TEXT.flow.opensWhenDone) }),
    [say],
  );

  const readUsage = useCallback(async () => {
    const c = clientRef.current;
    // Before the account is applied (or while `setAccount` waits on a flow
    // left open across a reload) usage would count another account's videos.
    if (!c || !accountApplied.current) return;
    try {
      setUsage(await c.usage());
    } catch (error) {
      console.warn('[pulse-embed] usage failed:', error);
    }
  }, []);

  /** A flow's result, from `open`, the `flowResult` event or the inbox: handled once each. */
  const handleResult = useCallback(
    (result: FlowResult) => {
      if (handled.current.has(result.requestId)) return;
      handled.current.add(result.requestId);
      setIsOpen(false);
      if (result.status === 'completed' && result.mode === 'pulse') {
        say(PULSE_EMBED_TEXT.flow.sending(result.context?.label ?? ''));
      } else if (result.status === 'closed' && result.reason === 'user') {
        // "Saved to Unsent videos · View": View opens the Media page (§5.1 Back navigation).
        live.current.toast?.toast({
          message: PULSE_EMBED_TEXT.flow.kept,
          variant: 'info',
          action: {
            label: MEDIA_TEXT.view,
            onClick: () => queue.request(MEDIA_PATH, live.current.routerNavigate),
          },
        });
      } else if (result.status === 'failed') {
        reportError(result.error);
      }
      queue.flowEnded();
      // Acknowledged at once, even while this page's `setAccount` waits: the
      // result sits in the namespace the flow ran in, which is still active.
      void clientRef.current?.acknowledge(result.requestId).catch((error) => {
        // Unacknowledged, it comes back from the inbox at the next start, and is shown again.
        console.warn('[pulse-embed] acknowledge failed:', error);
      });
      // A `setAccount` refused as `busy` (the page reloaded under an open flow)
      // goes now; usage is read once it is applied.
      void retryPulseAccount()
        .catch((error) => console.warn('[pulse-embed] setAccount retry failed:', error))
        .then(readUsage);
    },
    [queue, readUsage, reportError, say],
  );

  const drainInbox = useCallback(async () => {
    const c = clientRef.current;
    if (!c) return;
    try {
      for (const result of await c.pendingResults()) handleResult(result);
    } catch (error) {
      console.warn('[pulse-embed] reading the results inbox failed:', error);
    }
  }, [handleResult]);

  /**
   * The server's word (types, team settings, the runtime pause), then the
   * background work it allows: resumeOutbox and prewarm. Resolves whether
   * background work is allowed.
   */
  const syncServer = useCallback(async (): Promise<boolean> => {
    const c = clientRef.current;
    if (!c) return false;
    let list: PulseUploadTypesList;
    try {
      list = await live.current.loadTypes();
    } catch (error) {
      // Offline or signed out: nothing wakes Pulse until the server answers.
      console.warn('[pulse-embed] pulseUploadTypes.list failed:', error);
      return false;
    }
    pausedRef.current = list.runtimePaused;
    setTypes(list.types);
    setTeams(list.teams);
    setRuntimePaused(list.runtimePaused);
    const facts = { available: true, runtimePaused: list.runtimePaused };
    if (!backgroundWorkAllowed(facts)) return false;
    await c.resumeOutbox().catch((error) => console.warn('[pulse-embed] resumeOutbox:', error));
    if (recordingAllowed({ ...facts, teams: list.teams, unsent: null })) {
      await c.prewarm().catch((error) => console.warn('[pulse-embed] prewarm:', error));
    }
    return true;
  }, []);

  /** Once per sign-in, when background work is allowed: purge stale namespaces (§6.4). */
  const purgeStale = useCallback(async (userId: string) => {
    const c = clientRef.current;
    if (!c || cleanedFor.current === userId) return;
    cleanedFor.current = userId;
    try {
      const stale = staleNamespaces(await c.listNamespaces(), live.current.now());
      for (const namespace of stale) {
        await c.purge({ namespace }).catch((error) => console.warn('[pulse-embed] purge:', error));
      }
    } catch (error) {
      console.warn('[pulse-embed] listNamespaces failed:', error);
    }
  }, []);

  // ── Start ──
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const offs: (() => void)[] = [];

    void (async () => {
      const c = givenClient ?? (await installTestAdapter(), getPulse());
      if (!alive) return;
      clientRef.current = c;
      offs.push(c.on('flowResult', handleResult));

      let available = false;
      try {
        available = await c.isAvailable();
      } catch {
        available = false;
      }
      if (!alive) return;
      if (!available) {
        setStatus('unavailable');
        return;
      }
      let pulseInfo: PulseInfo | null = null;
      try {
        pulseInfo = await c.getInfo();
        if (alive) setInfo(pulseInfo);
        await c.configure(pulseConfigureOptions());
      } catch (error) {
        console.warn('[pulse-embed] configure failed:', error);
        if (alive) setStatus('unavailable');
        return;
      }
      c.setHostServices(
        services ??
          createGrants({
            clientInfo: () =>
              pulseInfo
                ? {
                    appVersion: pulseInfo.sdkVersion,
                    contractVersion: `${pulseInfo.contract.major}.${pulseInfo.contract.minor}`,
                    platform: pulseInfo.platform,
                  }
                : null,
            // The server clocked in or out at Send: the clock state changed.
            onClockSend: () => live.current.refetchClock(),
          }),
      );
      configuredRef.current = true;

      let usageTimer: ReturnType<typeof setTimeout> | undefined;
      offs.push(
        c.on('draftsChanged', () => {
          clearTimeout(usageTimer);
          usageTimer = setTimeout(() => void readUsage(), USAGE_DEBOUNCE_MS);
        }),
        () => clearTimeout(usageTimer),
      );

      // The account first: the provider is ready (reads may run) once it is applied.
      await attachPulseAccount({
        client: c,
        queue,
        onApplied: (applied) => {
          if (!alive) return;
          accountApplied.current = applied !== null;
          setAccount(applied);
          if (applied) setClient(c);
        },
        onError: (error) => {
          if (!alive) return;
          if ((error as { code?: unknown } | null)?.code === 'restart_required') {
            setRestartRequired(true);
          }
          reportError(error);
        },
      });
      if (!alive) return;

      try {
        const open = await c.isOpen();
        queue.setOpen(open);
        setIsOpen(open);
      } catch {
        /* nothing open */
      }
    })();

    return () => {
      alive = false;
      offs.forEach((off) => off());
    };
    // Starts once per mount; the props are fixed for the app's life.
  }, [enabled]);

  // ── Once the account is applied: the inbox, the server, the usage ──
  const accountId = account?.userId ?? null;
  useEffect(() => {
    if (!configuredRef.current) return;
    if (!accountId) {
      // Signed out: no reads until the next account is applied.
      setStatus('starting');
      setUsage(null);
      return;
    }
    setStatus('ready');
    void (async () => {
      await drainInbox();
      if (await syncServer()) await purgeStale(accountId);
      await readUsage();
    })();
  }, [accountId, drainInbox, syncServer, purgeStale, readUsage]);

  // ── Back in the foreground: results that ended meanwhile, and the outbox ──
  useEffect(() => {
    if (status !== 'ready') return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void (async () => {
        await drainInbox();
        await syncServer();
        await readUsage();
      })();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [status, drainInbox, syncServer, readUsage]);

  const open = useCallback(
    async (request: OpenRequest): Promise<FlowResult | null> => {
      const c = clientRef.current;
      if (live.current.restartRequired) {
        reportError({ code: 'restart_required' });
        return null;
      }
      if (!c || !configuredRef.current) {
        reportError({ code: 'unavailable' });
        return null;
      }
      // Only a pause the server has stated refuses a flow. Unknown (offline
      // since launch) still opens: background work waits for the server
      // (visibility.ts), but the person's own tap may reach their drafts
      // offline, and record buttons stay hidden until the server has sent
      // the team settings (startPulse).
      if (pausedRef.current === true) {
        reportError({ code: 'runtime.paused' });
        return null;
      }
      queue.setOpen(true);
      setIsOpen(true);
      try {
        const result = await c.open({ ...request, theme: request.theme ?? pulseTheme() });
        handleResult(result);
        return result;
      } catch (error) {
        const stillOpen = await c.isOpen().catch(() => false);
        if (!stillOpen) {
          setIsOpen(false);
          queue.flowEnded();
        }
        reportError(error);
        return null;
      }
    },
    [handleResult, queue, reportError],
  );

  const navigate = useCallback(
    (path: string, go: Navigate) => {
      queue.request(path, go);
    },
    [queue],
  );

  const refresh = useCallback(() => {
    void syncServer();
    void readUsage();
  }, [syncServer, readUsage]);

  const value = useMemo<PulseEmbed>(() => {
    const ready = status === 'ready' && client !== null;
    return {
      status,
      client: ready ? client : null,
      info,
      restartRequired,
      runtimePaused,
      teams,
      types,
      usage,
      surfacesVisible: pulseSurfacesVisible({
        available: ready,
        teams,
        unsent: usage?.unsent ?? null,
      }),
      isOpen,
      open,
      navigate,
      reportError,
      refresh,
    };
  }, [
    status,
    client,
    info,
    restartRequired,
    runtimePaused,
    teams,
    types,
    usage,
    isOpen,
    open,
    navigate,
    reportError,
    refresh,
  ]);

  return <PulseEmbedContext.Provider value={value}>{children}</PulseEmbedContext.Provider>;
};
