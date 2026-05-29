/**
 * ATTIC — removed from TimeHuddle on 2026-06-01.
 * Reason: Jerry AI integration removed from app. Kept for reuse in other projects.
 * Original location: src/features/ai/OzwellWidget.tsx
 * Companion file: ozwell-tools.ts (also in .attic/)
 */

/**
 * OzwellWidget — mounts the Ozwell AI chat widget into the authenticated shell.
 *
 * Architecture:
 *   • Injects the CDN loader script once on mount (cleans up on unmount).
 *   • Syncs live context (user, team, page) via OzwellChat.updateContext()
 *     whenever those values change.
 *   • Handles all ozwell-tool-call DOM events dispatched by the widget when
 *     the AI calls a TimeHuddle tool.
 *
 * The widget renders itself (floating bubble, bottom-right). This component
 * returns null — no JSX output.
 *
 * To configure: set VITE_OZWELL_AGENT_KEY in your .env.local.
 * https://mieweb.github.io/ozwellai-api/frontend/cdn-embed
 */
import { useCallback, useEffect, useRef } from 'react';

import { clockApi, teamApi, ticketApi, timerApi } from '../../lib/api';
import { useSession } from '../../lib/useSession';
import { createTicketFromGithub, fetchGithubIssue, isGithubIssueUrl } from '../tickets/githubIssue';
import { useTeam } from '../../lib/TeamContext';
import { useRouter } from '../../ui/router';

/** Format a number of seconds into a human-readable string, e.g. "2h 15m" or "45m". */
function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

// ── Window interface augmentation ────────────────────────────────────────────

declare global {
  interface Window {
    OzwellChatConfig?: {
      apiKey: string;
      debug?: boolean;
      title?: string;
      placeholder?: string;
      welcomeMessage?: string;
      tools?: unknown[];
    };
    OzwellChat?: {
      open: () => void;
      close: () => void;
      updateContext: (ctx: Record<string, unknown>) => void;
    };
  }
}

// ── Tool call event type ─────────────────────────────────────────────────────

interface OzwellToolCallDetail {
  name: string;
  arguments: Record<string, unknown>;
  respond: (result: unknown) => void;
}

// ── OzwellWidget ─────────────────────────────────────────────────────────────

const LOADER_URL = 'https://ozwellapi.os.mieweb.org/embed/ozwell-loader.js';
const SCRIPT_ID = 'ozwell-loader';
const MOBILE_OVERRIDE_STYLE_ID = 'ozwell-mobile-override';
const JERRY_BUTTON_STYLE_ID = 'ozwell-jerry-button';
const JERRY_IFRAME_STYLE_ID = 'ozwell-jerry-iframe-style';
const JERRY_NUDGE_STYLE_ID = 'ozwell-jerry-nudge-style';
const JERRY_NUDGE_ID = 'ozwell-jerry-nudge';
const JERRY_CHAT_WELCOME_TEXT =
  "Hi! I'm Jerry, your Huddle assistant. I can help you clock in/out, manage tickets, track time, and navigate the app. How can I help you today?";
const JERRY_NUDGE_TEXT = 'Help me help you.';

