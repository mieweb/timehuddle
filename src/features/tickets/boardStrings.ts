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

  removed: (label: string) => `${label} removed from My Board`,
  undo: 'Undo',
  columnHeading: 'My Board and timer',
};
