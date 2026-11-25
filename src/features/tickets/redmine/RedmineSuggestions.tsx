/**
 * The Tickets page search bar, with Redmine suggestions under it.
 *
 * The parent owns `query`, but the Tickets table no longer filters on it: all
 * results live in the dropdown. It offers Redmine issues — "Suggested for you"
 * on focus, narrowed as they type, then "More from Redmine" from a server
 * search. Above them, "Tickets" lists the tickets the query finds in any of
 * the user's teams (#736c), current team first. Below them, "From GitHub"
 * lists the member's GitHub issues once they've connected it (#873): what's
 * assigned to them on focus, what the text finds as they type.
 *
 * In the app (Capacitor) the results take the whole screen instead: the bar
 * on the page opens a search with its own field and a Cancel button, sized to
 * what the keyboard leaves. Scrolling or tapping outside the field leaves it
 * open; Cancel closes it.
 *
 * Built on downshift's `useCombobox` rather than `@mieweb/ui`'s `Autocomplete`,
 * whose rows are `<button>`s (no room for the timer and hide actions) and whose
 * highlighted row is private (no Delete-to-hide). Everything visible is still
 * `@mieweb/ui`; downshift supplies only the combobox keyboard and ARIA wiring.
 */
import {
  Badge,
  Button,
  ButtonGroup,
  Input,
  ScrollArea,
  SearchIcon,
  Skeleton,
  Spinner,
  Text,
  Tooltip,
  XIcon,
  useAnchoredPosition,
  useToast,
} from '@mieweb/ui';
import { useCombobox, type UseComboboxState, type UseComboboxStateChangeOptions } from 'downshift';
import React, {
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal, flushSync } from 'react-dom';

import {
  ticketApi,
  type RedmineIssue,
  type RedmineRelevantIssue,
  type SourcePrefix,
  type SourceSearchAnswer,
  type SourceSearchIssue,
  type Team,
  type Ticket,
} from '../../../lib/api';
import { isNativeApp } from '../../../lib/device';
import { useTeam } from '../../../lib/TeamContext';
import { useRouter } from '../../../ui/router';
import { MINIMAL_SCROLLBAR_CLASS } from '../../../ui/scrollbar';
import { TimerToggleButton } from '../../../ui/TimerToggleButton';
import { huddleTicketRef } from '../sources/huddleSource';
import { outsideIdOf, ticketOutsideRefOf } from '../ticketIds';
import { ticketDetailPath, ticketKey } from '../sources/types';
import type { TicketTimerOutcome } from '../startTicketTimer';

import { ticketTimerText as timerText } from '../../timers/ticketTimerStrings';
import { settingsPath } from '../../settings/settingsSections';
import { BoardToggleButton } from '../BoardToggleButton';
import { boardText } from '../boardStrings';

import { suggestionText as text } from './suggestionStrings';
import {
  SUGGESTION_LIMIT,
  emptySearchMessage,
  filterSuggestions,
  newSearchResults,
  reasonLabel,
} from './suggestions';
import { invalidateSuggestionsCache, useRedmineSuggestions } from './useRedmineSuggestions';
import { useSourceSearch } from './useSourceSearch';
import { useTicketSearch } from './useTicketSearch';

interface RedmineSuggestionsProps {
  userId: string | null;
  /** The search text. The parent filters the Tickets table with it. */
  query: string;
  onQueryChange: (query: string) => void;
  /** The connected Redmine's base URL; a pasted link matches locally only on it. */
  baseUrl: string | null;
  /** What the selected org calls its servers, as the table uses: an issue reads `RMX-219`. */
  sourcePrefixes?: readonly SourcePrefix[];
  /** The Redmine issue a timer is running on, if any. */
  runningIssueId: number | null;
  /** Start a timer on the issue, or stop it when it is the running one. */
  onToggleTimer: (issue: RedmineIssue) => Promise<TicketTimerOutcome>;
  /** The key of the ticket a timer is running on, e.g. `huddle:<id>`, if any. */
  runningTicketKey: string | null;
  /** Start a timer on a ticket a typed ID found, or stop it when it is the running one. */
  onToggleTicketTimer: (ticket: Ticket) => Promise<TicketTimerOutcome>;
  /** Redmine issue ids on My Board. Off it, starting a timer adds the issue first. */
  boardIssueIds: ReadonlySet<number>;
  /** The board has been read, so `boardIssueIds` is a fact — see `useMyBoardKeys`. */
  boardKnown: boolean;
  /** Put the issue on My Board, or take it off when it is there. */
  onToggleBoard: (issue: RedmineIssue) => Promise<unknown>;
  /** Board keys, for a GitHub result, which acts through the ticket carrying its address. */
  boardKeys: ReadonlySet<string>;
  /** Put a ticket on My Board, or take it off when it is there. */
  onToggleTicketBoard: (ticket: Ticket) => Promise<unknown>;
  inputClassName?: string;
}

const NO_PREFIXES: readonly SourcePrefix[] = [];

type Row =
  | { kind: 'ticket'; ticket: Ticket }
  | { kind: 'issue'; section: 'suggested'; issue: RedmineRelevantIssue }
  | { kind: 'issue'; section: 'more'; issue: RedmineIssue }
  | { kind: 'source'; server: SourceSearchAnswer; issue: SourceSearchIssue }
  | { kind: 'show-all'; count: number }
  | { kind: 'connect' }
  | { kind: 'retry' };

const rowKey = (row: Row | null): string =>
  !row
    ? ''
    : row.kind === 'issue'
      ? `${row.section}:${row.issue.id}`
      : row.kind === 'source'
        ? `source:${row.server.host}:${row.issue.url}`
        : row.kind === 'ticket'
          ? `ticket:${row.ticket.id}`
          : row.kind;

