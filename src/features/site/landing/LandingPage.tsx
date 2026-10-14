/**
 * LandingPage — the public home page at `/`.
 *
 * Built around the product's own idea rather than a template: a working day
 * has two clocks (the shift, and the ticket timers inside it), and TimeHuddle
 * records both. The hero lets a visitor drag through an example day; the next
 * section reads that same day top to bottom. Every claim is in `../copy.ts`.
 *
 * Light on purpose: no animation library, one variable font plus a mono, and
 * it loads as its own chunk so neither the app nor the site carries the other.
 */
import React, { useEffect } from 'react';

import { SiteFooter } from '../SiteFooter';
import { SiteHeader } from '../SiteHeader';
import styles from '../site.module.css';
import { DaySection } from './DaySection';
import { HeroSection } from './HeroSection';
import { OpenSourceSection } from './OpenSourceSection';
import { PlatformsSection } from './PlatformsSection';
import { RedmineSection } from './RedmineSection';
import { TeamSection } from './TeamSection';

export const LandingPage: React.FC = () => {
  useEffect(() => {
    document.title = 'TimeHuddle — open-source time tracking for teams';
  }, []);

  return (
    <div className={`${styles.site} landing-page min-h-dvh`}>
      <SiteHeader current="home" />
      <main id="main">
        <HeroSection />
        <DaySection />
        <RedmineSection />
        <TeamSection />
        <PlatformsSection />
        <OpenSourceSection />
      </main>
      <SiteFooter />
    </div>
  );
};
