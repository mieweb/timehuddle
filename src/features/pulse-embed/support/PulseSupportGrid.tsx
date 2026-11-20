/**
 * The Pulse support table (TH-4): one row per upload with its state, reason
 * and flags, in the NITRO grid admins already know from Usage, so they can
 * sort and filter by person, state or flag.
 *
 * Loaded with React.lazy (PulseSupportSection), because `@mieweb/ui/datavis`
 * is heavy and only admins open this. As in UsageGrid, the rows reach NITRO
 * through a `local` source (a window variable it re-reads on refresh), held
 * only while the grid is mounted, so a sign-out leaves no rows behind.
 */
import { Alert, Badge, Button, Spinner, Text } from '@mieweb/ui';
import { DataVisNitroContext, DataVisNitroGrid, DataVisNitroSource } from '@mieweb/ui/datavis';
import React, { useContext, useEffect, useRef } from 'react';

import { timeAgo } from '../../../lib/date';
import type { SupportRow } from './supportRows';
import { SUPPORT_TEXT as T } from './supportStrings';

export interface PulseSupportGridProps {
  items: SupportRow[];
  loading: boolean;
  /** A failed search's message; the grid shows it in place of the rows. */
  error: string | null;
  onRetry?: () => void;
}

const COLUMN_TYPES = [
  { field: 'sentAt', type: 'date', width: 130 },
  { field: 'userName', type: 'string', width: 170 },
  { field: 'type', type: 'string', width: 130 },
  { field: 'place', type: 'string', width: 200 },
  { field: 'state', type: 'string', width: 150 },
  { field: 'flags', type: 'string', width: 140 },
  { field: 'reason', type: 'string', width: 220 },
  { field: 'updatedAt', type: 'date', width: 130 },
  { field: 'device', type: 'string', width: 130 },
  { field: 'id', type: 'string', width: 280 },
] as const;

const ALL_COLUMNS = COLUMN_TYPES.map(({ field, type, width }) => ({
  field,
  type,
  width,
  header: T.columns[field],
}));
const COLUMNS = ALL_COLUMNS.map(({ field, header, width }) => ({ field, header, width }));
const CONTROL_FIELDS = ALL_COLUMNS.map(({ field, header, type }) => ({
  field,
  displayName: header,
  type,
}));
const TYPE_INFO = ALL_COLUMNS.map(({ field, type }) => ({ field, type }));

/** The window variable NITRO's `local` source reads the rows from. */
export const SUPPORT_ROWS_VAR = 'timehuddlePulseSupportRows';

type RowsWindow = Window & {
  [SUPPORT_ROWS_VAR]?: { typeInfo: typeof TYPE_INFO; data: SupportRow[] };
};

function publishRows(rows: SupportRow[]): void {
  (window as RowsWindow)[SUPPORT_ROWS_VAR] = { typeInfo: TYPE_INFO, data: rows };
}

/** The rows on `window` while the grid is mounted; an empty payload after. */
function useRowsOnWindow(rows: SupportRow[]): void {
  publishRows(rows);
  const latest = useRef(rows);
  latest.current = rows;
  useEffect(() => {
    publishRows(latest.current);
    return () => publishRows([]);
  }, []);
}

/** Reload the view when a new search returns rows (the first load is the source's own). */
const ReloadOnChange: React.FC<{ rows: SupportRow[] }> = ({ rows }) => {
  const view = useContext(DataVisNitroContext);
  const first = useRef(rows);
  useEffect(() => {
    if (!view || rows === first.current) return;
    view.refresh();
    view.getData();
  }, [rows, view]);
  return null;
};

function formatCell(value: unknown, _row: unknown, column: { field: string }) {
  if ((column.field === 'sentAt' || column.field === 'updatedAt') && typeof value === 'string') {
    return <>{value ? timeAgo(value) : ''}</>;
  }
  if (column.field === 'flags' && typeof value === 'string' && value) {
    return (
      <>
        {value.split(', ').map((flag) => (
          <Badge key={flag} variant={flag === T.flags.late ? 'secondary' : 'danger'}>
            {flag}
          </Badge>
        ))}
      </>
    );
  }
  return <>{value as React.ReactNode}</>;
}

/** The rows' grid, once they are in. */
const Grid: React.FC<{ items: SupportRow[] }> = ({ items }) => {
  useRowsOnWindow(items);
  return (
    <DataVisNitroSource type="local" varName={SUPPORT_ROWS_VAR}>
      <ReloadOnChange rows={items} />
      <DataVisNitroGrid
        title={T.gridTitle}
        height="420px"
        columns={COLUMNS}
        allColumns={ALL_COLUMNS.map(({ field, header }) => ({ field, header }))}
        controlFields={CONTROL_FIELDS}
        features={{ stickyHeaders: true, columnResize: true, zebraStripe: true }}
        formatCell={formatCell}
      />
    </DataVisNitroSource>
  );
};

const PulseSupportGrid: React.FC<PulseSupportGridProps> = ({ items, loading, error, onRetry }) => {
  let body: React.ReactNode;
  if (loading) {
    body = <Spinner size="sm" label={T.loading} />;
  } else if (error) {
    body = (
      <Alert variant="danger" className="pulse-support-error">
        <span>{error}</span>
        {onRetry && (
          <Button variant="link" size="sm" onClick={onRetry}>
            {T.retry}
          </Button>
        )}
      </Alert>
    );
  } else if (!items.length) {
    body = (
      <Text variant="muted" size="sm" className="pulse-support-empty">
        {T.noRows}
      </Text>
    );
  } else {
    body = <Grid items={items} />;
  }
  return (
    <section className="pulse-support-grid" aria-label={T.gridLabel} aria-busy={loading}>
      {body}
    </section>
  );
};

export default PulseSupportGrid;
