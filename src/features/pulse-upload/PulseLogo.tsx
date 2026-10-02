import { cn } from '@mieweb/ui';
import React from 'react';

import pulseLogoMono from '../../../vendor/pulsevault/assets/pulse-logo-mono.svg';
import pulseLogo from '../../../vendor/pulsevault/assets/pulse-logo.svg';

interface PulseLogoProps {
  className?: string;
  /** White, for a filled button; otherwise the full-colour logo. */
  inverse?: boolean;
}

/**
 * The Pulse logo, from PulseVault's asset pack (vendor/pulsevault/assets).
 * Decorative: whatever it sits beside says "Pulse" in words.
 */
export const PulseLogo: React.FC<PulseLogoProps> = ({ className, inverse }) => (
  <img
    src={inverse ? pulseLogoMono : pulseLogo}
    alt=""
    aria-hidden="true"
    // The mono file draws in black as an <img>; `invert` makes it white.
    className={cn('w-auto shrink-0', inverse && 'invert', className)}
  />
);
