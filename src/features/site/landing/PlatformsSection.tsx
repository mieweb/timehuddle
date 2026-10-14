import React from 'react';

import { APP_STORE_URL } from '../../../lib/constants';
import { SITE_COPY } from '../copy';
import styles from '../site.module.css';
import { SectionIntro } from './SectionIntro';

/** Where it runs, as a spec sheet rather than a row of device mockups. */
export const PlatformsSection: React.FC = () => {
  const copy = SITE_COPY.platforms;
  return (
    <section
      aria-labelledby="platforms-heading"
      className="platforms-section border-t border-(--rule)"
    >
      <div className="mx-auto grid max-w-[88rem] gap-12 px-4 py-20 sm:px-8 lg:grid-cols-2 lg:gap-20 lg:py-28">
        <div>
          <SectionIntro
            id="platforms-heading"
            eyebrow={copy.eyebrow}
            title={copy.title}
            body={copy.body}
          />
          <a
            href={APP_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-8 inline-block font-medium underline decoration-(--shift) decoration-2 underline-offset-[6px]"
          >
            {copy.appStore}
          </a>
        </div>
        <dl className="platforms-spec self-end border-t border-(--ink)">
          {copy.rows.map((row) => (
            <div
              key={row.label}
              className="flex items-baseline justify-between gap-6 border-b border-(--rule) py-5"
            >
              <dt className="text-2xl font-semibold tracking-tight sm:text-3xl">{row.label}</dt>
              <dd className={`${styles.mono} text-end text-sm text-(--ink-soft)`}>{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
};
