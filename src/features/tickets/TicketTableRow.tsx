/**
 * TicketTableRow — one row of the unified ticket table.
 *
 * Renders a `UnifiedTicket` without caring which source it came from. Every
 * action is gated on `ticket.capabilities`, so a source cannot render a control
 * it is unable to perform (Redmine issues, for instance, are never deleted).
 *
 * My Board and the timer are the exception to "actions live in the ⋮ menu":
 * every row carries both buttons ahead of its title, on both views.
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
  ButtonGroup,
  Checkbox,
  DropdownContent,
  DropdownItem,
  DropdownSeparator,
  TableCell,
  TableRow,
  Text,
  Tooltip,
} from '@mieweb/ui';
import { CircleUser } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { timeAgo } from '../../lib/date';
import { useCopyLink } from '../../lib/useCopyLink';
import { OverflowTooltip } from '../../ui/OverflowTooltip';
import { useRouter } from '../../ui/router';
import { TimerToggleButton } from '../../ui/TimerToggleButton';
import { UserAvatar } from '../../ui/UserAvatar';
import { ticketTimerText } from '../timers/ticketTimerStrings';

import { BoardToggleButton } from './BoardToggleButton';
import { boardText } from './boardStrings';
import { ticketLinkText } from './link/ticketLinkStrings';
import { SOURCE_LABELS, displaySourceId, ticketDetailPath, type UnifiedTicket } from './sources';

export interface TicketTableRowProps {
  ticket: UnifiedTicket;
  /** Whether the signed-in user created this ticket (gates edit/delete). */
  isCreator: boolean;
  selected: boolean;
  onSelectedChange: (ticket: UnifiedTicket, selected: boolean) => void;
  isTimerRunning: boolean;
  timerLoading: boolean;
  /** Another row's timer start or stop is in flight. */
  timerDisabled?: boolean;
  onToggleTimer: (ticket: UnifiedTicket) => void;
  /** Whether the ticket is on My Board; off it, starting a timer adds it first. */
  onBoard: boolean;
  boardLoading: boolean;
  onToggleBoard: (ticket: UnifiedTicket) => void;
  onEditRequest: (ticket: UnifiedTicket) => void;
  onDeleteRequest: (ticket: UnifiedTicket) => void;
  onChangeStatusRequest: (ticket: UnifiedTicket) => void;
  /**
   * Phone layout: the title in full, a line of where the ticket sits, and a
   * line of badges, in place of one column per fact. The table decides; see
   * `TicketTable`.
   */
  compact?: boolean;
  /** Whether the row has its select checkbox; a compact row only does in selection mode. */
  showSelectColumn?: boolean;
}

/** The title button's look, shared by the one-line (table) and wrapping (phone) forms. */
const TITLE_CLASS =
  'h-auto justify-start p-0 text-left text-sm font-medium text-neutral-900 hover:text-primary hover:underline dark:text-neutral-100 dark:hover:text-primary';

/**
 * A compact row's first line: the height of one line of the title. The status
 * dot is centred in a box this tall, and the timer button, on top of the board
 * button it is stacked with, is centred on the same line.
 */
const FIRST_LINE_CLASS = 'h-5';

/** Assignee names a compact row shows before it counts the rest. */
const COMPACT_ASSIGNEES = 2;

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

