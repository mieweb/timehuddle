import React from 'react';

import appStoreBadge from '@mieweb/pulsevault/assets/badge-app-store.svg';
import googlePlayBadge from '@mieweb/pulsevault/assets/badge-google-play.png';
import { PULSE_STORE_URLS } from '../../lib/device';

/**
 * The App Store and Google Play badges, linking to Pulse's listings — from
 * PulseVault's asset pack, shown unaltered at one height as the badge
 * guidelines ask.
 */
export const PulseStoreBadges: React.FC = () => (
  <div className="pulse-store-badges flex items-center justify-center gap-2">
    <a href={PULSE_STORE_URLS.ios} target="_blank" rel="noopener noreferrer">
      <img src={appStoreBadge} alt="Download Pulse on the App Store" className="h-10 w-auto" />
    </a>
    <a href={PULSE_STORE_URLS.android} target="_blank" rel="noopener noreferrer">
      <img src={googlePlayBadge} alt="Get Pulse on Google Play" className="h-10 w-auto" />
    </a>
  </div>
);
