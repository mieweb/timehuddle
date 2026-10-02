import { cn, Text } from '@mieweb/ui';
import React from 'react';

import { PulseLogo } from './PulseLogo';

/** The "Powered by Pulse and PulseVault" mark, where Pulse is offered. */
export const PoweredByPulse: React.FC<{ className?: string }> = ({ className }) => (
  <Text
    as="span"
    size="xs"
    variant="muted"
    className={cn('powered-by-pulse inline-flex items-center gap-1.5', className)}
  >
    <PulseLogo className="h-3.5" />
    Powered by Pulse and PulseVault
  </Text>
);
