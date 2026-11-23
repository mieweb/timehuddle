/**
 * The plan post as the day's launching point (M4, #886): in your own plan
 * post for the session you're clocked in to, each ticket chip gets a ▶ that
 * starts that ticket's timer. Wraps the references plugin's link: every other
 * link, and every other post, renders exactly as it did.
 *
 * Which posts qualify and how a start runs come from `PlanStartProvider`,
 * read by each link through context, so the render plugins stay stable
 * while the feed changes underneath them.
 */
import { useTextRenderContext, type SuperChatRenderPlugin } from '@mieweb/ui/components/SuperChat';
import React, { createContext, useContext } from 'react';

import { TimerToggleButton } from '../../ui/TimerToggleButton';

export interface PlanStart {
  /** Ids of the posts whose ticket chips start timers. */
  postIds: ReadonlySet<string>;
  start: (ticketId: string, title: string) => void;
  isStarting: (ticketId: string) => boolean;
  /** Any start is in flight: one at a time, app-wide. */
  busy: boolean;
  /** The ticket running now, which needs no ▶. */
  runningTicketId: string | null;
  startLabel: (title: string) => string;
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
    if (!plan || !ticketId || !plan.postIds.has(messageId) || plan.runningTicketId === ticketId) {
      return link;
    }
    const title = textOf(props.node as HastNode | undefined) || ticketId;
    return (
      <span className="plan-ticket-start inline-flex items-center gap-1 align-middle">
        {link}
        <TimerToggleButton
          isRunning={false}
          isLoading={plan.isStarting(ticketId)}
          disabled={plan.busy}
          onClick={() => plan.start(ticketId, title)}
          ariaLabel={plan.startLabel(title)}
          className="h-6 w-6"
        />
      </span>
    );
  }

  return { ...plugin, components: { ...plugin.components, a: PlanTicketLink } };
}
