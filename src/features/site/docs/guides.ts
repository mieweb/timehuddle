/**
 * Loads `guides/*.md` — the docs served at `/docs` — into the build.
 *
 * Bundled rather than fetched, like the release notes: the guide shipped with a
 * build describes that build, and the page works with no backend.
 */
import { splitFrontmatter } from '../../release-notes/parse';

export interface Guide {
  /** The filename without `.md`; the guide lives at `/docs/<slug>`. */
  slug: string;
  title: string;
  /** One sentence for the index and the page's lead. */
  summary: string;
  /** The group it is listed under in the docs sidebar. */
  section: string;
  /** Sort position, across all sections. */
  order: number;
  body: string;
}

const SLUG_RE = /^([a-z0-9-]+)\.md$/;

const RAW_GUIDES = import.meta.glob('../../../../guides/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Parses one guide; throws with the filename on anything malformed. */
export function parseGuide(fileName: string, raw: string): Guide {
  const slug = SLUG_RE.exec(fileName)?.[1];
  if (!slug) throw new Error(`${fileName}: guide filenames are lowercase-with-dashes.md`);
  const parsed = splitFrontmatter(raw);
  if (!parsed) throw new Error(`${fileName}: missing the "---" frontmatter block`);

  const { title, summary, section, order } = parsed.fields;
  for (const [key, value] of Object.entries({ title, summary, section, order })) {
    if (!value) throw new Error(`${fileName}: frontmatter is missing "${key}"`);
  }
  const position = Number(order);
  if (!Number.isFinite(position)) throw new Error(`${fileName}: order "${order}" is not a number`);
  if (!parsed.body) throw new Error(`${fileName}: has no body below the frontmatter`);

  return { slug, title, summary, section, order: position, body: parsed.body };
}

/** Every guide, in reading order. README.md is the folder's own note, not a guide. */
export function loadGuides(rawGuides: Record<string, string> = RAW_GUIDES): Guide[] {
  return Object.entries(rawGuides)
    .map(([path, raw]) => [path.slice(path.lastIndexOf('/') + 1), raw] as const)
    .filter(([fileName]) => fileName !== 'README.md')
    .map(([fileName, raw]) => parseGuide(fileName, raw))
    .sort((a, b) => a.order - b.order);
}

export const guides: Guide[] = loadGuides();

/** Guides grouped by section, sections in the order their first guide appears. */
export function guidesBySection(list: Guide[] = guides): { section: string; guides: Guide[] }[] {
  const groups = new Map<string, Guide[]>();
  for (const guide of list)
    groups.set(guide.section, [...(groups.get(guide.section) ?? []), guide]);
  return [...groups].map(([section, items]) => ({ section, guides: items }));
}
