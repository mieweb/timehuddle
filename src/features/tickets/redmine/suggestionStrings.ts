/**
 * Every user-facing string in the Redmine search suggestions, in one place.
 *
 * The app has no translation library yet, so this module is the seam one will
 * plug into: components read text only from here, never inline. Anything built
 * from values (an issue number, a name, a count) is a function, so a translation
 * can reorder the words around it.
 */
import type { RedmineRelevanceReason } from '../../../lib/api';

export const suggestionText = {
  searchLabel: 'Search tickets and Redmine issues',
  placeholder: 'Search, #number, @person, or paste a link',
  menuLabel: 'Redmine suggestions',

  suggestedHeading: 'Suggested for you',
  moreHeading: 'More from Redmine',
  showAll: (count: number) => `Show all ${count} suggestions`,

  reason: {
    running: 'Timer running',
    assigned: 'Assigned',
    activity: 'Recent activity',
    watching: 'Watching',
    pinned: 'Pinned',
    board: 'On My Board',
  } satisfies Record<Exclude<RedmineRelevanceReason, 'logged'>, string>,
  /** `when` is already localized, e.g. "2 days ago" or "yesterday". */
  loggedReason: (when: string) => `Logged ${when}`,
  loggedReasonUndated: 'Logged recently',

  startTimer: (id: number) => `Start a timer on #${id}`,
  stopTimer: (id: number) => `Stop the timer on #${id}`,
  hide: (id: number) => `Hide #${id} from suggestions`,
  rowShortcuts: 'Press Delete to hide, Shift+Enter to start a timer.',
  searchRowShortcuts: 'Press Shift+Enter to start a timer.',

  loadingSuggestions: 'Loading your Redmine issues…',
  searching: 'Searching Redmine…',
  partial: 'Some Redmine results are still unavailable.',
  unreachable: "Redmine didn't respond.",
  retry: 'Try again',
  connect: 'Connect Redmine to see your issues',
  noSuggestions: 'No suggestions right now. Type to search Redmine.',

  emptyById: (id: string) => `No issue #${id}, or you can't see it.`,
  emptyByUrl: "That link isn't an issue on your Redmine.",
  emptyByAssignee: (name: string) =>
    `No single person matches “@${name}”. Type more of their name — names work, logins don't.`,
  emptyByText: (text: string) => `No open Redmine issues with “${text}” in the title.`,

  hidden: (id: number) => `Hidden #${id}`,
  undo: 'Undo',
  hideFailed: (id: number) => `Couldn't hide #${id}. Please try again.`,

  hiddenHeading: 'Hidden suggestions',
  hiddenExplainer:
    'Issues you hid from your search suggestions. They come back on their own after 15 days, or as soon as one is assigned to you.',
  hiddenNone: "You haven't hidden any suggestions.",
  restore: 'Restore',
  restoreLabel: (id: number) => `Restore #${id} to suggestions`,
  restoreFailed: (id: number) => `Couldn't restore #${id}. Please try again.`,
  hiddenLoadFailed: "Couldn't load your hidden suggestions.",
} as const;
