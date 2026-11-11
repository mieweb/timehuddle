/**
 * AppPrompt — asks browser users to install the TimeHuddle iOS app, or offers
 * to open it when they already have it (#859). Which one, if any, is decided
 * by appPromptKind.ts.
 *
 * Shown each time the app is opened: it lives in AppLayout, which mounts once
 * per page load, so moving between pages doesn't bring it back and a reload
 * or new tab does. Dismissing it is deliberately not remembered.
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
import React, { useId, useState } from 'react';

import { APP_STORE_URL, openInAppUrl } from '../../lib/appLinks';
import { getMobileOS, isNativeApp, openExternalUrl } from '../../lib/device';
import { useSession } from '../../lib/useSession';
import { appPromptKind, type AppPromptKind } from './appPromptKind';

const COPY = {
  installTitle: 'Get TimeHuddle for iPhone',
  installBody: 'The app is on the App Store. Install it for a faster TimeHuddle on your phone.',
  installAction: 'Get the App',
  openTitle: 'Open in the TimeHuddle app',
  openBody: 'You have TimeHuddle on this iPhone. Pick up on this same page in the app.',
  openAction: 'Open in App',
  qrBody: 'Point your iPhone camera at the code to get TimeHuddle from the App Store.',
  qrAlt: 'QR code linking to TimeHuddle on the App Store',
  qrAction: 'Open App Store',
  dismiss: 'Not Now',
} as const;

/** Decided once per page load: the device can't change, and the prompt shouldn't swap mid-view. */
function useAppPromptKind(): AppPromptKind | null {
  const { user } = useSession();
  const [kind] = useState(() =>
    appPromptKind({
      isNativeApp: isNativeApp(),
      automated: typeof navigator !== 'undefined' && navigator.webdriver === true,
      mobileOS: getMobileOS(),
      hasIosApp: user?.hasIosApp ?? false,
    }),
  );
  return kind;
}

export const AppPrompt: React.FC = () => {
  const kind = useAppPromptKind();
  const { needsUsernameClaim } = useSession();
  const [open, setOpen] = useState(true);
  // A new social signup must pick a username first (main.tsx); don't stack a second dialog on it.
  if (!kind || !open || needsUsernameClaim) return null;

  const close = () => setOpen(false);
  return kind === 'install-desktop' ? (
    <InstallQrModal onClose={close} />
  ) : (
    <PhoneSheet kind={kind} onClose={close} />
  );
};

const AppIcon: React.FC<{ className: string }> = ({ className }) => (
  <img src="/logo.png" alt="" className={className} />
);

const PhoneSheet: React.FC<{ kind: 'install-phone' | 'open-in-app'; onClose: () => void }> = ({
  kind,
  onClose,
}) => {
  const descriptionId = useId();
  const { pathname, search } = useRouter();
  const install = kind === 'install-phone';

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
          {install ? COPY.installTitle : COPY.openTitle}
        </SheetTitle>
        <SheetDescription id={descriptionId} className="max-w-xs">
          {install ? COPY.installBody : COPY.openBody}
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
              void openExternalUrl(APP_STORE_URL);
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
      size="sm"
      onOpenChange={(isOpen) => !isOpen && onClose()}
      aria-describedby={descriptionId}
    >
      <ModalHeader>
        <ModalTitle>{COPY.installTitle}</ModalTitle>
        <ModalClose />
      </ModalHeader>
      <ModalBody className="app-prompt-qr flex flex-col items-center gap-4 py-6 text-center">
        <div className="app-prompt-qr-tile rounded-xl bg-white p-3.5">
          <QRCodeSVG
            value={APP_STORE_URL}
            size={176}
            role="img"
            aria-label={COPY.qrAlt}
            className="block"
          />
        </div>
        <p id={descriptionId} className="text-muted-foreground max-w-xs text-sm">
          {COPY.qrBody}
        </p>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          {COPY.dismiss}
        </Button>
        <Button
          variant="primary"
          leftIcon={<ExternalLinkIcon size={16} aria-hidden="true" />}
          onClick={() => {
            void openExternalUrl(APP_STORE_URL);
            onClose();
          }}
        >
          {COPY.qrAction}
        </Button>
      </ModalFooter>
    </AppModal>
  );
};
