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

import { APP_STORE_URL, PLAY_STORE_URL, openInAppUrl, storeUrlFor } from '../../lib/appLinks';
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
  qrBody: 'Point your phone camera at the code for your phone to get TimeHuddle.',
  dismiss: 'Not Now',
} as const;

/** The desktop modal's two QR codes, one per store. */
const QR_STORES = [
  {
    os: 'ios',
    label: 'iPhone',
    url: APP_STORE_URL,
    alt: 'QR code linking to TimeHuddle on the App Store',
    action: 'Open App Store',
  },
  {
    os: 'android',
    label: 'Android',
    url: PLAY_STORE_URL,
    alt: 'QR code linking to TimeHuddle on Google Play',
    action: 'Open Google Play',
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
        {install ? (
          <Button
            variant="primary"
            size="lg"
            fullWidth
            leftIcon={<DownloadIcon size={18} aria-hidden="true" />}
            onClick={() => {
              void openExternalUrl(storeUrlFor(os));
              onClose();
            }}
          >
            {COPY.installAction}
          </Button>
        ) : (
          // A real link: a custom-scheme URL only opens the app when it's navigated to.
          <a
            href={openInAppUrl(`${pathname}${search}`)}
            onClick={onClose}
            className={buttonVariants({ variant: 'primary', size: 'lg', fullWidth: true })}
          >
            <ExternalLinkIcon size={18} aria-hidden="true" />
            {COPY.openAction}
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
      size="md"
      onOpenChange={(isOpen) => !isOpen && onClose()}
      aria-describedby={descriptionId}
    >
      <ModalHeader>
        <ModalTitle>{COPY.qrTitle}</ModalTitle>
        <ModalClose />
      </ModalHeader>
      <ModalBody className="app-prompt-qr flex flex-col items-center gap-4 py-6 text-center">
        <p id={descriptionId} className="text-muted-foreground max-w-xs text-sm">
          {COPY.qrBody}
        </p>
        <ul className="app-prompt-qr-stores flex flex-wrap justify-center gap-6">
          {QR_STORES.map((store) => (
            <li key={store.os} className="app-prompt-qr-store flex flex-col items-center gap-2">
              <span className="text-sm font-semibold">{store.label}</span>
              <div className="app-prompt-qr-tile rounded-xl bg-white p-3">
                <QRCodeSVG
                  value={store.url}
                  size={140}
                  role="img"
                  aria-label={store.alt}
                  className="block"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                leftIcon={<ExternalLinkIcon size={14} aria-hidden="true" />}
                onClick={() => {
                  void openExternalUrl(store.url);
                  onClose();
                }}
              >
                {store.action}
              </Button>
            </li>
          ))}
        </ul>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          {COPY.dismiss}
        </Button>
      </ModalFooter>
    </AppModal>
  );
};
