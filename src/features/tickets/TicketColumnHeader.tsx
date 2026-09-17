/**
 * TicketColumnHeader — a table header that can sort, filter, or both.
 *
 * `TableHead`'s own `sortable` prop wraps its children in a `<button>`, so a
 * filter trigger passed as children would nest a button inside a button. The
 * sort control and the filter trigger are therefore rendered as siblings and
 * `aria-sort` is supplied explicitly — `TableHead` spreads `...props` after its
 * own `aria-sort`, so ours wins.
 */
import { faFilter, faSort, faSortDown, faSortUp } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { DropdownItem, DropdownLabel, DropdownSeparator, TableHead } from '@mieweb/ui';
import React from 'react';

import { FilterDropdown } from './FilterDropdown';
import { SOURCE_LABELS, type TicketSourceId } from './sources';
import type { FilterOption, SortField, SortSpec } from './ticketFilters';

export interface TicketColumnFilter {
  /** Menu id, used to close sibling menus when this one opens. */
  id: string;
  /** Shown when nothing is selected, e.g. "Any status". */
  anyLabel: string;
  options: FilterOption[];
  /** Currently selected value, or null for "any". */
  value: string | null;
  onChange: (value: string | null) => void;
  /** Extra entry above the options, e.g. "Unassigned" or "No priority". */
  extraOption?: { value: string; label: string };
}

export interface TicketColumnHeaderProps {
  label: string;
  className?: string;
  sortField?: SortField;
  sort: SortSpec;
  onSortChange: (field: SortField) => void;
  filter?: TicketColumnFilter;
  openMenuId: string | null;
  onOpenMenuChange: (menuId: string | null) => void;
  boundaryRef?: React.RefObject<HTMLElement | null>;
}

function sortIcon(active: boolean, direction: SortSpec['direction']) {
  if (!active) return faSort;
  return direction === 'asc' ? faSortUp : faSortDown;
}

export const TicketColumnHeader: React.FC<TicketColumnHeaderProps> = ({
  label,
  className,
  sortField,
  sort,
  onSortChange,
  filter,
  openMenuId,
  onOpenMenuChange,
  boundaryRef,
}) => {
  const isSorted = sortField !== undefined && sort.field === sortField;
  const ariaSort = isSorted ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none';

  const selectedLabel =
    filter && filter.value
      ? ((filter.extraOption?.value === filter.value
          ? filter.extraOption.label
          : filter.options.find((o) => o.value === filter.value)?.label) ?? null)
      : null;

  // Options arrive pre-grouped by source; a label is emitted when the group
  // changes so the menu reads as sections without needing a nested structure.
  let lastGroup: TicketSourceId | undefined;

  return (
    <TableHead
      className={`whitespace-nowrap ${className ?? ''}`}
      aria-sort={sortField ? ariaSort : undefined}
    >
      <div className="flex items-center gap-1">
        {sortField ? (
          <button
            type="button"
            onClick={() => onSortChange(sortField)}
            className="hover:text-foreground flex items-center gap-1 rounded transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
            aria-label={`Sort by ${label} ${isSorted && sort.direction === 'asc' ? 'descending' : 'ascending'}`}
          >
            {label}
            <FontAwesomeIcon
              icon={sortIcon(isSorted, sort.direction)}
              className={`text-[10px] ${isSorted ? 'text-neutral-700 dark:text-neutral-200' : 'text-neutral-400'}`}
            />
          </button>
        ) : (
          <span>{label}</span>
        )}

        {filter && (
          <FilterDropdown
            label=""
            activeLabel={null}
            placement="bottom-start"
            menuId={filter.id}
            activeMenuId={openMenuId}
            boundaryRef={boundaryRef}
            onOpenChange={(open) => onOpenMenuChange(open ? filter.id : null)}
            trigger={
              <span
                className={`flex items-center rounded px-1 py-0.5 transition-colors ${
                  filter.value
                    ? 'text-primary'
                    : 'text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200'
                }`}
                title={selectedLabel ? `${label}: ${selectedLabel}` : `Filter by ${label}`}
              >
                <FontAwesomeIcon icon={faFilter} className="text-[10px]" />
              </span>
            }
            triggerAriaLabel={
              selectedLabel ? `${label} filtered by ${selectedLabel}` : `Filter by ${label}`
            }
          >
            <DropdownItem
              onClick={() => filter.onChange(null)}
              className={!filter.value ? 'font-semibold' : ''}
            >
              {filter.anyLabel}
            </DropdownItem>
            {filter.extraOption && (
              <DropdownItem
                onClick={() => filter.onChange(filter.extraOption!.value)}
                className={filter.value === filter.extraOption.value ? 'font-semibold' : ''}
              >
                {filter.extraOption.label}
              </DropdownItem>
            )}
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
          </FilterDropdown>
        )}
      </div>
    </TableHead>
  );
};
