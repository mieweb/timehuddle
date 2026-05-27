import React, { useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@mieweb/ui';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronLeft, faChevronRight, faXmark } from '@fortawesome/free-solid-svg-icons';

interface ViewportOverlayProps {
  open: boolean;
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  onPrevious?: () => void;
  onNext?: () => void;
  canGoPrevious?: boolean;
  canGoNext?: boolean;
  ariaLabel?: string;
}

export const ViewportOverlay: React.FC<ViewportOverlayProps> = ({
  open,
  title,
  onClose,
  children,
  onPrevious,
  onNext,
  canGoPrevious = false,
  canGoNext = false,
  ariaLabel,
}) => {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabel ? undefined : titleId}
    >
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/50 backdrop-blur-[1px]"
      />

      <div className="absolute inset-[30px] flex min-h-0 flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900">
        <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-700">
          <h2
            id={titleId}
            className="min-w-0 truncate text-base font-semibold text-neutral-900 dark:text-neutral-50"
          >
            {title}
          </h2>

          <div className="flex items-center gap-1">
            {onPrevious && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0"
                onClick={onPrevious}
                disabled={!canGoPrevious}
                aria-label="Previous item"
              >
                <FontAwesomeIcon icon={faChevronLeft} />
              </Button>
            )}
            {onNext && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0"
                onClick={onNext}
                disabled={!canGoNext}
                aria-label="Next item"
              >
                <FontAwesomeIcon icon={faChevronRight} />
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={onClose}
              aria-label="Close overlay"
            >
              <FontAwesomeIcon icon={faXmark} />
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </div>,
    document.body,
  );
};
