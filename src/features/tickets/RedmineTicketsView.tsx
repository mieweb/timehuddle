/**
 * RedmineTicketsView — read-only list of the connected user's Redmine issues.
 *
 * Milestone 2 of the Redmine integration. This is a *separate* data path from
 * the internal TimeHuddle tickets: it renders the minimal `RedmineIssue` DTO
 * from `redmine.issues.list` and never touches the core `Ticket` model.
 *
 * "Read-only" here means the Redmine *issue data* is read-only — issues cannot
 * be created/edited/deleted from TimeHuddle (the "New Ticket" button is disabled
 * with a "Read only" tooltip). Rows link out to Redmine.
 *
 * Fetch strategy: fetch-on-view + a manual "Refresh" button, with a small
 * module-level cache keyed by user and scope so switching views/scopes doesn't
 * refetch every time. There is no server-side cache in v1.
 */
import { faExternalLink, faPlus, faRotate, faSearch } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Select,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
  Tooltip,
} from '@mieweb/ui';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  redmineApi,
  type RedmineIssue,
  type RedmineIssueList,
  type RedmineScope,
} from '../../lib/api';
import { useRefresh } from '../../lib/RefreshContext';
import { useSession } from '../../lib/useSession';
import { EmptyState } from '../../ui/EmptyState';
import { useRouter } from '../../ui/router';

// ─── Constants ──────────────────────────────────────────────────────────────

const SCOPE_OPTIONS = [
  { value: 'mine', label: 'Assigned to me' },
  { value: 'all', label: 'All' },
];

/** Sentinel value for the "Unassigned" assignee-filter option. */
const UNASSIGNED = '__unassigned__';

/**
 * Session-lived cache of the last fetched list, keyed by user *and* scope.
 * Module-level so it survives view switches (Tickets v1 ↔ Redmine) without a
 * refetch. Sign-out does not reload the page, so the user id must be part of
 * the key or a second user could be served the first user's issues. Only
 * connected responses are cached, so linking an account in Settings and coming
 * back refetches instead of replaying a stale "not connected" state.
 */
const listCache = new Map<string, RedmineIssueList>();

const cacheKey = (userId: string, scope: RedmineScope) => `${userId}:${scope}`;

// ─── Component ────────────────────────────────────────────────────────────────

