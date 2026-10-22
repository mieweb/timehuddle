/**
 * TicketListControls — the ticket list's sort and filter controls: one pill per
 * ticket property. A property that can only be sorted by is a button: pressing
 * it sorts by that property, and pressing it again turns the order round. One
 * that can be filtered opens a menu: its sort, if it has one, at the top, then
 * its choices, with a tick beside the one in force.
 *
 * The list is rows, not columns, so what a column header used to do lives here,
 * in the list's header. On a wide list every pill sits on the header's one
 * line. As the list narrows, the pills that no longer fit leave the line and a
 * chevron takes their place; pressing it opens a pane under the header holding
 * every pill, wrapped onto as many lines as they need.
 *
 * How many fit is measured, not set by a breakpoint, so it follows the list's
 * own width: the sidebar opening and closing counts as much as the window.
 */
import { Button, DropdownItem, DropdownLabel, DropdownSeparator, Input } from '@mieweb/ui';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
} from 'lucide-react';
import React from 'react';

import { FilterDropdown } from './FilterDropdown';
import { SOURCE_LABELS, type TicketSourceId } from './sources';
import type { FilterOption, SortField, SortSpec } from './ticketFilters';

export interface TicketFieldFilter {
  /** Shown when nothing is selected, e.g. "Any status". */
  anyLabel: string;
  options: FilterOption[];
  /** The values chosen; empty for "any". One at most, unless `multiple`. */
  values: string[];
  onChange: (values: string[]) => void;
  /**
   * Several choices may be on at once, and a ticket matching any of them is
   * listed. Choosing one then toggles it and leaves the menu open.
   */
  multiple?: boolean;
  /**
   * Entries above the derived options, in order — e.g. "Me" and "Unassigned",
   * or "No priority". These are not derived from the loaded tickets, so they
   * stay available even when nothing currently matches them.
   */
  extraOptions?: { value: string; label: string }[];
  /**
   * Placeholder of a search box over the choices, for a property with more of
   * them than fit a glance: people, projects.
   */
  searchPlaceholder?: string;
}

/** A view option under a property, on or off, such as showing TimeHuddle IDs. */
export interface TicketFieldToggle {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
}

/** A ticket property the list can sort by, filter by, or both, and how it is shown. */
export interface TicketField {
  label: string;
  sortField?: SortField;
  filter?: TicketFieldFilter;
  /** Change only how rows look, so they never count as a filter. */
  toggles?: readonly TicketFieldToggle[];
}

export interface TicketListControlsProps {
  fields: readonly TicketField[];
  sort: SortSpec;
  onSortChange: (field: SortField) => void;
  /** Offered after the pills while any filter is on. */
  onClearFilters: () => void;
  openMenuId: string | null;
  onOpenMenuChange: (menuId: string | null) => void;
  boundaryRef?: React.RefObject<HTMLElement | null>;
}

const text = {
  showAll: 'Show all sort and filter controls',
  showAllFiltered: (count: number) =>
    `Show all sort and filter controls, ${count} filter${count === 1 ? '' : 's'} on`,
  hideAll: 'Hide the sort and filter controls',
  pane: 'Sort and filter',
  clearFilters: 'Clear filters',
  sortBy: (label: string) => `Sort by ${label}`,
  sorted: (direction: SortSpec['direction']) =>
    direction === 'asc' ? '(sorted ascending)' : '(sorted descending)',
  sortedBy: (label: string, direction: SortSpec['direction']) =>
    `Sorted by ${label}, ${direction === 'asc' ? 'ascending' : 'descending'}. Press to reverse`,
  selected: '(selected)',
  noMatches: 'No matches',
  optionsFor: (label: string) => `Options for ${label}`,
  showFor: (label: string) => `Show with ${label}`,
  filterBy: (label: string, selected: string | null) =>
    selected ? `Filter by ${label}: ${selected}` : `Filter by ${label}`,
  /** After a pill's label when more than one choice is on. */
  chosen: (count: number) => `${count}`,
};

/** A pill's menu id, shared with the host so only one menu is open at a time. */
const menuIdFor = (field: TicketField) => `field:${field.label}`;

const PILL_CLASS =
  'ticket-list-pill inline-flex h-7 items-center gap-1 rounded-full px-3 text-xs font-semibold whitespace-nowrap transition-colors';
const PILL_IDLE_CLASS = 'bg-foreground/10 text-foreground hover:bg-foreground/15';
/** A pill whose property the list is filtered or sorted by. */
const PILL_ACTIVE_CLASS = 'bg-primary/15 text-primary hover:bg-primary/20';

/** The labels of the choices a filter is set to, joined, or null when it is on "any". */
export function selectedFilterLabel(filter: TicketFieldFilter): string | null {
  const labels = filter.values
    .map(
      (value) =>
        filter.extraOptions?.find((o) => o.value === value)?.label ??
        filter.options.find((o) => o.value === value)?.label,
    )
    .filter(Boolean);
  return labels.length ? labels.join(', ') : null;
}

