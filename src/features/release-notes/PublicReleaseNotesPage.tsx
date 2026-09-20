/**
 * PublicReleaseNotesPage — the release notes at `/release-notes`, no account
 * needed.
 *
 * Mounted directly by `main.tsx` rather than through `AppLayout`, the same way
 * the landing page and the dev inbox are: everything under `/app` assumes a
 * session, and someone who has not signed up yet should still be able to read
 * what the product does lately. It is reachable from the landing page's nav.
 *
 * Nothing here is personalised — there is no one to personalise for — so no
 * release carries a "New" flag. Signed-in readers get that at
 * `/app/release-notes` instead.
 */
import { faArrowLeft } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { buttonVariants, Text } from '@mieweb/ui';
import React from 'react';

import { Logo } from '../../ui/Logo';
import { ThemeToggle } from '../../ui/ThemeToggle';
import { releaseNotes } from './notes';
import { ReleaseNotesList } from './ReleaseNotesList';

export const PublicReleaseNotesPage: React.FC = () => (
  <div className="release-notes-public min-h-dvh bg-neutral-50 dark:bg-neutral-950">
    <header className="release-notes-public-header sticky top-0 z-10 border-b border-neutral-200 bg-white/90 backdrop-blur-md dark:border-neutral-800 dark:bg-neutral-950/90">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-6 py-3">
        <a
          href="/"
          className="flex items-center gap-2.5 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500/40"
        >
          <Logo size={28} className="rounded-md" />
          <span className="text-sm font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
            TimeHuddle
          </span>
        </a>

        <nav aria-label="Release notes navigation" className="flex items-center gap-2">
          <ThemeToggle />
          {/* Real anchors, styled with the library's own button classes —
              Button renders a <button> and cannot carry an href. */}
          <a href="/" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            <FontAwesomeIcon icon={faArrowLeft} className="me-2" aria-hidden="true" />
            Back to home
          </a>
          <a href="/app" className={buttonVariants({ variant: 'primary', size: 'sm' })}>
            Sign in
          </a>
        </nav>
      </div>
    </header>

    <main className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
        What&rsquo;s New
      </h1>
      <Text as="p" variant="muted" size="sm" className="mb-6">
        What has changed in TimeHuddle, newest first.
      </Text>

      <ReleaseNotesList notes={releaseNotes} />
    </main>
  </div>
);
