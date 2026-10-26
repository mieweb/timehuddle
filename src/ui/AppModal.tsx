import { Modal, cn, type ModalProps } from '@mieweb/ui';

/**
 * The library Modal is full-screen on mobile (`min-h-dvh`, `rounded-none`,
 * `max-h-dvh`, safe-area padding); TimeHuddle wants a centered popup at every
 * breakpoint. A popup keeps clear of the notch and home indicator by its
 * height cap instead, so the library's safe-area padding is dropped — inside a
 * popup it is just empty space above the title and below the buttons (seen in
 * the Capacitor app). Owning that here rather than in a global stylesheet
 * keeps the override off `[data-slot='modal']`, a library internal a future
 * upgrade could rename.
 *
 * Pass `max-sm:mx-0 max-sm:w-full` to opt out of the small-screen inset — the
 * org/team switcher does, because it is a full-width bottom sheet on mobile.
 */
export function AppModal({ className, ...props }: ModalProps) {
  return (
    <Modal
      {...props}
      className={cn(
        'max-h-[calc(100dvh_-_2rem_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] min-h-0 rounded-xl pt-0 pb-0',
        'max-sm:mx-4 max-sm:w-[calc(100%-2rem)]',
        className,
      )}
    />
  );
}
