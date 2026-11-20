/**
 * Unsent videos, at the top of the Media page (PLAN §5.1, F2): every video
 * recorded in TimeHuddle on this phone that hasn't been sent, and the ones
 * sent in the last 7 days, grouped by place (Tickets, Clock sessions, Posts,
 * Library). Filters show when more than one group has rows. Offline, it says
 * the list is this phone's alone (§5.3). A row's change of state is
 * announced.
 *
 * Presentational: it takes the rows (`items`, already merged and in their
 * stable order), `loading`, `error` and callbacks; it fetches nothing and
 * knows no router.
 */
import { Alert, Spinner, Text } from '@mieweb/ui';
import { WifiOff } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { SegmentedSwitcher } from '../../ui/SegmentedSwitcher';
import { rowChip } from '../pulse-embed/chips';
import type { PulseRow } from '../pulse-embed/mergeRows';
import { PULSE_EMBED_TEXT } from '../pulse-embed/pulseEmbedStrings';
import { MEDIA_TEXT } from './mediaStrings';
import { rowFacts, type MenuAction } from './rowActions';
import { UnsentVideoRow } from './UnsentVideoRow';
import {
  applyFilter,
  filtersFor,
  groupRows,
  placeGroupOf,
  type MediaFilter,
  type PlaceGroup,
} from './unsentRows';

const T = MEDIA_TEXT;

export interface UnsentVideosSectionProps {
  /** The rows, in the order they show (each has its draft on this phone). */
  items: readonly PulseRow[];
  loading?: boolean;
  error?: unknown;
  /** The phone is offline: the list comes from this phone alone. */
  offline?: boolean;
  /** PulseKit resumes paused uploads by itself. */
  headless?: boolean;
  filter: MediaFilter;
  onFilterChange: (filter: MediaFilter) => void;
  /** Now, for each row's age. */
  now: number;
  onOpen: (row: PulseRow) => void;
  onMenu: (action: MenuAction, row: PulseRow) => void;
}

/** Videos not yet sent: what "Unsent videos (n)" counts (§5.2). */
export function unsentCount(items: readonly PulseRow[]): number {
  return items.filter((row) => row.local && row.local.state !== 'sent').length;
}

const groupOf = (row: PulseRow): PlaceGroup => placeGroupOf(row.local?.context);

export function UnsentVideosSection({
  items,
  loading = false,
  error = null,
  offline = false,
  headless = false,
  filter,
  onFilterChange,
  now,
  onOpen,
  onMenu,
}: UnsentVideosSectionProps) {
  const headingId = useId();
  const groups = groupRows(items, groupOf);
  const filters = filtersFor(groups.map((g) => g.group));
  const shown = applyFilter(groups, filters.length > 0 ? filter : 'all');
  const count = unsentCount(items);

  // Announce a row whose state changed (not each percent of an upload).
  const [announcement, setAnnouncement] = useState('');
  const seen = useRef<Map<string, string> | null>(null);
  const states = items.map((row) => [row.key, rowChip(row, { headless })] as const);
  const changeKey = states.map(([key, chip]) => `${key}=${chip.state}`).join('|');
  useEffect(() => {
    const now = new Map(states.map(([key, chip]) => [key, chip.state]));
    const before = seen.current;
    seen.current = now;
    if (!before) return;
    const changed = states.findIndex(([key, chip]) => {
      const was = before.get(key);
      return was !== undefined && was !== chip.state;
    });
    if (changed >= 0) {
      const row = items[changed];
      setAnnouncement(
        PULSE_EMBED_TEXT.rows.changed(row.name || T.row.untitled, states[changed][1].text),
      );
    }
    // changeKey stands for items and their chips.
  }, [changeKey]);

  let body: ReactNode;
  if (loading && items.length === 0) {
    body = (
      <div className="unsent-videos-loading flex justify-center py-6" aria-busy="true">
        <Spinner size="sm" label={T.unsent.loading} />
      </div>
    );
  } else if (error && items.length === 0) {
    body = (
      <Alert variant="danger" className="unsent-videos-error">
        {T.unsent.loadFailed}
      </Alert>
    );
  } else if (items.length === 0) {
    body = (
      <Text size="sm" variant="muted" className="unsent-videos-empty">
        {T.unsent.empty}
      </Text>
    );
  } else {
    body = (
      <>
        {filters.length > 0 && (
          <SegmentedSwitcher
            name="unsent-videos-filter"
            label={T.unsent.filterLabel}
            hideLabel
            compact
            options={filters.map((value) => ({ value, label: T.filter[value] }))}
            value={filters.includes(filter) ? filter : 'all'}
            onValueChange={onFilterChange}
          />
        )}
        {shown.map(({ group, rows }) => (
          <section key={group} className="unsent-videos-group flex flex-col gap-2">
            <h3 className="unsent-videos-group-heading text-sm font-medium text-muted-foreground">
              {T.group[group]}
            </h3>
            <ul className="flex flex-col gap-3" aria-label={T.group[group]}>
              {rows.map((row) => (
                <UnsentVideoRow
                  key={row.key}
                  row={row}
                  facts={rowFacts(row, { headless })}
                  headless={headless}
                  now={now}
                  onOpen={onOpen}
                  onMenu={onMenu}
                />
              ))}
            </ul>
          </section>
        ))}
      </>
    );
  }

  return (
    <section className="unsent-videos flex flex-col gap-3" aria-labelledby={headingId}>
      <h2 id={headingId} className="unsent-videos-heading text-base font-semibold">
        {count > 0 ? T.unsent.headingCount(count) : T.unsent.heading}
      </h2>
      {offline && (
        <Alert
          variant="warning"
          className="unsent-videos-offline"
          icon={<WifiOff className="size-4" aria-hidden />}
          role="status"
          aria-live="polite"
        >
          {T.unsent.offline}
        </Alert>
      )}
      {body}
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </section>
  );
}
