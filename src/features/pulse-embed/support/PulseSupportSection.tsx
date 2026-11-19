/**
 * Pulse support in Settings → Team (TH-4, D9; huddle-server §5.6): for a
 * team's admins, find a video someone sent from the app that never arrived,
 * by person, ticket or clock session, with its state, reason and overdue or
 * abandoned flag, plus the team's last 30 days of Pulse metrics (PLAN §7.2).
 * The runbook "my video never attached" (docs/pulse-in-app.md) starts here.
 *
 * Nothing loads until the admin opens it: the metrics and the search are
 * admin calls (`pulseUploads.metrics`, `pulseUploads.adminList`), and the
 * table is a lazily loaded NITRO grid. Every search asks `adminList` for the
 * selected team's rows only, and says so when a full page means some may be
 * missing.
 */
import { Button, Input, Select, Spinner, Text } from '@mieweb/ui';
import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';

import {
  pulseUploadApi,
  teamApi,
  type PulseUploadMetrics,
  type Team,
  type TeamMember,
} from '../../../lib/api';
import {
  metricItems,
  SUPPORT_LIMIT,
  supportPage,
  supportQuery,
  type SupportMode,
  type SupportRow,
} from './supportRows';
import { SUPPORT_TEXT as T } from './supportStrings';

const PulseSupportGrid = lazy(() => import('./PulseSupportGrid'));

const MODES: SupportMode[] = ['recent', 'person', 'ticket', 'session'];

type SupportQuery = Parameters<typeof pulseUploadApi.adminList>[0];

/** "Most recent": the team's newest rows, no other filter. */
const recentQuery = (teamId: string): SupportQuery => {
  const built = supportQuery('recent', {}, teamId);
  return 'query' in built ? built.query : { teamId, limit: SUPPORT_LIMIT };
};

const messageOf = (error: unknown, fallback: string) =>
  (error as { message?: unknown } | null)?.message && typeof (error as Error).message === 'string'
    ? `${fallback} ${(error as Error).message}`
    : fallback;

type Metrics =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'done'; metrics: PulseUploadMetrics };