/** What a source's results are headed with: its name, else its address. */
const sourceName = (server: SourceSearchAnswer): string =>
  server.type === 'github' ? text.github : server.host;

/** Keep the typed text and the menu's own state through every selection. */
function stateReducer(
  state: UseComboboxState<Row>,
  { type, changes }: UseComboboxStateChangeOptions<Row>,
): Partial<UseComboboxState<Row>> {
  switch (type) {
    // The text is the table filter: choosing a row must never replace it.
    case useCombobox.stateChangeTypes.ItemClick:
    case useCombobox.stateChangeTypes.InputKeyDownEnter:
      return changes.selectedItem?.kind === 'show-all'
        ? {
            ...changes,
            inputValue: state.inputValue,
            isOpen: true,
            highlightedIndex: state.highlightedIndex,
          }
        : { ...changes, inputValue: state.inputValue };
    // Escape closes the menu but keeps the table filtered.
    case useCombobox.stateChangeTypes.InputKeyDownEscape:
      return { ...changes, inputValue: state.inputValue };
    // Focus already opened the menu; the click that caused the focus must not
    // toggle it shut again (downshift's default).
    case useCombobox.stateChangeTypes.InputClick:
      return { ...changes, isOpen: true };
    // Leaving the field must not open whatever row happened to be highlighted.
    case useCombobox.stateChangeTypes.InputBlur:
      return { ...changes, selectedItem: state.selectedItem, inputValue: state.inputValue };
    default:
      return changes;
  }
}