export const RedmineTicketsView: React.FC = () => {
  const { navigate, pathname } = useRouter();
  const { user } = useSession();
  const userId = user?.id ?? '';

  const [scope, setScope] = useState<RedmineScope>('mine');
  const [data, setData] = useState<RedmineIssueList | null>(
    () => listCache.get(cacheKey(userId, 'mine')) ?? null,
  );
  const [loading, setLoading] = useState(!listCache.has(cacheKey(userId, 'mine')));
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState<string>('');

  // Guards against a slow response for a previous scope overwriting a newer one.
  const requestSeq = useRef(0);

  const load = useCallback(
    async (targetScope: RedmineScope, { force = false }: { force?: boolean } = {}) => {
      // Bumped before the cache check so a cache hit also supersedes any
      // in-flight request for a previously selected scope.
      const seq = ++requestSeq.current;
      const key = cacheKey(userId, targetScope);

      const cached = listCache.get(key);
      if (cached && !force) {
        setData(cached);
        setLoading(false);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const result = await redmineApi.issues.list(targetScope);
        if (seq !== requestSeq.current) return; // superseded by a newer request
        if (result.connected) listCache.set(key, result);
        setData(result);
      } catch (err: unknown) {
        if (seq !== requestSeq.current) return;
        setError(err instanceof Error ? err.message : 'Failed to load Redmine issues.');
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    },
    [userId],
  );

  // Fetch on scope change (from cache when available). The assignee filter is
  // reset because its options are derived from the fetched issues, and a name
  // present in "All" may be absent from "Assigned to me".
  useEffect(() => {
    setAssigneeFilter('');
    void load(scope);
  }, [scope, load]);

  // Pull-to-refresh / global refresh forces a refetch of the current scope.
  // Gated on the tickets route: TicketsPage stays mounted behind other routes,
  // so an ungated handler would refetch Redmine issues from Settings etc.
  useRefresh(
    useCallback(async () => {
      await load(scope, { force: true });
    }, [load, scope]),
    pathname === '/app/tickets',
  );

  const issues = data?.issues ?? [];
  const baseUrl = data?.baseUrl ?? null;
  const connected = data?.connected ?? true;

  // Assignee-filter options are derived from the assignees present in the
  // fetched issues — no Redmine users API needed (sidesteps whether the key
  // can list team members).
  const assigneeOptions = useMemo(() => {
    const byId = new Map<number, string>();
    let hasUnassigned = false;
    for (const issue of issues) {
      if (issue.assignedTo) byId.set(issue.assignedTo.id, issue.assignedTo.name);
      else hasUnassigned = true;
    }
    const options = [{ value: '', label: 'All assignees' }];
    if (hasUnassigned) options.push({ value: UNASSIGNED, label: 'Unassigned' });
    for (const [id, name] of byId) options.push({ value: String(id), label: name });
    return options;
  }, [issues]);

  const filteredIssues = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return issues.filter((issue) => {
      if (assigneeFilter === UNASSIGNED && issue.assignedTo) return false;
      if (assigneeFilter && assigneeFilter !== UNASSIGNED) {
        if (String(issue.assignedTo?.id ?? '') !== assigneeFilter) return false;
      }
      if (!q) return true;
      return (
        String(issue.id).includes(q) ||
        issue.subject.toLowerCase().includes(q) ||
        (issue.project?.name.toLowerCase().includes(q) ?? false)
      );
    });
  }, [issues, searchQuery, assigneeFilter]);

  // ── Header (mirrors the v1 tickets header: New Ticket + Search) ──
  const header = (
    <div className="redmine-tickets-header sticky top-0 z-20 -mx-4 border-b border-neutral-200 bg-neutral-50/95 px-4 py-2 backdrop-blur supports-backdrop-filter:bg-neutral-50/80 dark:border-neutral-800 dark:bg-neutral-950/95 dark:supports-backdrop-filter:bg-neutral-950/80 md:static md:z-auto md:mx-0 md:border-0 md:bg-transparent md:px-0 md:py-0">
      <div className="flex items-center gap-2">
        {/* Issues are read-only in TimeHuddle — creation is disabled. The span
            wrapper lets the tooltip fire even though the button is disabled. */}
        <Tooltip content="Read only">
          <span tabIndex={0} className="shrink-0" aria-label="New ticket is read only">
            <Button
              variant="primary"
              size="sm"
              disabled
              leftIcon={<FontAwesomeIcon icon={faPlus} />}
              className="rounded-lg"
            >
              New Ticket
            </Button>
          </span>
        </Tooltip>

        <div className="relative min-w-0 flex-1">
          <FontAwesomeIcon
            icon={faSearch}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-neutral-400"
          />
          <Input
            label="Search Redmine issues"
            hideLabel
            placeholder="Search issues…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 rounded-lg"
            size="sm"
          />
        </div>

        <Button
          variant="outline"
          size="sm"
          leftIcon={<FontAwesomeIcon icon={faRotate} spin={loading} />}
          onClick={() => void load(scope, { force: true })}
          disabled={loading}
          className="shrink-0 rounded-lg"
          aria-label="Refresh Redmine issues"
        >
          Refresh
        </Button>
      </div>
    </div>
  );

  const filters = (
    <div className="redmine-tickets-filters flex flex-wrap items-center gap-3">
      <div className="w-48">
        <Select
          aria-label="Scope"
          options={SCOPE_OPTIONS}
          value={scope}
          onValueChange={(val: string) => setScope(val as RedmineScope)}
          size="sm"
        />
      </div>
      <div className="w-56">
        <Select
          aria-label="Filter by assignee"
          options={assigneeOptions}
          value={assigneeFilter}
          onValueChange={setAssigneeFilter}
          size="sm"
        />
      </div>
      <Text size="sm" variant="muted" className="ml-auto">
        {filteredIssues.length} {filteredIssues.length === 1 ? 'issue' : 'issues'}
      </Text>
    </div>
  );

  // ── Body states: loading → not-connected → error → empty → table ──
  const renderBody = () => {
    if (loading && !data) {
      return (
        <div className="redmine-tickets-loading flex items-center justify-center py-24">
          <Spinner />
        </div>
      );
    }

    if (!connected) {
      return (
        <EmptyState
          icon={<FontAwesomeIcon icon={faExternalLink} />}
          title="Redmine account not connected"
          description="Connect your personal Redmine API key to see your issues here."
          action={
            <Button variant="primary" size="sm" onClick={() => navigate('/app/settings')}>
              Go to Settings
            </Button>
          }
        />
      );
    }

    if (error) {
      return (
        <EmptyState
          title="Couldn't load Redmine issues"
          description={error}
          action={
            <Button variant="outline" size="sm" onClick={() => void load(scope, { force: true })}>
              Try again
            </Button>
          }
        />
      );
    }

    if (filteredIssues.length === 0) {
      return (
        <EmptyState
          icon={<FontAwesomeIcon icon={faSearch} />}
          title={issues.length === 0 ? 'No Redmine issues' : 'No matching issues'}
          description={
            issues.length === 0
              ? scope === 'mine'
                ? 'You have no issues assigned to you in Redmine.'
                : 'No issues are visible to your Redmine account.'
              : 'Try a different search or assignee filter.'
          }
        />
      );
    }

    return (
      <div className="redmine-tickets-table overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">ID</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Assignee</TableHead>
              <TableHead className="w-12 text-right sr-only">Open in Redmine</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredIssues.map((issue) => (
              <RedmineIssueRow key={issue.id} issue={issue} baseUrl={baseUrl} />
            ))}
          </TableBody>
        </Table>
      </div>
    );
  };

  return (
    <div className="redmine-tickets-view flex min-h-0 flex-1 flex-col gap-3">
      {header}
      <Card className="flex min-h-0 flex-1 flex-col">
        <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
          {connected && filters}
          <div className="min-h-0 flex-1 overflow-auto">{renderBody()}</div>
        </CardContent>
      </Card>
    </div>
  );
};

