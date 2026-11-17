/**
 * AppPrompt — asks browser users to install the TimeHuddle app (App Store or
 * Google Play), or offers
 * to open it when they already have it (#859). Which one, if any, is decided
 * by appPromptKind.ts.
 *
 * Shown once per browser tab: the first time TimeHuddle opens in a tab it
 * shows, and a session-storage flag keeps reloads and in-app navigation from
 * bringing it back. A new tab or window shows it again.
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
  Sheet,
  SheetClose,
  SheetDescription,
  SheetFooter,
  SheetTitle,
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
} from '../../lib/appLinks';
import { getMobileOS, isNativeApp, openExternalUrl, type MobileOS } from '../../lib/device';
import { useSession } from '../../lib/useSession';
import { appPromptKind, type AppPromptKind } from './appPromptKind';

/** Phone-sheet copy that names the person's platform and its store. */
const PHONE_COPY: Record<
  MobileOS,
  { installTitle: string; installBody: string; openBody: string }
> = {
  ios: {
    installTitle: 'Get TimeHuddle for iPhone',
    installBody: 'The app is on the App Store. Install it for a faster TimeHuddle on your phone.',
    openBody: 'You have TimeHuddle on this iPhone. Pick up on this same page in the app.',
  },
  android: {
    installTitle: 'Get TimeHuddle for Android',
    installBody: 'The app is on Google Play. Install it for a faster TimeHuddle on your phone.',
    openBody: 'You have TimeHuddle on this phone. Pick up on this same page in the app.',
  },
};

const COPY = {
  installAction: 'Get the App',
  openTitle: 'Open in the TimeHuddle app',
  openAction: 'Open in App',
  qrTitle: 'Get TimeHuddle for your phone',
  qrBody: 'Scan with your iPhone or Android camera to open your app store.',
  qrAlt: 'QR code to get the TimeHuddle app for iPhone or Android',
  storesLabel: 'App stores',
  dismiss: 'Not Now',
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

/** Session storage can throw (private mode, blocked storage); treat that as "not shown yet". */
function wasShownThisSession(): boolean {
  try {
    return sessionStorage.getItem(SHOWN_KEY) === '1';
  } catch {
    return false;
  }
}

function markShownThisSession(): void {
  try {
    sessionStorage.setItem(SHOWN_KEY, '1');
  } catch {
    // Without storage it simply shows again on the next load.
  }
}

/** Decided once per page load: the device can't change, and the prompt shouldn't swap mid-view. */
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
  const [open, setOpen] = useState(true);
  // A new social signup must pick a username first (main.tsx); don't stack a second dialog on it.
  const visible = Boolean(kind) && open && !needsUsernameClaim;
  useEffect(() => {
    if (visible) markShownThisSession();
  }, [visible]);
  if (!kind || !visible) return null;

  const close = () => setOpen(false);
  if (kind === 'install-desktop' || !mobileOS) return <InstallQrModal onClose={close} />;
  return <PhoneSheet kind={kind} os={mobileOS} onClose={close} />;
};

const AppIcon: React.FC<{ className: string }> = ({ className }) => (
  <img src="/logo.png" alt="" className={className} />
);

const PhoneSheet: React.FC<{
  kind: 'install-phone' | 'open-in-app';
  os: MobileOS;
  onClose: () => void;
}> = ({ kind, os, onClose }) => {
  const descriptionId = useId();
  const { pathname, search } = useRouter();
  const install = kind === 'install-phone';
  const copy = PHONE_COPY[os];
  const route = `${pathname}${search}`;

  return (
    <Sheet
      open
      side="bottom"
      onOpenChange={(isOpen) => !isOpen && onClose()}
      aria-describedby={descriptionId}
      className="app-prompt-sheet gap-0 rounded-t-3xl pb-[env(safe-area-inset-bottom)]"
    >
      <div className="app-prompt-header relative flex flex-col items-center gap-3 px-6 pt-8 pb-6 text-center">
        <SheetClose className="absolute top-3 right-3 flex h-11 w-11 items-center justify-center" />
        <AppIcon className="h-[72px] w-[72px] rounded-2xl shadow-md" />
        <SheetTitle className="text-xl leading-tight font-extrabold">
          {install ? copy.installTitle : COPY.openTitle}
        </SheetTitle>
        <SheetDescription id={descriptionId} className="max-w-xs">
          {install ? copy.installBody : copy.openBody}
        </SheetDescription>
      </div>
      <SheetFooter className="app-prompt-actions flex-col gap-2 sm:flex-col">
        {install && os === 'ios' ? (
          <Button
            variant="primary"
            size="lg"
            fullWidth
            leftIcon={<DownloadIcon size={18} aria-hidden="true" />}
            onClick={() => {
              void openExternalUrl(APP_STORE_URL);
              onClose();
            }}
          >
            {COPY.installAction}
          </Button>
        ) : (
          // A real link: an app link only opens the app when it's navigated to.
          // On Android it opens the app when installed and Google Play when not,
          // so Get the App never strands someone who already has it.
          <a
            href={os === 'android' ? androidAppLink(route) : openInAppUrl(route)}
            onClick={onClose}
            className={buttonVariants({ variant: 'primary', size: 'lg', fullWidth: true })}
          >
            {install ? (
              <DownloadIcon size={18} aria-hidden="true" />
            ) : (
              <ExternalLinkIcon size={18} aria-hidden="true" />
            )}
            {install ? COPY.installAction : COPY.openAction}
          </a>
        )}
        <Button variant="secondary" size="lg" fullWidth onClick={onClose}>
          {COPY.dismiss}
        </Button>
      </SheetFooter>
    </Sheet>
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
      <ModalBody className="app-prompt-qr flex flex-col items-center gap-4 py-6 text-center">
        {/* One code for both phones: the backend's /get-app redirects each to its store. */}
        <div className="app-prompt-qr-tile rounded-xl bg-white">
          <QRCodeSVG
            value={getAppUrl()}
            size={176}
            marginSize={4}
            role="img"
            aria-label={COPY.qrAlt}
            className="block"
          />
        </div>
        <p id={descriptionId} className="text-muted-foreground max-w-xs text-sm">
          {COPY.qrBody}
        </p>
        <nav aria-label={COPY.storesLabel} className="app-prompt-store-badges flex gap-3">
          {STORE_BADGES.map((badge) => (
            <a
              key={badge.store}
              href={badge.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg focus-visible:ring-2 focus-visible:ring-orange-500/60 focus-visible:outline-none"
            >
              <img src={badge.src} alt={badge.alt} className="block h-10 w-auto" />
            </a>
          ))}
        </nav>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          {COPY.dismiss}
        </Button>
      </ModalFooter>
    </AppModal>
  );
};
