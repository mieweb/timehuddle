/**
 * TicketRow — one ticket in the ticket list.
 *
 * Renders a `UnifiedTicket` without caring which source it came from, as a
 * `RowListItem`, the same at every width: a line of where the ticket sits
 * (project, reference, last updated), its title, and under the title its
 * badges (assignees, status, priority, source, linked issue).
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
  Checkbox,
  DropdownContent,
  DropdownItem,
  DropdownSeparator,
  Tooltip,
} from '@mieweb/ui';
import { CircleUser, ClipboardCopy, ClipboardX } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { timeAgo } from '../../lib/date';
import { useCopyLink } from '../../lib/useCopyLink';
import { useRouter } from '../../ui/router';
import { RowListItem } from '../../ui/RowList';
import { TimerToggleButton } from '../../ui/TimerToggleButton';

import { ticketTimerText } from '../timers/ticketTimerStrings';

import { BoardToggleButton } from './BoardToggleButton';
import { boardText } from './boardStrings';
import { ticketLinkText } from './link/ticketLinkStrings';
import { SOURCE_LABELS, displaySourceId, ticketDetailPath, type UnifiedTicket } from './sources';

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
  'ticket-row-title h-auto w-full justify-start whitespace-normal break-words p-0 text-start text-base leading-snug font-medium text-neutral-900 hover:text-primary hover:underline dark:text-neutral-100 dark:hover:text-primary [&_[data-slot=button-label]]:overflow-visible [&_[data-slot=button-label]]:whitespace-normal';

/** Assignee names a row shows before it counts the rest. */
const SHOWN_ASSIGNEES = 3;

const text = {
  select: (title: string) => `Select ${title}`,
  startTimer: (title: string) => `Start timer for ${title}`,
  stopTimer: (title: string) => `Stop timer for ${title}`,
  moreAssignees: (names: string[]) => `and ${names.join(', ')}`,
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
  const { navigate } = useRouter();
  const copyLink = useCopyLink();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});

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

  // The options menu is portaled to <body> and positioned with `fixed`
  // coordinates computed from the trigger's own rect, so it escapes the list's
  // scroll area instead of being clipped by it.
  const updateMenuPosition = useCallback(() => {
    const trigger = menuTriggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const gutter = 8;
    setMenuStyle({
      position: 'fixed',
      top: rect.bottom + 8,
      right: Math.max(gutter, window.innerWidth - rect.right),
      left: 'auto',
    });
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    updateMenuPosition();
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [menuOpen, updateMenuPosition]);

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuTriggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  // Starting a timer puts the ticket on My Board, so off the board the button
  // says it will: in its name, and in its tooltip.
  const addsToBoard = boardKnown && !onBoard && !isTimerRunning;
  const leading = (
    <>
      {selecting && (
        <Checkbox
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
  const meta = (
    <span className="ticket-row-meta contents">
      {ticket.container?.name && (
        <span className="min-w-0 break-words">{ticket.container.name}</span>
      )}
      {ticket.externalRef ? (
        <a
          href={ticket.externalRef.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${ticket.ref}, ${ticket.externalRef.label}`}
          className={`${refClass} inline-flex items-center gap-1 hover:underline`}
        >
          {ticket.ref}
          <FontAwesomeIcon icon={faExternalLink} className="text-[9px]" aria-hidden="true" />
        </a>
      ) : (
        <span className={refClass}>{ticket.ref}</span>
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
      {assignees.slice(0, SHOWN_ASSIGNEES).map((assignee) => (
        <Badge key={assignee.id} variant="secondary" size="sm" className="max-w-[11rem]">
          <CircleUser className="me-1 h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{assignee.name}</span>
        </Badge>
      ))}
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
      <Badge variant="outline" size="sm">
        {SOURCE_LABELS[displaySourceId(ticket)]}
      </Badge>
      {ticket.linked && (
        <Tooltip
          content={
            ticket.linked.status
              ? ticketLinkText.linkedToWithStatus(ticket.linked.ref, ticket.linked.status.native)
              : ticketLinkText.linkedTo(ticket.linked.ref)
          }
        >
          <Badge variant="outline" size="sm">
            <FontAwesomeIcon icon={faLink} className="me-1 text-[10px]" aria-hidden="true" />
            {ticket.linked.ref}
          </Badge>
        </Tooltip>
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
      <BoardToggleButton
        onBoard={onBoard}
        isLoading={boardLoading}
        // Not while this row's timer is starting: the start decides whether to
        // add the ticket from where the board stood when it was pressed.
        disabled={timerLoading || !boardKnown}
        onClick={() => onToggleBoard(ticket)}
        ariaLabel={onBoard ? boardText.removeLabel(ticket.title) : boardText.addLabel(ticket.title)}
        className="h-8 w-8 shrink-0"
      />
      <Button
        ref={menuTriggerRef}
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        aria-label={text.options}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((o) => !o)}
      >
        <FontAwesomeIcon icon={faEllipsisVertical} className="text-sm" />
      </Button>
      {menuOpen &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={menuStyle}
            className="z-99999 max-w-xs overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-800"
          >
            <DropdownContent className="bg-white dark:bg-neutral-800">
              <DropdownItem
                icon={<FontAwesomeIcon icon={faEye} />}
                onClick={() => {
                  setMenuOpen(false);
                  openTicket();
                }}
              >
                Ticket Details
              </DropdownItem>
              <DropdownItem
                icon={<FontAwesomeIcon icon={faLink} />}
                onClick={() => {
                  setMenuOpen(false);
                  void copyLink(ticketDetailPath(ticket));
                }}
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
                onClick={() => {
                  setMenuOpen(false);
                  onToggleBoard(ticket);
                }}
              >
                {onBoard ? boardText.remove : boardText.add}
              </DropdownItem>
              {capabilities.openExternal && externalUrl && (
                <DropdownItem
                  icon={<FontAwesomeIcon icon={faExternalLink} />}
                  onClick={() => {
                    setMenuOpen(false);
                    openExternal();
                  }}
                >
                  {`Open in ${SOURCE_LABELS[ticket.sourceId]}`}
                </DropdownItem>
              )}
              {canEdit && (
                <DropdownItem
                  icon={<FontAwesomeIcon icon={faPen} />}
                  onClick={() => {
                    setMenuOpen(false);
                    onEditRequest(ticket);
                  }}
                >
                  Edit Ticket
                </DropdownItem>
              )}
              {capabilities.changeStatus && (
                <DropdownItem
                  icon={<FontAwesomeIcon icon={faRightLeft} />}
                  onClick={() => {
                    setMenuOpen(false);
                    onChangeStatusRequest(ticket);
                  }}
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
                    onClick={() => {
                      setMenuOpen(false);
                      onDeleteRequest(ticket);
                    }}
                  >
                    Delete Ticket
                  </DropdownItem>
                </>
              )}
            </DropdownContent>
          </div>,
          document.body,
        )}
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
