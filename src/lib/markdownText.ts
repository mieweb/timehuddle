/**
 * How much of the text a preview reads: far more than two lines show, and
 * small enough that a long post (or a GitHub issue body) costs nothing to strip.
 */
export const PREVIEW_SOURCE_CHARS = 2000;

/**
 * Markdown as one line of plain text, for a preview that sits inside
 * something clickable (a card that opens the post, a search result), where
 * links and formatting can't be rendered. Reads only the start of the text
 * (PREVIEW_SOURCE_CHARS): a preview never shows more.
 */
export function stripMarkdown(text: string): string {
  return (
    text
      .slice(0, PREVIEW_SOURCE_CHARS)
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`[^`]+`/g, '')
      // `[^[\]]`: a label stops at the next bracket, so a run of `[` can't rescan.
      .replace(/!?\[([^[\]]*)\]\([^)]+\)/g, '$1')
      .replace(/[#*_~>]/g, '')
      .replace(/\n+/g, ' ')
      .trim()
  );
}
