/**
 * The Media page (`/app/media`, PLAN §5.1 F2, TH-8): Unsent videos at the
 * top, "Your library" below. Back from retirement only under the §7.2
 * visibility rule (mediaVisibility.ts); otherwise the route goes to the
 * Dashboard exactly as it did while retired.
 *
 * Unsent videos are this phone's drafts (Pulse's `listDrafts`, receipts of
 * the last 7 days included), joined with the server's record of their uploads
 * by draftKey while online, so a kept outcome the phone hasn't polled yet
 * shows at once. Offline the section renders from this phone alone and says
 * so (§5.3). Rows keep their places as their states change, a sent video's
 * receipt included.
 *
 * Send from the list starts at once and Delete hides the row; both say so in
 * a toast with Undo for about 5 s (§5.3: undo, not confirm). A delete commits
 * when the toast's time is up, or when the page is left.
 */
import { useOptionalToast } from '@mieweb/ui';
import type { DraftState } from '@mieweb/pulse-embed';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { mediaApi, pulseUploadApi, type MediaItem, type PulseUploadPublic } from '../../lib/api';
import { useSession } from '../../lib/useSession';
import { useTeam } from '../../lib/TeamContext';
import { AppPage } from '../../ui/AppPage';
import { useQueryParam, useRouter } from '../../ui/router';
import { mergeRows, type PulseRow } from '../pulse-embed/mergeRows';
import { pulsePlace, type PulsePlace } from '../pulse-embed/place';
import { watchPath } from '../pulse-upload/artifact';
import { usePulseDrafts, usePulseEmbed } from '../pulse-embed/usePulseEmbed';
import { createMediaActions } from './mediaActions';
import { MEDIA_TEXT } from './mediaStrings';
import { MEDIA_GATE_WAIT_MS, mediaGate, mediaRedirectTarget } from './mediaVisibility';
import { MoveToSheet } from './MoveToSheet';
import { RenameDialog } from './RenameDialog';
import { rowFacts, rowTap, type MenuAction, type SheetAction } from './rowActions';
import { UnsentVideosSection } from './UnsentVideosSection';
import { clockActionOf, inOrder, isClockBound, parseFilter, stableOrder } from './unsentRows';
import { UploadSheet } from './UploadSheet';
import { YourLibrary } from './YourLibrary';

const T = MEDIA_TEXT;

/** How long Undo is offered after Send or Delete from the list. */
export const UNDO_MS = 5_000;

/** Every state, receipts included: the section lists sent videos for their 7 days. */
const ALL_STATES: DraftState[] = [
  'draft',
  'ready',
  'preparing',
  'queued',
  'waiting_network',
  'uploading',
  'delivering',
  'needs_credentials',
  'failed',
  'sent',
];

/** How far back the server's rows are read: a receipt lives 7 days. */
const SERVER_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** `navigator.onLine`, kept current. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine !== false,
  );
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

/** Now, every minute, for the rows' ages. */
function useMinute(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** The server's rows for the caller's recent uploads, read again when `key` changes. */
function useRecentUploads(enabled: boolean, key: string): PulseUploadPublic[] {
  const [uploads, setUploads] = useState<PulseUploadPublic[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    pulseUploadApi
      .list({ since: Date.now() - SERVER_WINDOW_MS })
      .then(({ uploads: rows }) => alive && setUploads(rows))
      .catch((error) => console.warn('[media] pulseUploads.list failed:', error));
    return () => {
      alive = false;
    };
  }, [enabled, key]);
  return enabled ? uploads : [];
}

/** `media.list`, with its loading and error state. */
function useLibrary(enabled: boolean) {
  const [state, setState] = useState<{ items: MediaItem[]; loading: boolean; error: unknown }>({
    items: [],
    loading: enabled,
    error: null,
  });
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setState((prev) => ({ ...prev, loading: true }));
    mediaApi
      .list()
      .then((items) => alive && setState({ items, loading: false, error: null }))
      .catch((error) => alive && setState((prev) => ({ ...prev, loading: false, error })));
    return () => {
      alive = false;
    };
  }, [enabled, round]);
  return { ...state, retry: () => setRound((n) => n + 1) };
}

// ─── The page ─────────────────────────────────────────────────────────────────

