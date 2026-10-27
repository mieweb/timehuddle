import { cn } from '@mieweb/ui';
import React from 'react';

import pulseLogoMono from '@mieweb/pulsevault/assets/pulse-logo-mono.svg';
import pulseLogo from '@mieweb/pulsevault/assets/pulse-logo.svg';

interface PulseLogoProps {
  className?: string;
  /** The one-colour mark in white, for the logo on a filled (red) button. */
  inverse?: boolean;
}

/**
 * The Pulse logo, from PulseVault's asset pack (`@mieweb/pulsevault/assets`).
 * Decorative: whatever it sits beside says "Pulse" in words.
 */
export const PulseLogo: React.FC<PulseLogoProps> = ({ className, inverse }) => (
  <img
    src={inverse ? pulseLogoMono : pulseLogo}
    alt=""
    aria-hidden="true"
    className={cn('w-auto shrink-0', inverse && 'invert', className)}
  />
);
