/**
 * DocsPage — the guides at `/docs` and `/docs/<slug>`, no account needed.
 *
 * Mounted directly by `main.tsx`, like the landing page and the public release
 * notes. Moving between guides stays in the page (history.pushState) so the
 * docs feel instant, while every URL still works on its own when shared.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Components } from 'react-markdown';

import { REPO_URL } from '../../../lib/constants';
import { MarkdownContent } from '../../../ui/MarkdownContent';
import { SITE_COPY } from '../copy';
import { SiteFooter } from '../SiteFooter';
import { SiteHeader } from '../SiteHeader';
import styles from '../site.module.css';
import { DOCS_ROOT, guidePath, guideSlugFromPath } from './docsRoute';
import { type Guide, guides, guidesBySection } from './guides';

/** Plain text of a rendered heading, for its anchor id. */
function textOf(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (React.isValidElement<{ children?: React.ReactNode }>(node))
    return textOf(node.props.children);
  return '';
}

export const headingId = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** `## Heading` lines outside code fences — the "On this page" list. */
function outline(body: string): { id: string; text: string }[] {
  let inFence = false;
  const items: { id: string; text: string }[] = [];
  for (const line of body.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const match = !inFence && /^##\s+(.+?)\s*$/.exec(line);
    if (match) {
      const text = match[1].replace(/[`*_]/g, '');
      items.push({ id: headingId(text), text });
    }
  }
  return items;
}

const isInternal = (href?: string) => !!href && href.startsWith('/') && !href.startsWith('//');

const proseComponents: Components = {
  h2: ({ children }) => (
    <h2
      id={headingId(textOf(children))}
      className="mt-14 mb-4 scroll-mt-24 border-t border-(--rule) pt-6 text-2xl font-semibold tracking-tight text-(--ink) first:mt-0"
    >
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3
      id={headingId(textOf(children))}
      className="mt-8 mb-2 scroll-mt-24 text-lg font-semibold text-(--ink)"
    >
      {children}
    </h3>
  ),
  p: ({ children }) => (
    <p className="mb-4 text-[1.0625rem] leading-relaxed text-(--ink-soft)">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="mb-5 list-disc space-y-2 ps-5 text-[1.0625rem] leading-relaxed text-(--ink-soft) marker:text-(--ticket)">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-5 list-decimal space-y-2 ps-5 text-[1.0625rem] leading-relaxed text-(--ink-soft) marker:font-medium marker:text-(--shift)">
      {children}
    </ol>
  ),
  strong: ({ children }) => <strong className="font-semibold text-(--ink)">{children}</strong>,
  blockquote: ({ children }) => (
    <blockquote className="my-6 border-s-2 border-(--ticket) bg-(--card) py-3 ps-5 pe-4 text-(--ink) [&_p]:mb-0 [&_p]:text-(--ink)">
      {children}
    </blockquote>
  ),
  a: ({ href, children }) =>
    isInternal(href) ? (
      <a
        href={href}
        className="font-medium text-(--shift) underline decoration-(--shift)/30 underline-offset-4 hover:decoration-(--shift)"
      >
        {children}
      </a>
    ) : (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-(--shift) underline decoration-(--shift)/30 underline-offset-4 hover:decoration-(--shift)"
      >
        {children}
      </a>
    ),
  code: ({ className, children }) =>
    className?.includes('language-') ? (
      <code
        className={`block overflow-x-auto p-4 text-[0.8125rem] leading-6 text-(--paper) ${className}`}
      >
        {children}
      </code>
    ) : (
      <code className="rounded bg-(--paper-deep) px-1.5 py-0.5 text-[0.85em] text-(--ink)">
        {children}
      </code>
    ),
  pre: ({ children }) => (
    <pre className="mb-6 overflow-hidden rounded-xl bg-(--ink)">{children}</pre>
  ),
  table: ({ children }) => (
    <div className="mb-6 overflow-x-auto rounded-xl border border-(--rule) bg-(--card)">
      <table className="min-w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-(--rule) px-3 py-2 text-start font-semibold text-(--ink)">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-(--rule) px-3 py-2 align-top text-(--ink-soft) [tr:last-child_&]:border-b-0">
      {children}
    </td>
  ),
  hr: () => <hr className="my-10 border-(--rule)" />,
};

/** Keeps the docs in one page: internal /docs links push history instead of reloading. */
function useDocsLocation() {
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPop = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const onClick = useCallback((e: React.MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
      return;
    const anchor = (e.target as HTMLElement).closest('a');
    const href = anchor?.getAttribute('href');
    if (!href || anchor?.target || !(href === DOCS_ROOT || href.startsWith(`${DOCS_ROOT}/`)))
      return;
    e.preventDefault();
    const [path, hash] = href.split('#');
    if (path !== window.location.pathname) {
      window.history.pushState(null, '', href);
      setPathname(path);
      window.scrollTo({ top: 0 });
    } else if (hash) {
      window.history.pushState(null, '', href);
    }
    if (hash) document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  return { pathname, onClick };
}

export const DocsPage: React.FC = () => {
  const { pathname, onClick } = useDocsLocation();
  const slug = guideSlugFromPath(pathname);
  const guide = slug ? guides.find((g) => g.slug === slug) : undefined;
  const copy = SITE_COPY.docs;

  useEffect(() => {
    document.title = guide
      ? `${guide.title} — ${copy.title} — TimeHuddle`
      : `${copy.title} — TimeHuddle`;
  }, [guide, copy.title]);

  return (
    // The click handler only routes clicks bubbling up from real anchors.
    <div className={`${styles.site} docs-page min-h-dvh`} onClick={onClick}>
      <SiteHeader current="docs" />
      <div className="docs-layout mx-auto grid max-w-[88rem] gap-10 px-4 pt-8 pb-24 sm:px-8 lg:grid-cols-[15rem_minmax(0,1fr)] lg:pt-14 xl:grid-cols-[15rem_minmax(0,1fr)_13rem]">
        <DocsSidebar currentSlug={guide?.slug ?? null} />
        <main id="docs-main" className="docs-main min-w-0">
          {guide ? <GuideArticle guide={guide} /> : slug ? <GuideNotFound /> : <DocsIndex />}
        </main>
        {guide && <GuideOutline guide={guide} />}
      </div>
      <SiteFooter />
    </div>
  );
};

const DocsSidebar: React.FC<{ currentSlug: string | null }> = ({ currentSlug }) => {
  const copy = SITE_COPY.docs;
  const list = (
    <nav aria-label={copy.sidebarLabel} className="docs-sidebar-nav space-y-7">
      <a
        href={DOCS_ROOT}
        aria-current={currentSlug === null ? 'page' : undefined}
        className="block text-sm font-semibold text-(--ink) aria-[current=page]:text-(--shift)"
      >
        {copy.overview}
      </a>
      {guidesBySection().map(({ section, guides: items }) => (
        <div key={section} className="docs-sidebar-section">
          <p
            className={`${styles.mono} mb-2 text-[0.68rem] tracking-[0.14em] text-(--ink-faint) uppercase`}
          >
            {section}
          </p>
          <ul className="space-y-0.5 border-s border-(--rule)">
            {items.map((g) => (
              <li key={g.slug}>
                <a
                  href={guidePath(g.slug)}
                  aria-current={g.slug === currentSlug ? 'page' : undefined}
                  className="-ms-px block border-s-2 border-transparent py-1 ps-3 text-sm text-(--ink-soft) transition-colors hover:text-(--ink) aria-[current=page]:border-(--ticket) aria-[current=page]:font-medium aria-[current=page]:text-(--ink)"
                >
                  {g.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <aside className="docs-sidebar">
      <details className="docs-sidebar-mobile rounded-xl border border-(--rule) bg-(--card) lg:hidden">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">{copy.browse}</summary>
        <div className="border-t border-(--rule) px-4 py-4">{list}</div>
      </details>
      <div className="docs-sidebar-desktop sticky top-24 hidden lg:block">{list}</div>
    </aside>
  );
};

const DocsIndex: React.FC = () => {
  const copy = SITE_COPY.docs;
  let n = 0;
  return (
    <div className="docs-index">
      <p className={`${styles.mono} text-xs tracking-[0.14em] text-(--ink-faint) uppercase`}>
        {copy.eyebrow}
      </p>
      <h1 className="mt-3 max-w-3xl text-[clamp(2.5rem,6vw,4.5rem)] leading-[0.95] font-semibold tracking-[-0.035em]">
        {copy.title}
      </h1>
      <p className="mt-5 max-w-2xl text-lg leading-relaxed text-(--ink-soft)">{copy.intro}</p>

      <div className="docs-index-sections mt-14 space-y-14">
        {guidesBySection().map(({ section, guides: items }) => (
          <section key={section} aria-labelledby={`docs-section-${headingId(section)}`}>
            <h2
              id={`docs-section-${headingId(section)}`}
              className={`${styles.mono} mb-3 text-xs tracking-[0.14em] text-(--ink-faint) uppercase`}
            >
              {section}
            </h2>
            <ul className="border-t border-(--ink)">
              {items.map((g) => {
                n += 1;
                return (
                  <li key={g.slug} className="border-b border-(--rule)">
                    <a
                      href={guidePath(g.slug)}
                      className="group grid grid-cols-[2.5rem_1fr] items-baseline gap-x-4 py-5 sm:grid-cols-[3rem_16rem_1fr_auto]"
                    >
                      <span className={`${styles.mono} text-sm text-(--ink-faint)`}>
                        {String(n).padStart(2, '0')}
                      </span>
                      <span className="text-lg font-semibold tracking-tight transition-colors group-hover:text-(--shift)">
                        {g.title}
                      </span>
                      <span className="col-start-2 mt-1 text-(--ink-soft) sm:col-start-auto sm:mt-0">
                        {g.summary}
                      </span>
                      <span
                        className="hidden text-(--ink-faint) transition-transform group-hover:translate-x-1 group-hover:text-(--ticket) sm:inline"
                        aria-hidden="true"
                      >
                        →
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <p className="mt-14 text-sm text-(--ink-soft)">
        {copy.contribute}{' '}
        <a
          href={`${REPO_URL}/tree/main/guides`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-(--shift) underline underline-offset-4"
        >
          {copy.contributeLink}
        </a>
      </p>
    </div>
  );
};

const GuideArticle: React.FC<{ guide: Guide }> = ({ guide }) => {
  const copy = SITE_COPY.docs;
  const index = guides.indexOf(guide);
  const prev = guides[index - 1];
  const next = guides[index + 1];

  return (
    <article className="guide-article max-w-[44rem]" aria-labelledby="guide-title">
      <p className={`${styles.mono} text-xs tracking-[0.14em] text-(--ink-faint) uppercase`}>
        {guide.section}
      </p>
      <h1
        id="guide-title"
        className="mt-3 text-[clamp(2.25rem,5vw,3.5rem)] leading-[1] font-semibold tracking-[-0.03em]"
      >
        {guide.title}
      </h1>
      <p className="mt-4 mb-10 text-xl leading-relaxed text-(--ink-soft)">{guide.summary}</p>

      <MarkdownContent content={guide.body} hardBreaks={false} components={proseComponents} />

      <nav
        aria-label={copy.pagerLabel}
        className="guide-pager mt-16 grid gap-3 border-t border-(--rule) pt-6 sm:grid-cols-2"
      >
        {prev ? <PagerLink guide={prev} label={copy.previous} /> : <span />}
        {next && <PagerLink guide={next} label={copy.next} alignEnd />}
      </nav>

      <a
        href={`${REPO_URL}/edit/main/guides/${guide.slug}.md`}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-8 inline-block text-sm text-(--ink-faint) underline underline-offset-4 hover:text-(--ink)"
      >
        {copy.editOnGitHub}
      </a>
    </article>
  );
};

const PagerLink: React.FC<{ guide: Guide; label: string; alignEnd?: boolean }> = ({
  guide,
  label,
  alignEnd,
}) => (
  <a
    href={guidePath(guide.slug)}
    className={`rounded-xl border border-(--rule) bg-(--card) p-4 transition-colors hover:border-(--ink) ${alignEnd ? 'sm:text-end' : ''}`}
  >
    <span
      className={`${styles.mono} block text-[0.68rem] tracking-[0.14em] text-(--ink-faint) uppercase`}
    >
      {label}
    </span>
    <span className="mt-1 block font-semibold">{guide.title}</span>
  </a>
);

const GuideOutline: React.FC<{ guide: Guide }> = ({ guide }) => {
  const items = useMemo(() => outline(guide.body), [guide.body]);
  if (items.length < 2) return null;
  return (
    <aside className="guide-outline hidden xl:block">
      <nav aria-label={SITE_COPY.docs.onThisPage} className="sticky top-24">
        <p
          className={`${styles.mono} mb-3 text-[0.68rem] tracking-[0.14em] text-(--ink-faint) uppercase`}
        >
          {SITE_COPY.docs.onThisPage}
        </p>
        <ul className="space-y-2 text-sm">
          {items.map((item) => (
            <li key={item.id}>
              <a
                href={`${guidePath(guide.slug)}#${item.id}`}
                className="text-(--ink-soft) hover:text-(--ink)"
              >
                {item.text}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
};

const GuideNotFound: React.FC = () => (
  <div className="guide-not-found max-w-xl" role="status">
    <h1 className="text-4xl font-semibold tracking-tight">{SITE_COPY.docs.notFoundTitle}</h1>
    <p className="mt-4 text-lg text-(--ink-soft)">{SITE_COPY.docs.notFoundBody}</p>
    <a
      href={DOCS_ROOT}
      className="mt-6 inline-block font-medium text-(--shift) underline underline-offset-4"
    >
      {SITE_COPY.docs.overview}
    </a>
  </div>
);
