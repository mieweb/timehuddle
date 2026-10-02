/**
 * OverflowTooltip — the full text of a truncated label, on hover or focus.
 *
 * Replaces `title="…"` on text cut off with an ellipsis. The browser's native
 * tooltip waits about a second and cannot be styled; `@mieweb/ui`'s `Tooltip`
 * opens after 200 ms. It only opens while the text is actually cut off, so
 * moving the mouse down a table does not flash a tooltip for every row.
 *
 * `Tooltip` wraps its trigger in an `inline-flex` div that sizes to its content,
 * which would stop the trigger's `truncate` from ever kicking in. The wrapper
 * here caps that div at the available width, so the child must be able to
 * shrink (`min-w-0`) and carry its own `truncate`.
 */
import { Tooltip } from '@mieweb/ui';
import React, { useLayoutEffect, useRef, useState } from 'react';

interface OverflowTooltipProps {
  /** The full text, shown when the child is cut off. */
  content: string;
  /** One element that truncates its own text. */
  children: React.ReactElement<{
    onFocus?: () => void;
    onBlur?: () => void;
    'aria-describedby'?: string;
  }>;
  className?: string;
}

export function OverflowTooltip({ content, children, className = '' }: OverflowTooltipProps) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);

  useLayoutEffect(() => {
    // box › Tooltip's wrapper div › the child
    const text = boxRef.current?.firstElementChild?.firstElementChild;
    if (!(text instanceof HTMLElement)) return;
    const measure = () => setTruncated(text.scrollWidth > text.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(text);
    return () => observer.disconnect();
  }, [content]);

  return (
    <span
      ref={boxRef}
      className={`overflow-tooltip flex min-w-0 [&>div]:min-w-0 [&>div]:max-w-full ${className}`}
    >
      <Tooltip content={content} disabled={!truncated} maxWidth={360}>
        {children}
      </Tooltip>
    </span>
  );
}
