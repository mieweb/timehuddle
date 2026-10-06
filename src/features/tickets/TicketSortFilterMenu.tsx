/**
 * TicketSortFilterMenu — the compact (phone) table's one menu for sorting and
 * filtering.
 *
 * A compact row has no column per fact, so there are no column headers to carry
 * a sort control or a filter each. Everything those headers do is gathered here
 * instead, behind one button at the end of the header row, built from the same
 * column definitions the wide table's headers use.
 */
import { DropdownItem, DropdownLabel, DropdownSeparator } from '@mieweb/ui';
import { ArrowDown, ArrowUp, SlidersHorizontal } from 'lucide-react';
import React from 'react';

import { FilterDropdown } from './FilterDropdown';
import { TicketFilterItems, type TicketColumnFilter } from './TicketColumnHeader';
import type { SortField, SortSpec } from './ticketFilters';

export interface TicketColumn {
  label: string;
  sortField?: SortField;
  filter?: TicketColumnFilter;
}

export interface TicketSortFilterMenuProps {
  columns: readonly TicketColumn[];
  sort: SortSpec;
  onSortChange: (field: SortField) => void;
  openMenuId: string | null;
  onOpenMenuChange: (menuId: string | null) => void;
  boundaryRef?: React.RefObject<HTMLElement | null>;
}

const MENU_ID = 'sort-and-filter';

const text = {
  trigger: 'Sort and filter',
  triggerFiltered: (count: number) =>
    `Sort and filter, ${count} filter${count === 1 ? '' : 's'} on`,
  sortBy: 'Sort by',
  filterBy: (label: string) => `Filter by ${label}`,
};

export const TicketSortFilterMenu: React.FC<TicketSortFilterMenuProps> = ({
  columns,
  sort,
  onSortChange,
  openMenuId,
  onOpenMenuChange,
  boundaryRef,
}) => {
  const filters = columns.filter((column) => column.filter);
  const activeFilters = filters.filter((column) => column.filter?.value).length;
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
      <DropdownLabel>{text.sortBy}</DropdownLabel>
      {columns
        .filter((column) => column.sortField)
        .map((column) => {
          const active = sort.field === column.sortField;
          return (
            <DropdownItem
              key={column.label}
              // Choosing the field already sorted by flips its direction.
              onClick={() => onSortChange(column.sortField!)}
              className={active ? 'font-semibold' : ''}
              icon={
                active ? (
                  <SortArrow className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <span className="inline-block w-3.5" />
                )
              }
            >
              {column.label}
            </DropdownItem>
          );
        })}

      {filters.map((column) => (
        <React.Fragment key={column.label}>
          <DropdownSeparator />
          <DropdownLabel>{text.filterBy(column.label)}</DropdownLabel>
          <TicketFilterItems filter={column.filter!} />
        </React.Fragment>
      ))}
    </FilterDropdown>
  );
};
