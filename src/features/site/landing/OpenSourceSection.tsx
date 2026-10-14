import { buttonVariants } from '@mieweb/ui';
import React from 'react';

import { REPO_URL } from '../../../lib/constants';
import { SITE_COPY } from '../copy';
import { DOCS_ROOT, guidePath } from '../docs/docsRoute';
import { guides } from '../docs/guides';
import styles from '../site.module.css';
import { SectionIntro } from './SectionIntro';

/** The shortest true path to a running copy; the guide has the rest. */
const RUN_STEPS: { cmd: string; note?: string }[] = [
  { cmd: `git clone ${REPO_URL}.git && cd timehuddle` },
  { cmd: 'git submodule update --init vendor/meteor-wormhole' },
  { cmd: 'docker compose up -d meteor-backend', note: 'MongoDB, Mailpit, API on :3100' },
  { cmd: 'nvm use && npm install' },
  { cmd: 'npm run dev', note: 'http://localhost:3000' },
];

/** Open source: how to run it, and where the guides start. */
export const OpenSourceSection: React.FC = () => {
  const copy = SITE_COPY.openSource;
  return (
    <section
      aria-labelledby="source-heading"
      className="open-source-section border-t border-(--rule) bg-(--paper-deep)/40"
    >
      <div className="mx-auto max-w-[88rem] px-4 py-20 sm:px-8 lg:py-32">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-20">
          <div>
            <SectionIntro
              id="source-heading"
              eyebrow={copy.eyebrow}
              title={copy.title}
              body={copy.body}
            />
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={`${buttonVariants({ variant: 'outline', size: 'lg' })} mt-8 rounded-full! border-(--ink)! bg-transparent! px-6! text-(--ink)! hover:bg-(--card)!`}
            >
              {copy.star}
            </a>
          </div>

          <div className="open-source-run min-w-0">
            <p
              className={`${styles.mono} mb-3 text-xs tracking-[0.14em] text-(--ink-soft) uppercase`}
            >
              {copy.runTitle}
            </p>
            <pre
              className="overflow-x-auto rounded-2xl bg-(--ink) p-5 text-[0.8125rem] leading-7 text-(--paper) sm:p-7"
              aria-label={copy.runTitle}
            >
              <code>
                {RUN_STEPS.map((step, i) => (
                  <span key={step.cmd} className="block whitespace-pre">
                    <span className="text-(--ink-faint) select-none">
                      {String(i + 1).padStart(2, '0')}{' '}
                    </span>
                    {step.cmd}
                    {step.note && (
                      <span className="text-(--sand) select-none">{`   # ${step.note}`}</span>
                    )}
                  </span>
                ))}
              </code>
            </pre>
            <a
              href={guidePath('self-hosting')}
              className="mt-4 inline-block text-sm font-medium underline decoration-(--shift) decoration-2 underline-offset-4"
            >
              {copy.fullGuide}
            </a>
          </div>
        </div>

        <div className="open-source-guides mt-20">
          <div className="mb-4 flex items-baseline justify-between gap-4">
            <h3 className={`${styles.mono} text-xs tracking-[0.14em] text-(--ink-soft) uppercase`}>
              {copy.guidesTitle}
            </h3>
            <a href={DOCS_ROOT} className="text-sm font-medium underline underline-offset-4">
              {copy.allGuides}
            </a>
          </div>
          <ul className="grid border-t border-(--ink) sm:grid-cols-2 lg:grid-cols-3">
            {guides.map((g, i) => (
              <li
                key={g.slug}
                className="border-b border-(--rule) sm:odd:border-e lg:odd:border-e-0 lg:[&:not(:nth-child(3n))]:border-e"
              >
                <a
                  href={guidePath(g.slug)}
                  className="group block h-full p-5 transition-colors hover:bg-(--card)"
                >
                  <span className={`${styles.mono} text-xs text-(--ink-faint)`}>
                    {String(i + 1).padStart(2, '0')} · {g.section}
                  </span>
                  <span className="mt-2 block font-semibold tracking-tight group-hover:text-(--shift)">
                    {g.title}
                  </span>
                  <span className="mt-1 block text-sm leading-relaxed text-(--ink-soft)">
                    {g.summary}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
};
