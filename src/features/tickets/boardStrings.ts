/**
 * User-facing text for the My Board toggle a ticket carries wherever it is
 * shown (`BoardToggleButton`), and for taking one ticket off the board.
 *
 * Kept in one module, like `redmine/suggestionStrings.ts`, as the seam a
 * translation library will plug into. Anything built around a ticket's name is
 * a function, so a translation can reorder the words around it.
 */
export const boardText = {
  add: 'Add to My Board',
  /** The tooltip of a ticket already on the board: what it is, and what a press does. */
  onBoard: 'On My Board. Press to remove.',
  addLabel: (label: string) => `Add ${label} to My Board`,
  removeLabel: (label: string) => `Remove ${label} from My Board`,
  /** Beside the icon, where there is room for words. */
  addShort: 'Add to My Board',
  onBoardShort: 'On My Board',
  /** In a ticket's menu, where the item names the action. */
  remove: 'Remove from My Board',

  removed: (label: string) => `${label} removed from My Board`,
  /** A Redmine issue becomes a ticket in the selected team when it's boarded or timed (#736). */
  noTeam: 'Choose a team first. A Redmine issue becomes a ticket in your team.',
  carryFailed: (count: number) =>
    count === 1
      ? "One Redmine issue couldn't be added to My Board. Try again in a moment."
      : `${count} Redmine issues couldn't be added to My Board. Try again in a moment.`,
  undo: 'Undo',

  /** Pinning: a ticket's place in the plan for the day (#884). */
  pin: 'Pin',
  unpin: 'Unpin',
  pinFailed: "Couldn't pin that ticket. Try again in a moment.",
  unpinFailed: "Couldn't unpin that ticket. Try again in a moment.",
  reorderFailed: "Couldn't save your pins. Try again in a moment.",
  pinnedSection: 'Pinned',
  restSection: 'Rest of my board',
  pinnedEmpty: 'Drag the tickets you plan to work on here, or pin them from their ⋮ menu.',
  /** Writes the pins into today's plan and starts the first once clocked in. */
  startSession: 'Start session',
  startSessionLabel: (count: number) =>
    count === 1
      ? 'Start session: plan your pinned ticket and start it once you clock in'
      : `Start session: plan your ${count} pinned tickets and start the first once you clock in`,
  columnHeading: 'My Board and timer',
};
