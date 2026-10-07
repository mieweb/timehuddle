/**
 * TicketSortFilterMenu — the ticket list's one control for sorting and
 * filtering.
 *
 * The list is rows, not columns, so there are no column headers to carry a
 * sort control or a filter each. Every sort field and every filter is behind
 * this one button instead, in the list header, the same at every width.
 */
import { DropdownItem, DropdownLabel, DropdownSeparator } from '@mieweb/ui';
import { ArrowDown, ArrowUp, SlidersHorizontal } from 'lucide-react';
import React from 'react';

import { FilterDropdown } from './FilterDropdown';
import { SOURCE_LABELS, type TicketSourceId } from './sources';
import type { FilterOption, SortField, SortSpec } from './ticketFilters';

export interface TicketFieldFilter {
  /** Shown when nothing is selected, e.g. "Any status". */
  anyLabel: string;
  options: FilterOption[];
  /** Currently selected value, or null for "any". */
  value: string | null;
  onChange: (value: string | null) => void;
  /**
   * Entries above the derived options, in order — e.g. "Me" and "Unassigned",
   * or "No priority". These are not derived from the loaded tickets, so they
   * stay available even when nothing currently matches them.
   */
  extraOptions?: { value: string; label: string }[];
}

/** A ticket property the list can sort by, filter by, or both. */
export interface TicketField {
  label: string;
  sortField?: SortField;
  filter?: TicketFieldFilter;
}

export interface TicketSortFilterMenuProps {
  fields: readonly TicketField[];
  sort: SortSpec;
  onSortChange: (field: SortField) => void;
  /** Offered at the top of the menu while any filter is on. */
  onClearFilters: () => void;
  openMenuId: string | null;
  onOpenMenuChange: (menuId: string | null) => void;
  boundaryRef?: React.RefObject<HTMLElement | null>;
}

const MENU_ID = 'sort-and-filter';

const text = {
  trigger: 'Sort and filter',
  triggerFiltered: (count: number) =>
    `Sort and filter, ${count} filter${count === 1 ? '' : 's'} on`,
  clearFilters: 'Clear filters',
  sortBy: 'Sort by',
  sorted: (direction: SortSpec['direction']) =>
    direction === 'asc' ? '(sorted ascending)' : '(sorted descending)',
  filterBy: (label: string, selected: string | null) =>
    selected ? `Filter by ${label}: ${selected}` : `Filter by ${label}`,
};

/** The label of the choice a filter is set to, or null when it is on "any". */
export function selectedFilterLabel(filter: TicketFieldFilter): string | null {
  if (!filter.value) return null;
  return (
    filter.extraOptions?.find((o) => o.value === filter.value)?.label ??
    filter.options.find((o) => o.value === filter.value)?.label ??
    null
  );
}

/**
 * One filter's choices as menu items: "any", the fixed extras, then the options
 * derived from the loaded tickets.
 */
const TicketFilterItems: React.FC<{ filter: TicketFieldFilter }> = ({ filter }) => {
  // Options arrive pre-grouped by source; a label is emitted when the group
  // changes so the menu reads as sections without needing a nested structure.
  let lastGroup: TicketSourceId | undefined;

  return (
    <>
      <DropdownItem
        onClick={() => filter.onChange(null)}
        className={!filter.value ? 'font-semibold' : ''}
      >
        {filter.anyLabel}
      </DropdownItem>
      {filter.extraOptions?.map((option) => (
        <DropdownItem
          key={option.value}
          onClick={() => filter.onChange(option.value)}
          className={filter.value === option.value ? 'font-semibold' : ''}
        >
          {option.label}
        </DropdownItem>
      ))}
      {filter.options.length > 0 && <DropdownSeparator />}
      {filter.options.map((option) => {
        const startsGroup = option.group !== undefined && option.group !== lastGroup;
        lastGroup = option.group;
        return (
          <React.Fragment key={option.value}>
            {startsGroup && <DropdownLabel>{SOURCE_LABELS[option.group!]}</DropdownLabel>}
            <DropdownItem
              onClick={() => filter.onChange(option.value)}
              className={filter.value === option.value ? 'font-semibold' : ''}
            >
              {option.label}
            </DropdownItem>
          </React.Fragment>
        );
      })}
    </>
  );
};

export const TicketSortFilterMenu: React.FC<TicketSortFilterMenuProps> = ({
  fields,
  sort,
  onSortChange,
  onClearFilters,
  openMenuId,
  onOpenMenuChange,
  boundaryRef,
}) => {
  const filters = fields.filter((field) => field.filter);
  const activeFilters = filters.filter((field) => field.filter?.value).length;
  const SortArrow = sort.direction === 'asc' ? ArrowUp : ArrowDown;

  return (
    <FilterDropdown
      menuId={MENU_ID}
      activeMenuId={openMenuId}
      boundaryRef={boundaryRef}
      onOpenChange={(open) => onOpenMenuChange(open ? MENU_ID : null)}
      triggerAriaLabel={activeFilters ? text.triggerFiltered(activeFilters) : text.trigger}
      trigger={
        <span
          className={`flex items-center rounded p-1.5 transition-colors ${
            activeFilters ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
        </span>
      }
    >
      {activeFilters > 0 && (
        <>
          <DropdownItem onClick={onClearFilters}>{text.clearFilters}</DropdownItem>
          <DropdownSeparator />
        </>
      )}
      {/* Each section is a named group, so a screen reader hears which field a
          choice belongs to, not only the choice. */}
      <div role="group" aria-label={text.sortBy}>
        <DropdownLabel>{text.sortBy}</DropdownLabel>
        {fields
          .filter((field) => field.sortField)
          .map((field) => {
            const active = sort.field === field.sortField;
            return (
              <DropdownItem
                key={field.label}
                // Choosing the field already sorted by flips its direction.
                onClick={() => onSortChange(field.sortField!)}
                className={active ? 'font-semibold' : ''}
                icon={
                  active ? (
                    <SortArrow className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <span className="inline-block w-3.5" />
                  )
                }
              >
                {field.label}
                {/* The arrow is decoration; this says it in words. */}
                {active && <span className="sr-only">{text.sorted(sort.direction)}</span>}
              </DropdownItem>
            );
          })}
      </div>

      {filters.map((field) => {
        // The section names what is applied: bold on the choice below is all
        // that marks it otherwise, and a screen reader cannot hear bold.
        const label = text.filterBy(field.label, selectedFilterLabel(field.filter!));
        return (
          <React.Fragment key={field.label}>
            <DropdownSeparator />
            <div role="group" aria-label={label}>
              <DropdownLabel>{label}</DropdownLabel>
              <TicketFilterItems filter={field.filter!} />
            </div>
          </React.Fragment>
        );
      })}
    </FilterDropdown>
  );
};