/** One choice of a filter, with a tick at its far end when it is in force. */
const FilterChoice: React.FC<{
  label: string;
  selected: boolean;
  onSelect: () => void;
  /** One of several that can be on together: pressing it leaves the menu open. */
  toggles?: boolean;
}> = ({ label, selected, onSelect, toggles = false }) => (
  // Room is kept at the far end of every choice, so the tick has its place
  // whatever the item's own layout, and labels line up with or without it.
  <DropdownItem
    onClick={onSelect}
    className={`relative pe-9 ${selected ? 'font-semibold' : ''}`}
    {...(toggles
      ? { role: 'menuitemcheckbox', 'aria-checked': selected, 'data-menu-keep-open': true }
      : {})}
  >
    {label}
    {selected && (
      <>
        <Check
          className="absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary"
          aria-hidden="true"
        />
        {/* A checkbox item already says it is checked. */}
        {!toggles && <span className="sr-only">{text.selected}</span>}
      </>
    )}
  </DropdownItem>
);

/**
 * One filter's choices as menu items: "any", the fixed extras, then the options
 * derived from the loaded tickets, under a search box where the filter has one.
 */
const TicketFilterItems: React.FC<{ filter: TicketFieldFilter }> = ({ filter }) => {
  const [query, setQuery] = React.useState('');
  const needle = query.trim().toLowerCase();
  const matches = (label: string) => !needle || label.toLowerCase().includes(needle);
  const extras = (filter.extraOptions ?? []).filter((option) => matches(option.label));
  const options = filter.options.filter((option) => matches(option.label));
  // "Any" is not something to search for: it is offered until a search starts.
  const showAny = !needle;
  const isOn = (value: string) => filter.values.includes(value);
  const choose = (value: string) =>
    filter.onChange(
      filter.multiple
        ? isOn(value)
          ? filter.values.filter((each) => each !== value)
          : [...filter.values, value]
        : [value],
    );

  // Options arrive pre-grouped by source; a label is emitted when the group
  // changes so the menu reads as sections without needing a nested structure.
  let lastGroup: TicketSourceId | undefined;

  return (
    <>
      {filter.searchPlaceholder && (
        // Typing here must not close the menu, and focus starts here: see
        // `FilterDropdown`.
        <div className="ticket-filter-search px-1 pb-1" data-menu-keep-open>
          <Input
            type="search"
            size="sm"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={filter.searchPlaceholder}
            aria-label={filter.searchPlaceholder}
            data-menu-autofocus
          />
        </div>
      )}
      {showAny && (
        <FilterChoice
          label={filter.anyLabel}
          selected={filter.values.length === 0}
          onSelect={() => filter.onChange([])}
        />
      )}
      {extras.map((option) => (
        <FilterChoice
          key={option.value}
          label={option.label}
          selected={isOn(option.value)}
          onSelect={() => choose(option.value)}
          toggles={filter.multiple}
        />
      ))}
      {options.length > 0 && (showAny || extras.length > 0) && <DropdownSeparator />}
      {options.map((option) => {
        const startsGroup = option.group !== undefined && option.group !== lastGroup;
        lastGroup = option.group;
        return (
          <React.Fragment key={option.value}>
            {startsGroup && <DropdownLabel>{SOURCE_LABELS[option.group!]}</DropdownLabel>}
            <FilterChoice
              label={option.label}
              selected={isOn(option.value)}
              onSelect={() => choose(option.value)}
              toggles={filter.multiple}
            />
          </React.Fragment>
        );
      })}
      {needle && extras.length + options.length === 0 && (
        <DropdownLabel>{text.noMatches}</DropdownLabel>
      )}
    </>
  );
};

interface FieldPillProps extends Pick<
  TicketListControlsProps,
  'sort' | 'onSortChange' | 'openMenuId' | 'onOpenMenuChange' | 'boundaryRef'
> {
  field: TicketField;
}

