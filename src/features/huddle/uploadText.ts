/**
 * Every word the upload-on-attach UI says, on every surface — Huddle's message
 * box (passed to the composer as `uploadLabels`), the Clock composer's tiles
 * and button, and a ticket's Videos — kept in one place for translation and so
 * the same thing is said the same way everywhere.
 */
export const UPLOAD_TEXT = {
  /** A file on its way up: its progress bar's name, and what's announced. */
  uploading: (name: string) => `Uploading ${name}`,
  /** Announced once it's up. */
  uploaded: (name: string) => `${name} uploaded`,
  /** How far it has got. */
  percent: (percent: number) => `${percent}%`,
  /** Every byte is in and the server is making it ready (a video converting). */
  processing: 'Processing…',
  /** It didn't make it: announced, and said on its card. */
  failed: (name: string) => `${name} didn't upload`,
  retry: 'Retry',
  /** The × while it's uploading. */
  cancel: (name: string) => `Cancel upload of ${name}`,
  /** The × once it's up, or failed. */
  remove: (name: string) => `Remove attachment ${name}`,
  /** A post or clock action that waits for its files: how far they've got. */
  waiting: (percent: number) => `Uploading ${percent}%…`,
  /** A video that uploaded but hasn't shown up in its list. */
  notListed: (name: string) => `${name} uploaded, but isn't showing yet. Reload to see it.`,
  /** Why a post or clock action stopped. */
  blocked: (name: string) => `${name} didn't upload. Retry it or remove it.`,
  /** Over a composer while files are dragged onto it. */
  dropFiles: 'Drop files to attach them',
  /** Over a ticket's Videos while videos are dragged onto it. */
  dropVideos: 'Drop videos to upload them here',
};
