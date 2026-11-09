/**
 * The heading of a My Board section, inside the sortable list: its title and
 * count, the whole of which collapses the section when tapped, and an action
 * at the far end (Pinned's Clock in). Rows move past it, so dropping a ticket
 * under Pinned pins it.
 *
 * Headings stick while their section scrolls (see `TicketList`). Once the list
 * is scrolled past a section, its heading says so with an upward chevron, and
 * a tap takes the list back up to it instead of collapsing it.
 */
import { Badge, Button } from '@mieweb/ui';
import { ChevronDown, ChevronRight, ChevronUp } from 'lucide-react';
import React from 'react';

/**
 * A heading's height, borders included: Rest of My Board sticks this far down,
 * under the Pinned heading. Kept exact by the heading's fixed `h-10`.
 */
export const BOARD_HEADING_HEIGHT = 42;

export interface BoardSectionHeadingProps {
  title: string;
  icon?: React.ReactNode;
  count: number;
  /** The count in words, for its badge. */
  countLabel: string;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** Names the toggle: "Collapse …" or "Expand …". */
  toggleLabel: string;
  /** The list is scrolled past this section: a tap scrolls back up to it. */
  scrolledPast?: { label: string; onReveal: () => void };
  /** At the heading's far end. */
  action?: React.ReactNode;
}

export const BoardSectionHeading: React.FC<BoardSectionHeadingProps> = ({
  title,
  icon,
  count,
  countLabel,
  collapsed,
  onCollapsedChange,
  toggleLabel,
  scrolledPast,
  action,
}) => {
  const Chevron = scrolledPast ? ChevronUp : collapsed ? ChevronRight : ChevronDown;
  return (
    <div className="board-section-heading flex h-10 items-center gap-2 border-b border-border/50 px-(--row-list-inset)">
      {/* The toggle fills the heading, so a tap anywhere on it acts. */}
      <Button
        variant="ghost"
        size="sm"
        // One line, laid out in the label slot; and no press feedback of any
        // kind (scale, background, tap flash): the section opening is the answer.
        className="board-section-toggle -ms-2 h-8 min-w-0 flex-1 justify-start px-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase transition-none [-webkit-tap-highlight-color:transparent] hover:bg-transparent active:scale-100 active:bg-transparent dark:hover:bg-transparent dark:active:bg-transparent [&_[data-slot=button-label]]:flex [&_[data-slot=button-label]]:items-center [&_[data-slot=button-label]]:gap-1"
        aria-expanded={!collapsed}
        aria-label={scrolledPast ? scrolledPast.label : toggleLabel}
        onClick={() => (scrolledPast ? scrolledPast.onReveal() : onCollapsedChange(!collapsed))}
      >
        <Chevron className="h-4 w-4 shrink-0" aria-hidden="true" />
        {icon && (
          <span className="board-section-icon ms-0.5 me-1 inline-flex shrink-0">{icon}</span>
        )}
        <span className="board-section-title">{title}</span>
        <Badge variant="secondary" size="sm" className="ms-1.5" aria-label={countLabel}>
          {count}
        </Badge>
      </Button>
      {action}
    </div>
  );
};
