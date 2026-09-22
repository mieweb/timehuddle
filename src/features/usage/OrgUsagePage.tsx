/**
 * OrgUsagePage — who in the organization is actually using TimeHuddle.
 *
 * Restricted to default-org owners and admins, like the Members page it sits
 * next to in the Admin menu. It answers two questions side by side:
 *
 *   • the period selector drives the counts — today, or the last 7/14/30 days;
 *   • the cadence badge is fixed to the last 30 days, so switching the period
 *     changes what someone did without changing how habitual they look.
 *
 * The grid lives in its own lazily-loaded module (see UsageGrid) because it
 * carries the whole DataVis NITRO dependency.
 */
import {
  Alert,
  Card,
  CardContent,
  Select,
  Spinner,
  Tabs,
  TabsList,
  TabsTrigger,
  Text,
} from '@mieweb/ui';
import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';

import {
  ApiError,
  USAGE_PERIOD_DAYS,
  usageApi,
  type OrgUsageReport,
  type UsagePeriodDays,
} from '../../lib/api';
import { timeAgo } from '../../lib/date';
import { hasOrganizationAdminAccess } from '../../lib/organizationAccess';
import { useRefresh } from '../../lib/RefreshContext';
import { useTeam } from '../../lib/TeamContext';
import { AppPage } from '../../ui/AppPage';
import {
  CADENCE_META,
  CADENCE_ORDER,
  PERIOD_LABEL,
  PERIOD_TAB_LABEL,
  featureLabel,
} from './usageDisplay';

const UsageGrid = lazy(() => import('./UsageGrid'));

const DEFAULT_PERIOD: UsagePeriodDays = 7;

/** Picker value for "every organization I administer" — never sent to the server. */
const ALL_ORGS = 'all';

// ─── Summary ──────────────────────────────────────────────────────────────────

/** What the numbers cover: the one organization, or how many are rolled up. */
function scopeLabel(report: OrgUsageReport): string {
  if (report.organizations.length === 1) return report.organizations[0].name;
  return `${report.organizations.length} organizations`;
}

const SummaryCard: React.FC<{ label: string; value: string; note?: string }> = ({
  label,
  value,
  note,
}) => (
  <Card padding="md">
    <CardContent className="space-y-1">
      <Text variant="muted" size="xs" className="uppercase tracking-wide">
        {label}
      </Text>
      <Text size="2xl" weight="semibold">
        {value}
      </Text>
      {note && (
        <Text variant="muted" size="xs">
          {note}
        </Text>
      )}
    </CardContent>
  </Card>
);

const CadenceLegend: React.FC<{ report: OrgUsageReport }> = ({ report }) => (
  <Card padding="md">
    <CardContent className="space-y-3">
      <Text variant="muted" size="xs" className="uppercase tracking-wide">
        Cadence — last {report.cadenceWindowDays} days
      </Text>
      <dl className="cadence-legend grid grid-cols-2 gap-3 sm:grid-cols-5">
        {CADENCE_ORDER.map((cadence) => {
          const meta = CADENCE_META[cadence];
          return (
            <div key={cadence} className="cadence-legend-item space-y-0.5">
              <dt>
                <Text size="sm" weight="medium">
                  {meta.label}
                </Text>
              </dt>
              <dd>
                <Text size="xl" weight="semibold">
                  {report.totals.cadenceCounts[cadence]}
                </Text>
                <Text variant="muted" size="xs">
                  {meta.hint}
                </Text>
              </dd>
            </div>
          );
        })}
      </dl>
    </CardContent>
  </Card>
);

// ─── Page ─────────────────────────────────────────────────────────────────────

