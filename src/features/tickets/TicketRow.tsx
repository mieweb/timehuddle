/**
 * TicketRow — one ticket in the ticket list.
 *
 * Renders a `UnifiedTicket` without caring which source it came from, as a
 * `RowListItem`: the title, a line of where the ticket sits (reference,
 * project, last updated), and its properties (status, priority, source, linked
 * issue, assignees). The row lays those out by the room it has; see `RowList`.
 *
 * Every action is gated on `ticket.capabilities`, so a source cannot render a
 * control it is unable to perform (Redmine issues, for instance, are never
 * deleted). Timers are the exception to "actions live in the ⋮ menu": a row
 * starts one only from My Board's ▶/⏸ button, never from the menu.
 */
import {
  faEllipsisVertical,
  faExternalLink,
  faEye,
  faLink,
  faPen,
  faCircleCheck,
  faCircleDot,
  faCircleXmark,
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
import { CircleUser } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { timeAgo } from '../../lib/date';
import { useCopyLink } from '../../lib/useCopyLink';
import { useRouter } from '../../ui/router';
import { RowListItem } from '../../ui/RowList';
import { TimerToggleButton } from '../../ui/TimerToggleButton';

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
  /**
   * My Board only. Renders the ▶/⏸ button between the checkbox and the title.
   * My Board is the only *list* that starts a ticket timer, so no other list
   * passes this. (Redmine search suggestions start one too.)
   */
  showTimer?: boolean;
  onEditRequest: (ticket: UnifiedTicket) => void;
  onDeleteRequest: (ticket: UnifiedTicket) => void;
  onChangeStatusRequest: (ticket: UnifiedTicket) => void;
}

/**
 * The title button: wraps in full rather than truncating, since the title is
 * most of what tells one ticket from another and a phone has no hover tooltip.
 */
const TITLE_CLASS =
  'ticket-row-title h-auto w-full justify-start whitespace-normal break-words p-0 text-start text-sm font-medium text-neutral-900 hover:text-primary hover:underline dark:text-neutral-100 dark:hover:text-primary [&_[data-slot=button-label]]:overflow-visible [&_[data-slot=button-label]]:whitespace-normal';

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

function statusIconFor(status: UnifiedTicket['status']): {
  icon: typeof faCircleDot;
  className: string;
} {
  if (status.isClosed) return { icon: faCircleCheck, className: 'text-purple-500' };
  if (status.native === 'blocked') return { icon: faCircleXmark, className: 'text-amber-500' };
  return { icon: faCircleDot, className: 'text-green-500' };
}

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
  showTimer = false,
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
  const { icon, className: iconClass } = statusIconFor(status);
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

  const leading = (
    <>
      {selecting && (
        <Checkbox
          checked={selected}
          onChange={(e) => onSelectedChange(ticket, e.target.checked)}
          aria-label={text.select(ticket.title)}
        />
      )}
      {showTimer && (
        <TimerToggleButton
          isRunning={isTimerRunning}
          isLoading={timerLoading}
          disabled={timerDisabled}
          onClick={() => onToggleTimer(ticket)}
          ariaLabel={isTimerRunning ? text.stopTimer(ticket.title) : text.startTimer(ticket.title)}
          className="h-8 w-8"
        />
      )}
      <FontAwesomeIcon
        icon={icon}
        className={`ticket-row-status shrink-0 text-sm ${iconClass}`}
        aria-hidden="true"
      />
    </>
  );

  // Where the ticket sits: reference, project and age, dot-separated.
  const updatedAt = ticket.updatedAt ?? ticket.createdAt;
  const metaItems = [
    ticket.externalRef ? (
      <a
        href={ticket.externalRef.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${ticket.ref}, ${ticket.externalRef.label}`}
        className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
      >
        {ticket.ref}
        <FontAwesomeIcon icon={faExternalLink} className="text-[9px]" aria-hidden="true" />
      </a>
    ) : (
      ticket.ref
    ),
    ticket.container?.name,
    updatedAt && (
      <time dateTime={updatedAt} title={text.updated(new Date(updatedAt).toLocaleString())}>
        {timeAgo(updatedAt)}
      </time>
    ),
  ].filter(Boolean);
  const meta = (
    <span className="ticket-row-meta contents">
      {metaItems.map((item, index) => (
        <React.Fragment key={index}>
          {index > 0 && <span aria-hidden="true">•</span>}
          <span className="min-w-0 break-words">{item}</span>
        </React.Fragment>
      ))}
    </span>
  );

  const extraAssignees = assignees.slice(SHOWN_ASSIGNEES).map((a) => a.name);
  // One height for every badge: an outlined one is otherwise taller than a
  // filled one by its border. A minimum, so a label long enough to wrap grows
  // its badge instead of spilling out of it.
  const properties = (
    <span className="ticket-row-facts contents [&_[data-slot=badge]]:min-h-5 [&_[data-slot=badge]]:py-0">
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
    </span>
  );

  const actions = (
    <>
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