/** One property's pill: its sort, if it has one, then its filter choices. */
const FieldPill: React.FC<FieldPillProps> = ({
  field,
  sort,
  onSortChange,
  openMenuId,
  onOpenMenuChange,
  boundaryRef,
}) => {
  const { filter, sortField, label, toggles } = field;
  const hasToggles = !!toggles?.length;
  const selected = filter ? selectedFilterLabel(filter) : null;
  const sorted = sortField !== undefined && sort.field === sortField;
  const SortArrow = sort.direction === 'asc' ? ArrowUp : ArrowDown;
  const menuId = menuIdFor(field);

  // Nothing to choose but the order, so there is no menu to open: the pill is
  // the sort itself.
  if (!filter && !hasToggles && sortField) {
    return (
      // The pill is drawn by the span, as a menu pill's is by its trigger: the
      // button gives up its own size and padding.
      <Button
        variant="ghost"
        type="button"
        onClick={() => onSortChange(sortField)}
        aria-label={sorted ? text.sortedBy(label, sort.direction) : text.sortBy(label)}
        className="flex h-auto shrink-0 items-center rounded-full p-0 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
      >
        <span className={`${PILL_CLASS} ${sorted ? PILL_ACTIVE_CLASS : PILL_IDLE_CLASS}`}>
          {label}
          {sorted ? (
            <SortArrow className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ArrowUpDown className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
          )}
        </span>
      </Button>
    );
  }
  if (!filter && !hasToggles) return null;
  const name = filter ? text.filterBy(label, selected) : text.optionsFor(label);

  return (
    <FilterDropdown
      menuId={menuId}
      activeMenuId={openMenuId}
      boundaryRef={boundaryRef}
      onOpenChange={(open) => onOpenMenuChange(open ? menuId : null)}
      triggerAriaLabel={name}
      triggerClassName="rounded-full"
      trigger={
        <span
          className={`${PILL_CLASS} ${selected || sorted ? PILL_ACTIVE_CLASS : PILL_IDLE_CLASS}`}
          title={selected ? `${label}: ${selected}` : undefined}
        >
          {label}
          {filter && filter.values.length > 1 && (
            <span className="ticket-list-pill-count tabular-nums opacity-80" aria-hidden="true">
              {text.chosen(filter.values.length)}
            </span>
          )}
          {sorted ? (
            <SortArrow className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ChevronsUpDown className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
          )}
        </span>
      }
    >
      {/* Each section is a named group, so a screen reader hears which property
          a choice belongs to, not only the choice. */}
      {sortField && (
        <div role="group" aria-label={text.sortBy(label)}>
          <DropdownItem
            // Choosing the property already sorted by flips its direction.
            onClick={() => onSortChange(sortField)}
            className={sorted ? 'font-semibold' : ''}
            icon={
              sorted ? (
                <SortArrow className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <ArrowUpDown className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
              )
            }
          >
            {text.sortBy(label)}
            {/* The arrow is decoration; this says it in words. */}
            {sorted && <span className="sr-only">{text.sorted(sort.direction)}</span>}
          </DropdownItem>
        </div>
      )}
      {sortField && (filter || hasToggles) && <DropdownSeparator />}
      {filter && (
        <div role="group" aria-label={text.filterBy(label, selected)}>
          <TicketFilterItems filter={filter} />
        </div>
      )}
      {filter && hasToggles && <DropdownSeparator />}
      {toggles && hasToggles && (
        <div role="group" aria-label={text.showFor(label)}>
          {toggles.map((toggle) => (
            <FilterChoice
              key={toggle.label}
              label={toggle.label}
              selected={toggle.on}
              onSelect={() => toggle.onChange(!toggle.on)}
              toggles
            />
          ))}
        </div>
      )}
    </FilterDropdown>
  );
};

/** The chevron's width and the gap before it, held back from the pills' line. */
const TOGGLE_ROOM = 28 + 6;
/** Room kept for "Clear filters" until it has been on the line to be measured. */
const CLEAR_WIDTH_ESTIMATE = 96;

