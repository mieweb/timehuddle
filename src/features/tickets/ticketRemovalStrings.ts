/**
 * User-facing text for taking tickets off the Tickets page: the bulk Delete
 * confirmation and the notice about My Board entries that point at nothing.
 *
 * Kept in one module, like `redmine/suggestionStrings.ts`, as the seam a
 * translation library will plug into. Counts are functions so a translation
 * can place the number and choose the plural.
 */

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

export const removalText = {
  deleteTitle: (count: number) => (count === 1 ? 'Delete ticket?' : `Delete ${count} tickets?`),
  /** Redmine issues leave TimeHuddle only; Redmine itself is never touched. */
  redmineRemoved: (count: number) =>
    `${count} Redmine ${plural(count, 'issue', 'issues')} will be removed from TimeHuddle, not from Redmine. ` +
    `Start a timer on ${plural(count, 'it', 'one')} to bring it back.`,
  /** TimeHuddle is where a Huddle ticket lives, so deleting it is permanent. */
  huddleDeleted: (count: number) =>
    `${count} Huddle ${plural(count, 'ticket', 'tickets')} will be permanently deleted and removed from all clock events.`,
  deleteFailed: 'Some tickets could not be deleted. Please try again.',
  deleteDisabled: 'Only Huddle tickets you created can be deleted',

  connectRedmine: (count: number) =>
    `Connect your Redmine account in Settings to see ${count} Redmine ${plural(count, 'issue', 'issues')} on your board.`,
  boardUnavailable: (count: number) =>
    `${count} ${plural(count, 'ticket', 'tickets')} on your board ${plural(count, 'is', 'are')} no longer available.`,
  boardNotLoaded: (count: number) =>
    `${count} ${plural(count, 'ticket', 'tickets')} on your board couldn't be loaded right now.`,
  boardAddFailed: "Couldn't add to My Board. Please try again.",
  boardRemoveFailed: "Couldn't remove from My Board. Please try again.",
  removeUnavailable: 'Remove them',
  removeUnavailableFailed: "Couldn't remove them. Please try again.",
  removeUnavailableLabel: (count: number) =>
    `Remove ${count} unavailable ${plural(count, 'ticket', 'tickets')} from My Board`,
};
