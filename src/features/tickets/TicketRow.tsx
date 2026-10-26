/**
 * TicketRow — one ticket in the ticket list.
 *
 * Renders a `UnifiedTicket` without caring which source it came from, as a
 * `RowListItem`, the same at every width: a line of where the ticket sits
 * (project, reference, last updated), then its title with its badges beside it
 * (assignees, status, priority, source, linked issue), wrapping as it narrows.
 *
 * An open ticket leads with its timer button; a closed one has its purple mark
 * there instead. The My Board button sits at the row's end, beside the ⋮ menu,
 * which offers the same in words. Every other action is in that menu and gated
 * on `ticket.capabilities`, so a source cannot render a control it is unable
 * to perform (Redmine issues, for instance, are never deleted).
 */
import {
  faEllipsisVertical,
  faExternalLink,
  faEye,
  faLink,
  faPen,
  faCircleCheck,
  faRightLeft,
  faTrash,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  Badge,
  Button,
  ButtonGroup,
  Checkbox,
  DropdownItem,
  DropdownSeparator,
  Tooltip,
} from '@mieweb/ui';
import { CircleUser, ClipboardCopy, ClipboardX } from 'lucide-react';
import React, { useCallback } from 'react';

import { timeAgo } from '../../lib/date';
import { useCopyLink } from '../../lib/useCopyLink';
import { useRouter } from '../../ui/router';
import { RowListItem } from '../../ui/RowList';
import { TimerToggleButton } from '../../ui/TimerToggleButton';

import { ticketTimerText } from '../timers/ticketTimerStrings';

import { BoardToggleButton } from './BoardToggleButton';
import { FilterDropdown } from './FilterDropdown';
import { boardText } from './boardStrings';
import { outsideRefOf } from './ticketIds';
import { useShowHuddleIds } from './useShowHuddleIds';
import { SOURCE_LABELS, ticketDetailPath, type UnifiedTicket } from './sources';

export interface TicketRowProps {
  ticket: UnifiedTicket;
  /** Whether the signed-in user created this ticket (gates edit/delete). */
  isCreator: boolean;
  selected: boolean;
  selecting: boolean;
  onSelectedChange: (ticket: UnifiedTicket, selected: boolean) => void;
  isTimerRunning: boolean;
  timerLoading: boolean;
  /** Another row's timer start or stop is in flight. */
  timerDisabled?: boolean;
  onToggleTimer: (ticket: UnifiedTicket) => void;
  /** Whether the ticket is on My Board; off it, starting a timer adds it first. */
  onBoard: boolean;
  /**
   * The board has been read. Until then "not on it" is not known, so the
   * toggle is off and the timer makes no promise about adding.
   */
  boardKnown: boolean;
  boardLoading: boolean;
  onToggleBoard: (ticket: UnifiedTicket) => void;
  onEditRequest: (ticket: UnifiedTicket) => void;
  onDeleteRequest: (ticket: UnifiedTicket) => void;
  onChangeStatusRequest: (ticket: UnifiedTicket) => void;
}

/**
 * The title button: wraps in full rather than truncating, since the title is
 * most of what tells one ticket from another and a phone has no hover tooltip.
 */
const TITLE_CLASS =
  'ticket-row-title h-auto max-w-full justify-start whitespace-normal break-words p-0 text-start text-sm leading-snug font-medium text-neutral-900 hover:bg-transparent hover:text-neutral-900 dark:text-neutral-100 dark:hover:bg-transparent dark:hover:text-neutral-100 [&_[data-slot=button-label]]:overflow-visible [&_[data-slot=button-label]]:whitespace-normal';

/** Assignee names a row shows before it counts the rest. */
const SHOWN_ASSIGNEES = 3;

const text = {
  select: (title: string) => `Select ${title}`,
  startTimer: (title: string) => `Start timer for ${title}`,
  stopTimer: (title: string) => `Stop timer for ${title}`,
  moreAssignees: (names: string[]) => `and ${names.join(', ')}`,
  viewProfile: (name: string) => `View ${name}'s profile`,
  updated: (date: string) => `Updated ${date}`,
  options: 'Ticket options',
  sharedWithTimeharbor: 'Shared with TimeHarbor',
};

/**
 * Map a normalized priority rank onto a badge tone. Low and unrecognized
 * priorities use `outline` rather than `secondary`, which is low enough
 * contrast to read as plain text next to the other badges.
 */
function priorityVariant(rank: number): 'danger' | 'warning' | 'default' | 'outline' {
  if (rank >= 4) return 'danger';
  if (rank === 3) return 'warning';
  if (rank === 2) return 'default';
  return 'outline';
}

