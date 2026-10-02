/**
 * TicketTableRow — one row of the unified ticket table.
 *
 * Renders a `UnifiedTicket` without caring which source it came from. Every
 * action is gated on `ticket.capabilities`, so a source cannot render a control
 * it is unable to perform (Redmine issues, for instance, are never deleted).
 *
 * Timers are the exception to "actions live in the ⋮ menu": a row starts one
 * only from My Board's ▶/⏸ column, never from the menu.
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
  TableCell,
  TableRow,
  Text,
  Tooltip,
} from '@mieweb/ui';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { timeAgo } from '../../lib/date';
import { useCopyLink } from '../../lib/useCopyLink';
import { OverflowTooltip } from '../../ui/OverflowTooltip';
import { useRouter } from '../../ui/router';
import { TimerToggleButton } from '../../ui/TimerToggleButton';
import { UserAvatar } from '../../ui/UserAvatar';

import { SOURCE_LABELS, ticketDetailPath, type UnifiedTicket } from './sources';

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
  /**
   * My Board only. Renders the ▶/⏸ column between the checkbox and Title
   * cells. My Board is the only *table* that starts a ticket timer, so no other
   * table passes this. (Redmine search suggestions start one too.)
   */
  showTimerColumn?: boolean;
  onEditRequest: (ticket: UnifiedTicket) => void;
  onDeleteRequest: (ticket: UnifiedTicket) => void;
  onChangeStatusRequest: (ticket: UnifiedTicket) => void;
}

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
  showTimerColumn = false,
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

  return (
    <TableRow
      selected={selected}
      data-ticket-key={ticket.key}
      data-ticket-id={ticket.id}
      data-ticket-source={ticket.sourceId}
      className="hover:bg-neutral-50 dark:hover:bg-neutral-800/40"
    >
      <TableCell className="pl-4">
        <Checkbox
          checked={selected}
          onChange={(e) => onSelectedChange(ticket, e.target.checked)}
          aria-label={`Select ${ticket.title}`}
        />
      </TableCell>

      {showTimerColumn && (
        <TableCell className="pl-2">
          <TimerToggleButton
            isRunning={isTimerRunning}
            isLoading={timerLoading}
            disabled={timerDisabled}
            onClick={() => onToggleTimer(ticket)}
            ariaLabel={
              isTimerRunning ? `Stop timer for ${ticket.title}` : `Start timer for ${ticket.title}`
            }
          />
        </TableCell>
      )}

      <TableCell className="overflow-hidden">
        <div className="flex min-w-0 items-center gap-2">
          <FontAwesomeIcon icon={icon} className={`shrink-0 text-sm ${iconClass}`} />
          <OverflowTooltip content={ticket.title} className="flex-1">
            <Button
              variant="ghost"
              className="h-auto min-w-0 flex-1 justify-start truncate p-0 text-left text-sm font-medium text-neutral-900 hover:text-primary hover:underline dark:text-neutral-100 dark:hover:text-primary"
              onClick={openTicket}
            >
              {ticket.title}
            </Button>
          </OverflowTooltip>
          {ticket.sharedWithTimeharbor && (
            <Tooltip content="Shared with TimeHarbor">
              <Badge variant="default" size="sm">
                TH
              </Badge>
            </Tooltip>
          )}
        </div>
      </TableCell>

      <TableCell className="whitespace-nowrap">
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
      </TableCell>

      <TableCell className="whitespace-nowrap">
        <Badge variant="outline" size="sm">
          {SOURCE_LABELS[ticket.sourceId]}
        </Badge>
      </TableCell>

      <TableCell className="whitespace-nowrap">
        <Badge variant={status.isClosed ? 'secondary' : 'default'} size="sm">
          {status.native}
        </Badge>
      </TableCell>

      <TableCell className="whitespace-nowrap">
        {ticket.priority ? (
          <Badge variant={priorityVariant(ticket.priority.rank)} size="sm">
            {ticket.priority.native}
          </Badge>
        ) : (
          <Text size="sm" variant="muted">
            —
          </Text>
        )}
      </TableCell>

      <TableCell className="whitespace-nowrap">
        {assignees.length > 0 ? (
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
                    <div className="rounded-full ring-2 ring-white dark:ring-neutral-900">
                      {avatar}
                    </div>
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
        ) : (
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
          {(ticket.updatedAt ?? ticket.createdAt)
            ? timeAgo((ticket.updatedAt ?? ticket.createdAt) as string)
            : '—'}
        </Text>
      </TableCell>

      <TableCell className="pr-4 text-end">
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
