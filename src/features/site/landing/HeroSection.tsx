import { buttonVariants } from '@mieweb/ui';
import React from 'react';

import { REPO_URL } from '../../../lib/constants';
import { SITE_COPY } from '../copy';
import styles from '../site.module.css';
import { DayScrubber } from './DayScrubber';

/** The opening: the claim, then the instrument that proves it. */
export const HeroSection: React.FC = () => {
  const copy = SITE_COPY.hero;
  const [lineOne, lineTwo] = copy.headline;

  return (
    <section
      aria-labelledby="hero-heading"
      className="hero-section mx-auto max-w-[88rem] px-4 pt-10 pb-20 sm:px-8 sm:pt-16 lg:pb-28"
    >
      <p
        className={`${styles.mono} hero-eyebrow flex items-center gap-2 text-xs tracking-[0.14em] text-(--ink-soft) uppercase`}
      >
        <span
          className={`${styles.pulse} size-1.5 rounded-full bg-(--ticket)`}
          aria-hidden="true"
        />
        {copy.eyebrow}
      </p>

      <div className="hero-grid mt-6">
        <h1
          id="hero-heading"
          className="hero-heading text-[clamp(2.9rem,8.6vw,8.75rem)] leading-[0.88] font-semibold tracking-[-0.055em]"
        >
          <span className="block">{lineOne}</span>
          <span className="block">
            <TwoStrokes>{lineTwo}</TwoStrokes>
          </span>
        </h1>

        <div className="hero-aside mt-12 grid gap-8 md:grid-cols-[minmax(0,34rem)_auto] md:items-end md:justify-between">
          <p className="hero-lede text-lg leading-relaxed text-(--ink-soft) sm:text-xl">
            {copy.lede}
          </p>
          <div className="hero-cta md:text-end">
            <div className="hero-actions flex flex-wrap items-center gap-3 md:justify-end">
              <a
                href="/app"
                className={`${buttonVariants({ variant: 'primary', size: 'lg' })} rounded-full! bg-(--ink)! px-6! text-(--paper)! hover:bg-(--shift)!`}
              >
                {copy.primary}
              </a>
              <a
                href="/docs"
                className={`${buttonVariants({ variant: 'outline', size: 'lg' })} rounded-full! border-(--ink)! bg-transparent! px-6! text-(--ink)! hover:bg-(--card)!`}
              >
                {copy.secondary}
              </a>
            </div>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={`${styles.mono} mt-5 inline-block text-xs text-(--ink-soft) underline decoration-(--rule) underline-offset-4 hover:text-(--ink) hover:decoration-(--ink)`}
            >
              {copy.source}
            </a>
          </div>
        </div>
      </div>

      <div className="hero-instrument mt-14 sm:mt-20">
        <DayScrubber />
      </div>
    </section>
  );
};

/**
 * Underlines the last two words with the two clocks' colours — the shift
 * above, the tickets beneath — echoing the two tracks of the instrument below.
 */
const TwoStrokes: React.FC<{ children: string }> = ({ children }) => {
  const words = children.split(' ');
  const head = words.slice(0, -2).join(' ');
  const tail = words.slice(-2).join(' ');
  return (
    <>
      {head && `${head} `}
      <span className="relative inline-block whitespace-nowrap">
        {tail}
        <span
          className="absolute inset-x-[0.04em] -bottom-[0.02em] h-[0.06em] rounded-full bg-(--shift)"
          aria-hidden="true"
        />
        <span
          className="absolute start-[0.04em] end-[38%] -bottom-[0.12em] h-[0.06em] rounded-full bg-(--ticket)"
          aria-hidden="true"
        />
      </span>
    </>
  );
};
