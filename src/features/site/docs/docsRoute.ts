/** The docs live at `/docs` and `/docs/<slug>`. */
export const DOCS_ROOT = '/docs';

export function isDocsPath(pathname: string): boolean {
  return pathname === DOCS_ROOT || pathname.startsWith(`${DOCS_ROOT}/`);
}

/** The guide slug in a docs path, or null for the docs index. */
export function guideSlugFromPath(pathname: string): string | null {
  const rest = pathname.slice(DOCS_ROOT.length).replace(/^\/+|\/+$/g, '');
  return rest || null;
}

export const guidePath = (slug: string) => `${DOCS_ROOT}/${slug}`;
