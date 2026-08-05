/**
 * WorkspaceGreeting — the warm "hello, and here's where you are" banner that
 * opens the Dashboard and the Clock page.
 *
 * Two jobs at once. It greets you, and — more usefully — it says in plain
 * words which workspace you're about to act on. The header's org/team switcher
 * technically already shows that, but it reads as a control rather than a
 * statement, which is how people end up logging hours against the wrong team.
 *
 * The shell is shared; the `note` is not. What a workspace *means* differs by
 * page ("these are the numbers for X" vs "your hours land in X"), so each page
 * passes its own line rather than reusing one vague sentence.
 */
import { faLock, faMoon, faSun, faUsers } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { cn, Text } from '@mieweb/ui';
import React from 'react';

import { useWorkspaceGreeting } from '../lib/useWorkspaceGreeting';
import { UserAvatar } from './UserAvatar';

interface Props {
  /** Page-specific line: what this particular page does with the workspace. */
  note?: string;
  /**
   * Optional block pinned to the trailing edge — the Dashboard puts the live
   * session summary here rather than spending a whole card on it.
   */
  trailing?: React.ReactNode;
  className?: string;
}

export const WorkspaceGreeting: React.FC<Props> = ({ note, trailing, className }) => {
  const { greeting, partOfDay, userName, userImage, workspaceLabel, isPersonalWorkspace, ready } =
    useWorkspaceGreeting();

  if (!ready) return null;

  const isEvening = partOfDay === 'evening';

  return (
    <div
      className={cn(
        'workspace-greeting relative flex shrink-0 flex-wrap items-center gap-4 overflow-hidden rounded-2xl border px-4 py-4 sm:px-5',
        // Warm at the start of the day, cool once it's dark out — the same
        // signal the sun/moon badge carries, so the card feels like the time
        // rather than just stating it.
        isEvening
          ? 'border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-violet-50 dark:border-indigo-900/40 dark:from-indigo-950/40 dark:via-neutral-900 dark:to-violet-950/30'
          : 'border-amber-100 bg-gradient-to-br from-amber-50 via-white to-rose-50 dark:border-amber-900/30 dark:from-amber-950/30 dark:via-neutral-900 dark:to-rose-950/20',
        className,
      )}
    >
      {/* Avatar with a sun/moon badge tucked into the corner. */}
      <div className="relative shrink-0">
        <UserAvatar name={userName} src={userImage} size="lg" />
        <span
          className={cn(
            'absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full text-[11px] shadow-sm ring-2 ring-white dark:ring-neutral-900',
            isEvening ? 'bg-indigo-500 text-white' : 'bg-amber-400 text-amber-950',
          )}
          aria-hidden="true"
        >
          <FontAwesomeIcon icon={isEvening ? faMoon : faSun} />
        </span>
      </div>

      <div className="min-w-0 flex-1 basis-56">
        <Text as="h2" size="lg" weight="semibold" className="truncate">
          {greeting} <span aria-hidden="true">👋</span>
        </Text>

        {/* Workspace pill — the part worth actually noticing. */}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className={cn(
              'inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
              isPersonalWorkspace
                ? 'bg-neutral-900/5 text-neutral-700 dark:bg-white/10 dark:text-neutral-200'
                : 'bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300',
            )}
          >
            <FontAwesomeIcon
              icon={isPersonalWorkspace ? faLock : faUsers}
              className="shrink-0 text-[10px]"
            />
            <span className="truncate">
              {isPersonalWorkspace ? 'Personal workspace' : workspaceLabel}
            </span>
          </span>
          <Text variant="muted" size="xs">
            {isPersonalWorkspace ? 'Only you can see this' : 'Shared with your team'}
          </Text>
        </div>

        {note && (
          <Text variant="muted" size="sm" className="mt-2">
            {note}
          </Text>
        )}
      </div>

      {trailing && <div className="w-full shrink-0 sm:w-auto">{trailing}</div>}
    </div>
  );
};
