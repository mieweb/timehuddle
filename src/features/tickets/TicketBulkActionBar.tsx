/**
 * TicketBulkActionBar — shown above a `TicketTable` once at least one row is
 * selected. Delete is functional; Archive and Close Issues are static
 * placeholders (no backend/model support yet, always disabled) reserved for
 * a later milestone. The primary action is context-sensitive: "Move to My
 * Board" on the Tickets tab, "Remove from My Board" on the My Board tab.
 */
import { faTrash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, Text } from '@mieweb/ui';
import React from 'react';

export interface TicketBulkActionBarProps {
  selectedCount: number;
  onDeselectAll: () => void;
  canDeleteSelected: boolean;
  onDelete: () => void;
  primaryLabel: string;
  onPrimaryAction: () => void;
}

export const TicketBulkActionBar: React.FC<TicketBulkActionBarProps> = ({
  selectedCount,
  onDeselectAll,
  canDeleteSelected,
  onDelete,
  primaryLabel,
  onPrimaryAction,
}) => (
  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
    <div className="flex items-center gap-3">
      <Text size="sm" weight="medium">
        {selectedCount} selected
      </Text>
      <Button variant="ghost" size="sm" onClick={onDeselectAll}>
        Deselect all
      </Button>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="danger"
        size="sm"
        onClick={onDelete}
        disabled={!canDeleteSelected}
        aria-label="Delete selected tickets"
        title={canDeleteSelected ? undefined : 'Only tickets you created can be bulk-deleted'}
      >
        <FontAwesomeIcon icon={faTrash} className="mr-1.5 text-xs" />
        Delete
      </Button>
      <Button
        variant="secondary"
        size="sm"
        disabled
        title="Archiving is coming in a future milestone"
      >
        Archive
      </Button>
      <Button
        variant="secondary"
        size="sm"
        disabled
        title="Bulk-closing issues is coming in a future milestone"
      >
        Close Issues
      </Button>
      <Button variant="primary" size="sm" onClick={onPrimaryAction}>
        {primaryLabel}
      </Button>
    </div>
  </div>
);
