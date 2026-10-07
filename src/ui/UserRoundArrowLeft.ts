/**
 * Lucide's `user-round-arrow-left` icon.
 *
 * Built here from Lucide's own drawing because the installed `lucide-react`
 * (0.562) predates it. Made with Lucide's `createLucideIcon`, so it takes the
 * same props and renders the same as an imported icon. Delete this file and
 * import the icon from `lucide-react` once the app is on a version that has it.
 */
import { createLucideIcon } from 'lucide-react';

export const UserRoundArrowLeft = createLucideIcon('user-round-arrow-left', [
  ['path', { d: 'm19 16-3 3', key: 'arrow-head-top' }],
  ['path', { d: 'M2 21a8 8 0 0 1 12.664-6.5', key: 'shoulders' }],
  ['path', { d: 'M22 19h-6l3 3', key: 'arrow' }],
  ['circle', { cx: '10', cy: '8', r: '5', key: 'head' }],
]);
