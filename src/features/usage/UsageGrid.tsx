/**
 * UsageGrid — the per-member usage table.
 *
 * Split out from OrgUsagePage and loaded with React.lazy purely for weight:
 * this module is the only thing in the app that pulls in `@mieweb/ui/datavis`
 * (and with it @mieweb/datavis + datavis-ace), and an admin-only page has no
 * business sitting in the entry chunk everyone downloads.
 *
 * NITRO reads its rows from a source rather than a prop, so the rows go in
 * through a blob URL — the same trick the library's own grids use for
 * in-memory data.
 */
import { Badge, Text } from '@mieweb/ui';
import { DataVisNitroGrid, DataVisNitroSource } from '@mieweb/ui/datavis';
import React, { useEffect, useMemo } from 'react';

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
  role: string;
  status: UsageStatus;
  cadence: UsageCadence;
  activeDays: number;
  totalActions: number;
  topFeature: string;
  lastActiveAt: string | null;
}

const BASE_COLUMNS = [
  { field: 'name', header: 'Member', type: 'string', width: 200 },
  { field: 'email', header: 'Email', type: 'string', width: 220 },
  { field: 'role', header: 'Role', type: 'string', width: 110 },
  { field: 'status', header: 'Status', type: 'string', width: 110 },
  { field: 'cadence', header: 'Cadence', type: 'string', width: 120 },
  { field: 'lastActiveAt', header: 'Last active', type: 'date', width: 130 },
  { field: 'activeDays', header: 'Active days', type: 'number', width: 120 },
  { field: 'totalActions', header: 'Actions', type: 'number', width: 100 },
  { field: 'topFeature', header: 'Top feature', type: 'string', width: 140 },
] as const;

const FEATURE_COLUMNS = USAGE_FEATURES.map((feature) => ({
  field: feature.key,
  header: feature.label,
  type: 'number' as const,
  width: 120,
}));

const ALL_COLUMNS = [...BASE_COLUMNS, ...FEATURE_COLUMNS];

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
    role: ROLE_LABEL[user.role] ?? user.role,
    status: user.status,
    cadence: user.cadence,
    activeDays: user.activeDays,
    totalActions: user.totalActions,
    topFeature: featureLabel(user.topFeature),
    lastActiveAt: user.lastActiveAt,
    ...user.features,
  };
}

/** Rows into a blob URL NITRO can source, revoked when they change. */
function useRowsUrl(users: OrgUsageUser[]): string {
  const url = useMemo(() => {
    const payload = { typeInfo: TYPE_INFO, data: users.map(toRow) };
    return URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: 'application/json' }));
  }, [users]);

  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return url;
}

function formatUsageCell(value: unknown, _row: unknown, column: { field: string }) {
  if (column.field === 'status' && typeof value === 'string') {
    const meta = STATUS_META[value as UsageStatus];
    return meta ? <Badge variant={meta.variant}>{meta.label}</Badge> : <>{value}</>;
  }

  if (column.field === 'cadence' && typeof value === 'string') {
    const meta = CADENCE_META[value as UsageCadence];
    return meta ? <Badge variant={meta.variant}>{meta.label}</Badge> : <>{value}</>;
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
}

const UsageGrid: React.FC<UsageGridProps> = ({ users, periodDays }) => {
  const url = useRowsUrl(users);

  return (
    <section className="usage-grid" aria-label="Member usage">
      <DataVisNitroSource type="http" url={url}>
        <DataVisNitroGrid
          title={`Member usage — ${PERIOD_LABEL[periodDays]}`}
          helpText="Counts cover the selected period. Cadence always reads the last 30 days."
          height="560px"
          columns={COLUMNS}
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
