/**
 * AppPrompt — a one-line strip under the navbar on the dashboard that tells
 * browser users TimeHuddle has a phone app, or offers to open it when they
 * already have it (#859). Which one, if any, is decided by appPromptKind.ts.
 *
 * Download does what fits the device: on a laptop it opens a QR code to
 * scan with a phone; on an iPhone it goes to the App Store; on Android it
 * opens the app when it's installed and Google Play when it isn't.
 *
 * Shown once per browser tab: the first time the dashboard renders in a tab,
 * and a session-storage flag keeps reloads and coming back to the dashboard
 * from bringing it back. A new tab or window shows it again.
 */
import {
  Button,
  DownloadIcon,
  ExternalLinkIcon,
  ModalBody,
  ModalClose,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  XIcon,
  buttonVariants,
} from '@mieweb/ui';
import { AppModal } from '@ui/AppModal';
import { useRouter } from '@ui/router';
import { QRCodeSVG } from 'qrcode.react';
import React, { useEffect, useId, useState } from 'react';

import {
  APP_STORE_URL,
  PLAY_STORE_URL,
  androidAppLink,
  getAppUrl,
  openInAppUrl,
  storeUrlFor,
} from '../../lib/appLinks';
import { getMobileOS, isNativeApp, openExternalUrl, type MobileOS } from '../../lib/device';
import { useSession } from '../../lib/useSession';
import { appPromptKind, type AppPromptKind } from './appPromptKind';

// Short enough to stay on one line beside the button on a phone.
const COPY = {
  installText: 'TimeHuddle is on mobile.',
  installAction: 'Download',
  openText: 'Continue in the app.',
  openAction: 'Open in App',
  stripLabel: 'TimeHuddle mobile app',
  dismissLabel: 'Dismiss',
  qrTitle: 'Get TimeHuddle for your phone',
  qrBody: 'Scan with your iPhone or Android camera to open your app store.',
  qrAlt: 'QR code to get the TimeHuddle app for iPhone or Android',
  storesLabel: 'App stores',
  close: 'Close',
} as const;

/**
 * The official store badges under the QR code. Apple's is its SVG as
 * published; Google's PNG is cropped to the badge, without its transparent
 * margin, so both render at the same height.
 */
const STORE_BADGES = [
  {
    store: 'App Store',
    url: APP_STORE_URL,
    src: '/store-badges/app-store.svg',
    alt: 'Download on the App Store',
  },
  {
    store: 'Google Play',
    url: PLAY_STORE_URL,
    src: '/store-badges/google-play.png',
    alt: 'Get it on Google Play',
  },
] as const;

const SHOWN_KEY = 'timehuddle.appPromptShown';

/**
 * Also kept in memory: session storage can throw (private mode, blocked
 * storage), and without this, coming back to the dashboard would show the
 * strip again. Memory lasts until the page reloads, storage for the tab.
 */
let shownThisPageLoad = false;

function wasShownThisSession(): boolean {
  if (shownThisPageLoad) return true;
  try {
    return sessionStorage.getItem(SHOWN_KEY) === '1';
  } catch {
    return false;
  }
}

function markShownThisSession(): void {
  shownThisPageLoad = true;
  try {
    sessionStorage.setItem(SHOWN_KEY, '1');
  } catch {
    // Memory still covers this page load; a reload shows it again.
  }
}

/** Decided once per mount: the device can't change, and the card shouldn't swap mid-view. */
function useAppPrompt(): { kind: AppPromptKind | null; mobileOS: MobileOS | null } {
  const { user } = useSession();
  const [prompt] = useState(() => {
    const mobileOS = getMobileOS();
    const kind = wasShownThisSession()
      ? null
      : appPromptKind({
          isNativeApp: isNativeApp(),
          automated: typeof navigator !== 'undefined' && navigator.webdriver === true,
          mobileOS,
          hasIosApp: user?.hasIosApp ?? false,
          hasAndroidApp: user?.hasAndroidApp ?? false,
        });
    return { kind, mobileOS };
  });
  return prompt;
}