export function RedmineSuggestions({
  userId,
  query,
  onQueryChange,
  baseUrl,
  sourcePrefixes = NO_PREFIXES,
  runningIssueId,
  onToggleTimer,
  runningTicketKey,
  onToggleTicketTimer,
  boardIssueIds,
  boardKnown,
  onToggleBoard,
  boardKeys,
  onToggleTicketBoard,
  inputClassName,
}: RedmineSuggestionsProps) {
  const { navigate } = useRouter();
  const toast = useToast();
  const { allTeams, selectedTeamId } = useTeam();
  const { suggestions, search, loadSuggestions, retrySuggestions, retrySearch, dismiss } =
    useRedmineSuggestions(userId, query);
  const ticketSearch = useTicketSearch(userId, query);
  const sourceSearch = useSourceSearch(userId, query);
  const foundTickets = ticketSearch.tickets;
  const [showAll, setShowAll] = useState(false);
  // In the app the results are a full-screen search, open until Cancel.
  const [fullScreen] = useState(isNativeApp);
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetInputRef = useRef<HTMLInputElement | null>(null);
  const sheetOpenerRef = useRef<HTMLInputElement | null>(null);
  // A modal search: the page under it is out of reach (Tab included) while it's
  // open. A layout effect, so Cancel finds the page reachable to refocus.
  useLayoutEffect(() => {
    const page = document.getElementById('root');
    if (!fullScreen || !sheetOpen || !page) return;
    page.inert = true;
    return () => {
      page.inert = false;
    };
  }, [fullScreen, sheetOpen]);
  const viewport = useVisibleViewport(fullScreen && sheetOpen);
  // The row whose timer start or stop is in flight, by `rowKey`. The ref is the
  // guard (a double-click lands before the state does); the state drives the
  // spinner.
  const [timerRowKey, setTimerRowKey] = useState<string | null>(null);
  const timerBusy = useRef(false);
  // The same for a row being put on or taken off My Board.
  const [boardIssueId, setBoardIssueId] = useState<number | null>(null);
  const [boardSourceKey, setBoardSourceKey] = useState<string | null>(null);
  const boardBusy = useRef(false);
  const shortcutsId = useId();
  const searchShortcutsId = useId();
  const ticketShortcutsId = useId();

  const trimmed = query.trim();

  const teamById = useMemo(() => new Map(allTeams.map((team) => [team.id, team])), [allTeams]);
  const redmineHost = hostOfUrl(baseUrl);
  const redminePrefixes = useMemo(
    () => sourcePrefixes.filter((entry) => entry.host === redmineHost).map((e) => e.prefix),
    [sourcePrefixes, redmineHost],
  );
  const issueRef = useCallback(
    (id: number) => (baseUrl && outsideIdOf(`${baseUrl}/issues/${id}`, sourcePrefixes)) || `#${id}`,
    [baseUrl, sourcePrefixes],
  );

  // An issue the current team already carries is listed once, as its ticket.
  // Only one on the connected Redmine: issue 233 elsewhere is another issue. A
  // link with no host is on the deployment's own Redmine, which is the
  // connected one unless the user linked another server.
  const carriedHere = useMemo(
    () =>
      new Set(
        foundTickets
          .filter(
            (ticket) =>
              ticket.teamId === selectedTeamId &&
              ticket.linkedIssue &&
              (ticket.linkedIssue.host ?? redmineHost) === redmineHost,
          )
          .map((ticket) => Number(ticket.linkedIssue!.id)),
      ),
    [foundTickets, selectedTeamId, redmineHost],
  );

  const matching = useMemo(
    () =>
      filterSuggestions(suggestions.issues, trimmed, baseUrl, redminePrefixes).filter(
        (issue) => !carriedHere.has(issue.id),
      ),
    [suggestions.issues, trimmed, baseUrl, redminePrefixes, carriedHere],
  );

  const moreResults = useMemo(() => {
    if (search.status !== 'ready' || search.query !== trimmed) return [];
    const shown = new Set([...carriedHere, ...matching.map((issue) => issue.id)]);
    return newSearchResults(search.issues, shown);
  }, [search, trimmed, carriedHere, matching]);

  // The current team's ticket carrying a GitHub result's address, if any, else
  // another team's: that one still opens, but actions make one here.
  const ticketHere = useCallback(
    (issue: SourceSearchIssue) => issue.tickets.find((t) => t.teamId === selectedTeamId) ?? null,
    [selectedTeamId],
  );

  const sourceRows = useMemo<Extract<Row, { kind: 'source' }>[]>(() => {
    const listed = new Set(foundTickets.map((ticket) => ticket.id));
    return sourceSearch.servers.flatMap((server) =>
      server.issues
        // Already listed above as its ticket.
        .filter((issue) => !issue.tickets.some((ticket) => listed.has(ticket.id)))
        .map((issue) => ({ kind: 'source' as const, server, issue })),
    );
  }, [sourceSearch.servers, foundTickets]);

  const rows = useMemo<Row[]>(() => {
    const visible = showAll ? matching : matching.slice(0, SUGGESTION_LIMIT);
    // The current team's tickets first, each group in the server's order.
    const list: Row[] = [
      ...foundTickets.filter((ticket) => ticket.teamId === selectedTeamId),
      ...foundTickets.filter((ticket) => ticket.teamId !== selectedTeamId),
    ].map((ticket) => ({ kind: 'ticket', ticket }));
    for (const issue of visible) list.push({ kind: 'issue', section: 'suggested', issue });
    if (matching.length > visible.length) list.push({ kind: 'show-all', count: matching.length });
    for (const issue of moreResults) list.push({ kind: 'issue', section: 'more', issue });
    list.push(...sourceRows);
    if (suggestions.status === 'not-connected') list.push({ kind: 'connect' });
    if (suggestions.status === 'error' || search.status === 'error') list.push({ kind: 'retry' });
    return list;
  }, [
    foundTickets,
    selectedTeamId,
    matching,
    moreResults,
    sourceRows,
    showAll,
    suggestions.status,
    search.status,
  ]);

  const runTimer = useCallback(
    async (row: Row, toggle: () => Promise<TicketTimerOutcome>) => {
      if (timerBusy.current) return;
      timerBusy.current = true;
      setTimerRowKey(rowKey(row));
      let outcome: TicketTimerOutcome;
      try {
        // The toast is the parent's (`TicketStartProvider`); a start waiting on a
        // clock-in reports 'clock-in', and its chip follows the live timer.
        outcome = await toggle();
      } finally {
        timerBusy.current = false;
        setTimerRowKey(null);
      }
      if (outcome === 'failed' || outcome === 'cancelled' || outcome === 'clock-in') return;
      // The chip already follows the live timer (`runningIssueId`); refetching
      // brings the order and the server-side pin up to date as well.
      invalidateSuggestionsCache();
      void loadSuggestions({ force: true });
    },
    [loadSuggestions],
  );

  const toggleTimer = useCallback(
    (row: Extract<Row, { kind: 'issue' }>) => runTimer(row, () => onToggleTimer(row.issue)),
    [runTimer, onToggleTimer],
  );

  const toggleTicketTimer = useCallback(
    (row: Extract<Row, { kind: 'ticket' }>) => runTimer(row, () => onToggleTicketTimer(row.ticket)),
    [runTimer, onToggleTicketTimer],
  );

  // A GitHub result acts through the current team's ticket carrying its
  // address, made now if there is none. Nothing is converted: the ticket just
  // carries the address.
  const carrierOf = useCallback(
    async (row: Extract<Row, { kind: 'source' }>): Promise<Ticket | null> => {
      if (!selectedTeamId) {
        toast.error(text.noTeam);
        return null;
      }
      try {
        const { ticket } = await ticketApi.carryLink(selectedTeamId, row.issue.url);
        // Made by this call or by someone else since the search: either way the row learns it.
        if (!ticketHere(row.issue)) sourceSearch.noteTicket(row.server.host, row.issue.url, ticket);
        return ticket;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : text.carryFailed);
        return null;
      }
    },
    [selectedTeamId, toast, sourceSearch.noteTicket, ticketHere],
  );

  const toggleSourceTimer = useCallback(
    (row: Extract<Row, { kind: 'source' }>) =>
      runTimer(row, async () => {
        const ticket = await carrierOf(row);
        return ticket ? onToggleTicketTimer(ticket) : 'failed';
      }),
    [runTimer, carrierOf, onToggleTicketTimer],
  );

  const toggleSourceBoard = useCallback(
    async (row: Extract<Row, { kind: 'source' }>) => {
      if (!boardKnown || boardBusy.current) return;
      boardBusy.current = true;
      setBoardSourceKey(rowKey(row));
      try {
        const ticket = await carrierOf(row);
        if (ticket) await onToggleTicketBoard(ticket);
      } finally {
        boardBusy.current = false;
        setBoardSourceKey(null);
      }
    },
    [boardKnown, carrierOf, onToggleTicketBoard],
  );

  const toggleBoard = useCallback(
    async (issue: RedmineIssue) => {
      if (!boardKnown || boardBusy.current) return;
      boardBusy.current = true;
      setBoardIssueId(issue.id);
      try {
        // The toasts are the parent's (`useBoardActions`).
        await onToggleBoard(issue);
      } finally {
        boardBusy.current = false;
        setBoardIssueId(null);
      }
      // Being on the board is a reason to suggest an issue, so the list changes.
      invalidateSuggestionsCache();
      void loadSuggestions({ force: true });
    },
    [boardKnown, onToggleBoard, loadSuggestions],
  );

  const hide = useCallback(
    async (issue: RedmineRelevantIssue) => {
      try {
        const undo = await dismiss(issue);
        toast.toast({
          message: text.hidden(issue.id),
          duration: 6000,
          action: {
            label: text.undo,
            onClick: () => void undo().catch(() => toast.error(text.restoreFailed(issue.id))),
          },
        });
      } catch {
        toast.error(text.hideFailed(issue.id));
      }
    },
    [dismiss, toast],
  );

  const choose = useCallback(
    (row: Row) => {
      // Opening a result leaves the search, as the dropdown closes on the web.
      if (row.kind !== 'show-all' && row.kind !== 'retry') setSheetOpen(false);
      if (row.kind === 'ticket')
        navigate(ticketDetailPath({ sourceId: 'huddle', id: row.ticket.id }));
      else if (row.kind === 'issue')
        navigate(ticketDetailPath({ sourceId: 'redmine', id: String(row.issue.id) }));
      else if (row.kind === 'source') {
        // Opening goes to the ticket carrying its address, made now if there is none.
        const existing = ticketHere(row.issue) ?? row.issue.tickets[0];
        if (existing) navigate(ticketDetailPath({ sourceId: 'huddle', id: existing.id }));
        else {
          void carrierOf(row).then((ticket) => {
            if (ticket) navigate(ticketDetailPath({ sourceId: 'huddle', id: ticket.id }));
          });
        }
      } else if (row.kind === 'show-all') setShowAll(true);
      else if (row.kind === 'connect') navigate(settingsPath('integrations'));
      else {
        // One retry row stands for both requests: retry whichever failed.
        if (suggestions.status === 'error') void retrySuggestions();
        if (search.status === 'error') retrySearch();
      }
    },
    [
      navigate,
      ticketHere,
      carrierOf,
      suggestions.status,
      search.status,
      retrySuggestions,
      retrySearch,
    ],
  );

  const {
    isOpen,
    highlightedIndex,
    getInputProps,
    getMenuProps,
    getItemProps,
    openMenu,
    closeMenu,
  } = useCombobox<Row>({
    items: rows,
    inputValue: query,
    selectedItem: null,
    itemToString: () => query,
    itemToKey: rowKey,
    stateReducer,
    // The full-screen search stays open through blur and taps outside it.
    ...(fullScreen ? { isOpen: sheetOpen } : {}),
    onInputValueChange: ({ inputValue, type }) => {
      if (type === useCombobox.stateChangeTypes.InputChange) {
        onQueryChange(inputValue ?? '');
        setShowAll(false);
      }
    },
    onStateChange: ({ type, selectedItem }) => {
      if (
        selectedItem &&
        (type === useCombobox.stateChangeTypes.ItemClick ||
          type === useCombobox.stateChangeTypes.InputKeyDownEnter)
      ) {
        choose(selectedItem);
      }
    },
  });

  /** Close the results: the dropdown, or the full-screen search. */
  const closeResults = fullScreen ? () => setSheetOpen(false) : closeMenu;

  // Shown and focused within the tap, so the keyboard comes up with it.
  const openSheet = () => {
    void loadSuggestions();
    flushSync(() => setSheetOpen(true));
    sheetInputRef.current?.focus();
  };
  const cancelSheet = () => {
    flushSync(() => {
      setSheetOpen(false);
      setShowAll(false);
      onQueryChange('');
    });
    // Back where it was opened from, once the page is reachable again.
    sheetOpenerRef.current?.focus();
  };
  // Dragging the results puts the keyboard away, as a phone's own search does.
  const blurSheetInput = () => {
    if (document.activeElement === sheetInputRef.current) sheetInputRef.current?.blur();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const row = isOpen && highlightedIndex >= 0 ? rows[highlightedIndex] : undefined;
    const stopDownshift = () => {
      event.preventDefault();
      (
        event.nativeEvent as KeyboardEvent & { preventDownshiftDefault?: boolean }
      ).preventDownshiftDefault = true;
    };
    if (row?.kind === 'ticket' && event.key === 'Enter' && event.shiftKey) {
      stopDownshift();
      closeResults();
      void toggleTicketTimer(row);
      return;
    }
    if (row?.kind === 'source' && event.key === 'Enter' && (event.altKey || event.shiftKey)) {
      stopDownshift();
      if (event.altKey) void toggleSourceBoard(row);
      else {
        closeResults();
        void toggleSourceTimer(row);
      }
      return;
    }
    if (row?.kind !== 'issue') return;
    if (event.key === 'Delete' && row.section === 'suggested') {
      stopDownshift();
      void hide(row.issue);
    } else if (event.key === 'Enter' && event.altKey) {
      // The menu stays open: the row is still there, with its new state.
      stopDownshift();
      void toggleBoard(row.issue);
    } else if (event.key === 'Enter' && event.shiftKey) {
      stopDownshift();
      closeResults();
      void toggleTimer(row);
    }
  };

  const statusMessage = (() => {
    if (suggestions.status === 'loading' && !suggestions.issues.length)
      return text.loadingSuggestions;
    if (search.status === 'loading' && !moreResults.length) return text.searching;
    if (suggestions.status === 'error' || search.status === 'error') return text.unreachable;
    // Nothing anywhere: said once both searches have answered, or once the
    // ticket search has when there is no Redmine to ask.
    const redmineAnswered =
      (search.status === 'ready' && search.query === trimmed) ||
      suggestions.status === 'not-connected';
    if (
      trimmed &&
      ticketSearch.settled &&
      redmineAnswered &&
      !foundTickets.length &&
      !matching.length &&
      !moreResults.length &&
      sourceSearch.settled &&
      !sourceRows.length
    ) {
      const kind = search.status === 'ready' ? search.kind : (ticketSearch.kind ?? 'text');
      return emptySearchMessage(kind, trimmed);
    }
    if (
      !trimmed &&
      suggestions.status === 'ready' &&
      !suggestions.issues.length &&
      !sourceRows.length
    )
      return text.noSuggestions;
    return null;
  })();

  // Placeholders while the list is still on its way, so the panel never sits
  // empty: rows for the first suggestions load, and a "More from Redmine"
  // section while a search is out.
  const loadingSuggested = suggestions.status === 'loading' && !suggestions.issues.length;
  const loadingMore = search.status === 'loading' && !moreResults.length;

  const firstTicketIndex = rows.findIndex((row) => row.kind === 'ticket');
  const firstMoreIndex = rows.findIndex((row) => row.kind === 'issue' && row.section === 'more');
  const firstSuggestedIndex = rows.findIndex(
    (row) => row.kind === 'issue' && row.section === 'suggested',
  );
  const failedServers = sourceSearch.servers.filter((server) => server.failed);
  const downServers = failedServers.filter((server) => !server.rateLimited);
  const limitedServers = failedServers.filter((server) => server.rateLimited);
  const showPanel =
    isOpen &&
    (rows.length > 0 || statusMessage !== null || suggestions.partial || failedServers.length > 0);

  // Rendered in a portal and positioned against the input: the page header
  // blurs its backdrop, which makes it its own stacking context, so an absolute
  // panel inside it would sit under the table.
  const { anchorRef, floatingRef, style } = useAnchoredPosition<HTMLDivElement, HTMLDivElement>({
    open: !fullScreen && showPanel,
    // At least as wide as the input, but never as narrow as it gets on a phone,
    // where it shares one row with "New Ticket" and the Closed switch.
    matchMinWidth: true,
    offset: 4,
    maxHeight: 384,
  });

  // One list of results: in the dropdown on the web, in the full-screen search in the app.
  const results = (
    <>
      {/* The list scrolls; the status line under it stays in view. */}
      <ScrollArea
        className={`redmine-suggestions-scroll min-h-0 flex-1 overscroll-contain [&::-webkit-scrollbar]:w-1.5 ${MINIMAL_SCROLLBAR_CLASS}`}
        onTouchMove={fullScreen && sheetOpen ? blurSheetInput : undefined}
      >
        <ul
          className="redmine-suggestions-list py-1"
          {...getMenuProps({ 'aria-label': text.menuLabel })}
        >
          {showPanel &&
            rows.map((row, index) => (
              <React.Fragment key={rowKey(row)}>
                {index === firstTicketIndex && (
                  <SectionHeading>{text.ticketsHeading}</SectionHeading>
                )}
                {index === firstSuggestedIndex && (
                  <SectionHeading>{text.suggestedHeading}</SectionHeading>
                )}
                {index === firstMoreIndex && <SectionHeading>{text.moreHeading}</SectionHeading>}
                {row.kind === 'source' &&
                  rows.findIndex(
                    (other) => other.kind === 'source' && other.server.host === row.server.host,
                  ) === index && (
                    <SectionHeading>{text.fromSource(sourceName(row.server))}</SectionHeading>
                  )}
                <li
                  className={
                    fullScreen
                      ? 'redmine-suggestion group flex cursor-pointer items-start gap-2.5 border-b border-border px-3 py-2.5 text-sm aria-selected:bg-muted'
                      : 'redmine-suggestion group flex cursor-pointer items-center gap-2 px-3 py-2 text-sm aria-selected:bg-muted'
                  }
                  {...getItemProps({ item: row, index })}
                  {...(row.kind === 'source' ? { 'aria-describedby': searchShortcutsId } : {})}
                  {...(row.kind === 'issue'
                    ? {
                        'aria-describedby':
                          row.section === 'suggested' ? shortcutsId : searchShortcutsId,
                      }
                    : row.kind === 'ticket'
                      ? { 'aria-describedby': ticketShortcutsId }
                      : {})}
                >
                  {row.kind === 'ticket' ? (
                    <FoundTicketRow
                      sheet={fullScreen}
                      ticket={row.ticket}
                      team={teamById.get(row.ticket.teamId)}
                      showTeam={row.ticket.teamId !== selectedTeamId}
                      redmineHost={redmineHost}
                      running={runningTicketKey === ticketKey('huddle', row.ticket.id)}
                      timerBusy={timerRowKey !== null}
                      timerLoading={timerRowKey === rowKey(row)}
                      onToggleTimer={() => {
                        closeResults();
                        void toggleTicketTimer(row);
                      }}
                    />
                  ) : row.kind === 'source' ? (
                    <IssueRow
                      sheet={fullScreen}
                      issue={row.issue}
                      issueRef={row.issue.ref ?? `${row.server.prefix}-${row.issue.id}`}
                      reason={row.issue.pull ? text.pullRequest : null}
                      running={Boolean(
                        ticketHere(row.issue) &&
                        runningTicketKey === ticketKey('huddle', ticketHere(row.issue)!.id),
                      )}
                      timerBusy={timerRowKey !== null}
                      timerLoading={timerRowKey === rowKey(row)}
                      onBoard={Boolean(
                        ticketHere(row.issue) &&
                        boardKeys.has(ticketKey('huddle', ticketHere(row.issue)!.id)),
                      )}
                      boardKnown={boardKnown}
                      boardBusy={boardIssueId !== null || boardSourceKey !== null}
                      boardLoading={boardSourceKey === rowKey(row)}
                      onToggleBoard={() => void toggleSourceBoard(row)}
                      onToggleTimer={() => {
                        closeResults();
                        void toggleSourceTimer(row);
                      }}
                    />
                  ) : row.kind === 'issue' ? (
                    <IssueRow
                      sheet={fullScreen}
                      issue={row.issue}
                      issueRef={issueRef(row.issue.id)}
                      reason={
                        row.section === 'suggested'
                          ? reasonLabel(row.issue, { runningIssueId })
                          : null
                      }
                      running={row.issue.id === runningIssueId}
                      timerBusy={timerRowKey !== null}
                      timerLoading={timerRowKey === rowKey(row)}
                      onBoard={boardIssueIds.has(row.issue.id)}
                      boardKnown={boardKnown}
                      boardBusy={boardIssueId !== null}
                      boardLoading={boardIssueId === row.issue.id}
                      onToggleBoard={() => void toggleBoard(row.issue)}
                      onToggleTimer={() => {
                        // Like Shift+Enter: close first, so nothing is left
                        // open behind a clock-in prompt.
                        closeResults();
                        void toggleTimer(row);
                      }}
                      onHide={row.section === 'suggested' ? () => void hide(row.issue) : undefined}
                    />
                  ) : (
                    <Text as="span" size="sm" variant="primary" className="font-medium">
                      {row.kind === 'show-all'
                        ? text.showAll(row.count)
                        : row.kind === 'connect'
                          ? text.connect
                          : text.retry}
                    </Text>
                  )}
                </li>
              </React.Fragment>
            ))}
          {showPanel && loadingSuggested && (
            <>
              <SectionHeading>{text.suggestedHeading}</SectionHeading>
              <SuggestionSkeletons count={4} />
            </>
          )}
          {showPanel && loadingMore && (
            <>
              <SectionHeading>{text.moreHeading}</SectionHeading>
              <SuggestionSkeletons count={2} />
            </>
          )}
        </ul>
      </ScrollArea>

      <div className="redmine-suggestions-status empty:hidden" role="status" aria-live="polite">
        {showPanel && downServers.length > 0 && (
          <div className="redmine-suggestions-failed border-t border-border px-3 py-2">
            <Text as="span" size="xs" variant="muted">
              {text.sourcesFailed(downServers.map(sourceName))}
            </Text>
          </div>
        )}
        {showPanel && limitedServers.length > 0 && (
          <div className="redmine-suggestions-limited border-t border-border px-3 py-2">
            <Text as="span" size="xs" variant="muted">
              {text.sourcesRateLimited(limitedServers.map(sourceName))}
            </Text>
          </div>
        )}
        {showPanel && (statusMessage || suggestions.partial) && (
          <div className="flex items-center gap-2 border-t border-border px-3 py-2">
            {(suggestions.status === 'loading' || search.status === 'loading') && (
              <Spinner size="xs" />
            )}
            <Text as="span" size="xs" variant="muted">
              {statusMessage ?? text.partial}
            </Text>
          </div>
        )}
      </div>
    </>
  );

  const searchIcon = (
    <SearchIcon
      aria-hidden="true"
      size={14}
      className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground"
    />
  );
  const comboboxInput = (
    <Input
      label={text.searchLabel}
      hideLabel
      placeholder={text.placeholder}
      size="sm"
      className={inputClassName}
      {...getInputProps({
        'aria-label': text.searchLabel,
        onKeyDown,
        ...(fullScreen
          ? { ref: sheetInputRef, type: 'search', enterKeyHint: 'search' as const }
          : {
              onFocus: () => {
                void loadSuggestions();
                if (!isOpen) openMenu();
              },
            }),
      })}
    />
  );

  return (
    <div ref={anchorRef} className="redmine-suggestions relative min-w-0 flex-1">
      {searchIcon}
      {fullScreen ? (
        // Only opens the full-screen search, which has the field you type in.
        <Input
          label={text.searchLabel}
          hideLabel
          ref={sheetOpenerRef}
          readOnly
          placeholder={text.placeholder}
          size="sm"
          className={inputClassName}
          value={query}
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          onClick={openSheet}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              openSheet();
            }
          }}
        />
      ) : (
        comboboxInput
      )}

      {createPortal(
        fullScreen ? (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={text.searchLabel}
            hidden={!sheetOpen}
            // The app's web view doesn't shrink for the keyboard: the sheet keeps
            // its full height, so its background shows through a translucent
            // keyboard instead of the page, and its content ends where the
            // keyboard begins.
            style={
              viewport
                ? {
                    top: viewport.offsetTop,
                    paddingBottom: `max(${viewport.keyboard}px, env(safe-area-inset-bottom))`,
                  }
                : undefined
            }
            className="redmine-search-sheet fixed inset-x-0 top-0 z-50 flex h-dvh flex-col bg-background pb-[env(safe-area-inset-bottom)] text-foreground"
          >
            <div className="redmine-search-sheet-bar flex shrink-0 items-center gap-2 border-b border-border px-3 pb-2 pt-[max(env(safe-area-inset-top),0.5rem)]">
              <div className="redmine-search-sheet-field relative min-w-0 flex-1">
                {searchIcon}
                {comboboxInput}
              </div>
              <Button variant="ghost" size="sm" onClick={cancelSheet}>
                {text.cancel}
              </Button>
            </div>
            {results}
          </div>
        ) : (
          <div
            ref={floatingRef}
            style={style}
            className="redmine-suggestions-panel z-50 flex w-[min(32rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-lg"
            hidden={!showPanel}
          >
            {results}
          </div>
        ),
        document.body,
      )}

      <span id={shortcutsId} className="sr-only">
        {text.rowShortcuts}
      </span>
      <span id={searchShortcutsId} className="sr-only">
        {text.searchRowShortcuts}
      </span>
      <span id={ticketShortcutsId} className="sr-only">
        {text.ticketRowShortcuts}
      </span>
    </div>
  );
}

