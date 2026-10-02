import { cn } from '@mieweb/ui';
import React from 'react';

import pulseLogo from '../../../vendor/pulsevault/assets/pulse-logo.svg';

/**
 * The Pulse logo, from PulseVault's asset pack (vendor/pulsevault/assets).
 * Decorative: whatever it sits beside says "Pulse" in words.
 */
export const PulseLogo: React.FC<{ className?: string }> = ({ className }) => (
  <img src={pulseLogo} alt="" aria-hidden="true" className={cn('w-auto shrink-0', className)} />
);
