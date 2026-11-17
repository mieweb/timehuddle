/**
 * GetAppPage — `/get-app`, the one link the laptop install popup's QR code
 * points at (#859).
 *
 * A phone never sees this page: main.tsx sends an iPhone, iPad or Android
 * phone straight on to its store before anything renders. Anything else (a
 * laptop, an unknown device) lands here and picks a store. Public, like the
 * landing page: whoever scans the code may not be signed in on that phone.
 */
import { DownloadIcon, Text, buttonVariants } from '@mieweb/ui';
import React from 'react';

import { APP_STORE_URL, PLAY_STORE_URL } from '../../lib/appLinks';
import { Logo } from '../../ui/Logo';

const COPY = {
  title: 'Get the TimeHuddle app',
  body: 'TimeHuddle is on the App Store for iPhone and iPad, and on Google Play for Android.',
  appStore: 'App Store',
  googlePlay: 'Google Play',
  storesLabel: 'App stores',
} as const;

const STORES = [
  { label: COPY.appStore, url: APP_STORE_URL },
  { label: COPY.googlePlay, url: PLAY_STORE_URL },
] as const;

export const GetAppPage: React.FC = () => (
  <main className="get-app-page flex min-h-dvh flex-col items-center justify-center gap-4 bg-neutral-50 px-6 text-center dark:bg-neutral-950">
    <Logo size={72} className="rounded-2xl shadow-md" />
    <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
      {COPY.title}
    </h1>
    <Text as="p" variant="muted" className="max-w-sm">
      {COPY.body}
    </Text>
    <nav
      aria-label={COPY.storesLabel}
      className="get-app-stores flex flex-wrap justify-center gap-3"
    >
      {STORES.map((store) => (
        <a
          key={store.url}
          href={store.url}
          className={buttonVariants({ variant: 'primary', size: 'lg' })}
        >
          <DownloadIcon size={18} aria-hidden="true" />
          {store.label}
        </a>
      ))}
    </nav>
  </main>
);