const MetricsSummary: React.FC<{ state: Metrics }> = ({ state }) => {
  if (state.status === 'loading') return <Spinner size="sm" label={T.metricsLoading} />;
  if (state.status === 'error') {
    return (
      <Text variant="muted" size="sm" className="pulse-support-metrics-error">
        {state.message}
      </Text>
    );
  }
  const { metrics } = state;
  return (
    <div className="pulse-support-metrics space-y-1">
      <Text size="xs" weight="semibold" variant="muted" className="uppercase tracking-widest">
        {T.metricsTitle}
      </Text>
      {metrics.counts.total === 0 ? (
        <Text variant="muted" size="sm">
          {T.metricsNone}
        </Text>
      ) : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          {metricItems(metrics).map(({ label, value }) => (
            <div key={label} className="pulse-support-metric">
              <dt className="text-neutral-500 dark:text-neutral-400">{label}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {metrics.truncated && (
        <Text variant="muted" size="xs">
          {T.metricsTruncated}
        </Text>
      )}
    </div>
  );
};

/** The open section: metrics, the search, and the table. */
const SupportPanel: React.FC<{ team: Team }> = ({ team }) => {
  const [metrics, setMetrics] = useState<Metrics>({ status: 'loading' });
  const [mode, setMode] = useState<SupportMode>('recent');
  const [userId, setUserId] = useState('');
  const [ticket, setTicket] = useState('');
  const [session, setSession] = useState('');
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [rows, setRows] = useState<SupportRow[]>([]);
  const [incomplete, setIncomplete] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  // Only the latest search may set the rows.
  const searchId = useRef(0);
  const lastQuery = useRef<SupportQuery>({});

  const run = useCallback(
    async (query: SupportQuery) => {
      const id = (searchId.current += 1);
      lastQuery.current = query;
      setLoading(true);
      setError(null);
      try {
        const { uploads } = await pulseUploadApi.adminList(query);
        if (id !== searchId.current) return;
        const page = supportPage(uploads, team.id, Date.now(), query?.limit ?? SUPPORT_LIMIT);
        setRows(page.rows);
        setIncomplete(page.incomplete);
        setAnnouncement(T.found(page.rows.length));
      } catch (e) {
        if (id !== searchId.current) return;
        setRows([]);
        setIncomplete(false);
        setError(messageOf(e, T.loadFailed));
      } finally {
        if (id === searchId.current) setLoading(false);
      }
    },
    [team.id],
  );

  useEffect(() => {
    let alive = true;
    pulseUploadApi
      .metrics({ teamId: team.id })
      .then((m) => alive && setMetrics({ status: 'done', metrics: m }))
      .catch(
        (e) => alive && setMetrics({ status: 'error', message: messageOf(e, T.metricsFailed) }),
      );
    void run(recentQuery(team.id));
    return () => {
      alive = false;
    };
  }, [team.id, run]);

  // The person picker's names, once it is first shown.
  useEffect(() => {
    if (mode !== 'person' || members) return;
    let alive = true;
    teamApi
      .getMembers(team.id)
      .then((list) => alive && setMembers(list))
      .catch(() => alive && setMembers([]));
    return () => {
      alive = false;
    };
  }, [mode, members, team.id]);

  const find = (event?: React.FormEvent) => {
    event?.preventDefault();
    const built = supportQuery(mode, { userId, ticket, session }, team.id);
    if ('error' in built) {
      setInputError(built.error);
      return;
    }
    setInputError(null);
    void run(built.query);
  };

  const chooseMode = (next: SupportMode) => {
    setMode(next);
    setInputError(null);
    // "Most recent" needs nothing typed: run it at once.
    if (next === 'recent') void run(recentQuery(team.id));
  };

  return (
    <div className="pulse-support-panel space-y-4">
      <MetricsSummary state={metrics} />

      <form className="space-y-3" onSubmit={find} aria-label={T.findBy}>
        <div role="group" aria-label={T.findBy} className="flex flex-wrap gap-2">
          {MODES.map((m) => (
            <Button
              key={m}
              type="button"
              size="sm"
              variant={mode === m ? 'primary' : 'outline'}
              aria-pressed={mode === m}
              className={`pulse-support-mode-${m}`}
              onClick={() => chooseMode(m)}
            >
              {T.modes[m]}
            </Button>
          ))}
        </div>

        {mode !== 'recent' && (
          <div className="flex flex-wrap items-end gap-2">
            {mode === 'person' && (
              <Select
                label={T.personLabel}
                placeholder={T.personPlaceholder}
                size="sm"
                searchable
                value={userId}
                options={(members ?? []).map((m) => ({ value: m.id, label: m.name || m.email }))}
                onValueChange={(id) => setUserId(id)}
                error={inputError ?? undefined}
                className="pulse-support-person min-w-[14rem]"
              />
            )}
            {mode === 'ticket' && (
              <Input
                label={T.ticketLabel}
                placeholder={T.ticketPlaceholder}
                value={ticket}
                onChange={(e) => setTicket(e.target.value)}
                error={inputError ?? undefined}
                className="pulse-support-ticket"
              />
            )}
            {mode === 'session' && (
              <Input
                label={T.sessionLabel}
                placeholder={T.sessionPlaceholder}
                value={session}
                onChange={(e) => setSession(e.target.value)}
                error={inputError ?? undefined}
                className="pulse-support-session"
              />
            )}
            <Button type="submit" size="sm" className="pulse-support-find">
              {T.find}
            </Button>
          </div>
        )}
      </form>

      <Suspense fallback={<Spinner size="sm" label={T.loading} />}>
        <PulseSupportGrid
          items={rows}
          loading={loading}
          error={error}
          onRetry={() => void run(lastQuery.current)}
        />
      </Suspense>
      {incomplete && !loading && !error && (
        <Text variant="muted" size="xs" className="pulse-support-incomplete">
          {T.incomplete(SUPPORT_LIMIT)}
        </Text>
      )}
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
};

/** Settings → Team's Pulse support, for a team the viewer manages. */
export const PulseSupportSection: React.FC<{ team: Team }> = ({ team }) => {
  const [open, setOpen] = useState(false);
  return (
    <section className="pulse-support space-y-3" aria-labelledby={`pulse-support-${team.id}`}>
      <div>
        <Text as="h3" id={`pulse-support-${team.id}`} weight="semibold" size="sm">
          {T.title}
        </Text>
        <Text variant="muted" size="sm">
          {T.hint}
        </Text>
      </div>
      {open ? (
        <SupportPanel team={team} />
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="pulse-support-open"
          onClick={() => setOpen(true)}
        >
          {T.open}
        </Button>
      )}
    </section>
  );
};

/** Whether the server knows Pulse in the app (it resolves the team's Pulse settings). */
export function teamHasPulse(team: Team): boolean {
  return team.resolvedSettings.pulseInApp !== undefined;
}
