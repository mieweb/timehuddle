/**
 * The Tickets page search bar, with Redmine suggestions under it.
 *
 * One input, two jobs: every keystroke still filters the Tickets table (the
 * parent owns `query`), and a dropdown offers Redmine issues — "Suggested for
 * you" on focus, narrowed as they type, then "More from Redmine" from a server
 * search.
 *
 * Built on downshift's `useCombobox` rather than `@mieweb/ui`'s `Autocomplete`,
 * whose rows are `<button>`s (no room for the timer and hide actions) and whose
 * highlighted row is private (no Delete-to-hide). Everything visible is still
 * `@mieweb/ui`; downshift supplies only the combobox keyboard and ARIA wiring.
 */
import {
  Badge,
  Button,
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
import React, { useCallback, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { RedmineIssue, RedmineRelevantIssue } from '../../../lib/api';
import { OverflowTooltip } from '../../../ui/OverflowTooltip';
import { useRouter } from '../../../ui/router';
import { MINIMAL_SCROLLBAR_CLASS } from '../../../ui/scrollbar';
import { TimerToggleButton } from '../../../ui/TimerToggleButton';
import { ticketDetailPath } from '../sources/types';
import type { TicketTimerOutcome } from '../startTicketTimer';

import { suggestionText as text } from './suggestionStrings';
import {
  SUGGESTION_LIMIT,
  emptySearchMessage,
  filterSuggestions,
  newSearchResults,
  reasonLabel,
} from './suggestions';
import { invalidateSuggestionsCache, useRedmineSuggestions } from './useRedmineSuggestions';

interface RedmineSuggestionsProps {
  userId: string | null;
  /** The search text. The parent filters the Tickets table with it. */
  query: string;
  onQueryChange: (query: string) => void;
  /** The connected Redmine's base URL; a pasted link matches locally only on it. */
  baseUrl: string | null;
  /** Redmine issue ids already in the Tickets table, left out of "More from Redmine". */
  tableIssueIds: ReadonlySet<number>;
  /** The Redmine issue a timer is running on, if any. */
  runningIssueId: number | null;
  /** Start a timer on the issue, or stop it when it is the running one. */
  onToggleTimer: (issue: RedmineIssue) => Promise<TicketTimerOutcome>;
  inputClassName?: string;
}

type Row =
  | { kind: 'issue'; section: 'suggested'; issue: RedmineRelevantIssue }
  | { kind: 'issue'; section: 'more'; issue: RedmineIssue }
  | { kind: 'show-all'; count: number }
  | { kind: 'connect' }
  | { kind: 'retry' };

const rowKey = (row: Row | null): string =>
  !row ? '' : row.kind === 'issue' ? `${row.section}:${row.issue.id}` : row.kind;

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
  tableIssueIds,
  runningIssueId,
  onToggleTimer,
  inputClassName,
}: RedmineSuggestionsProps) {
  const { navigate } = useRouter();
  const toast = useToast();
  const { suggestions, search, loadSuggestions, retrySuggestions, retrySearch, dismiss } =
    useRedmineSuggestions(userId, query);
  const [showAll, setShowAll] = useState(false);
  // The issue whose timer start or stop is in flight. The ref is the guard (a
  // double-click lands before the state does); the state drives the spinner.
  const [timerIssueId, setTimerIssueId] = useState<number | null>(null);
  const timerBusy = useRef(false);
  const shortcutsId = useId();
  const searchShortcutsId = useId();

  const trimmed = query.trim();

  const matching = useMemo(
    () => filterSuggestions(suggestions.issues, trimmed, baseUrl),
    [suggestions.issues, trimmed, baseUrl],
  );

  const moreResults = useMemo(() => {
    if (search.status !== 'ready' || search.query !== trimmed) return [];
    const shown = new Set([...tableIssueIds, ...matching.map((issue) => issue.id)]);
    return newSearchResults(search.issues, shown);
  }, [search, trimmed, tableIssueIds, matching]);

  const rows = useMemo<Row[]>(() => {
    const visible = showAll ? matching : matching.slice(0, SUGGESTION_LIMIT);
    const list: Row[] = visible.map((issue) => ({ kind: 'issue', section: 'suggested', issue }));
    if (matching.length > visible.length) list.push({ kind: 'show-all', count: matching.length });
    for (const issue of moreResults) list.push({ kind: 'issue', section: 'more', issue });
    if (suggestions.status === 'not-connected') list.push({ kind: 'connect' });
    if (suggestions.status === 'error' || search.status === 'error') list.push({ kind: 'retry' });
    return list;
  }, [matching, moreResults, showAll, suggestions.status, search.status]);

  const toggleTimer = useCallback(
    async (issue: RedmineIssue) => {
      if (timerBusy.current) return;
      timerBusy.current = true;
      setTimerIssueId(issue.id);
      let outcome: TicketTimerOutcome;
      try {
        // The toast is the parent's (`TicketStartProvider`); a start waiting on a
        // clock-in reports 'clock-in', and its chip follows the live timer.
        outcome = await onToggleTimer(issue);
      } finally {
        timerBusy.current = false;
        setTimerIssueId(null);
      }
      if (outcome === 'failed' || outcome === 'clock-in') return;
      // The chip already follows the live timer (`runningIssueId`); refetching
      // brings the order and the server-side pin up to date as well.
      invalidateSuggestionsCache();
      void loadSuggestions({ force: true });
    },
    [onToggleTimer, loadSuggestions],
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
      if (row.kind === 'issue')
        navigate(ticketDetailPath({ sourceId: 'redmine', id: String(row.issue.id) }));
      else if (row.kind === 'show-all') setShowAll(true);
      else if (row.kind === 'connect') navigate('/app/settings');
      else {
        // One retry row stands for both requests: retry whichever failed.
        if (suggestions.status === 'error') void retrySuggestions();
        if (search.status === 'error') retrySearch();
      }
    },
    [navigate, suggestions.status, search.status, retrySuggestions, retrySearch],
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

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const row = isOpen && highlightedIndex >= 0 ? rows[highlightedIndex] : undefined;
    if (row?.kind !== 'issue') return;
    const stopDownshift = () => {
      event.preventDefault();
      (
        event.nativeEvent as KeyboardEvent & { preventDownshiftDefault?: boolean }
      ).preventDownshiftDefault = true;
    };
    if (event.key === 'Delete' && row.section === 'suggested') {
      stopDownshift();
      void hide(row.issue);
    } else if (event.key === 'Enter' && event.shiftKey) {
      stopDownshift();
      closeMenu();
      void toggleTimer(row.issue);
    }
  };

  const statusMessage = (() => {
    if (suggestions.status === 'loading' && !suggestions.issues.length)
      return text.loadingSuggestions;
    if (search.status === 'loading' && !moreResults.length) return text.searching;
    if (suggestions.status === 'error' || search.status === 'error') return text.unreachable;
    if (
      search.status === 'ready' &&
      search.query === trimmed &&
      !matching.length &&
      !moreResults.length
    ) {
      return emptySearchMessage(search.kind, trimmed);
    }
    if (!trimmed && suggestions.status === 'ready' && !suggestions.issues.length)
      return text.noSuggestions;
    return null;
  })();

  // Placeholders while the list is still on its way, so the panel never sits
  // empty: rows for the first suggestions load, and a "More from Redmine"
  // section while a search is out.
  const loadingSuggested = suggestions.status === 'loading' && !suggestions.issues.length;
  const loadingMore = search.status === 'loading' && !moreResults.length;

  const firstMoreIndex = rows.findIndex((row) => row.kind === 'issue' && row.section === 'more');
  const firstSuggestedIndex = rows.findIndex(
    (row) => row.kind === 'issue' && row.section === 'suggested',
  );
  const showPanel = isOpen && (rows.length > 0 || statusMessage !== null || suggestions.partial);

  // Rendered in a portal and positioned against the input: the page header
  // blurs its backdrop, which makes it its own stacking context, so an absolute
  // panel inside it would sit under the table.
  const { anchorRef, floatingRef, style } = useAnchoredPosition<HTMLDivElement, HTMLDivElement>({
    open: showPanel,
    // At least as wide as the input, but never as narrow as it gets on a phone,
    // where it shares one row with "New Ticket" and the Closed switch.
    matchMinWidth: true,
    offset: 4,
    maxHeight: 384,
  });

  return (
    <div ref={anchorRef} className="redmine-suggestions relative min-w-0 flex-1">
      <SearchIcon
        aria-hidden="true"
        size={14}
        className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        label={text.searchLabel}
        hideLabel
        placeholder={text.placeholder}
        size="sm"
        className={inputClassName}
        {...getInputProps({
          'aria-label': text.searchLabel,
          onKeyDown,
          onFocus: () => {
            void loadSuggestions();
            if (!isOpen) openMenu();
          },
        })}
      />

      {createPortal(
        <div
          ref={floatingRef}
          style={style}
          className="redmine-suggestions-panel z-50 flex w-[min(32rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-lg"
          hidden={!showPanel}
        >
          {/* The list scrolls; the status line under it stays in view. */}
          <ScrollArea
            className={`redmine-suggestions-scroll min-h-0 flex-1 [&::-webkit-scrollbar]:w-1.5 ${MINIMAL_SCROLLBAR_CLASS}`}
          >
            <ul
              className="redmine-suggestions-list py-1"
              {...getMenuProps({ 'aria-label': text.menuLabel })}
            >
              {showPanel &&
                rows.map((row, index) => (
                  <React.Fragment key={rowKey(row)}>
                    {index === firstSuggestedIndex && (
                      <SectionHeading>{text.suggestedHeading}</SectionHeading>
                    )}
                    {index === firstMoreIndex && (
                      <SectionHeading>{text.moreHeading}</SectionHeading>
                    )}
                    <li
                      className="redmine-suggestion group flex cursor-pointer items-center gap-2 px-3 py-2 text-sm aria-selected:bg-muted"
                      {...getItemProps({ item: row, index })}
                      {...(row.kind === 'issue'
                        ? {
                            'aria-describedby':
                              row.section === 'suggested' ? shortcutsId : searchShortcutsId,
                          }
                        : {})}
                    >
                      {row.kind === 'issue' ? (
                        <IssueRow
                          issue={row.issue}
                          reason={
                            row.section === 'suggested'
                              ? reasonLabel(row.issue, { runningIssueId })
                              : null
                          }
                          running={row.issue.id === runningIssueId}
                          timerBusy={timerIssueId !== null}
                          timerLoading={timerIssueId === row.issue.id}
                          onToggleTimer={() => {
                            // Like Shift+Enter: close first, so nothing is left
                            // open behind a clock-in prompt.
                            closeMenu();
                            void toggleTimer(row.issue);
                          }}
                          onHide={
                            row.section === 'suggested' ? () => void hide(row.issue) : undefined
                          }
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
        </div>,
        document.body,
      )}

      <span id={shortcutsId} className="sr-only">
        {text.rowShortcuts}
      </span>
      <span id={searchShortcutsId} className="sr-only">
        {text.searchRowShortcuts}
      </span>
    </div>
  );
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

/** Stop an action's click from also choosing the row, and keep focus in the input. */
const keepFocus = (event: React.MouseEvent) => {
  event.preventDefault();
  event.stopPropagation();
};

interface IssueRowProps {
  issue: RedmineIssue;
  reason: string | null;
  running: boolean;
  /** A timer start or stop is in flight, on this row or another. */
  timerBusy: boolean;
  /** …and it is this row's. */
  timerLoading: boolean;
  onToggleTimer: () => void;
  onHide?: () => void;
}

/**
 * One suggestion. Only `#id` and the title always show; the rest is placed by
 * priority so a row stays readable at 320 px:
 * - project: second line, `sm` and up
 * - reason chip: at the end on wide screens with a mouse, until the row is
 *   highlighted or hovered; under the title on touch, or on a highlighted
 *   narrow row
 * - timer and hide: on the highlighted or hovered row, always on touch
 *
 * The actions are mouse-only (`tabIndex={-1}`, `aria-hidden`): a combobox
 * option cannot hold its own buttons, so the keyboard gets Delete and
 * Shift+Enter instead, announced through the row's `aria-describedby`.
 */
function IssueRow({
  issue,
  reason,
  running,
  timerBusy,
  timerLoading,
  onToggleTimer,
  onHide,
}: IssueRowProps) {
  return (
    <>
      <Text
        as="span"
        size="xs"
        variant="muted"
        className="redmine-suggestion-id w-12 shrink-0 tabular-nums"
      >
        #{issue.id}
      </Text>

      <span className="redmine-suggestion-body min-w-0 flex-1">
        <OverflowTooltip content={issue.subject}>
          <span className="block min-w-0 truncate">{issue.subject}</span>
        </OverflowTooltip>
        <span className="redmine-suggestion-meta flex min-w-0 items-center gap-2 empty:hidden">
          {issue.project && (
            <Text as="span" size="xs" variant="muted" className="hidden truncate sm:block">
              {issue.project.name}
            </Text>
          )}
          {reason && (
            <Badge
              size="sm"
              variant="secondary"
              className={`hidden pointer-coarse:inline-flex max-sm:group-aria-selected:inline-flex ${CHIP_CLASS}`}
            >
              {reason}
            </Badge>
          )}
        </span>
      </span>

      {reason && (
        <Badge
          size="sm"
          variant="secondary"
          className={`hidden sm:pointer-fine:inline-flex sm:pointer-fine:group-hover:hidden sm:pointer-fine:group-aria-selected:hidden ${CHIP_CLASS}`}
        >
          {reason}
        </Badge>
      )}

      <span
        className="redmine-suggestion-actions hidden shrink-0 items-center gap-1 group-hover:flex group-aria-selected:flex pointer-coarse:flex"
        aria-hidden="true"
      >
        <TimerToggleButton
          isRunning={running}
          isLoading={timerLoading}
          disabled={timerBusy}
          className="h-7 w-7"
          tabIndex={-1}
          aria-hidden
          title={running ? text.stopTimer(issue.id) : text.startTimer(issue.id)}
          ariaLabel={running ? text.stopTimer(issue.id) : text.startTimer(issue.id)}
          onMouseDown={keepFocus}
          onClick={(event) => {
            keepFocus(event);
            onToggleTimer();
          }}
        />
        {onHide && (
          <Tooltip content={text.hide(issue.id)}>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 [&_[data-slot=button-label]]:flex"
              tabIndex={-1}
              aria-label={text.hide(issue.id)}
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
      </span>
    </>
  );
}