/** The route: the page under the visibility rule, else the Dashboard as before. */
export function MediaPage() {
  const embed = usePulseEmbed();
  const { search, replace } = useRouter();
  const gate = mediaGate(embed);
  // Once shown, it stays for this visit: sending the last video doesn't pull
  // the page out from under the person.
  const [shown, setShown] = useState(gate === 'render');
  if (gate === 'render' && !shown) setShown(true);

  const [waitedOut, setWaitedOut] = useState(false);
  useEffect(() => {
    if (gate !== 'wait') return;
    const timer = setTimeout(() => setWaitedOut(true), MEDIA_GATE_WAIT_MS);
    return () => clearTimeout(timer);
  }, [gate]);

  const redirect = !shown && (gate === 'redirect' || (gate === 'wait' && waitedOut));
  const searchRef = useRef(search);
  searchRef.current = search;
  useEffect(() => {
    if (redirect) replace(mediaRedirectTarget(searchRef.current));
  }, [redirect, replace]);

  if (shown) return <MediaContent />;
  if (redirect) return null;
  return (
    <div className="media-checking flex justify-center py-12" aria-live="polite" aria-busy="true">
      <span className="sr-only">{T.checking}</span>
    </div>
  );
}

function MediaContent() {
  const embed = usePulseEmbed();
  const { client, info, types } = embed;
  const toast = useOptionalToast();
  const { user } = useSession();
  const { teams, activeClockEvent } = useTeam();
  const online = useOnline();
  const now = useMinute();
  const [filterParam, setFilterParam] = useQueryParam('filter');
  const filter = parseFilter(filterParam);
  const headless = !!info?.capabilities?.includes('headless');

  // ── Rows ──
  const local = usePulseDrafts(useMemo(() => ({ states: ALL_STATES }), []));
  const stateKey = local.drafts.map((d) => `${d.draftKey}=${d.state}`).join('|');
  const server = useRecentUploads(online, stateKey);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const merged = useMemo(
    () =>
      mergeRows(local.drafts, online ? server : [], { userId: user?.id ?? null }).filter(
        (row) => row.local !== null,
      ),
    [local.drafts, server, online, user?.id],
  );
  // The order covers rows hidden for an undo too, so an undone delete is back in its place.
  const order = useRef<string[]>([]);
  order.current = stableOrder(
    order.current,
    merged.map((r) => r.key),
  );
  const rows = inOrder(merged, order.current, (r) => r.key).filter((r) => !hidden.has(r.key));
  const byKey = new Map(rows.map((r) => [r.key, r]));

  const library = useLibrary(online);

  // ── Actions ──
  const actions = useMemo(
    () =>
      client
        ? createMediaActions({ client, open: embed.open, reportError: embed.reportError })
        : null,
    [client, embed.open, embed.reportError],
  );

  const say = useCallback(
    (message: string, action?: { label: string; onClick: () => void }) =>
      toast?.toast({ message, variant: 'info', duration: action ? UNDO_MS : undefined, action }),
    [toast],
  );

  const [sheetKey, setSheetKey] = useState<string | null>(null);
  const [moveKey, setMoveKey] = useState<string | null>(null);
  const [renameKey, setRenameKey] = useState<string | null>(null);

  // Deletes waiting out their undo, committed on time or when the page is left.
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const pendingDeletes = useRef(new Map<string, { row: PulseRow; timer: number }>());
  const commitDelete = useCallback(async (key: string) => {
    const pending = pendingDeletes.current.get(key);
    if (!pending) return;
    pendingDeletes.current.delete(key);
    window.clearTimeout(pending.timer);
    await actionsRef.current?.remove(pending.row);
    // Gone from Pulse's list by now; shown again if the delete failed.
    setHidden((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);
  useEffect(() => {
    const pending = pendingDeletes.current;
    return () => {
      for (const key of [...pending.keys()]) void commitDelete(key);
    };
  }, [commitDelete]);

  const deleteWithUndo = (row: PulseRow) => {
    setHidden((prev) => new Set(prev).add(row.key));
    const timer = window.setTimeout(() => void commitDelete(row.key), UNDO_MS);
    pendingDeletes.current.set(row.key, { row, timer });
    say(T.undo.deleted(row.name || T.row.untitled), {
      label: T.undo.action,
      onClick: () => {
        const pending = pendingDeletes.current.get(row.key);
        if (!pending) return;
        window.clearTimeout(pending.timer);
        pendingDeletes.current.delete(row.key);
        setHidden((prev) => {
          const next = new Set(prev);
          next.delete(row.key);
          return next;
        });
        say(T.undo.undone);
      },
    });
  };

  const sendWithUndo = async (row: PulseRow) => {
    if (!actions || !(await actions.send(row))) return;
    say(T.undo.sending, {
      label: T.undo.action,
      onClick: () => {
        void actions.unsend(row).then((ok) => ok && say(T.undo.undone));
      },
    });
  };

  const onOpen = (row: PulseRow) => {
    const facts = rowFacts(row, { headless });
    switch (rowTap(facts)) {
      case 'editor':
        void actions?.edit(row, facts.state);
        return;
      case 'sheet':
        setSheetKey(row.key);
        return;
      case 'watch':
        actions?.watch(row);
        return;
      default:
        return;
    }
  };

  const onMenu = (action: MenuAction, row: PulseRow) => {
    switch (action) {
      case 'send':
        void sendWithUndo(row);
        return;
      case 'move':
        setMoveKey(row.key);
        return;
      case 'rename':
        setRenameKey(row.key);
        return;
      case 'delete':
        deleteWithUndo(row);
        return;
    }
  };

  const sheetRow = sheetKey ? (byKey.get(sheetKey) ?? null) : null;
  const sheetFacts = sheetRow ? rowFacts(sheetRow, { headless }) : null;
  const onSheetAction = (action: SheetAction) => {
    if (!sheetRow || !sheetFacts) return;
    setSheetKey(null);
    if (action === 'move') setMoveKey(sheetRow.key);
    else if (action === 'delete') deleteWithUndo(sheetRow);
    else void actions?.sheet(action, sheetRow, sheetFacts.state);
  };

  const moveRow = moveKey ? (byKey.get(moveKey) ?? null) : null;
  const moveFacts = moveRow ? rowFacts(moveRow, { headless }) : null;
  const typeOf = (id: string) => types?.find((t) => t.id === id) ?? null;
  const sessionPlace: PulsePlace | null = useMemo(() => {
    const type = types?.find((t) => t.id === 'clock.session') ?? null;
    if (!activeClockEvent || !type) return null;
    const team = teams.find((t) => t.id === activeClockEvent.teamId);
    return pulsePlace({
      type: 'clock.session',
      clockEventId: activeClockEvent.id,
      label: T.move.sessionLabel(team?.name ?? null),
      uploadType: type,
    });
  }, [types, activeClockEvent, teams]);
  const libraryType = typeOf('library.video');
  const libraryPlace =
    libraryType && user?.id && moveFacts?.state !== 'kept'
      ? pulsePlace({
          type: 'library.video',
          userId: user.id,
          label: T.move.library,
          uploadType: libraryType,
        })
      : null;
  const onPick = async (place: PulsePlace) => {
    if (!moveRow || !moveFacts || !actions) return;
    setMoveKey(null);
    const kept = moveFacts.state === 'kept';
    if (await actions.move(moveRow, place, moveFacts.state)) {
      say(kept ? T.move.movedKept(place.context.label) : T.move.moved(place.context.label));
    }
  };

  const renameRow = renameKey ? (byKey.get(renameKey) ?? null) : null;

  return (
    <AppPage>
      <div className="media-page flex flex-col gap-8">
        <UnsentVideosSection
          items={rows}
          loading={local.loading}
          error={local.error}
          offline={!online}
          headless={headless}
          filter={filter}
          onFilterChange={(next) => setFilterParam(next === 'all' ? null : next)}
          now={now}
          onOpen={onOpen}
          onMenu={onMenu}
        />
        <YourLibrary
          items={library.items}
          loading={library.loading}
          error={library.error}
          onRetry={library.retry}
          onWatch={(item) => item.videoid && window.location.assign(watchPath(item.videoid))}
        />
      </div>

      <UploadSheet
        row={sheetRow}
        facts={sheetFacts}
        headless={headless}
        clockNote={sheetRow ? clockNoteOf(sheetRow) : null}
        onAction={onSheetAction}
        onClose={() => setSheetKey(null)}
      />
      <MoveToSheet
        open={moveRow !== null}
        name={moveRow?.name || T.row.untitled}
        currentKey={moveRow?.local?.context?.key ?? null}
        clockNote={moveRow && isClockBound(moveRow.local) ? clockNoteOf(moveRow) : null}
        userId={user?.id ?? null}
        ticketType={typeOf('ticket.video')}
        session={sessionPlace}
        library={libraryPlace}
        onPick={(place) => void onPick(place)}
        onClose={() => setMoveKey(null)}
      />
      <RenameDialog
        open={renameRow !== null}
        name={renameRow?.name ?? ''}
        onSave={(name) => {
          const row = renameRow;
          setRenameKey(null);
          if (row) void actions?.rename(row, name);
        }}
        onClose={() => setRenameKey(null)}
      />
    </AppPage>
  );
}

/** "Belongs to your 17:02 clock-out" for a clock-bound row (O13); null otherwise. */
export function clockNoteOf(row: PulseRow): string | null {
  const draft = row.local;
  if (!draft || !isClockBound(draft)) return null;
  const time = new Date(draft.confirmedAt!).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  return T.clockBound(clockActionOf(draft.context), time);
}
