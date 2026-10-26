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
  /** TimeHuddle is where a Huddle ticket lives, so deleting it is permanent. */
  huddleDeleted: (count: number) =>
    `${count} Huddle ${plural(count, 'ticket', 'tickets')} will be permanently deleted and removed from all clock events.`,
  deleteFailed: 'Some tickets could not be deleted. Please try again.',
  deleteDisabled: 'Only Huddle tickets you created can be deleted',

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
