import React from 'react';

import { SITE_COPY } from '../copy';
import { guidePath } from '../docs/docsRoute';
import styles from '../site.module.css';
import { useReveal } from '../useReveal';

/** The Redmine integration, led by the one rule it is built on. */
export const RedmineSection: React.FC = () => {
  const copy = SITE_COPY.redmine;
  const reveal = useReveal<HTMLDivElement>();

  return (
    <section
      id="redmine"
      aria-labelledby="redmine-heading"
      className="redmine-section scroll-mt-16 border-t border-(--rule)"
    >
      <div className="mx-auto max-w-[88rem] px-4 py-20 sm:px-8 lg:py-32">
        <p className={`${styles.mono} text-xs tracking-[0.14em] text-(--ink-soft) uppercase`}>
          {copy.eyebrow}
        </p>
        <div
          ref={reveal.ref}
          className={`${reveal.className} redmine-statement mt-6 grid gap-10 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-end`}
        >
          <h2
            id="redmine-heading"
            className="text-[clamp(2.4rem,6.4vw,6rem)] leading-[0.92] font-semibold tracking-[-0.045em] text-balance"
          >
            {copy.quote}
          </h2>
          <p className="text-lg leading-relaxed text-(--ink-soft)">{copy.intro}</p>
        </div>

        <ol className="redmine-points mt-16 grid border-t border-(--ink) sm:grid-cols-2 lg:grid-cols-4">
          {copy.points.map((point, i) => (
            <li
              key={point.title}
              className="redmine-point border-b border-(--rule) py-6 sm:pe-8 lg:border-b-0 lg:border-s lg:ps-6 lg:first:border-s-0 lg:first:ps-0"
            >
              <span className={`${styles.mono} text-sm text-(--ticket)`}>
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3 className="mt-3 text-lg font-semibold tracking-tight">{point.title}</h3>
              <p className="mt-2 leading-relaxed text-(--ink-soft)">{point.body}</p>
            </li>
          ))}
        </ol>

        <a
          href={guidePath('redmine')}
          className="group mt-10 inline-flex items-center gap-2 font-medium text-(--ink) underline decoration-(--ticket) decoration-2 underline-offset-[6px]"
        >
          {copy.link}
          <span
            aria-hidden="true"
            className="transition-transform group-hover:translate-x-1 rtl:rotate-180"
          >
            →
          </span>
        </a>
      </div>
    </section>
  );
};
