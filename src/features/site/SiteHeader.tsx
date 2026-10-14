import { buttonVariants } from '@mieweb/ui';
import React, { useEffect, useState } from 'react';

import { REPO_URL } from '../../lib/constants';
import { Logo } from '../../ui/Logo';
import { SITE_COPY } from './copy';

/** Which top-level page is showing, so its nav link reads as current. */
type SiteSection = 'home' | 'docs';

/**
 * The public site's header — shared by the landing page and the docs, so the
 * two read as one site. Gains a rule once the page scrolls.
 */
export const SiteHeader: React.FC<{ current: SiteSection }> = ({ current }) => {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const { nav } = SITE_COPY;
  const link =
    'site-nav-link rounded-md px-2.5 py-1.5 text-sm text-(--ink-soft) transition-colors hover:text-(--ink) focus-visible:outline-2 focus-visible:outline-(--shift)';

  return (
    <header
      className={`site-header sticky top-0 z-30 transition-[background-color,border-color] duration-300 ${
        scrolled
          ? 'border-b border-(--rule) bg-(--paper)/90 backdrop-blur-sm'
          : 'border-b border-transparent'
      }`}
    >
      <div className="site-header-inner mx-auto flex max-w-[88rem] items-center justify-between gap-4 px-4 py-3 sm:px-8">
        <a
          href="/"
          className="site-brand flex items-center gap-2.5 rounded-md focus-visible:outline-2 focus-visible:outline-(--shift)"
          aria-label={nav.homeLabel}
        >
          <Logo size={28} className="rounded-md shadow-none" />
          <span className="text-[0.95rem] font-semibold tracking-tight">TimeHuddle</span>
        </a>

        <nav aria-label={nav.label} className="site-nav flex items-center gap-1">
          <span className="site-nav-sections hidden items-center gap-1 md:flex">
            <a href="/#day" className={link}>
              {nav.product}
            </a>
            <a href="/#redmine" className={link}>
              {nav.redmine}
            </a>
          </span>
          <a href="/docs" className={link} aria-current={current === 'docs' ? 'page' : undefined}>
            {nav.docs}
          </a>
          <a href="/release-notes" className={`${link} hidden sm:inline-block`}>
            {nav.releaseNotes}
          </a>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={`${link} hidden sm:inline-block`}
          >
            {nav.github}
          </a>
          {/* A real anchor in the library's button styling — Button renders a
              <button> and cannot carry an href. */}
          <a
            href="/app"
            className={`${buttonVariants({ variant: 'primary', size: 'sm' })} ms-1 rounded-full! bg-(--ink)! text-(--paper)! hover:bg-(--shift)!`}
          >
            {nav.signIn}
          </a>
        </nav>
      </div>
    </header>
  );
};
