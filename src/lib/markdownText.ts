/**
 * Markdown as one line of plain text, for a preview that sits inside
 * something clickable (a card that opens the post, a search result), where
 * links and formatting can't be rendered.
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/[#*_~>]/g, '')
    .replace(/\n+/g, ' ')
    .trim();
}
