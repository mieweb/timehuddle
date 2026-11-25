/**
 * The plan post as the day's launching point (M4, #886): in your own plan
 * post for the session you're clocked in to, each ticket chip gets its timer
 * button — ▶ to start it, ⏸ while it runs. Wraps the references plugin's
 * link: every other link, and every other post — the "Working on …"
 * updates included — renders exactly as it did.
 *
 * Which posts qualify and how a start runs come from `PlanStartProvider`,
 * read by each link through context, so the render plugins stay stable
 * while the feed changes underneath them.
 */
import { useTextRenderContext, type SuperChatRenderPlugin } from '@mieweb/ui/components/SuperChat';
import React, { createContext, useContext } from 'react';

import { TimerControl } from '../../ui/TimerControl';

export interface PlanStart {
  /** Ids of the posts whose ticket chips start timers. */
  postIds: ReadonlySet<string>;
  /** Start the ticket, or stop it when it's the one running. */
  toggle: (ticketId: string, title: string) => void;
  isBusy: (ticketId: string) => boolean;
  /** Any start or stop is in flight: one at a time, app-wide. */
  busy: boolean;
  /** The ticket whose timer is running. */
  runningTicketId: string | null;
  startLabel: (title: string) => string;
  stopLabel: (title: string) => string;
}

const PlanStartContext = createContext<PlanStart | null>(null);

export const PlanStartProvider = PlanStartContext.Provider;

// A Huddle ticket's page; a Redmine issue's is under /app/tickets/redmine/.
const TICKET_PATH = /^\/app\/tickets\/(?!redmine\/)([^/?#\s]+)$/;

/** The ticket a link opens, or null when it isn't a Huddle ticket's page. */
export function ticketIdOfHref(href: unknown): string | null {
  const match = typeof href === 'string' ? TICKET_PATH.exec(href) : null;
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

interface HastNode {
  type?: string;
  value?: string;
  children?: HastNode[];
}

/** The plain text of a rendered link, its label. */
function textOf(node: HastNode | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return node.value ?? '';
  return (node.children ?? []).map(textOf).join('');
}

/** `plugin` with a start button beside each ticket link of a qualifying post. */
export function withPlanStart(plugin: SuperChatRenderPlugin): SuperChatRenderPlugin {
  const found = plugin.components?.a;
  if (!found) return plugin;
  const Link: React.ComponentType<Record<string, unknown>> = found;

  function PlanTicketLink(props: Record<string, unknown>) {
    const plan = useContext(PlanStartContext);
    const { messageId } = useTextRenderContext();
    const link = <Link {...props} />;
    const ticketId = ticketIdOfHref(props.href);
    if (!plan || !ticketId || !plan.postIds.has(messageId)) return link;
    const running = plan.runningTicketId === ticketId;
    const title = textOf(props.node as HastNode | undefined) || ticketId;
    return (
      // Bounded by the bubble, so a long ticket name truncates inside it.
      <span className="plan-ticket-start inline-flex max-w-full items-start gap-1 align-middle">
        <TimerControl
          isRunning={running}
          isLoading={plan.isBusy(ticketId)}
          disabled={plan.busy}
          onClick={() => plan.toggle(ticketId, title)}
          ariaLabel={running ? plan.stopLabel(title) : plan.startLabel(title)}
          className="h-6 w-6"
        />
        <span className="flex min-w-0">{link}</span>
      </span>
    );
  }

  return { ...plugin, components: { ...plugin.components, a: PlanTicketLink } };
}
