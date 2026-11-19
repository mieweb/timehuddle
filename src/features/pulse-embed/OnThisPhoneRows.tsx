/**
 * "On this phone": the rows for a place's videos that aren't (yet) its
 * server cards (PLAN §5.1 flow A, §5.2). Each row has a poster, a name, a
 * duration and a state chip (text and an icon, never colour alone); a change
 * of state is announced. When the server delivers a row's video, the place's
 * own card takes the same slot (`renderLanded`), and this phone's poster
 * stays until the server's has loaded.
 *
 * Presentational: it takes the merged rows (mergeRows.ts) and callbacks, and
 * fetches nothing.
 */
import { Alert, Badge, Button, Spinner } from '@mieweb/ui';
import {
  CircleAlert,
  CircleCheck,
  Clock,
  Film,
  Library,
  LoaderCircle,
  Pause,
  Send,
  Upload,
  WifiOff,
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

import { type Chip, type ChipIcon, type ChipTone, rowChip } from './chips';
import type { PulseRow } from './mergeRows';
import { PULSE_EMBED_TEXT } from './pulseEmbedStrings';

const T = PULSE_EMBED_TEXT.rows;

const ICONS: Record<
  ChipIcon,
  React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
> = {
  draft: Film,
  ready: Send,
  preparing: LoaderCircle,
  queued: Clock,
  offline: WifiOff,
  uploading: Upload,
  processing: LoaderCircle,
  paused: Pause,
  failed: CircleAlert,
  sent: CircleCheck,
  kept: Library,
};

const BADGE_VARIANT: Record<ChipTone, 'secondary' | 'default' | 'warning' | 'danger' | 'success'> =
  {
    neutral: 'secondary',
    progress: 'default',
    warning: 'warning',
    danger: 'danger',
    success: 'success',
  };

export interface OnThisPhoneRowsProps {
  items: readonly PulseRow[];
  loading?: boolean;
  error?: unknown;
  /** PulseKit resumes paused uploads by itself (`headless` capability). */
  headless?: boolean;
  /** Shown above the rows; null for none. */
  heading?: string | null;
  /** Tapping a row (its sheet: Edit, Send, Cancel sending…). */
  onOpen?: (row: PulseRow) => void;
  /** A landed row: the place's own card for its video, in the row's slot. */
  renderLanded?: (row: PulseRow) => React.ReactNode;
  /** The server's poster for a row; this phone's shows until it loads. */
  serverPoster?: (row: PulseRow) => string | null;
}

/** The chip, as a badge with its icon and words. */
export function PulseChip({ chip }: { chip: Chip }) {
  const Icon = ICONS[chip.icon];
  return (
    <Badge
      size="sm"
      variant={BADGE_VARIANT[chip.tone]}
      icon={<Icon className="size-3.5" aria-hidden />}
      className="pulse-chip"
      data-state={chip.state}
    >
      {chip.text}
    </Badge>
  );
}

/** This phone's poster, swapped for the server's once that has loaded. */
function RowPoster({
  name,
  local,
  server,
}: {
  name: string;
  local: string | null;
  server: string | null;
}) {
  const [loaded, setLoaded] = useState<string | null>(null);
  useEffect(() => {
    if (!server) return;
    const img = new Image();
    img.onload = () => setLoaded(server);
    img.src = server;
    return () => {
      img.onload = null;
    };
  }, [server]);
  const src = (server && loaded === server ? server : null) ?? local ?? server;
  return (
    <div className="pulse-row-poster flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
      {src ? (
        <img src={src} alt={T.poster(name)} className="h-full w-full object-cover" />
      ) : (
        <Film className="size-5 text-muted-foreground" aria-hidden />
      )}
    </div>
  );
}

export function OnThisPhoneRows({
  items,
  loading = false,
  error = null,
  headless = false,
  heading = T.heading,
  onOpen,
  renderLanded,
  serverPoster,
}: OnThisPhoneRowsProps) {
  const chips = items.map((row) => rowChip(row, { headless }));

  // Announce a row whose state changed (not every percent of an upload).
  const [announcement, setAnnouncement] = useState('');
  const seen = useRef<Map<string, string> | null>(null);
  const changeKey = items.map((row, i) => `${row.key}=${chips[i].state}`).join('|');
  useEffect(() => {
    const now = new Map(items.map((row, i) => [row.key, chips[i].state]));
    const before = seen.current;
    seen.current = now;
    if (!before) return;
    const changed = items.findIndex((row, i) => {
      const was = before.get(row.key);
      return was !== undefined && was !== chips[i].state;
    });
    if (changed >= 0) {
      setAnnouncement(T.changed(items[changed].name || T.untitled, chips[changed].text));
    }
    // changeKey stands for items and chips.
  }, [changeKey]);

  if (loading && items.length === 0) {
    return (
      <div className="on-this-phone-loading flex justify-center py-3" aria-busy="true">
        <Spinner size="sm" label={T.loading} />
      </div>
    );
  }
  if (error && items.length === 0) {
    return (
      <Alert variant="danger" className="on-this-phone-error">
        {T.loadFailed}
      </Alert>
    );
  }
  if (items.length === 0) return null;

  return (
    <section className="on-this-phone flex flex-col gap-2">
      {heading && (
        <h3 className="on-this-phone-heading text-sm font-medium text-muted-foreground">
          {heading}
        </h3>
      )}
      <ul className="on-this-phone-rows flex flex-col gap-2" aria-label={T.listLabel}>
        {items.map((row, i) => {
          if (row.landed && renderLanded) {
            return (
              <li key={row.key} className="on-this-phone-row landed">
                {renderLanded(row)}
              </li>
            );
          }
          const chip = chips[i];
          const name = row.name || T.untitled;
          return (
            <li key={row.key} className="on-this-phone-row flex items-center gap-3">
              <RowPoster
                name={name}
                local={row.localPoster}
                server={row.landed ? (serverPoster?.(row) ?? null) : null}
              />
              <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
                {onOpen ? (
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto max-w-full p-0 text-start"
                    aria-label={T.open(name)}
                    onClick={() => onOpen(row)}
                  >
                    {name}
                  </Button>
                ) : (
                  <span className="on-this-phone-name max-w-full truncate text-sm font-medium">
                    {name}
                  </span>
                )}
                <div className="flex items-center gap-2">
                  <PulseChip chip={chip} />
                  {row.durationMs != null && row.durationMs > 0 && (
                    <span className="on-this-phone-duration text-xs text-muted-foreground">
                      {T.duration(row.durationMs)}
                    </span>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </section>
  );
}
