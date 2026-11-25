/**
 * A "Working on …" update with its time: the ticket link in the update a timer
 * start posted gets a `TimePill` beside it, ticking while the timer runs and
 * stopped once it stops. Coming back to a ticket continues its time this
 * session: the pill counts on from what the ticket had before this stint. The time is the timer session's
 * (`HuddlePost.timer`, read with the post), so it stays right after the update
 * is long scrolled past.
 *
 * Which posts have a timer comes from `WorkingTimersProvider`, read by each
 * link through context, so the render plugins stay stable while the feed
 * changes underneath them.
 */
import { useTextRenderContext, type SuperChatRenderPlugin } from '@mieweb/ui/components/SuperChat';
import React, { createContext, useContext } from 'react';

import { TimePill } from '../../ui/TimePill';
import { ticketTimerText } from '../timers/ticketTimerStrings';

export interface PostTimer {
  startTime: number;
  /** Null while it runs. */
  endTime: number | null;
  /** The ticket's time this clock session before this stint: the pill counts on from it. */
  priorSeconds?: number;
}

const WorkingTimersContext = createContext<ReadonlyMap<string, PostTimer>>(new Map());

/** The timer each update post started, by post id. */
export const WorkingTimersProvider = WorkingTimersContext.Provider;

interface HastNode {
  type?: string;
  value?: string;
  children?: HastNode[];
}

function textOf(node: HastNode | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return node.value ?? '';
  return (node.children ?? []).map(textOf).join('');
}

/** `plugin` with a stint's time beside the ticket link of a post that started a timer. */
export function withWorkingTimer(plugin: SuperChatRenderPlugin): SuperChatRenderPlugin {
  const found = plugin.components?.a;
  if (!found) return plugin;
  const Link: React.ComponentType<Record<string, unknown>> = found;

  function WorkingTicketLink(props: Record<string, unknown>) {
    const timers = useContext(WorkingTimersContext);
    const { messageId } = useTextRenderContext();
    const link = <Link {...props} />;
    const timer = timers.get(messageId);
    if (!timer) return link;
    const running = timer.endTime === null;
    const priorMs = (timer.priorSeconds ?? 0) * 1000;
    const title = textOf(props.node as HastNode | undefined);
    return (
      <span className="working-on-ticket inline-flex max-w-full flex-wrap items-center gap-1 align-middle">
        <span className="flex min-w-0">{link}</span>
        <TimePill
          runningSince={running ? timer.startTime - priorMs : null}
          seconds={running ? 0 : Math.max(0, (timer.endTime! - timer.startTime + priorMs) / 1000)}
          label={ticketTimerText.workingTimeLabel(title, running)}
        />
      </span>
    );
  }

  return { ...plugin, components: { ...plugin.components, a: WorkingTicketLink } };
}