/**
 * Where the visible part of the screen starts, and how much of a full-height
 * panel from there the keyboard covers, while `active`: the app's web view keeps its full height
 * under the keyboard, so a full-screen panel would hide its last rows behind
 * it. Null when inactive or where `visualViewport` is missing.
 */
function useVisibleViewport(active: boolean): { offsetTop: number; keyboard: number } | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const viewport = window.visualViewport;
      if (!active || !viewport) return () => {};
      viewport.addEventListener('resize', onChange);
      viewport.addEventListener('scroll', onChange);
      return () => {
        viewport.removeEventListener('resize', onChange);
        viewport.removeEventListener('scroll', onChange);
      };
    },
    [active],
  );
  // A string, so an unchanged viewport is an unchanged snapshot.
  const snapshot = useSyncExternalStore(subscribe, () => {
    const viewport = window.visualViewport;
    if (!active || !viewport) return '';
    // The sheet is full height from `offsetTop`, so all but the visible height is covered.
    const keyboard = Math.max(0, window.innerHeight - viewport.height);
    return `${viewport.offsetTop}:${keyboard}`;
  });
  if (!snapshot) return null;
  const [offsetTop, keyboard] = snapshot.split(':').map(Number);
  return { offsetTop, keyboard };
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <li role="presentation" className="redmine-suggestions-heading px-3 pb-1 pt-2">
      <Text as="span" size="xs" variant="muted" className="font-semibold uppercase tracking-wide">
        {children}
      </Text>
    </li>
  );
}

