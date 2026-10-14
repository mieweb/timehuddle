import React from 'react';

import { REPO_URL } from '../../lib/constants';
import { SITE_COPY } from './copy';
import styles from './site.module.css';

/** The public site's footer: where to go next, and the name set large enough to sign the page. */
export const SiteFooter: React.FC = () => {
  const { footer } = SITE_COPY;
  const columns = [
    {
      title: footer.product,
      links: [
        { label: footer.signIn, href: '/app' },
        { label: footer.releaseNotes, href: '/release-notes' },
        { label: footer.support, href: '/docs/support' },
      ],
    },
    {
      title: footer.docs,
      links: [
        { label: footer.gettingStarted, href: '/docs/getting-started' },
        { label: footer.redmine, href: '/docs/redmine' },
        { label: footer.selfHost, href: '/docs/self-hosting' },
      ],
    },
    {
      title: footer.source,
      links: [
        { label: footer.github, href: REPO_URL, external: true },
        { label: footer.issues, href: `${REPO_URL}/issues`, external: true },
        { label: footer.license, href: `${REPO_URL}/blob/main/LICENSE`, external: true },
      ],
    },
  ];

  return (
    <footer className="site-footer overflow-hidden border-t border-(--ink) bg-(--paper)">
      <div className="site-footer-inner mx-auto max-w-[88rem] px-4 pt-14 sm:px-8">
        <div className="site-footer-columns grid gap-10 sm:grid-cols-[1.4fr_repeat(3,1fr)]">
          <p className="max-w-xs text-sm leading-relaxed text-(--ink-soft)">{footer.tagline}</p>
          {columns.map((col) => (
            <nav key={col.title} aria-label={col.title} className="site-footer-column">
              <p
                className={`${styles.mono} mb-3 text-[0.68rem] tracking-[0.14em] text-(--ink-faint) uppercase`}
              >
                {col.title}
              </p>
              <ul className="space-y-2 text-sm">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <a
                      href={l.href}
                      {...('external' in l && l.external
                        ? { target: '_blank', rel: 'noopener noreferrer' }
                        : {})}
                      className="text-(--ink) underline-offset-4 hover:underline"
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
      </div>
      <p
        className="site-footer-wordmark mx-auto mt-16 max-w-[88rem] translate-y-[0.22em] px-2 text-center text-[clamp(4rem,17.5vw,17rem)] leading-[0.8] font-semibold tracking-[-0.06em] text-(--ink) select-none"
        aria-hidden="true"
      >
        TimeHuddle
      </p>
    </footer>
  );
};
