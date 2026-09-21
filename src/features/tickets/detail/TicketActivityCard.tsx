/**
 * The Activity card both ticket pages share (Huddle ticket, Redmine issue).
 *
 * It sizes to its content, but never grows taller than the viewport leaves
 * room for: past that, the list scrolls inside the card, so a long history
 * never pushes the rest of the page away.
 */
import { Card, CardContent, ScrollArea, Text } from '@mieweb/ui';
import React from 'react';

import { UserAvatar } from '../../../ui/UserAvatar';

import type { ActivityEntry } from './activityEntries';

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export interface TicketActivityCardProps {
  entries: ActivityEntry[];
  /** Shown under the heading, e.g. what the timeline includes. */
  note?: string;
}

export function TicketActivityCard({ entries, note }: TicketActivityCardProps) {
  return (
    <Card>
      <CardContent className="ticket-activity-section">
        <div className="ticket-activity-header mb-3">
          <Text size="sm" className="font-semibold text-neutral-700 dark:text-neutral-300">
            Activity
          </Text>
          {note && (
            <Text size="xs" variant="muted">
              {note}
            </Text>
          )}
        </div>
        {entries.length === 0 ? (
          <Text size="sm" className="italic text-neutral-400">
            No activity yet.
          </Text>
        ) : (
          // 12rem leaves room for the app header and the card's own chrome.
          <ScrollArea className="ticket-activity-scroll max-h-[calc(100dvh-12rem)] pr-2">
            <ol className="ticket-activity-list space-y-4" aria-label="Ticket activity">
              {entries.map((entry) => (
                <li
                  key={entry.id}
                  className="ticket-activity-item flex items-start gap-2"
                  data-activity-kind={entry.kind}
                >
                  <UserAvatar size="xs" name={entry.actorName} />
                  <div className="ticket-activity-body min-w-0">
                    <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
                      {entry.actorName}
                    </span>{' '}
                    <span className="text-sm text-neutral-500 dark:text-neutral-400">
                      {entry.text}
                    </span>
                    {entry.detail && (
                      <div
                        className={
                          entry.kind === 'comment' || entry.kind === 'event'
                            ? 'ticket-activity-comment mt-1 whitespace-pre-wrap rounded-md bg-neutral-50 p-2 text-sm text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300'
                            : 'ticket-activity-detail text-xs text-neutral-500 dark:text-neutral-400'
                        }
                      >
                        {entry.detail}
                      </div>
                    )}
                    <div className="ticket-activity-time mt-0.5 text-xs text-neutral-400">
                      <time dateTime={entry.at}>{formatWhen(entry.at)}</time>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
