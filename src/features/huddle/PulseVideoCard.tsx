/**
 * PulseVideoCard — the `pulse_video` GenUI widget for the Huddle inbox (see
 * Huddle.tsx). The payload is validated by `pulseVideoSchema` before this
 * mounts and holds only artifact ids (see pulseVideoBlock.ts for why); the
 * card itself is the shared {@link PulseVideoPlayer}.
 */
import type { GenUIWidgetProps } from '@mieweb/ui/components/SuperChat';
import React from 'react';

import { PulseVideoPlayer } from '../pulse-upload/PulseVideoPlayer';
import type { PulseVideoProps } from './pulseVideoBlock';

export default function PulseVideoCard({ data }: GenUIWidgetProps<PulseVideoProps>) {
  return <PulseVideoPlayer video={data.video} poster={data.poster} />;
}