export const TicketListControls: React.FC<TicketListControlsProps> = ({
  fields,
  sort,
  onSortChange,
  onClearFilters,
  openMenuId,
  onOpenMenuChange,
  boundaryRef,
}) => {
  const activeFilters = fields.filter((field) => field.filter?.values.length).length;
  // A pill grows a count when several of its choices are on, and that takes room.
  const chosenSignature = fields.map((field) => field.filter?.values.length ?? 0).join('|');
  const [inlineCount, setInlineCount] = React.useState(fields.length);
  const [expanded, setExpanded] = React.useState(false);
  const inlineCountRef = React.useRef(inlineCount);
  const paneId = React.useId();
  const layoutRef = React.useRef<HTMLDivElement>(null);
  const paneRef = React.useRef<HTMLDivElement>(null);
  // A pill's width is kept from when it was last on the line, so one that has
  // left it can still be counted back in when there is room again.
  const pillWidths = React.useRef(new Map<string, number>());
  // "Clear filters" is on the line only while every pill is, so whether it
  // needs room is asked of the filters, never of the DOM: asked of the DOM, a
  // measure taken while it is off the line would find room for all the pills,
  // put it back, and push it under the controls before it.
  const clearWidth = React.useRef(CLEAR_WIDTH_ESTIMATE);
  const filtersOn = React.useRef(false);
  filtersOn.current = activeFilters > 0;
  const fieldSignature = fields.map((field) => field.label).join('|');

  React.useLayoutEffect(() => {
    const layout = layoutRef.current;
    if (!layout || typeof ResizeObserver === 'undefined') return;
    const labels = fieldSignature ? fieldSignature.split('|') : [];

    const updateLayout = () => {
      if (layout.clientWidth === 0) return;

      // The pane's pills count too: one can grow a count while it is there,
      // and must not come back to the line at its old width.
      const pills = [layout, paneRef.current].flatMap((part) =>
        part ? [...part.querySelectorAll<HTMLElement>('[data-ticket-pill]')] : [],
      );
      for (const element of pills) {
        const width = element.getBoundingClientRect().width;
        if (width > 0) pillWidths.current.set(element.dataset.ticketPill ?? '', width);
      }
      const gap = Number.parseFloat(getComputedStyle(layout).columnGap) || 0;
      const clear = layout.querySelector<HTMLElement>('[data-ticket-clear]');
      if (clear) clearWidth.current = clear.getBoundingClientRect().width;
      const clearRoom = filtersOn.current ? clearWidth.current + gap : 0;
      const widths = labels.map((label) => pillWidths.current.get(label) ?? Infinity);
      const needed = (count: number) =>
        widths.slice(0, count).reduce((sum, width) => sum + width, 0) +
        Math.max(0, count - 1) * gap;

      // Every pill, with no chevron, if they all fit; otherwise as many as fit
      // beside the chevron.
      let count = labels.length;
      if (needed(count) + clearRoom > layout.clientWidth) {
        // At least one pill goes to the pane, and "Clear filters" with it:
        // kept on the line, it would be pushed under the controls before it.
        count -= 1;
        const available = layout.clientWidth - TOGGLE_ROOM;
        while (count > 0 && needed(count) > available) count -= 1;
      }
      if (inlineCountRef.current === count) return;
      inlineCountRef.current = count;
      setInlineCount(count);
      // A different size is a different header: the pane goes back to closed.
      setExpanded(false);
    };

    const observer = new ResizeObserver(updateLayout);
    observer.observe(layout);
    updateLayout();
    return () => observer.disconnect();
    // The clear button comes and goes with the filters, and takes room; the
    // pane opening and closing changes which pills can be measured.
  }, [fieldSignature, chosenSignature, expanded]);

  const overflowing = inlineCount < fields.length;
  // The pane holds every pill, so the line above it keeps only the chevron.
  const paneOpen = expanded && overflowing;
  const inlineFields = paneOpen ? [] : fields.slice(0, inlineCount);

  // A menu whose pill has just left the screen has nothing to hang from.
  React.useEffect(() => {
    if (!openMenuId || paneOpen) return;
    const shown = inlineFields.some((field) => menuIdFor(field) === openMenuId);
    if (!shown && fields.some((field) => menuIdFor(field) === openMenuId)) onOpenMenuChange(null);
  }, [fields, inlineFields, paneOpen, onOpenMenuChange, openMenuId]);

  const pill = (field: TicketField) => (
    <div key={field.label} data-ticket-pill={field.label} className="shrink-0">
      <FieldPill
        field={field}
        sort={sort}
        onSortChange={onSortChange}
        openMenuId={openMenuId}
        onOpenMenuChange={onOpenMenuChange}
        boundaryRef={boundaryRef}
      />
    </div>
  );
  const clearFilters = activeFilters > 0 && (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClearFilters}
      data-ticket-clear
      className="h-7 shrink-0 rounded-full px-2.5 text-xs"
    >
      {text.clearFilters}
    </Button>
  );

  return (
    <>
      <div
        ref={layoutRef}
        className="ticket-list-controls ms-auto flex min-w-0 flex-1 items-center justify-end gap-1.5"
      >
        {/* Ahead of the pills, which are held to the far end, so it comes and
            goes without moving any of them. */}
        {!overflowing && clearFilters}
        {inlineFields.map(pill)}
        {overflowing && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setExpanded((open) => !open)}
            aria-expanded={paneOpen}
            aria-controls={paneId}
            aria-label={
              paneOpen
                ? text.hideAll
                : activeFilters
                  ? text.showAllFiltered(activeFilters)
                  : text.showAll
            }
            className={`ticket-list-controls-toggle h-7 w-7 shrink-0 rounded-full ${
              activeFilters && !paneOpen ? PILL_ACTIVE_CLASS : PILL_IDLE_CLASS
            }`}
          >
            {paneOpen ? (
              <ChevronUp className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            )}
          </Button>
        )}
      </div>
      {paneOpen && (
        <div
          ref={paneRef}
          id={paneId}
          role="group"
          aria-label={text.pane}
          className="ticket-list-controls-pane flex basis-full flex-wrap items-center gap-1.5"
        >
          {fields.map(pill)}
          {clearFilters}
        </div>
      )}
    </>
  );
};