export const TicketTableRow: React.FC<TicketTableRowProps> = ({
  ticket,
  isCreator,
  selected,
  onSelectedChange,
  isTimerRunning,
  timerLoading,
  timerDisabled = false,
  onToggleTimer,
  onBoard,
  boardLoading,
  onToggleBoard,
  onEditRequest,
  onDeleteRequest,
  onChangeStatusRequest,
  compact = false,
  showSelectColumn = true,
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
  // The whole row opens the ticket, a bigger target than its title. This is a
  // pointer convenience only: the keyboard path is the title, which is a real
  // button, so the row itself takes no tab stop or role. Controls
  // keep their own job: the select, timer and menu cells, and anything
  // clickable inside the row (the menu is portaled out of the row's DOM, but
  // its clicks still bubble here through React). A click that ends a text
  // selection is someone copying, not opening.
  const openFromRow = useCallback(
    (event: React.MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('[data-row-control], button, a, input, label, [role="menu"]')) return;
      if (window.getSelection()?.toString()) return;
      openTicket();
    },
    [openTicket],
  );
  const openExternal = useCallback(() => {
    if (externalUrl) window.open(externalUrl, '_blank', 'noopener,noreferrer');
  }, [externalUrl]);

  // The options menu is portaled to <body> and positioned with `fixed`
  // coordinates computed from the trigger's own rect, so it escapes the
  // table's horizontal-scroll wrapper instead of being clipped by it.
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

  // The row's facts, built once and laid out twice: one per column on a wide
  // screen, or as a line under the title in the compact (phone) row.
  const statusDot = <FontAwesomeIcon icon={icon} className={`shrink-0 text-sm ${iconClass}`} />;
  const linkedBadge = ticket.linked && (
    <Tooltip
      content={
        ticket.linked.status
          ? ticketLinkText.linkedToWithStatus(ticket.linked.ref, ticket.linked.status.native)
          : ticketLinkText.linkedTo(ticket.linked.ref)
      }
    >
      <Badge variant="outline" size="sm" className="shrink-0">
        <FontAwesomeIcon icon={faLink} className="me-1 text-[10px]" aria-hidden="true" />
        {ticket.linked.ref}
      </Badge>
    </Tooltip>
  );
  const timeharborBadge = ticket.sharedWithTimeharbor && (
    <Tooltip content="Shared with TimeHarbor">
      <Badge variant="default" size="sm">
        TH
      </Badge>
    </Tooltip>
  );
  const titleLine = (
    <div className="flex min-w-0 items-center gap-2">
      {statusDot}
      <OverflowTooltip content={ticket.title} className="flex-1">
        <Button
          variant="ghost"
          className={`${TITLE_CLASS} min-w-0 flex-1 truncate`}
          onClick={openTicket}
        >
          {ticket.title}
        </Button>
      </OverflowTooltip>
      {linkedBadge}
      {timeharborBadge}
    </div>
  );
  const refNode = (
    <>
      {ticket.externalRef ? (
        <Tooltip content={ticket.externalRef.label}>
          <a
            href={ticket.externalRef.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-blue-500 hover:underline dark:text-neutral-400"
          >
            {ticket.ref}
            <FontAwesomeIcon icon={faExternalLink} className="text-[10px]" />
          </a>
        </Tooltip>
      ) : (
        <Text size="sm" variant="muted">
          {ticket.ref}
        </Text>
      )}
    </>
  );
  const statusBadge = (
    <Badge variant={status.isClosed ? 'secondary' : 'default'} size="sm">
      {status.native}
    </Badge>
  );
  const priorityBadge = ticket.priority ? (
    <Badge variant={priorityVariant(ticket.priority.rank)} size="sm">
      {ticket.priority.native}
    </Badge>
  ) : null;
  const assigneeList =
    assignees.length > 0 ? (
      <div className="flex -space-x-1">
        {assignees.slice(0, 3).map((assignee) => {
          // Only Huddle assignee ids resolve to an in-app profile route.
          const avatar = <UserAvatar name={assignee.name} size="xs" />;
          return (
            <Tooltip key={assignee.id} content={assignee.name}>
              {ticket.sourceId === 'huddle' ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-auto w-auto rounded-full p-0 ring-2 ring-white transition-opacity hover:z-10 hover:opacity-80 dark:ring-neutral-900"
                  onClick={() => navigate(`/app/profile/${assignee.id}`)}
                  aria-label={`View ${assignee.name}'s profile`}
                >
                  {avatar}
                </Button>
              ) : (
                <div className="rounded-full ring-2 ring-white dark:ring-neutral-900">{avatar}</div>
              )}
            </Tooltip>
          );
        })}
        {assignees.length > 3 && (
          <Tooltip
            content={assignees
              .slice(3)
              .map((a) => a.name)
              .join(', ')}
          >
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-200 text-[10px] font-medium text-neutral-600 ring-2 ring-white dark:bg-neutral-700 dark:text-neutral-300 dark:ring-neutral-900">
              +{assignees.length - 3}
            </div>
          </Tooltip>
        )}
      </div>
    ) : null;

  // In a compact row the controls sit on the title's first line, not midway
  // down a row that is three lines tall.
  const selectCell = showSelectColumn && (
    <TableCell className={compact ? 'pl-4 pt-3.5 align-top' : 'pl-4'} data-row-control>
      <Checkbox
        checked={selected}
        onChange={(e) => onSelectedChange(ticket, e.target.checked)}
        aria-label={`Select ${ticket.title}`}
      />
    </TableCell>
  );
  // Starting a timer puts the ticket on My Board, so off the board the button
  // says it will. In words on a wide row; a phone row has room for the icon only.
  const addsToBoard = !onBoard && !isTimerRunning;
  // On a phone, the height of the toolbar's buttons rather than a full icon button.
  const quickButtonClass = 'h-8 shrink-0';
  const boardButton = (
    <BoardToggleButton
      onBoard={onBoard}
      isLoading={boardLoading}
      // Not while this row's timer is starting: the start decides whether to
      // add the ticket from where the board stood when it was pressed.
      disabled={timerLoading}
      onClick={() => onToggleBoard(ticket)}
      ariaLabel={onBoard ? boardText.removeLabel(ticket.title) : boardText.addLabel(ticket.title)}
      className={`${quickButtonClass} w-8`}
    />
  );
  const timerButton = (
    <TimerToggleButton
      isRunning={isTimerRunning}
      isLoading={timerLoading}
      disabled={timerDisabled || boardLoading}
      onClick={() => onToggleTimer(ticket)}
      label={addsToBoard && !compact ? ticketTimerText.addAndStart : undefined}
      ariaLabel={
        isTimerRunning
          ? `Stop timer for ${ticket.title}`
          : addsToBoard
            ? ticketTimerText.addAndStartLabel(ticket.title)
            : `Start timer for ${ticket.title}`
      }
      className={`${quickButtonClass} ${addsToBoard && !compact ? '' : 'w-8'}`}
    />
  );
  const quickActionsCell = (
    <TableCell
      className={
        compact ? `${showSelectColumn ? 'pl-2' : 'pl-4'} pr-0 pt-3 pb-2 align-top` : 'pl-2'
      }
      data-row-control
    >
      {/* On a phone the two are stacked, to leave the width to the title, with
          the timer on top as the one pressed most: it is pulled up to centre on
          the title's first line, beside the status dot (a 32px button on a
          20px line). */}
      <ButtonGroup
        orientation={compact ? 'vertical' : 'horizontal'}
        className={`ticket-row-quick-actions gap-1 ${compact ? '-mt-1.5 items-start' : 'justify-start'}`}
      >
        {compact ? (
          <>
            {timerButton}
            {boardButton}
          </>
        ) : (
          <>
            {boardButton}
            {timerButton}
          </>
        )}
      </ButtonGroup>
    </TableCell>
  );

  const sourceBadge = (
    <Badge variant="outline" size="sm">
      {SOURCE_LABELS[displaySourceId(ticket)]}
    </Badge>
  );
  const updatedAt = ticket.updatedAt ?? ticket.createdAt;
  const updatedText = updatedAt ? timeAgo(updatedAt) : null;

  // The compact row's second line: reference, project and age, dot-separated.
  const metaItems = [
    ticket.externalRef ? (
      <a
        href={ticket.externalRef.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${ticket.ref}, ${ticket.externalRef.label}`}
        className="hover:text-foreground hover:underline"
      >
        {ticket.ref}
      </a>
    ) : (
      ticket.ref
    ),
    ticket.container?.name,
    updatedText,
  ].filter(Boolean);

  const factCells = compact ? (
    // Phone: no sideways scroll, and no column per fact. The title, in full;
    // then where the ticket sits; then who has it and what state it is in.
    <TableCell className="py-3 ps-2 pe-1 align-top">
      <div className="ticket-row-compact flex min-w-0 items-start gap-2">
        <span className={`ticket-row-status flex shrink-0 items-center ${FIRST_LINE_CLASS}`}>
          {statusDot}
        </span>
        <div className="ticket-row-body flex min-w-0 flex-1 flex-col gap-1.5">
          {/* Wraps instead of truncating: on a phone the title is most of what
              tells one ticket from another, and there is no tooltip to hover. */}
          <Button
            variant="ghost"
            className={`ticket-row-title ${TITLE_CLASS} w-full whitespace-normal break-words [&_[data-slot=button-label]]:overflow-visible [&_[data-slot=button-label]]:whitespace-normal`}
            onClick={openTicket}
          >
            {ticket.title}
          </Button>

          <div className="ticket-row-meta flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            {metaItems.map((item, index) => (
              <React.Fragment key={index}>
                {index > 0 && <span aria-hidden="true">•</span>}
                <span className="min-w-0 truncate">{item}</span>
              </React.Fragment>
            ))}
          </div>

          {/* One height for every badge: an outlined one is otherwise taller
              than a filled one by its border. A minimum, so a label long
              enough to wrap grows its badge instead of spilling out of it. */}
          <div className="ticket-row-facts flex min-w-0 flex-wrap items-center gap-1.5 [&_[data-slot=badge]]:min-h-5 [&_[data-slot=badge]]:py-0">
            {/* Names, not avatars: there is room, and initials alone say less. */}
            {assignees.slice(0, COMPACT_ASSIGNEES).map((assignee) => (
              <Badge key={assignee.id} variant="secondary" size="sm" className="max-w-[11rem]">
                <CircleUser className="me-1 h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{assignee.name}</span>
              </Badge>
            ))}
            {assignees.length > COMPACT_ASSIGNEES && (
              <Text size="xs" variant="muted">
                +{assignees.length - COMPACT_ASSIGNEES}
              </Text>
            )}
            {sourceBadge}
            {statusBadge}
            {priorityBadge}
            {linkedBadge}
            {timeharborBadge}
          </div>
        </div>
      </div>
    </TableCell>
  ) : (
    <>
      <TableCell className="overflow-hidden">{titleLine}</TableCell>
      <TableCell className="whitespace-nowrap">{refNode}</TableCell>
      <TableCell className="whitespace-nowrap">{sourceBadge}</TableCell>
      <TableCell className="whitespace-nowrap">{statusBadge}</TableCell>
      <TableCell className="whitespace-nowrap">
        {priorityBadge ?? (
          <Text size="sm" variant="muted">
            —
          </Text>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {assigneeList ?? (
          <Text size="sm" variant="muted">
            Unassigned
          </Text>
        )}
      </TableCell>
      <TableCell className="overflow-hidden">
        <OverflowTooltip content={ticket.container?.name ?? '—'}>
          <Text size="sm" variant="muted" className="block min-w-0 truncate">
            {ticket.container?.name ?? '—'}
          </Text>
        </OverflowTooltip>
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <Text size="sm" variant="muted">
          {updatedText ?? '—'}
        </Text>
      </TableCell>
    </>
  );

  return (
    <TableRow
      selected={selected}
      data-ticket-key={ticket.key}
      data-ticket-id={ticket.id}
      data-ticket-source={ticket.sourceId}
      className="cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800/40"
      onClick={openFromRow}
    >
      {selectCell}
      {quickActionsCell}
      {factCells}

      <TableCell
        className={compact ? 'pr-2 pt-1 pb-0 text-end align-top' : 'pr-4 text-end'}
        data-row-control
      >
        <Button
          ref={menuTriggerRef}
          variant="ghost"
          size="icon"
          aria-label="Ticket options"
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
      </TableCell>
    </TableRow>
  );
};