// ─── Row ──────────────────────────────────────────────────────────────────────

interface RedmineIssueRowProps {
  issue: RedmineIssue;
  baseUrl: string | null;
}

const RedmineIssueRow: React.FC<RedmineIssueRowProps> = ({ issue, baseUrl }) => {
  const issueUrl = baseUrl ? `${baseUrl}/issues/${issue.id}` : null;

  return (
    <TableRow>
      <TableCell className="font-mono text-xs text-neutral-500">#{issue.id}</TableCell>
      <TableCell className="max-w-md truncate font-medium">{issue.subject}</TableCell>
      <TableCell className="text-neutral-600 dark:text-neutral-400">
        {issue.project?.name ?? '—'}
      </TableCell>
      <TableCell>
        {issue.status ? <Badge variant="secondary">{issue.status.name}</Badge> : '—'}
      </TableCell>
      <TableCell className="text-neutral-600 dark:text-neutral-400">
        {issue.assignedTo?.name ?? 'Unassigned'}
      </TableCell>
      <TableCell className="text-right">
        {issueUrl && (
          <a
            href={issueUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open Redmine issue #${issue.id} in a new tab`}
            className="inline-flex items-center text-neutral-400 hover:text-blue-600 dark:hover:text-blue-400"
          >
            <FontAwesomeIcon icon={faExternalLink} className="h-3.5 w-3.5" />
          </a>
        )}
      </TableCell>
    </TableRow>
  );
};