/** Inject CSS for the Jerry animated avatar button. */
function injectJerryButtonStyles() {
  if (document.getElementById(JERRY_BUTTON_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = JERRY_BUTTON_STYLE_ID;
  style.textContent = `
    #ozwell-chat-button {
      background: #F5A623 !important;
      border-radius: 14px !important;
      box-shadow: 0 4px 16px rgba(245, 166, 35, 0.4) !important;
      flex-direction: column !important;
      gap: 2px !important;
      animation: jerry-bob 3.5s ease-in-out infinite !important;
    }
    #ozwell-chat-button:hover {
      box-shadow: 0 6px 22px rgba(245, 166, 35, 0.55) !important;
    }
    #ozwell-chat-button.wiggling {
      animation: ozwell-wiggle 0.8s ease-in-out !important;
    }
    @keyframes jerry-bob {
      0%, 100% { transform: translateY(0px); }
      50%       { transform: translateY(-5px); }
    }
    .jerry-eyes {
      display: flex;
      gap: 8px;
    }
    .jerry-eye {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: #3B2000;
      animation: jerry-blink 5s ease-in-out infinite;
      transform-origin: center;
    }
    .jerry-eye.r { animation-delay: 0.07s; }
    @keyframes jerry-blink {
      0%, 88%, 100% { transform: scaleY(1); }
      93%           { transform: scaleY(0.08); }
    }
    .jerry-j {
      font-size: 24px;
      font-weight: 700;
      line-height: 1;
      color: #3B2000;
      font-family: Georgia, 'Times New Roman', serif;
    }
  `;
  document.head.appendChild(style);
}

/** Replace the loader's default favicon icon with the Jerry animated avatar. */
function injectJerryButtonContent() {
  const button = document.getElementById('ozwell-chat-button');
  if (!button) return;
  button.innerHTML = `
    <div class="jerry-eyes">
      <div class="jerry-eye l"></div>
      <div class="jerry-eye r"></div>
    </div>
    <div class="jerry-j">J</div>
  `;
}

function injectJerryNudgeStyles() {
  if (document.getElementById(JERRY_NUDGE_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = JERRY_NUDGE_STYLE_ID;
  style.textContent = `
    #${JERRY_NUDGE_ID} {
      position: fixed;
      right: 20px;
      bottom: 95px;
      max-width: 220px;
      padding: 10px 12px;
      border-radius: 12px;
      background: #ffffff;
      color: #0b2e57;
      border: 1px solid #d9e7f5;
      box-shadow: 0 8px 24px rgba(11, 46, 87, 0.25);
      font-size: 14px;
      line-height: 1.3;
      z-index: 10001;
      animation: jerry-nudge-in 240ms ease-out;
      pointer-events: none;
    }
    #${JERRY_NUDGE_ID}::after {
      content: '';
      position: absolute;
      right: 20px;
      bottom: -6px;
      width: 12px;
      height: 12px;
      background: #ffffff;
      border-right: 1px solid #d9e7f5;
      border-bottom: 1px solid #d9e7f5;
      transform: rotate(45deg);
    }
    @keyframes jerry-nudge-in {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @media (max-width: 767px) {
      #${JERRY_NUDGE_ID} {
        right: 16px;
        bottom: calc(180px + env(safe-area-inset-bottom));
        max-width: 200px;
        font-size: 13px;
      }
      #${JERRY_NUDGE_ID}::after {
        right: 20px;
        bottom: -6px;
        border-top: none;
        border-left: none;
        border-right: 1px solid #d9e7f5;
        border-bottom: 1px solid #d9e7f5;
        transform: rotate(45deg);
      }
    }
  `;
  document.head.appendChild(style);
}

function showJerryNudge(text: string) {
  if (document.getElementById(JERRY_NUDGE_ID)) return;
  const nudge = document.createElement('div');
  nudge.id = JERRY_NUDGE_ID;
  nudge.textContent = text;
  document.body.appendChild(nudge);
}

function hideJerryNudge() {
  document.getElementById(JERRY_NUDGE_ID)?.remove();
}

/** Keep list/newline formatting readable inside the iframe chat bubbles. */
function injectIframeMessageStyles() {
  const iframe = document.querySelector(
    '#ozwell-chat-container iframe',
  ) as HTMLIFrameElement | null;
  if (!iframe?.contentDocument) return false;

  const doc = iframe.contentDocument;

  // Get computed primary color from parent document
  const primaryColor =
    getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim() ||
    '#27aae1';
  const primaryForeground =
    getComputedStyle(document.documentElement)
      .getPropertyValue('--color-primary-foreground')
      .trim() || '#ffffff';

  // Set CSS variables directly on iframe's root so they can update
  if (doc.documentElement) {
    doc.documentElement.style.setProperty('--app-primary', primaryColor);
    doc.documentElement.style.setProperty('--app-primary-foreground', primaryForeground);
  }

  // Find and directly update all send button styles for immediate visual update
  const submitButtons = doc.querySelectorAll<HTMLButtonElement>(
    'button[type="submit"], .send-button, form button[type="submit"]',
  );
  submitButtons.forEach((button) => {
    button.style.backgroundColor = primaryColor;
    button.style.background = primaryColor;
    button.style.color = primaryForeground;
    button.style.borderColor = primaryColor;
  });

  // Only inject style once - it will use the CSS variables
  if (doc.getElementById(JERRY_IFRAME_STYLE_ID)) return true;

  const style = doc.createElement('style');
  style.id = JERRY_IFRAME_STYLE_ID;
  style.textContent = `
    .message {
      white-space: pre-line !important;
      overflow-wrap: anywhere !important;
      word-break: break-word !important;
      line-height: 1.45 !important;
    }
    /* Override Send button to use app theme color via CSS variables */
    button[type="submit"],
    .send-button,
    button:has(svg[data-icon="paper-plane"]),
    form button[type="submit"] {
      background-color: var(--app-primary, #27aae1) !important;
      background: var(--app-primary, #27aae1) !important;
      color: var(--app-primary-foreground, #ffffff) !important;
      border-color: var(--app-primary, #27aae1) !important;
    }
    button[type="submit"]:hover,
    .send-button:hover,
    button:has(svg[data-icon="paper-plane"]):hover,
    form button[type="submit"]:hover {
      opacity: 0.9 !important;
    }
    /* Fix input/placeholder visibility in Capacitor WebView */
    input, textarea {
      -webkit-appearance: none !important;
      appearance: none !important;
      box-sizing: border-box !important;
      width: 100% !important;
      min-width: 0 !important;
      color: #111827 !important;
      background: #ffffff !important;
      opacity: 1 !important;
    }
    input::placeholder,
    textarea::placeholder,
    input::-webkit-input-placeholder,
    textarea::-webkit-input-placeholder {
      color: #9ca3af !important;
      opacity: 1 !important;
      -webkit-text-fill-color: #9ca3af !important;
    }
    form {
      display: flex !important;
      width: 100% !important;
      overflow: visible !important;
    }
  `;
  doc.head.appendChild(style);
  return true;
}

/** Ensure the welcome prompt exists in the widget message list when chat opens. */
function ensureWelcomePromptInIframe(text: string) {
  const iframe = document.querySelector(
    '#ozwell-chat-container iframe',
  ) as HTMLIFrameElement | null;
  if (!iframe?.contentDocument) return false;

  const doc = iframe.contentDocument;
  const messagesEl = doc.getElementById('messages');
  if (!messagesEl) return false;

  const alreadyShown = Array.from(messagesEl.querySelectorAll('.message')).some(
    (el) => el.textContent?.trim() === text,
  );
  if (alreadyShown) return true;

  const msg = doc.createElement('div');
  msg.className = 'message welcome';
  msg.textContent = text;
  messagesEl.appendChild(msg);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return true;
}

/** Override loader styles to keep the chat window rounded (not square). */
function injectMobileOverride() {
  if (document.getElementById(MOBILE_OVERRIDE_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = MOBILE_OVERRIDE_STYLE_ID;
  style.textContent = `
    /* Override Ozwell chat header to use app theme colors */
    .ozwell-chat-header {
      background: var(--color-primary, #0b2e57) !important;
      color: var(--color-primary-foreground, #ffffff) !important;
    }
    .ozwell-chat-header * {
      color: var(--color-primary-foreground, #ffffff) !important;
    }
    /* Keep Send button using primary color - outer wrapper */
    #ozwell-chat-wrapper button[type="submit"],
    #ozwell-chat-wrapper .ozwell-send-button,
    #ozwell-chat-wrapper .send-button,
    #ozwell-chat-wrapper button:has(svg[data-icon="paper-plane"]),
    #ozwell-chat-wrapper form button {
      background: var(--color-primary, #0b2e57) !important;
      color: var(--color-primary-foreground, #ffffff) !important;
      border-color: var(--color-primary, #0b2e57) !important;
    }
    #ozwell-chat-wrapper button[type="submit"]:hover,
    #ozwell-chat-wrapper .ozwell-send-button:hover,
    #ozwell-chat-wrapper .send-button:hover,
    #ozwell-chat-wrapper form button:hover {
      opacity: 0.9 !important;
    }

    /* Keep a rounded chat-card shape on desktop */
    #ozwell-chat-wrapper {
      border-radius: 22px !important;
      overflow: hidden !important;
      border: 1px solid #e5e7eb !important;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.22) !important;
    }
    #ozwell-chat-wrapper.hidden {
      opacity: 0 !important;
      visibility: hidden !important;
      transform: translateY(calc(100% + 64px)) !important;
      pointer-events: none !important;
    }
    #ozwell-chat-wrapper.visible {
      opacity: 1 !important;
      visibility: visible !important;
      transform: translateY(0) !important;
      pointer-events: auto !important;
    }

    @media (max-width: 767px) {
      /* FAB: sit above the bottom nav bar */
      #ozwell-chat-button {
        bottom: calc(90px + env(safe-area-inset-bottom)) !important;
        right: 16px !important;
        width: 68px !important;
        height: 68px !important;
      }

      /* Bottom sheet pattern for mobile - slides up from bottom nav */
      #ozwell-chat-wrapper {
        position: fixed !important;
        top: 120px !important;
        left: 0 !important;
        right: 0 !important;
        bottom: calc(80px + env(safe-area-inset-bottom)) !important;
        width: 100% !important;
        height: auto !important;
        max-height: none !important;
        border-radius: 22px 22px 0 0 !important;
        border: none !important;
        border-top: 1px solid #e5e7eb !important;
        box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.15) !important;
        padding-bottom: 0 !important;
        z-index: 10000 !important;
        background: #ffffff !important;
        overflow: hidden !important;
        transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s !important;
      }

      /* Backdrop that dims the app - stops at bottom nav */
      #ozwell-chat-wrapper::before {
        content: '' !important;
        display: block !important;
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        bottom: calc(80px + env(safe-area-inset-bottom)) !important;
        background: rgba(0, 0, 0, 0.5) !important;
        z-index: -1 !important;
        transition: opacity 0.3s !important;
        pointer-events: auto !important;
      }

      #ozwell-chat-wrapper.hidden {
        opacity: 0 !important;
        visibility: hidden !important;
        transform: translateY(100%) !important;
        pointer-events: none !important;
      }
      #ozwell-chat-wrapper.hidden::before {
        opacity: 0 !important;
        pointer-events: none !important;
      }

      #ozwell-chat-wrapper.visible {
        opacity: 1 !important;
        visibility: visible !important;
        transform: translateY(0) !important;
        pointer-events: auto !important;
      }
      #ozwell-chat-wrapper.visible::before {
        opacity: 1 !important;
      }

      /* Prevent dark Capacitor WebView background bleeding through */
      #ozwell-chat-container {
        background: #ffffff !important;
        border-radius: 0 !important;
        height: 100% !important;
      }
      #ozwell-chat-container iframe {
        background: #ffffff !important;
        height: 100% !important;
      }

      .ozwell-chat-header {
        padding: 16px 16px 12px 16px !important;
        flex-direction: row !important;
        flex-wrap: nowrap !important;
        align-items: center !important;
        border-bottom: 1px solid #e5e7eb !important;
        background: var(--color-primary, #0b2e57) !important;
        color: var(--color-primary-foreground, #ffffff) !important;
      }
      .ozwell-chat-header * {
        color: var(--color-primary-foreground, #ffffff) !important;
      }
      .ozwell-chat-controls {
        display: flex !important;
        margin-left: auto !important;
        gap: 8px !important;
      }
      /* Mobile Send button - comprehensive selectors */
      #ozwell-chat-wrapper button[type="submit"],
      #ozwell-chat-wrapper .ozwell-send-button,
      #ozwell-chat-wrapper .send-button,
      #ozwell-chat-wrapper button:has(svg[data-icon="paper-plane"]),
      #ozwell-chat-wrapper form button {
        background: var(--color-primary, #0b2e57) !important;
        color: var(--color-primary-foreground, #ffffff) !important;
        border-color: var(--color-primary, #0b2e57) !important;
      }
      #ozwell-chat-wrapper button[type="submit"]:hover,
      #ozwell-chat-wrapper .send-button:hover,
      #ozwell-chat-wrapper form button:hover {
        opacity: 0.9 !important;
      }
    }
  `;
  document.head.appendChild(style);
}

export const OzwellWidget: React.FC = () => {
  const { user } = useSession();
  const { pathname, navigate } = useRouter();
  const { selectedTeam, selectedTeamId, teams, activeClockEvent, refetchClock, setSelectedTeamId } =
    useTeam();

  // Keep a stable ref to mutable context so the tool handler always has fresh values
  // without needing to re-register the listener on every render.
  const ctxRef = useRef({
    user,
    pathname,
    selectedTeam,
    selectedTeamId,
    teams,
    activeClockEvent,
    refetchClock,
    navigate,
    setSelectedTeamId,
  });
  useEffect(() => {
    ctxRef.current = {
      user,
      pathname,
      selectedTeam,
      selectedTeamId,
      teams,
      activeClockEvent,
      refetchClock,
      navigate,
      setSelectedTeamId,
    };
  }, [
    user,
    pathname,
    selectedTeam,
    selectedTeamId,
    teams,
    activeClockEvent,
    refetchClock,
    navigate,
    setSelectedTeamId,
  ]);

  // ── Effect 1: inject loader script once ───────────────────────────────────
  useEffect(() => {
    const env = (import.meta as { env?: Record<string, string> }).env;
    const apiKey = env?.VITE_OZWELL_AGENT_KEY;
    if (!apiKey) {
      // Widget intentionally disabled when no key is configured.
      return;
    }

    if (document.getElementById(SCRIPT_ID)) return; // already injected

    console.log('[Jerry] 🚀 widget initializing with key:', apiKey.slice(0, 14) + '…');
    window.OzwellChatConfig = {
      apiKey,
      debug: true, // forced on for debugging
      title: 'Jerry Assistant',
      placeholder: 'Ask Jerry anything...',
      welcomeMessage: JERRY_CHAT_WELCOME_TEXT,
    };

    injectMobileOverride();
    injectJerryNudgeStyles();
    injectJerryButtonStyles(); // inject before script so button is styled on creation

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = LOADER_URL;
    script.async = true;
    document.body.appendChild(script);

    return () => {
      document.getElementById(SCRIPT_ID)?.remove();
      document.getElementById(MOBILE_OVERRIDE_STYLE_ID)?.remove();
      document.getElementById(JERRY_BUTTON_STYLE_ID)?.remove();
      document.getElementById(JERRY_NUDGE_STYLE_ID)?.remove();
      hideJerryNudge();
      delete window.OzwellChatConfig;
    };
  }, []); // intentionally empty — run once

  // ── Effect 2: inject Jerry button once widget is ready ────────────────────
  useEffect(() => {
    let buttonClickHandler: (() => void) | null = null;

    const runIframeEnhancements = () => {
      let attempts = 0;
      const timer = window.setInterval(() => {
        attempts += 1;
        const styled = injectIframeMessageStyles();
        const welcomed = ensureWelcomePromptInIframe(JERRY_CHAT_WELCOME_TEXT);
        if ((styled && welcomed) || attempts >= 20) window.clearInterval(timer);
      }, 150);
    };

    const onReady = () => {
      injectJerryButtonStyles();
      injectJerryButtonContent();
      showJerryNudge(JERRY_NUDGE_TEXT);

      const button = document.getElementById('ozwell-chat-button');
      if (button && !buttonClickHandler) {
        buttonClickHandler = () => {
          hideJerryNudge();
          runIframeEnhancements();
        };
        button.addEventListener('click', buttonClickHandler);
      }

      runIframeEnhancements();
    };

    document.addEventListener('ozwell-chat-ready', onReady);
    // Widget may already be ready if this effect runs late
    if (document.getElementById('ozwell-chat-button')) onReady();

    return () => {
      document.removeEventListener('ozwell-chat-ready', onReady);
      const button = document.getElementById('ozwell-chat-button');
      if (button && buttonClickHandler) button.removeEventListener('click', buttonClickHandler);
    };
  }, []);

  // ── Effect 3: sync live context to widget ─────────────────────────────────
  useEffect(() => {
    if (!window.OzwellChat?.updateContext) return;
    window.OzwellChat.updateContext({
      userId: user?.id ?? null,
      userName: user?.name ?? null,
      page: pathname,
      teamId: selectedTeamId,
      teamName: selectedTeam?.name ?? null,
      today: new Date().toLocaleDateString('en-CA'),
      // Clock status — Jerry reads this directly instead of calling get_clock_status
      clockedIn: activeClockEvent != null,
      clockedInTeamId: activeClockEvent?.teamId ?? null,
      clockedInTeamName: activeClockEvent
        ? (teams.find((t) => t.id === activeClockEvent.teamId)?.name ?? null)
        : null,
      clockedInSince: activeClockEvent
        ? new Date(activeClockEvent.startTime).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })
        : null,
    });
  }, [user, pathname, selectedTeam, selectedTeamId, activeClockEvent, teams]);

  // ── Effect 4: watch for theme changes and update iframe button color ──────
  useEffect(() => {
    const observer = new MutationObserver(() => {
      // Theme changed - re-inject iframe styles with new colors
      injectIframeMessageStyles();
    });

    // Watch for data-theme attribute changes on <html>
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => observer.disconnect();
  }, []);

  // ── Effect 5: tool call handler ───────────────────────────────────────────
  const handleToolCall = useCallback((e: Event) => {
    const { name, arguments: args, respond } = (e as CustomEvent<OzwellToolCallDetail>).detail;
    const ctx = ctxRef.current;

    console.log('[Jerry] 🔧 tool call received:', name, args);

    const debugRespond = (result: unknown) => {
      console.log('[Jerry] ✅ debugRespond() called for', name, result);
      respond(result);
    };

    void (async () => {
      try {
        switch (name) {
          // Navigation
          case 'navigate': {
            const path = String(args.path ?? '');
            if (!path.startsWith('/app/')) {
              debugRespond({ success: false, error: 'Invalid path. Must start with /app/' });
              return;
            }
            ctx.navigate(path);
            debugRespond({ success: true, data: { path } });
            break;
          }

          // Read context
          case 'get_current_user': {
            if (!ctx.user) {
              debugRespond({ success: false, error: 'No user session found' });
              return;
            }
            debugRespond({
              success: true,
              data: { id: ctx.user.id, name: ctx.user.name, email: ctx.user.email },
            });
            break;
          }

          case 'get_current_page': {
            debugRespond({ success: true, data: { path: ctx.pathname } });
            break;
          }

          case 'get_current_team': {
            if (!ctx.selectedTeam) {
              debugRespond({ success: false, error: 'No team selected' });
              return;
            }
            debugRespond({ success: true, data: ctx.selectedTeam });
            break;
          }

          case 'get_teams': {
            debugRespond({ success: true, data: ctx.teams });
            break;
          }

          // Clock
          case 'get_clock_sessions': {
            if (!user?.id) {
              debugRespond({ success: false, error: 'No user session found' });
              return;
            }
            const todayStr = new Date().toLocaleDateString('en-CA');
            const startDateStr = String(args.start_date ?? todayStr);
            const endDateStr = String(args.end_date ?? startDateStr);
            // Convert local dates to epoch ms boundaries
            const startMs = new Date(`${startDateStr}T00:00:00`).getTime();
            const endMs = new Date(`${endDateStr}T23:59:59.999`).getTime();
            const result = await clockApi.getTimesheet(user.id, startMs, endMs);

            // Resolve team filter: explicit arg takes priority, then selected team
            const argTeamId = args.team_id ? String(args.team_id) : undefined;
            const argTeamName = args.team_name ? String(args.team_name).toLowerCase() : undefined;
            const resolvedByName = argTeamName
              ? ctx.teams.find((t) => t.name.toLowerCase().includes(argTeamName))
              : undefined;
            const filterTeamId = argTeamId ?? resolvedByName?.id ?? ctx.selectedTeamId;
            const filteredSessions = filterTeamId
              ? result.sessions.filter((s) => s.teamId === filterTeamId)
              : result.sessions;

            // Compute work seconds the same way TimesheetPage does (uses accumulatedTime when set)
            const now = Date.now();
            const getWorkSeconds = (s: (typeof filteredSessions)[number]): number => {
              if (!s.endTime) {
                const acc = Math.max(0, s.accumulatedTime ?? 0);
                return acc + Math.max(0, Math.floor((now - s.startTime) / 1000));
              }
              const acc = Math.max(0, s.accumulatedTime ?? 0);
              if (acc > 0) return acc;
              return Math.max(0, Math.floor((s.endTime - s.startTime) / 1000));
            };

            const totalSeconds = filteredSessions.reduce((sum, s) => sum + getWorkSeconds(s), 0);
            const sessions = filteredSessions.map((s) => ({
              id: s.id,
              date: new Date(s.startTime).toLocaleDateString([], {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              }),
              clockIn: new Date(s.startTime).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              }),
              clockOut: s.endTime
                ? new Date(s.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : 'still clocked in',
              duration: formatDuration(getWorkSeconds(s)),
              teamId: s.teamId,
              team: ctx.teams.find((t) => t.id === s.teamId)?.name ?? s.teamId,
            }));
            debugRespond({
              success: true,
              data: {
                startDate: startDateStr,
                endDate: endDateStr,
                teamFilter: filterTeamId
                  ? (ctx.teams.find((t) => t.id === filterTeamId)?.name ?? filterTeamId)
                  : 'all teams',
                sessions,
                totalSessions: filteredSessions.length,
                grandTotal: formatDuration(totalSeconds),
              },
            });
            break;
          }

          case 'get_clock_status': {
            if (ctx.activeClockEvent) {
              const elapsedSeconds =
                (Date.now() - new Date(ctx.activeClockEvent.startTime).getTime()) / 1000;
              debugRespond({
                success: true,
                data: {
                  clockedIn: true,
                  since: ctx.activeClockEvent.startTime,
                  elapsed: formatDuration(elapsedSeconds),
                  eventId: ctx.activeClockEvent.id,
                  teamId: ctx.activeClockEvent.teamId,
                },
              });
            } else {
              debugRespond({ success: true, data: { clockedIn: false } });
            }
            break;
          }

          case 'clock_in': {
            const event = await clockApi.start();
            ctx.refetchClock();
            debugRespond({ success: true, data: event });
            break;
          }

          case 'clock_out': {
            const stoppedEvent = await clockApi.stop();
            ctx.refetchClock();
            debugRespond({ success: true, data: stoppedEvent });
            break;
          }

          case 'update_timesheet_entry': {
            const entryId = String(args.id ?? '');
            if (!entryId) {
              debugRespond({ success: false, error: 'Missing required field: id' });
              return;
            }
            const updates: { startTime?: number; endTime?: number | null } = {};
            if (args.startTime != null)
              updates.startTime = new Date(String(args.startTime)).getTime();
            if (args.endTime != null) updates.endTime = new Date(String(args.endTime)).getTime();
            const updated = await clockApi.updateTimes(entryId, updates);
            ctx.refetchClock();
            debugRespond({ success: true, data: updated });
            break;
          }

          case 'delete_timesheet_entry': {
            const delId = String(args.id ?? '');
            if (!delId) {
              debugRespond({ success: false, error: 'Missing required field: id' });
              return;
            }
            await clockApi.deleteEvent(delId);
            ctx.refetchClock();
            debugRespond({ success: true });
            break;
          }

          // Tickets
          case 'get_tickets': {
            if (!ctx.selectedTeamId) {
              debugRespond({ success: false, error: 'No team selected' });
              return;
            }
            const tickets = await ticketApi.getTickets(ctx.selectedTeamId);
            debugRespond({ success: true, data: tickets });
            break;
          }

          case 'create_ticket': {
            if (!ctx.selectedTeamId) {
              debugRespond({ success: false, error: 'No team selected' });
              return;
            }
            let title = String(args.title ?? '');
            const githubUrl = String(args.github ?? '');
            const descriptionArg = args.description ? String(args.description) : undefined;

            if (!title) {
              debugRespond({ success: false, error: 'Missing required field: title' });
              return;
            }

            // If the title IS a GitHub URL, auto-fetch the real title + body
            if (isGithubIssueUrl(title)) {
              const issue = await fetchGithubIssue(title);
              const url = title;
              title = issue?.title ?? title;
              const description = descriptionArg ?? issue?.body ?? null;
              const ticket = await createTicketFromGithub({
                teamId: ctx.selectedTeamId,
                url,
                title,
                description,
              });
              window.dispatchEvent(new Event('tickets:refetch'));
              debugRespond({ success: true, data: ticket });
              break;
            }

            // If a separate github URL is provided, use createTicketFromGithub
            if (githubUrl && isGithubIssueUrl(githubUrl)) {
              const issue = await fetchGithubIssue(githubUrl);
              const description = descriptionArg ?? issue?.body ?? null;
              const ticket = await createTicketFromGithub({
                teamId: ctx.selectedTeamId,
                url: githubUrl,
                title,
                description,
              });
              window.dispatchEvent(new Event('tickets:refetch'));
              debugRespond({ success: true, data: ticket });
              break;
            }

            // Plain ticket
            const ticket = await ticketApi.createTicket({
              teamId: ctx.selectedTeamId,
              title,
            });
            if (descriptionArg) {
              await ticketApi.updateTicket(ticket.id, { description: descriptionArg });
            }
            window.dispatchEvent(new Event('tickets:refetch'));
            debugRespond({ success: true, data: ticket });
            break;
          }

          case 'update_ticket': {
            const ticketId = String(args.id ?? '');
            if (!ticketId) {
              debugRespond({ success: false, error: 'Missing required field: id' });
              return;
            }
            const hasStatusOrPriority = args.status != null || args.priority != null;
            const hasTitleOrDescription = args.title != null || args.description != null;

            let updatedTicket;
            if (hasStatusOrPriority && !hasTitleOrDescription) {
              updatedTicket = await ticketApi.updateStatusPriority(ticketId, {
                status: args.status as string | undefined,
                priority: args.priority as string | undefined,
              });
            } else if (hasTitleOrDescription && !hasStatusOrPriority) {
              updatedTicket = await ticketApi.updateTicket(ticketId, {
                title: args.title as string | undefined,
                description: args.description as string | undefined,
              });
            } else {
              // Both: do two calls, return the final state
              if (hasTitleOrDescription) {
                await ticketApi.updateTicket(ticketId, {
                  title: args.title as string | undefined,
                  description: args.description as string | undefined,
                });
              }
              updatedTicket = await ticketApi.updateStatusPriority(ticketId, {
                status: args.status as string | undefined,
                priority: args.priority as string | undefined,
              });
            }
            window.dispatchEvent(new Event('tickets:refetch'));
            debugRespond({ success: true, data: updatedTicket });
            break;
          }

          case 'delete_ticket': {
            const delTicketId = String(args.id ?? '');
            if (!delTicketId) {
              debugRespond({ success: false, error: 'Missing required field: id' });
              return;
            }
            await ticketApi.deleteTicket(delTicketId);
            window.dispatchEvent(new Event('tickets:refetch'));
            debugRespond({ success: true });
            break;
          }

          // Teams
          case 'switch_team': {
            // Try teamId first, then fall back to name match (case-insensitive).
            // Using explicit truthiness check so empty-string args don't mask the other field.
            const teamIdArg = args.teamId ? String(args.teamId) : '';
            const teamNameArg = args.name ? String(args.name) : '';

            if (!teamIdArg && !teamNameArg) {
              const available = ctx.teams.map((t) => `"${t.name}" (${t.id})`).join(', ');
              debugRespond({
                success: false,
                error: `Provide teamId or name. Available teams: ${available}`,
              });
              return;
            }

            const matchedTeam =
              (teamIdArg ? ctx.teams.find((t) => t.id === teamIdArg) : undefined) ??
              (teamNameArg
                ? ctx.teams.find((t) => t.name.toLowerCase() === teamNameArg.toLowerCase())
                : undefined);

            if (!matchedTeam) {
              const query = teamIdArg || teamNameArg;
              const available = ctx.teams.map((t) => `"${t.name}"`).join(', ');
              debugRespond({
                success: false,
                error: `Team "${query}" not found. Available teams: ${available}`,
              });
              return;
            }

            // Already on this team — nothing to do
            if (matchedTeam.id === ctx.selectedTeamId) {
              debugRespond({
                success: true,
                data: { id: matchedTeam.id, name: matchedTeam.name, alreadySelected: true },
              });
              return;
            }

            ctx.setSelectedTeamId(matchedTeam.id);
            debugRespond({ success: true, data: { id: matchedTeam.id, name: matchedTeam.name } });
            break;
          }

          case 'create_team': {
            const teamName = String(args.name ?? '');
            if (!teamName) {
              debugRespond({ success: false, error: 'Missing required field: name' });
              return;
            }
            const newTeam = await teamApi.createTeam({
              name: teamName,
              description: args.description as string | undefined,
            });
            debugRespond({ success: true, data: newTeam });
            break;
          }

          case 'update_team': {
            const updateTeamId = String(args.id ?? '');
            const newName = String(args.name ?? '');
            if (!updateTeamId || !newName) {
              debugRespond({ success: false, error: 'Missing required fields: id and name' });
              return;
            }
            const renamedTeam = await teamApi.renameTeam(updateTeamId, newName);
            debugRespond({ success: true, data: renamedTeam });
            break;
          }

          case 'delete_team': {
            const delTeamId = String(args.id ?? '');
            if (!delTeamId) {
              debugRespond({ success: false, error: 'Missing required field: id' });
              return;
            }
            await teamApi.deleteTeam(delTeamId);
            debugRespond({ success: true });
            break;
          }

          // Work / Timers
          case 'get_work_items': {
            const date = String(args.date ?? new Date().toLocaleDateString('en-CA'));
            const entries = await timerApi.getDay(date);
            const now = Date.now();
            let grandTotalSeconds = 0;
            const formatted = entries.map((e) => {
              const totalSeconds = e.sessions.reduce((sum, s) => {
                const end = s.endTime ?? now;
                return sum + (end - s.startTime) / 1000;
              }, 0);
              grandTotalSeconds += totalSeconds;
              return {
                ticket: e.entry.displayTitle ?? e.entry.ticketId,
                workItemId: e.entry.id,
                total: formatDuration(totalSeconds),
                sessions: e.sessions.map((s) => ({
                  id: s.id,
                  start: new Date(s.startTime).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
                  end: s.endTime
                    ? new Date(s.endTime).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : 'running',
                  duration: formatDuration(((s.endTime ?? now) - s.startTime) / 1000),
                })),
              };
            });
            debugRespond({
              success: true,
              data: { date, grandTotal: formatDuration(grandTotalSeconds), items: formatted },
            });
            break;
          }

          case 'create_work_item': {
            const ticketId = String(args.ticketId ?? '');
            if (!ticketId) {
              debugRespond({ success: false, error: 'Missing required field: ticketId' });
              return;
            }
            const date = String(args.date ?? new Date().toLocaleDateString('en-CA'));
            const entry = await timerApi.createEntry({
              ticketId,
              date,
              note: args.note as string | undefined,
            });
            debugRespond({ success: true, data: entry });
            break;
          }

          case 'start_work_timer': {
            const entryId = String(args.workItemId ?? '');
            if (!entryId) {
              debugRespond({ success: false, error: 'Missing required field: workItemId' });
              return;
            }
            const result = await timerApi.startSession(entryId);
            window.dispatchEvent(new Event('work:refetch'));
            debugRespond({ success: true, data: result });
            break;
          }

          case 'stop_work_timer': {
            const sessionId = String(args.sessionId ?? '');
            if (!sessionId) {
              debugRespond({ success: false, error: 'Missing required field: sessionId' });
              return;
            }
            const stopped = await timerApi.stopSession(sessionId);
            window.dispatchEvent(new Event('work:refetch'));
            debugRespond({ success: true, data: stopped });
            break;
          }

          case 'get_running_timer': {
            const running = await timerApi.getRunning();
            debugRespond({ success: true, data: running ?? null });
            break;
          }

          /**
           * Start a timer for an existing ticket.
           *
           * Rules enforced here (per product requirements):
           *   1. Never creates a ticket — use create_ticket first if needed.
           *   2. Ticket must belong to the currently selected team.
           *   3. User must be clocked in to the currently selected team.
           *   4. Reuses an existing work item for today if one exists (idempotent).
           */
          case 'start_ticket_timer': {
            const teamId = ctx.selectedTeamId;
            const teamName = ctx.selectedTeam?.name ?? 'the selected team';

            if (!teamId) {
              debugRespond({
                success: false,
                error: 'No team selected. Use switch_team to select a team first.',
              });
              return;
            }

            // ── 1. Resolve ticketId (lookup only — never create) ──────────────
            let ticketId = String(args.ticketId ?? '');
            const ticketTitle = String(args.title ?? '');

            if (!ticketId && !ticketTitle) {
              debugRespond({
                success: false,
                error: 'Provide ticketId or title to identify the ticket.',
              });
              return;
            }

            // Fetch all tickets for the current team
            const teamTickets = await ticketApi.getTickets(teamId);

            if (ticketId) {
              // Validate the provided ID belongs to the current team
              const belongs = teamTickets.some((t) => t.id === ticketId);
              if (!belongs) {
                debugRespond({
                  success: false,
                  error:
                    `Ticket ${ticketId} does not belong to "${teamName}". ` +
                    `Use switch_team to switch to the correct team, or get_tickets to list tickets for this team.`,
                });
                return;
              }
            } else {
              // Find by title (case-insensitive)
              const match = teamTickets.find(
                (t) => t.title.toLowerCase() === ticketTitle.toLowerCase(),
              );
              if (!match) {
                debugRespond({
                  success: false,
                  error:
                    `No ticket titled "${ticketTitle}" found in "${teamName}". ` +
                    `Use get_tickets to list available tickets, or create_ticket if you want to create a new one.`,
                });
                return;
              }
              ticketId = match.id;
            }

            // ── 2. Verify user is clocked in to this team ─────────────────────
            if (!ctx.activeClockEvent) {
              debugRespond({
                success: false,
                error: `You are not clocked in. Use clock_in to clock in to "${teamName}" first.`,
              });
              return;
            }
            if (ctx.activeClockEvent.teamId !== teamId) {
              const clockedTeam = ctx.teams.find((t) => t.id === ctx.activeClockEvent?.teamId);
              debugRespond({
                success: false,
                error:
                  `You are clocked in to "${clockedTeam?.name ?? ctx.activeClockEvent.teamId}" but the ticket belongs to "${teamName}". ` +
                  `Use switch_team to switch to the correct team, then clock_out and clock_in again.`,
              });
              return;
            }

            // ── 3. Get or create a work item for today ────────────────────────
            const today = new Date().toLocaleDateString('en-CA');
            const todayEntries = await timerApi.getDay(today);
            const existingDayEntry = todayEntries.find((de) => de.entry.ticketId === ticketId);
            const entry = existingDayEntry
              ? existingDayEntry.entry
              : await timerApi.createEntry({ ticketId, date: today });

            // ── 4. Start the timer ────────────────────────────────────────────
            const session = await timerApi.startSession(entry.id);
            window.dispatchEvent(new Event('work:refetch'));
            debugRespond({ success: true, data: { workItem: entry, session } });
            break;
          }

          default:
            debugRespond({ success: false, error: `Unknown tool: ${name}` });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'An unexpected error occurred';
        debugRespond({ success: false, error: message });
      }
    })();
  }, []); // stable — reads ctx via ref

  useEffect(() => {
    console.log('[Jerry] 📡 attaching ozwell-tool-call listener');
    document.addEventListener('ozwell-tool-call', handleToolCall);
    return () => {
      console.log('[Jerry] 🔌 removing ozwell-tool-call listener');
      document.removeEventListener('ozwell-tool-call', handleToolCall);
    };
  }, [handleToolCall]);

  return null;
};
