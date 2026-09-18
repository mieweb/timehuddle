import { Avatar, cn } from '@mieweb/ui';
import type { AvatarColor } from './types';

/**
 * Tinted user avatar for huddle surfaces, on top of the @mieweb/ui `Avatar`.
 *
 * Two things ride in on `className` because the library component cannot
 * express them: it has no colour variant (only `size` and `ring`), and its size
 * scale is 32/40px where these surfaces are 28/36px. Keeping both here means
 * call sites stay declarative and the pinning lives in exactly one place.
 */
const COLOR_CLASSES: Record<AvatarColor, string> = {
  indigo: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-400',
  teal: 'bg-teal-100 text-teal-600 dark:bg-teal-950/50 dark:text-teal-400',
  coral: 'bg-red-100 text-red-500 dark:bg-red-950/50 dark:text-red-400',
  amber: 'bg-amber-100 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400',
  pink: 'bg-pink-100 text-pink-500 dark:bg-pink-950/50 dark:text-pink-400',
  green: 'bg-green-100 text-green-600 dark:bg-green-950/50 dark:text-green-400',
};

const SIZE_CLASSES = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-7 w-7 text-[10px]',
  md: 'h-9 w-9 text-[13px]',
} as const;

interface HuddleAvatarProps {
  /** Pre-computed initials — `getUserInitials` splits first/last, which differs
   *  from the library's own first-letter-per-word derivation. */
  initials: string;
  color: AvatarColor;
  src?: string | null;
  size?: keyof typeof SIZE_CLASSES;
  className?: string;
}

export function HuddleAvatar({ initials, color, src, size = 'md', className }: HuddleAvatarProps) {
  return (
    <Avatar
      src={src ?? undefined}
      alt={initials}
      fallback={<span>{initials}</span>}
      className={cn('shrink-0 font-semibold', SIZE_CLASSES[size], COLOR_CLASSES[color], className)}
    />
  );
}