export const AppPrompt: React.FC = () => {
  const { kind, mobileOS } = useAppPrompt();
  const { needsUsernameClaim } = useSession();
  const [dismissed, setDismissed] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  // A new social signup must pick a username first (main.tsx), in a popup over
  // the page; hold the strip, unmarked, until that's done.
  const visible = Boolean(kind) && !dismissed && !needsUsernameClaim;
  useEffect(() => {
    if (visible) markShownThisSession();
  }, [visible]);
  if (!kind || !visible) return null;

  const install = kind !== 'open-in-app';
  return (
    <>
      <section
        aria-label={COPY.stripLabel}
        className="app-prompt-strip flex shrink-0 items-center gap-2 border-b border-primary-200 bg-primary-50 py-1.5 ps-4 pe-2 text-primary-900 dark:border-primary-800 dark:bg-primary-950 dark:text-primary-100"
      >
        {/* Polite status, like WhatsNewBanner: the strip can appear after in-app
            navigation, with focus still on the nav, so screen readers hear it. */}
        <p role="status" className="app-prompt-strip-text min-w-0 flex-1 truncate text-sm">
          {install ? COPY.installText : COPY.openText}
        </p>
        <AppPromptAction kind={kind} os={mobileOS} onShowQr={() => setQrOpen(true)} />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={COPY.dismissLabel}
          onClick={() => setDismissed(true)}
          className="app-prompt-strip-dismiss shrink-0"
        >
          <XIcon size={16} aria-hidden="true" />
        </Button>
      </section>
      {qrOpen && <InstallQrModal onClose={() => setQrOpen(false)} />}
    </>
  );
};

/** The strip's button: whatever gets this device to the app in one step. */
const AppPromptAction: React.FC<{
  kind: AppPromptKind;
  os: MobileOS | null;
  onShowQr: () => void;
}> = ({ kind, os, onShowQr }) => {
  const { pathname, search } = useRouter();
  const route = `${pathname}${search}`;
  const install = kind !== 'open-in-app';
  const label = install ? COPY.installAction : COPY.openAction;
  // The icon is dropped on narrow phones so the strip stays on one line.
  const icon = install ? (
    <DownloadIcon size={14} aria-hidden="true" className="hidden sm:block" />
  ) : (
    <ExternalLinkIcon size={14} aria-hidden="true" className="hidden sm:block" />
  );

  if (kind === 'install-desktop' || !os) {
    return (
      <Button variant="primary" size="sm" className="shrink-0" leftIcon={icon} onClick={onShowQr}>
        {label}
      </Button>
    );
  }
  // Download goes straight to the store. Not the Android intent link: browsers
  // other than Chrome and Samsung Internet may ignore `intent://`, which would
  // leave the button doing nothing.
  if (install) {
    return (
      <Button
        variant="primary"
        size="sm"
        className="shrink-0"
        leftIcon={icon}
        onClick={() => void openExternalUrl(storeUrlFor(os))}
      >
        {label}
      </Button>
    );
  }
  // A real link: an app link only opens the app when it's navigated to. On
  // Android the intent link falls back to Google Play if the app is gone.
  return (
    <a
      href={os === 'android' ? androidAppLink(route) : openInAppUrl(route)}
      className={buttonVariants({ variant: 'primary', size: 'sm', className: 'shrink-0' })}
    >
      {icon}
      {label}
    </a>
  );
};

const InstallQrModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const descriptionId = useId();
  return (
    <AppModal
      open
      size="sm"
      onOpenChange={(isOpen) => !isOpen && onClose()}
      aria-describedby={descriptionId}
    >
      <ModalHeader>
        <ModalTitle>{COPY.qrTitle}</ModalTitle>
        <ModalClose />
      </ModalHeader>
      {/* Sized to the window so the whole popup fits without scrolling, down to
          a phone held sideways: the code shrinks with the height, and short
          screens get tighter spacing, smaller badges and no footer (the ✕ in the
          header still closes it). */}
      <ModalBody className="app-prompt-qr flex flex-col items-center gap-4 py-6 text-center [@media(max-height:520px)]:gap-2 [@media(max-height:520px)]:py-3">
        {/* One code for both phones: the backend's /get-app redirects each to its store. */}
        <div className="app-prompt-qr-tile rounded-xl bg-white">
          <QRCodeSVG
            value={getAppUrl()}
            size={176}
            marginSize={4}
            role="img"
            aria-label={COPY.qrAlt}
            className="block h-auto w-[min(176px,30dvh)] min-w-24"
          />
        </div>
        <p
          id={descriptionId}
          className="text-muted-foreground max-w-xs text-sm [@media(max-height:520px)]:text-xs"
        >
          {COPY.qrBody}
        </p>
        <nav
          aria-label={COPY.storesLabel}
          className="app-prompt-store-badges flex flex-wrap justify-center gap-3 [@media(max-height:520px)]:gap-2"
        >
          {STORE_BADGES.map((badge) => (
            <a
              key={badge.store}
              href={badge.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg focus-visible:ring-2 focus-visible:ring-orange-500/60 focus-visible:outline-none"
            >
              <img
                src={badge.src}
                alt={badge.alt}
                className="block h-10 w-auto [@media(max-height:520px)]:h-8"
              />
            </a>
          ))}
        </nav>
      </ModalBody>
      <ModalFooter className="[@media(max-height:520px)]:hidden">
        <Button variant="secondary" onClick={onClose}>
          {COPY.close}
        </Button>
      </ModalFooter>
    </AppModal>
  );
};
