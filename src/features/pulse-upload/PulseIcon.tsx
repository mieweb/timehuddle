import { cn } from '@mieweb/ui';
import React from 'react';

import pulseIconWhite from '@mieweb/pulsevault/assets/pulse-icon-white.svg';
import pulseIcon from '@mieweb/pulsevault/assets/pulse-icon.svg';

interface PulseIconProps {
  /** Its height (`h-5`); it is square, so the width follows. */
  className?: string;
  /** The white one, for a filled (red) button. */
  white?: boolean;
}

/**
 * The Pulse icon, from PulseVault's asset pack (`@mieweb/pulsevault/assets`):
 * the Pulse logo in a square, so it lines up with the icons beside it.
 * Decorative: whatever it sits beside says "Pulse" in words.
 */
export const PulseIcon: React.FC<PulseIconProps> = ({ className, white }) => (
  <img
    src={white ? pulseIconWhite : pulseIcon}
    alt=""
    aria-hidden="true"
    className={cn('aspect-square w-auto shrink-0', className)}
  />
);
