/**
 * UsageGrid — the per-member usage table.
 *
 * Split out from OrgUsage and loaded with React.lazy purely for weight:
 * this module is the only thing in the app that pulls in `@mieweb/ui/datavis`
 * (and with it @mieweb/datavis + datavis-ace), and an admin-only page has no
 * business sitting in the entry chunk everyone downloads.
 *
 * NITRO reads its rows from a source rather than a prop. They go in through a
 * `local` source — a window variable it re-reads on every refresh — so a new
 * report reloads the same view in place and keeps the viewer's sort, filter
 * and scroll. (An `http` source on a blob URL can't: a new URL builds a new
 * view, and the library never loads data into it.)
 */
import { Badge, Text } from '@mieweb/ui';
import { DataVisNitroContext, DataVisNitroGrid, DataVisNitroSource } from '@mieweb/ui/datavis';
import React, { useContext, useEffect, useMemo, useRef } from 'react';

import {
  USAGE_FEATURES,
  type OrgUsageUser,
  type UsageCadence,
  type UsageStatus,
} from '../../lib/api';
import { timeAgo } from '../../lib/date';
import { CADENCE_META, PERIOD_LABEL, ROLE_LABEL, STATUS_META, featureLabel } from './usageDisplay';
import type { UsagePeriodDays } from '../../lib/api';

/** One flat row per member — NITRO wants scalars, not nested objects. */
interface UsageRow extends Record<string, unknown> {
  name: string;
  email: string;
  organization: string;
  role: string;
  status: UsageStatus;
  online: string;
  clockedInSince: string | null;
  redmine: string;
  github: string;
  cadence: UsageCadence;
  activeDays: number;
  totalActions: number;
  topFeature: string;
  lastActiveAt: string | null;
}

const BASE_COLUMNS = [
  { field: 'name', header: 'Member', type: 'string', width: 200 },
  { field: 'email', header: 'Email', type: 'string', width: 220 },
  { field: 'organization', header: 'Organization', type: 'string', width: 180 },
  { field: 'role', header: 'Role', type: 'string', width: 110 },
  { field: 'status', header: 'Status', type: 'string', width: 110 },
  { field: 'online', header: 'Online', type: 'string', width: 100 },
  { field: 'clockedInSince', header: 'Clocked in', type: 'date', width: 130 },
  { field: 'cadence', header: 'Cadence', type: 'string', width: 120 },
  { field: 'lastActiveAt', header: 'Last active', type: 'date', width: 130 },
  { field: 'activeDays', header: 'Active days', type: 'number', width: 120 },
  { field: 'totalActions', header: 'Actions', type: 'number', width: 100 },
  { field: 'topFeature', header: 'Top feature', type: 'string', width: 140 },
  { field: 'redmine', header: 'Redmine', type: 'string', width: 120 },
  { field: 'github', header: 'GitHub', type: 'string', width: 120 },
] as const;

const FEATURE_COLUMNS = USAGE_FEATURES.map((feature) => ({
  field: feature.key,
  header: feature.label,
  type: 'number' as const,
  width: 120,
}));

const ALL_COLUMNS = [...BASE_COLUMNS, ...FEATURE_COLUMNS];

/** Label for a linked integration — in the row data too, so it filters as text. */
const CONNECTED = 'Connected';

const COLUMNS = ALL_COLUMNS.map(({ field, header, width }) => ({ field, header, width }));

const CONTROL_FIELDS = ALL_COLUMNS.map(({ field, header, type }) => ({
  field,
  displayName: header,
  type,
}));

const TYPE_INFO = ALL_COLUMNS.map(({ field, type }) => ({ field, type }));

function toRow(user: OrgUsageUser): UsageRow {
  return {
    name: user.name,
    email: user.email,
    // Only the all-organizations view ever puts more than one name here.
    organization: user.organizations.map((organization) => organization.name).join(', '),
    role: ROLE_LABEL[user.role] ?? user.role,
    status: user.status,
    // A string, not a boolean, so it sorts and filters like the other labels.
    online: user.online ? 'Online' : '',
    clockedInSince: user.clockedInSince,
    // Strings, like `online`, so they sort and filter as labels.
    redmine: user.redmineConnected ? CONNECTED : '',
    github: user.githubConnected ? CONNECTED : '',
    cadence: user.cadence,
    activeDays: user.activeDays,
    totalActions: user.totalActions,
    topFeature: featureLabel(user.topFeature),
    lastActiveAt: user.lastActiveAt,
    ...user.features,
  };
}

/** The window variable NITRO's `local` source reads the rows from. */
const ROWS_VAR = 'timehuddleUsageRows';

