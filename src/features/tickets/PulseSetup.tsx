/**
 * PulseSetup — "Connect Pulse Cam" settings card.
 *
 * Shows a QR code + deep link button that saves TimeHuddle as an upload
 * destination inside the Pulse Cam mobile app.  Once configured, users can
 * scan the per-ticket QR codes and upload directly to this backend.
 */
import { faCamera, faQrcode } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, Text } from '@mieweb/ui';
import { Capacitor } from '@capacitor/core';
import { QRCodeSVG } from 'qrcode.react';
import React from 'react';

import { TIMECORE_BASE_URL } from '../../lib/api';
import { pulseServerBase } from './VideoUploadButton';

function buildConfigureLink(): string {
  const params = new URLSearchParams({
    mode: 'configure_destination',
    server: pulseServerBase(),
    name: 'TimeHuddle',
  });
  return `pulsecam://?${params.toString()}`;
}

export const PulseSetup: React.FC = () => {
  const isNative = Capacitor.isNativePlatform();
  const deepLink = buildConfigureLink();
  const serverBase = `${TIMECORE_BASE_URL.replace(/\/$/, '')}/v1/video`;

  const handleOpen = () => {
    window.open(deepLink, '_system');
  };

  return (
    <div className="pulse-setup flex flex-col gap-4 px-5 py-4">
      <Text size="sm" className="text-muted-foreground">
        Scan with your phone camera or tap{' '}
        <strong className="text-foreground">Open in Pulse App</strong> to add{' '}
        <strong className="text-foreground">TimeHuddle</strong> as an upload server. After
        configuring, scan any ticket&apos;s upload QR to record and upload directly.
      </Text>

      {!isNative && (
        <div className="pulse-setup-qr flex justify-center">
          <div className="rounded-lg border border-border bg-white p-4">
            <QRCodeSVG
              value={deepLink}
              size={180}
              aria-label="QR code to configure Pulse Cam with TimeHuddle"
            />
          </div>
        </div>
      )}

      <Button
        variant="primary"
        size="sm"
        leftIcon={<FontAwesomeIcon icon={faCamera} />}
        onClick={handleOpen}
        aria-label="Open Pulse Cam to configure TimeHuddle as the upload server"
      >
        Open in Pulse App
      </Button>

      <div className="pulse-setup-meta flex flex-col gap-1">
        <Text size="xs" className="text-muted-foreground">
          Server URL
        </Text>
        <code className="rounded bg-muted px-2 py-1 text-xs text-foreground break-all">
          {serverBase}
        </code>
        <Text size="xs" className="text-muted-foreground">
          Deep link
        </Text>
        <code className="rounded bg-muted px-2 py-1 text-xs text-foreground break-all">
          {deepLink}
        </code>
      </div>

      <div className="pulse-setup-hint flex items-start gap-2">
        <FontAwesomeIcon icon={faQrcode} className="mt-0.5 shrink-0 text-muted-foreground" />
        <Text size="xs" className="text-muted-foreground">
          After saving the server, go to a ticket and tap{' '}
          <strong className="text-foreground">Upload Video</strong> to get a per-ticket QR code.
        </Text>
      </div>
    </div>
  );
};
