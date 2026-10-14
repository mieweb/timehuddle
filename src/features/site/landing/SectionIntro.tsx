import React from 'react';

import styles from '../site.module.css';

/** Eyebrow, heading and lead — the same opening for every landing section. */
export const SectionIntro: React.FC<{
  id: string;
  eyebrow: string;
  title: string;
  body?: string;
}> = ({ id, eyebrow, title, body }) => (
  <div className="section-intro">
    <p className={`${styles.mono} text-xs tracking-[0.14em] text-(--ink-soft) uppercase`}>
      {eyebrow}
    </p>
    <h2
      id={id}
      className="mt-4 text-[clamp(2.25rem,4.6vw,4rem)] leading-[0.95] font-semibold tracking-[-0.04em] text-balance"
    >
      {title}
    </h2>
    {body && <p className="mt-5 max-w-md text-lg leading-relaxed text-(--ink-soft)">{body}</p>}
  </div>
);