type RowsWindow = Window & { [ROWS_VAR]?: { typeInfo: typeof TYPE_INFO; data: UsageRow[] } };

/**
 * Publish the rows where the `local` source reads them. Runs during render,
 * because the source copies the variable as soon as it is constructed.
 */
function publishRows(users: OrgUsageUser[]): void {
  (window as RowsWindow)[ROWS_VAR] = { typeInfo: TYPE_INFO, data: users.map(toRow) };
}

/**
 * Hold the rows on `window` only while the grid is mounted. Signing out swaps
 * React state without reloading the page, so rows left behind would hand the
 * next session in this tab the last report's member emails and activity.
 * Cleared to an empty payload rather than deleted, so a late read by the view
 * gets no rows instead of throwing. Re-published on mount, because StrictMode
 * runs this cleanup once while the grid is still on screen.
 */
function useRowsOnWindow(users: OrgUsageUser[]): void {
  publishRows(users);
  const latestUsers = useRef(users);
  latestUsers.current = users;
  useEffect(() => {
    publishRows(latestUsers.current);
    return () => publishRows([]);
  }, []);
}

/** Reload the grid's view when the rows change — after the first load, which
 *  the source does on its own. Must render inside DataVisNitroSource. */
const ReloadOnChange: React.FC<{ users: OrgUsageUser[] }> = ({ users }) => {
  const view = useContext(DataVisNitroContext);
  const firstRows = useRef(users);
  useEffect(() => {
    if (!view || users === firstRows.current) return;
    // refresh() re-reads the variable and clears the view's cache, but only
    // marks it loading — getData() is what recomputes it, sort and filter kept.
    view.refresh();
    view.getData();
  }, [users, view]);
  return null;
};

function formatUsageCell(value: unknown, _row: unknown, column: { field: string }) {
  if (column.field === 'status' && typeof value === 'string') {
    const meta = STATUS_META[value as UsageStatus];
    return meta ? <Badge variant={meta.variant}>{meta.label}</Badge> : <>{value}</>;
  }

  if (column.field === 'cadence' && typeof value === 'string') {
    const meta = CADENCE_META[value as UsageCadence];
    return meta ? <Badge variant={meta.variant}>{meta.label}</Badge> : <>{value}</>;
  }

  if (column.field === 'online') {
    return value ? <Badge variant="success">Online</Badge> : <></>;
  }

  if ((column.field === 'redmine' || column.field === 'github') && value) {
    return <Badge variant="secondary">{CONNECTED}</Badge>;
  }

  if (column.field === 'clockedInSince') {
    return typeof value === 'string' && value ? (
      <Badge variant="default">{timeAgo(value)}</Badge>
    ) : (
      <></>
    );
  }

  if (column.field === 'lastActiveAt') {
    if (typeof value !== 'string' || !value) {
      return (
        <Text variant="muted" size="sm">
          Never
        </Text>
      );
    }
    return <>{timeAgo(value)}</>;
  }

  return <>{value as React.ReactNode}</>;
}

interface UsageGridProps {
  users: OrgUsageUser[];
  periodDays: UsagePeriodDays;
  /** False when the report covers a single organization, where the column
   *  would repeat one value down every row. It stays in `allColumns`, so it
   *  is still reachable from the grid's own column menu. */
  showOrganization: boolean;
}

const UsageGrid: React.FC<UsageGridProps> = ({ users, periodDays, showOrganization }) => {
  useRowsOnWindow(users);
  const columns = useMemo(
    () =>
      showOrganization ? COLUMNS : COLUMNS.filter((column) => column.field !== 'organization'),
    [showOrganization],
  );

  return (
    <section className="usage-grid" aria-label="Member usage">
      {/* NITRO takes ownership of its column state on mount, so changing
          `columns` alone does not add or drop one. Keying the source on the
          visible set remounts it when the org scope changes. */}
      <DataVisNitroSource
        key={showOrganization ? 'with-org' : 'no-org'}
        type="local"
        varName={ROWS_VAR}
      >
        <ReloadOnChange users={users} />
        <DataVisNitroGrid
          title={`Member usage — ${PERIOD_LABEL[periodDays]}`}
          helpText="Counts cover the selected period. Cadence always reads the last 30 days."
          height="560px"
          columns={columns}
          allColumns={ALL_COLUMNS.map(({ field, header }) => ({ field, header }))}
          controlFields={CONTROL_FIELDS}
          features={{
            stickyHeaders: true,
            columnResize: true,
            zebraStripe: true,
            headerContextMenu: true,
          }}
          formatCell={formatUsageCell}
        />
      </DataVisNitroSource>
    </section>
  );
};

export default UsageGrid;
