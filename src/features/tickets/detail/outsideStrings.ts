/**
 * User-facing text for a carried issue on the ticket page (#757). Kept in one
 * module, like `../link/ticketLinkStrings.ts`, as the seam a translation
 * library will plug into; `source` is the source's name, e.g. "Redmine".
 */
export const outsideText = {
  statusLabel: (source: string) => `Status in ${source}`,
  priorityLabel: (source: string) => `Priority in ${source}`,
  noPriority: 'None',
  descriptionFrom: (source: string) => `From ${source}`,
  saveFailed: (source: string) => `Could not save the change to ${source}.`,
  notStored: (source: string) =>
    `${source} didn't store every change as sent. Reload to see what it kept.`,
  reload: 'Reload',
};