export const TicketRow: React.FC<TicketRowProps> = ({
  ticket,
  isCreator,
  selected,
  selecting,
  onSelectedChange,
  isTimerRunning,
  timerLoading,
  timerDisabled = false,
  onToggleTimer,
  onBoard,
  boardKnown,
  boardLoading,
  onToggleBoard,
  onEditRequest,
  onDeleteRequest,
  onChangeStatusRequest,
}) => {
  const [showHuddleIds] = useShowHuddleIds();
  const { navigate } = useRouter();
  const copyLink = useCopyLink();
  const { capabilities, status, externalUrl, assignees } = ticket;
  // "Only the creator edits" is Huddle's own rule. An external source enforces
  // its own permissions server-side (Redmine checks the user's role and
  // workflow), so its rows offer the action and surface any refusal.
  const canEdit = capabilities.edit && (ticket.sourceId !== 'huddle' || isCreator);

  // Every source has an in-app page; a source's own page is a separate menu item.
  const openTicket = useCallback(() => navigate(ticketDetailPath(ticket)), [navigate, ticket]);
  const openExternal = useCallback(() => {
    if (externalUrl) window.open(externalUrl, '_blank', 'noopener,noreferrer');
  }, [externalUrl]);

  // Starting a timer puts the ticket on My Board, so off the board the button
  // says it will: in its name, and in its tooltip.
  const addsToBoard = boardKnown && !onBoard && !isTimerRunning;
  const leading = (
    <>
      {selecting && (
        <Checkbox
          size="sm"
          checked={selected}
          onChange={(e) => onSelectedChange(ticket, e.target.checked)}
          aria-label={text.select(ticket.title)}
        />
      )}
      {status.isClosed && !isTimerRunning ? (
        // A closed ticket is not timed from its row: its purple mark stands
        // where an open one has the timer. The status badge says it in words.
        <span className="ticket-row-closed flex h-8 w-8 shrink-0 items-center justify-center">
          <FontAwesomeIcon
            icon={faCircleCheck}
            className="text-base text-purple-500"
            aria-hidden="true"
          />
        </span>
      ) : (
        <TimerToggleButton
          isRunning={isTimerRunning}
          isLoading={timerLoading}
          disabled={timerDisabled || boardLoading}
          onClick={() => onToggleTimer(ticket)}
          title={addsToBoard ? ticketTimerText.addAndStart : undefined}
          ariaLabel={
            isTimerRunning
              ? text.stopTimer(ticket.title)
              : addsToBoard
                ? ticketTimerText.addAndStartLabel(ticket.title)
                : text.startTimer(ticket.title)
          }
          className="h-8 w-8 shrink-0"
        />
      )}
    </>
  );

  // Where the ticket sits, then what it is called by: project, reference, age.
  const updatedAt = ticket.updatedAt ?? ticket.createdAt;
  const refClass = 'ticket-row-ref font-semibold text-foreground';
  const outsideRef = outsideRefOf(ticket);
  const leadingRef = outsideRef ?? ticket.ref;
  const meta = (
    <span className="ticket-row-meta contents">
      {ticket.container?.name && (
        <span className="min-w-0 break-words">{ticket.container.name}</span>
      )}
      {/* The outside ID leads. Plain text for every source: where it comes from
          and its links belong to the ticket's page. */}
      <span className={refClass}>{leadingRef}</span>
      {showHuddleIds && outsideRef && (
        <span className="ticket-row-huddle-ref text-xs text-muted-foreground">{ticket.ref}</span>
      )}
      {updatedAt && (
        <time
          dateTime={updatedAt}
          title={text.updated(new Date(updatedAt).toLocaleString())}
          className="text-xs"
        >
          {timeAgo(updatedAt)}
        </time>
      )}
    </span>
  );

  const extraAssignees = assignees.slice(SHOWN_ASSIGNEES).map((a) => a.name);
  // One height for every badge: an outlined one is otherwise taller than a
  // filled one by its border. A minimum, so a label long enough to wrap grows
  // its badge instead of spilling out of it.
  const properties = (
    <span className="ticket-row-facts contents [&_[data-slot=badge]]:min-h-5 [&_[data-slot=badge]]:py-0">
      {/* Names, not avatars: initials alone say less, and there is no hover on a phone. */}
      {assignees.slice(0, SHOWN_ASSIGNEES).map((assignee) => {
        const badge = (
          <Badge variant="secondary" size="sm" className="max-w-[11rem]">
            <CircleUser className="me-1 h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{assignee.name}</span>
          </Badge>
        );
        // Only a Huddle assignee's id is a TimeHuddle user with a profile. A
        // button, so the row's own click leaves it be.
        return ticket.sourceId === 'huddle' ? (
          <Button
            key={assignee.id}
            variant="ghost"
            className="ticket-row-assignee h-auto min-w-0 rounded-full p-0 hover:bg-transparent hover:opacity-80 dark:hover:bg-transparent"
            onClick={() => navigate(`/app/profile/${assignee.id}`)}
            aria-label={text.viewProfile(assignee.name)}
          >
            {badge}
          </Button>
        ) : (
          <React.Fragment key={assignee.id}>{badge}</React.Fragment>
        );
      })}
      {extraAssignees.length > 0 && (
        <Tooltip content={extraAssignees.join(', ')}>
          <Badge variant="secondary" size="sm">
            <span aria-hidden="true">+{extraAssignees.length}</span>
            <span className="sr-only">{text.moreAssignees(extraAssignees)}</span>
          </Badge>
        </Tooltip>
      )}
      <Badge variant={status.isClosed ? 'secondary' : 'default'} size="sm">
        {status.native}
      </Badge>
      {ticket.priority && (
        <Badge variant={priorityVariant(ticket.priority.rank)} size="sm">
          {ticket.priority.native}
        </Badge>
      )}
      {ticket.sharedWithTimeharbor && (
        <Tooltip content={text.sharedWithTimeharbor}>
          <Badge variant="default" size="sm">
            TH
          </Badge>
        </Tooltip>
      )}
    </span>
  );

  const actions = (
    <>
      {/* The row's own actions, side by side: one group, as adjacent buttons are. */}
      <ButtonGroup orientation="horizontal" className="ticket-row-actions gap-1">
        <BoardToggleButton
          onBoard={onBoard}
          isLoading={boardLoading}
          // Not while this row's timer is starting: the start decides whether to
          // add the ticket from where the board stood when it was pressed.
          disabled={timerLoading || !boardKnown}
          onClick={() => onToggleBoard(ticket)}
          ariaLabel={
            onBoard ? boardText.removeLabel(ticket.title) : boardText.addLabel(ticket.title)
          }
          className="h-8 w-8 shrink-0"
        />
        {/* The same menu as the list header's: focus moves into it, the arrow
            keys walk it, Tab and Escape leave it, and a choice closes it. */}
        <FilterDropdown
          triggerAriaLabel={text.options}
          triggerClassName="rounded-md"
          trigger={
            <span className="ticket-row-menu-trigger flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
              <FontAwesomeIcon icon={faEllipsisVertical} className="text-sm" aria-hidden="true" />
            </span>
          }
        >
          <DropdownItem icon={<FontAwesomeIcon icon={faEye} />} onClick={openTicket}>
            Ticket Details
          </DropdownItem>
          <DropdownItem
            icon={<FontAwesomeIcon icon={faLink} />}
            onClick={() => void copyLink(ticketDetailPath(ticket))}
          >
            Copy Link
          </DropdownItem>
          {/* The same toggle as the row's own button, in words. */}
          <DropdownItem
            icon={
              onBoard ? (
                <ClipboardX className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <ClipboardCopy className="h-3.5 w-3.5" aria-hidden="true" />
              )
            }
            disabled={timerLoading || boardLoading || !boardKnown}
            onClick={() => onToggleBoard(ticket)}
          >
            {onBoard ? boardText.remove : boardText.add}
          </DropdownItem>
          {capabilities.openExternal && externalUrl && (
            <DropdownItem icon={<FontAwesomeIcon icon={faExternalLink} />} onClick={openExternal}>
              {`Open in ${SOURCE_LABELS[ticket.sourceId]}`}
            </DropdownItem>
          )}
          {canEdit && (
            <DropdownItem
              icon={<FontAwesomeIcon icon={faPen} />}
              onClick={() => onEditRequest(ticket)}
            >
              Edit Ticket
            </DropdownItem>
          )}
          {capabilities.changeStatus && (
            <DropdownItem
              icon={<FontAwesomeIcon icon={faRightLeft} />}
              onClick={() => onChangeStatusRequest(ticket)}
            >
              Change Status
            </DropdownItem>
          )}
          {capabilities.delete && isCreator && (
            <>
              <DropdownSeparator />
              <DropdownItem
                icon={<FontAwesomeIcon icon={faTrash} />}
                variant="danger"
                onClick={() => onDeleteRequest(ticket)}
              >
                Delete Ticket
              </DropdownItem>
            </>
          )}
        </FilterDropdown>
      </ButtonGroup>
    </>
  );

  return (
    <RowListItem
      data-ticket-key={ticket.key}
      data-ticket-id={ticket.id}
      data-ticket-source={ticket.sourceId}
      selected={selected}
      // The whole row opens the ticket, a bigger target than its title; the
      // keyboard path is the title, which is a real button.
      onOpen={openTicket}
      leading={leading}
      title={
        <Button variant="ghost" className={TITLE_CLASS} onClick={openTicket}>
          {ticket.title}
        </Button>
      }
      meta={meta}
      properties={properties}
      actions={actions}
    />
  );
};