export const OrgUsagePage: React.FC = () => {
  const { organizations } = useTeam();
  // Optimistic: the server's owner/admin check is the one that counts, and a
  // `forbidden` from it flips `denied` below.
  const [denied, setDenied] = useState(false);
  // TeamContext fills this in a tick after the session resolves. An empty list
  // means "not loaded yet", not "a member of nothing" — every signed-in user
  // is in at least their default org — so waiting avoids telling an owner the
  // page is restricted for the moment before their roles arrive.
  const rolesLoaded = organizations.length > 0;
  const canAccess = rolesLoaded && hasOrganizationAdminAccess(organizations) && !denied;

  const [periodDays, setPeriodDays] = useState<UsagePeriodDays>(DEFAULT_PERIOD);
  // Select renders its placeholder for an empty value, so the all-orgs choice
  // carries a sentinel. The server takes a missing orgId to mean the same
  // thing, so the sentinel never leaves this file.
  const [orgId, setOrgId] = useState(ALL_ORGS);
  const [report, setReport] = useState<OrgUsageReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Built from TeamContext rather than the report, so the picker is populated
  // on first paint instead of after the first round trip.
  const orgOptions = useMemo(() => {
    const administered = organizations.filter(
      (organization) => organization.role === 'owner' || organization.role === 'admin',
    );
    return [
      { value: ALL_ORGS, label: `All organizations (${administered.length})` },
      ...administered.map((organization) => ({
        value: organization.id,
        label: organization.name,
      })),
    ];
  }, [organizations]);

  const loadReport = useCallback(async () => {
    if (!canAccess) return;
    setLoading(true);
    setError(null);
    try {
      setReport(await usageApi.getOrgUsage(periodDays, orgId === ALL_ORGS ? undefined : orgId));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'forbidden') {
        setDenied(true);
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Failed to load usage.');
    } finally {
      setLoading(false);
    }
  }, [canAccess, orgId, periodDays]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  useRefresh(loadReport, canAccess);

  if (!rolesLoaded) {
    return (
      <AppPage>
        <div className="flex justify-center py-12" aria-live="polite" aria-busy="true">
          <Spinner />
          <span className="sr-only">Loading usage</span>
        </div>
      </AppPage>
    );
  }

  if (!canAccess) {
    return (
      <AppPage>
        <Card padding="lg" className="mx-auto max-w-2xl text-center">
          <CardContent className="space-y-3">
            <Text weight="semibold">Usage is unavailable</Text>
            <Text variant="muted" size="sm">
              This page is restricted to organization owners and admins.
            </Text>
          </CardContent>
        </Card>
      </AppPage>
    );
  }

  const totals = report?.totals;

  return (
    <AppPage width="wide" subtitle="Who is using TimeHuddle, how often, and what they use it for.">
      {/* A row of its own rather than AppPage's titleActions: the pills plus a
          picker crush the subtitle to one word at phone widths up there. */}
      <section className="usage-controls flex flex-wrap items-center gap-3">
        <Tabs
          variant="pills"
          value={String(periodDays)}
          onValueChange={(value) => setPeriodDays(Number(value) as UsagePeriodDays)}
          // Tabs is w-full by default, which would push the picker to its own row.
          className="w-fit"
        >
          <TabsList aria-label="Usage period" className="w-fit max-w-full">
            {USAGE_PERIOD_DAYS.map((days) => (
              <TabsTrigger key={days} value={String(days)}>
                {PERIOD_TAB_LABEL[days]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {/* One organization needs no picker — the card below already names it. */}
        {orgOptions.length > 2 && (
          <div className="w-56">
            <Select
              label="Organization"
              hideLabel
              value={orgId}
              onValueChange={setOrgId}
              options={orgOptions}
              disabled={loading}
            />
          </div>
        )}
      </section>

      {error && (
        <Alert variant="danger" role="alert">
          {error}
        </Alert>
      )}

      {loading && !report && (
        <div className="flex justify-center py-12" aria-live="polite" aria-busy="true">
          <Spinner />
          <span className="sr-only">Loading usage</span>
        </div>
      )}

      {report && totals && (
        <>
          <section
            className="usage-summary grid grid-cols-2 gap-3 lg:grid-cols-4"
            aria-label="Usage summary"
          >
            <SummaryCard label="Members" value={String(totals.members)} note={scopeLabel(report)} />
            <SummaryCard
              label={`Active — ${PERIOD_LABEL[report.periodDays].toLowerCase()}`}
              value={`${totals.activeMembers}/${totals.members}`}
              note="did something in this period"
            />
            <SummaryCard
              label="Daily users"
              value={String(totals.cadenceCounts.daily)}
              note={`of ${totals.members} over ${report.cadenceWindowDays} days`}
            />
            <SummaryCard
              label="Most used"
              value={featureLabel(totals.topFeature)}
              note={
                totals.topFeature
                  ? `${totals.featureTotals[totals.topFeature]} actions in this period`
                  : 'no activity in this period'
              }
            />
          </section>

          <CadenceLegend report={report} />

          <Suspense
            fallback={
              <div className="flex justify-center py-12" aria-live="polite" aria-busy="true">
                <Spinner />
                <span className="sr-only">Loading the usage table</span>
              </div>
            }
          >
            <UsageGrid
              users={report.users}
              periodDays={report.periodDays}
              showOrganization={report.organizations.length > 1}
            />
          </Suspense>

          <Text variant="muted" size="xs">
            Updated {timeAgo(report.generatedAt)} · days counted in {report.timezone}
          </Text>
        </>
      )}
    </AppPage>
  );
};
