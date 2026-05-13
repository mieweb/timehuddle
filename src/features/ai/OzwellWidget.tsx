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

import { clockApi, teamApi, ticketApi } from '../../lib/api';
import { useSession } from '../../lib/useSession';
import { useTeam } from '../../lib/TeamContext';
import { useRouter } from '../../ui/router';

// ── Window interface augmentation ────────────────────────────────────────────

declare global {
  interface Window {
    OzwellChatConfig?: {
      apiKey: string;
      debug?: boolean;
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

const LOADER_URL = 'https://ozwellapi.opensource.mieweb.org/embed/ozwell-loader.js';
const SCRIPT_ID = 'ozwell-loader';

export const OzwellWidget: React.FC = () => {
  const { user } = useSession();
  const { pathname, navigate } = useRouter();
  const { selectedTeam, selectedTeamId, teams, activeClockEvent, refetchClock } = useTeam();

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
    };
  }, [user, pathname, selectedTeam, selectedTeamId, teams, activeClockEvent, refetchClock, navigate]);

  // ── Effect 1: inject loader script once ───────────────────────────────────
  useEffect(() => {
    const env = (import.meta as { env?: Record<string, string> }).env;
    const apiKey = env?.VITE_OZWELL_AGENT_KEY;
    if (!apiKey) {
      // Widget intentionally disabled when no key is configured.
      return;
    }

    if (document.getElementById(SCRIPT_ID)) return; // already injected

    window.OzwellChatConfig = {
      apiKey,
      debug: Boolean(env?.DEV),
    };

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = LOADER_URL;
    script.async = true;
    document.body.appendChild(script);

    return () => {
      document.getElementById(SCRIPT_ID)?.remove();
      delete window.OzwellChatConfig;
    };
  }, []); // intentionally empty — run once

  // ── Effect 2: sync live context to widget ─────────────────────────────────
  useEffect(() => {
    if (!window.OzwellChat?.updateContext) return;
    window.OzwellChat.updateContext({
      userId: user?.id ?? null,
      userName: user?.name ?? null,
      page: pathname,
      teamId: selectedTeamId,
      teamName: selectedTeam?.name ?? null,
    });
  }, [user, pathname, selectedTeam, selectedTeamId]);

  // ── Effect 3: tool call handler ───────────────────────────────────────────
  const handleToolCall = useCallback((e: Event) => {
    const { name, arguments: args, respond } = (e as CustomEvent<OzwellToolCallDetail>).detail;
    const ctx = ctxRef.current;

    void (async () => {
      try {
        switch (name) {
          // Navigation
          case 'navigate': {
            const path = String(args.path ?? '');
            if (!path.startsWith('/app/')) {
              respond({ success: false, error: 'Invalid path. Must start with /app/' });
              return;
            }
            ctx.navigate(path);
            respond({ success: true, data: { path } });
            break;
          }

          // Read context
          case 'get_current_user': {
            if (!ctx.user) {
              respond({ success: false, error: 'No user session found' });
              return;
            }
            respond({
              success: true,
              data: { id: ctx.user.id, name: ctx.user.name, email: ctx.user.email },
            });
            break;
          }

          case 'get_current_page': {
            respond({ success: true, data: { path: ctx.pathname } });
            break;
          }

          case 'get_current_team': {
            if (!ctx.selectedTeam) {
              respond({ success: false, error: 'No team selected' });
              return;
            }
            respond({ success: true, data: ctx.selectedTeam });
            break;
          }

          case 'get_teams': {
            respond({ success: true, data: ctx.teams });
            break;
          }

          // Clock
          case 'get_clock_status': {
            if (ctx.activeClockEvent) {
              respond({
                success: true,
                data: {
                  clockedIn: true,
                  since: ctx.activeClockEvent.startTime,
                  eventId: ctx.activeClockEvent.id,
                  teamId: ctx.activeClockEvent.teamId,
                },
              });
            } else {
              respond({ success: true, data: { clockedIn: false } });
            }
            break;
          }

          case 'clock_in': {
            if (!ctx.selectedTeamId) {
              respond({ success: false, error: 'No team selected' });
              return;
            }
            const event = await clockApi.start(ctx.selectedTeamId);
            ctx.refetchClock();
            respond({ success: true, data: event });
            break;
          }

          case 'clock_out': {
            if (!ctx.selectedTeamId) {
              respond({ success: false, error: 'No team selected' });
              return;
            }
            const stoppedEvent = await clockApi.stop(ctx.selectedTeamId);
            ctx.refetchClock();
            respond({ success: true, data: stoppedEvent });
            break;
          }

          case 'update_timesheet_entry': {
            const entryId = String(args.id ?? '');
            if (!entryId) {
              respond({ success: false, error: 'Missing required field: id' });
              return;
            }
            const updates: { startTime?: number; endTime?: number | null } = {};
            if (args.startTime != null) updates.startTime = new Date(String(args.startTime)).getTime();
            if (args.endTime != null) updates.endTime = new Date(String(args.endTime)).getTime();
            const updated = await clockApi.updateTimes(entryId, updates);
            ctx.refetchClock();
            respond({ success: true, data: updated });
            break;
          }

          case 'delete_timesheet_entry': {
            const delId = String(args.id ?? '');
            if (!delId) {
              respond({ success: false, error: 'Missing required field: id' });
              return;
            }
            await clockApi.deleteEvent(delId);
            ctx.refetchClock();
            respond({ success: true });
            break;
          }

          // Tickets
          case 'get_tickets': {
            if (!ctx.selectedTeamId) {
              respond({ success: false, error: 'No team selected' });
              return;
            }
            const tickets = await ticketApi.getTickets(ctx.selectedTeamId);
            respond({ success: true, data: tickets });
            break;
          }

          case 'create_ticket': {
            if (!ctx.selectedTeamId) {
              respond({ success: false, error: 'No team selected' });
              return;
            }
            const title = String(args.title ?? '');
            if (!title) {
              respond({ success: false, error: 'Missing required field: title' });
              return;
            }
            const ticket = await ticketApi.createTicket({
              teamId: ctx.selectedTeamId,
              title,
            });
            respond({ success: true, data: ticket });
            break;
          }

          case 'update_ticket': {
            const ticketId = String(args.id ?? '');
            if (!ticketId) {
              respond({ success: false, error: 'Missing required field: id' });
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
            respond({ success: true, data: updatedTicket });
            break;
          }

          case 'delete_ticket': {
            const delTicketId = String(args.id ?? '');
            if (!delTicketId) {
              respond({ success: false, error: 'Missing required field: id' });
              return;
            }
            await ticketApi.deleteTicket(delTicketId);
            respond({ success: true });
            break;
          }

          // Teams
          case 'create_team': {
            const teamName = String(args.name ?? '');
            if (!teamName) {
              respond({ success: false, error: 'Missing required field: name' });
              return;
            }
            const newTeam = await teamApi.createTeam({
              name: teamName,
              description: args.description as string | undefined,
            });
            respond({ success: true, data: newTeam });
            break;
          }

          case 'update_team': {
            const updateTeamId = String(args.id ?? '');
            const newName = String(args.name ?? '');
            if (!updateTeamId || !newName) {
              respond({ success: false, error: 'Missing required fields: id and name' });
              return;
            }
            const renamedTeam = await teamApi.renameTeam(updateTeamId, newName);
            respond({ success: true, data: renamedTeam });
            break;
          }

          case 'delete_team': {
            const delTeamId = String(args.id ?? '');
            if (!delTeamId) {
              respond({ success: false, error: 'Missing required field: id' });
              return;
            }
            await teamApi.deleteTeam(delTeamId);
            respond({ success: true });
            break;
          }

          default:
            respond({ success: false, error: `Unknown tool: ${name}` });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'An unexpected error occurred';
        respond({ success: false, error: message });
      }
    })();
  }, []); // stable — reads ctx via ref

  useEffect(() => {
    document.addEventListener('ozwell-tool-call', handleToolCall);
    return () => document.removeEventListener('ozwell-tool-call', handleToolCall);
  }, [handleToolCall]);

  return null;
};