/** Stand-ins shaped like an issue row: `#id`, a title, and a project line. */
function SuggestionSkeletons({ count }: { count: number }) {
  const titleWidths = ['70%', '55%', '80%', '62%'];
  return Array.from({ length: count }, (_, i) => (
    <li
      key={i}
      role="presentation"
      aria-hidden="true"
      className="redmine-suggestion-skeleton flex items-center gap-2 px-3 py-2"
    >
      <Skeleton variant="text" width={36} className="shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Skeleton variant="text" width={titleWidths[i % titleWidths.length]} />
        <Skeleton variant="text" width="30%" height={10} />
      </span>
    </li>
  ));
}

/**
 * The reason chip: `secondary` is the neutral filled badge, but its dark fill is
 * the card's own colour, so it steps up a shade there, and again on a
 * highlighted row, whose background is one shade up already.
 */
const CHIP_CLASS =
  'shrink-0 font-normal dark:bg-neutral-700 group-aria-selected:bg-neutral-200 dark:group-aria-selected:bg-neutral-600';

/**
 * For the actions that wait for the highlighted or hovered row. `invisible`, not
 * `hidden`: the space stays, so a wrapped title does not rewrap on hover.
 */
const ON_ACTIVE_ROW_CLASS =
  'invisible group-hover:visible group-aria-selected:visible pointer-coarse:visible';

