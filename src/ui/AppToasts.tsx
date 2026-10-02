/**
 * Renders the toasts held by `@mieweb/ui`'s `ToastProvider`.
 *
 * Replaces the library's `ToastContainer` rather than wrapping it, because that
 * container cannot give us three things the app needs: an exit animation (it
 * removes a toast instantly), swipe-to-dismiss on touch screens, and a neutral
 * surface (its colours are fixed per variant, `info` in the brand accent). Each
 * toast is still the library's own `Toast`; only the container and the motion
 * around it are ours.
 *
 * - **Enter / exit:** a short fade and lift, skipped for users who ask for
 *   reduced motion.
 * - **Dismiss:** the ×, the timeout, or a horizontal swipe in either direction.
 * - **Placement:** bottom-centre above the mobile tab bar, bottom-end from `md` up.
 */
import { Toast, useToast } from '@mieweb/ui';
import { AnimatePresence, MotionConfig, motion, type PanInfo } from 'motion/react';
import React from 'react';

/** How far, or how fast, a swipe must go before it dismisses. */
const SWIPE_DISTANCE_PX = 80;
const SWIPE_VELOCITY_PX_S = 500;

/**
 * Neutral surface for every variant. The library's `Toast` takes no className,
 * so its variant colours are overridden through its `data-slot` hooks. Its own
 * slide-in and the app-wide background-colour transition are switched off too:
 * together they made the toast flash in from transparent.
 */
const NEUTRAL_TOAST_CLASS = [
  '[&_[data-slot=toast]]:bg-card!',
  '[&_[data-slot=toast]]:text-card-foreground!',
  '[&_[data-slot=toast]]:border-border!',
  '[&_[data-slot=toast]]:animate-none!',
  '[&_[data-slot=toast]]:transition-none!',
  '[&_[data-slot=toast]]:min-w-0!',
  'md:[&_[data-slot=toast]]:min-w-[300px]!',
  '[&_[data-slot=toast-icon]]:text-muted-foreground!',
].join(' ');

const isSwipeAway = (info: PanInfo) =>
  Math.abs(info.offset.x) > SWIPE_DISTANCE_PX || Math.abs(info.velocity.x) > SWIPE_VELOCITY_PX_S;

export const AppToasts: React.FC = () => {
  const { toasts, dismiss } = useToast();

  return (
    <MotionConfig reducedMotion="user">
      <div
        className="app-toasts pointer-events-none fixed inset-x-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 md:inset-x-auto md:bottom-4 md:end-4 md:items-end"
        aria-live="polite"
      >
        <AnimatePresence initial={false}>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              layout
              className={`app-toast pointer-events-auto w-full touch-pan-y md:w-auto ${NEUTRAL_TOAST_CLASS}`}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8, transition: { duration: 0.15, ease: 'easeIn' } }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.7}
              onDragEnd={(_, info) => {
                if (isSwipeAway(info)) dismiss(toast.id);
              }}
            >
              <Toast {...toast} onClose={() => dismiss(toast.id)} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
};
