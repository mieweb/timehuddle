/**
 * What to tell someone whose Pulse video couldn't go where they recorded it
 * for: the server kept it in their media library instead (never thrown away),
 * and `reason` says why — e.g. the change was reviewed while they recorded.
 */
export function keptMessage(reason?: string): string {
  // Server reasons aren't always full sentences ("Not a team member").
  const why = reason ? ` ${reason.replace(/\.?$/, '.')}` : '';
  return `Couldn't add your video here.${why} It's saved in your Media library.`;
}
