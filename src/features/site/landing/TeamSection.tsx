import React from 'react';

import { SITE_COPY } from '../copy';
import { guidePath } from '../docs/docsRoute';
import { useReveal } from '../useReveal';
import { SectionIntro } from './SectionIntro';

/** What admins get: read as a ruled list, the way a policy reads. */
export const TeamSection: React.FC = () => {
  const copy = SITE_COPY.team;
  return (
    <section
      aria-labelledby="team-heading"
      className="team-section border-t border-(--rule) bg-(--paper-deep)/40"
    >
      <div className="mx-auto grid max-w-[88rem] gap-12 px-4 py-20 sm:px-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-20 lg:py-32">
        <div>
          <SectionIntro id="team-heading" eyebrow={copy.eyebrow} title={copy.title} />
          <a
            href={guidePath('teams')}
            className="mt-8 inline-block font-medium underline decoration-(--shift) decoration-2 underline-offset-[6px]"
          >
            {copy.link}
          </a>
        </div>
        <ul className="team-list border-t border-(--ink)">
          {copy.items.map((item) => (
            <TeamItem key={item.title} title={item.title} body={item.body} />
          ))}
        </ul>
      </div>
    </section>
  );
};

const TeamItem: React.FC<{ title: string; body: string }> = ({ title, body }) => {
  const reveal = useReveal<HTMLLIElement>();
  return (
    <li
      ref={reveal.ref}
      className={`${reveal.className} team-item grid gap-2 border-b border-(--rule) py-7 md:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] md:gap-10`}
    >
      <h3 className="text-xl font-semibold tracking-tight">{title}</h3>
      <p className="leading-relaxed text-(--ink-soft)">{body}</p>
    </li>
  );
};