/** Stop an action's click from also choosing the row, and keep focus in the input. */
const keepFocus = (event: React.MouseEvent) => {
  event.preventDefault();
  event.stopPropagation();
};

/** The bare hostname of a base URL, or null. */
function hostOfUrl(url: string | null): string | null {
  try {
    return url ? new URL(url).hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** The ID column, shared by ticket and issue rows so titles line up. */
const ID_CLASS = 'redmine-suggestion-id w-20 shrink-0 break-all tabular-nums';

/**
 * A ticket a typed ID named. It leads with the ID it is shown by in the table,
 * the outside one when it has one (`RMX-150`, `pulse-223`), with its own
 * (`TH-12`) under it, and the title beside them; its team shows when that is
 * not the current one. Choosing it opens the ticket; its timer button, like
 * an issue row's, starts or stops a timer on it (Shift+Enter from the keyboard).
 */
function FoundTicketRow({
  sheet = false,
  ticket,
  team,
  showTeam,
  redmineHost,
  running,
  timerBusy,
  timerLoading,
  onToggleTimer,
}: {
  /** Laid out like My Board's ticket rows, for the app's full-screen search. */
  sheet?: boolean;
  ticket: Ticket;
  team: Team | undefined;
  showTeam: boolean;
  redmineHost: string | null;
  running: boolean;
  /** A timer start or stop is in flight, on this row or another. */
  timerBusy: boolean;
  /** …and it is this row's. */
  timerLoading: boolean;
  onToggleTimer: () => void;
}) {
  const prefixes = team?.sourcePrefixes ?? [];
  const own = huddleTicketRef(ticket, team?.ticketPrefix);
  const outside = ticketOutsideRefOf(ticket, prefixes, redmineHost);
  const timerName = running ? text.stopTimer(outside ?? own) : text.startTimer(outside ?? own);
  return (
    <>
      <TimerToggleButton
        isRunning={running}
        isLoading={timerLoading}
        disabled={timerBusy}
        className={sheet ? 'h-8 w-8 shrink-0' : 'h-7 w-7 shrink-0'}
        tabIndex={-1}
        aria-hidden
        title={timerName}
        ariaLabel={timerName}
        onMouseDown={keepFocus}
        onClick={(event) => {
          keepFocus(event);
          onToggleTimer();
        }}
      />
      {sheet ? (
        <SheetRowBody
          meta={
            <>
              {showTeam && team && <span className="min-w-0 break-words">{team.name}</span>}
              <span className="font-semibold text-foreground">{outside ?? own}</span>
              {outside && <span className="text-xs">{own}</span>}
            </>
          }
          title={ticket.title}
        />
      ) : (
        <>
          <span className={`${ID_CLASS} flex flex-col self-start pt-0.5`}>
            <Text as="span" size="xs" className="redmine-suggestion-primary-id font-semibold">
              {outside ?? own}
            </Text>
            {outside && (
              <Text as="span" size="xs" variant="muted" className="redmine-suggestion-own-id">
                {own}
              </Text>
            )}
          </span>
          <span className="redmine-suggestion-body min-w-0 flex-1">
            <span className="redmine-suggestion-title block break-words">{ticket.title}</span>
            {showTeam && team && (
              <Text as="span" size="xs" variant="muted" className="block truncate">
                {text.inTeam(team.name)}
              </Text>
            )}
          </span>
        </>
      )}
    </>
  );
}

/**
 * A result's text as My Board's ticket rows lay theirs out: where it sits and
 * what it is called by on a line, the title under it, then any `properties`.
 */
function SheetRowBody({
  meta,
  title,
  properties,
}: {
  meta: React.ReactNode;
  title: string;
  properties?: React.ReactNode;
}) {
  return (
    <span className="redmine-suggestion-body min-w-0 flex-1">
      <span className="redmine-suggestion-meta flex min-h-8 min-w-0 flex-wrap items-center gap-x-2.5 text-sm text-muted-foreground">
        {meta}
      </span>
      <span className="redmine-suggestion-title-line flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 pb-1">
        <span className="redmine-suggestion-title min-w-0 text-sm leading-snug break-words">
          {title}
        </span>
        {properties}
      </span>
    </span>
  );
}

interface IssueRowProps {
  /** Laid out like My Board's ticket rows, for the app's full-screen search. */
  sheet?: boolean;
  issue: RedmineIssue;
  /** What the issue is shown as: `RMX-219` when its server has a prefix, else `#219`. */
  issueRef: string;
  reason: string | null;
  running: boolean;
  /** A timer start or stop is in flight, on this row or another. */
  timerBusy: boolean;
  /** …and it is this row's. */
  timerLoading: boolean;
  onToggleTimer: () => void;
  onBoard: boolean;
  boardKnown: boolean;
  /** A board add or removal is in flight, on this row or another. */
  boardBusy: boolean;
  /** …and it is this row's. */
  boardLoading: boolean;
  onToggleBoard: () => void;
  onHide?: () => void;
}

/**
 * One suggestion. Only its ID and the title always show; the rest is placed by
 * priority so a row stays readable at 320 px:
 * - project: second line, `sm` and up
 * - reason chip: under the title, ahead of the project
 * - timer: always, at the start of the row
 * - My Board and hide: on the highlighted or hovered row, always on touch. They
 *   keep their space when hidden, so the title does not rewrap on hover.
 *
 * The actions are mouse-only (`tabIndex={-1}`, `aria-hidden`): a combobox
 * option cannot hold its own buttons, so the keyboard gets Delete, Shift+Enter
 * and Alt+Enter instead, announced through the row's `aria-describedby`.
 */
function IssueRow({
  sheet = false,
  issue,
  issueRef,
  reason,
  running,
  timerBusy,
  timerLoading,
  onToggleTimer,
  onBoard,
  boardKnown,
  boardBusy,
  boardLoading,
  onToggleBoard,
  onHide,
}: IssueRowProps) {
  const label = issueRef;
  // Starting a timer puts the issue on My Board, so off the board the button's
  // tooltip says it will.
  const addsToBoard = boardKnown && !onBoard && !running;
  const timerName = running
    ? text.stopTimer(label)
    : addsToBoard
      ? timerText.addAndStartLabel(label)
      : text.startTimer(label);
  return (
    <>
      <TimerToggleButton
        isRunning={running}
        isLoading={timerLoading}
        disabled={timerBusy || boardLoading}
        className={sheet ? 'h-8 w-8 shrink-0' : 'h-7 w-7 shrink-0'}
        tabIndex={-1}
        aria-hidden
        title={timerName}
        ariaLabel={timerName}
        onMouseDown={keepFocus}
        onClick={(event) => {
          keepFocus(event);
          onToggleTimer();
        }}
      />

      {sheet ? (
        <SheetRowBody
          meta={
            <>
              {issue.project && <span className="min-w-0 break-words">{issue.project.name}</span>}
              <span className="font-semibold text-foreground">{label}</span>
            </>
          }
          title={issue.subject}
          properties={
            reason && (
              <Badge size="sm" variant="secondary" className={CHIP_CLASS}>
                {reason}
              </Badge>
            )
          }
        />
      ) : (
        <>
          <Text as="span" size="xs" variant="muted" className={ID_CLASS}>
            {label}
          </Text>

          <span className="redmine-suggestion-body min-w-0 flex-1">
            <span className="redmine-suggestion-title block break-words">{issue.subject}</span>
            <span className="redmine-suggestion-meta flex min-w-0 items-center gap-2 empty:hidden">
              {reason && (
                <Badge size="sm" variant="secondary" className={CHIP_CLASS}>
                  {reason}
                </Badge>
              )}
              {issue.project && (
                <Text as="span" size="xs" variant="muted" className="hidden truncate sm:block">
                  {issue.project.name}
                </Text>
              )}
            </span>
          </span>
        </>
      )}

      <ButtonGroup
        orientation="horizontal"
        className="redmine-suggestion-actions shrink-0 gap-1"
        aria-hidden="true"
      >
        <BoardToggleButton
          onBoard={onBoard}
          isLoading={boardLoading}
          // Not while this row's timer is starting (see `TicketTableRow`), nor
          // while another row's board action is, nor before the board is read.
          disabled={timerLoading || !boardKnown || (boardBusy && !boardLoading)}
          className={`${sheet ? 'h-8 w-8' : 'h-7 w-7'} ${ON_ACTIVE_ROW_CLASS}`}
          tabIndex={-1}
          aria-hidden
          ariaLabel={onBoard ? boardText.removeLabel(label) : boardText.addLabel(label)}
          onMouseDown={keepFocus}
          onClick={(event) => {
            keepFocus(event);
            onToggleBoard();
          }}
        />
        {onHide && (
          <Tooltip content={text.hide(label)}>
            <Button
              variant="ghost"
              size="icon"
              className={`${sheet ? 'h-8 w-8' : 'h-7 w-7'} [&_[data-slot=button-label]]:flex ${ON_ACTIVE_ROW_CLASS}`}
              tabIndex={-1}
              aria-label={text.hide(label)}
              onMouseDown={keepFocus}
              onClick={(event) => {
                keepFocus(event);
                onHide();
              }}
            >
              <XIcon size={14} />
            </Button>
          </Tooltip>
        )}
      </ButtonGroup>
    </>
  );
}
