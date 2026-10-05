/**
 * Lets its content change height smoothly instead of snapping.
 *
 * For content that swaps in place inside something whose size follows it — a
 * dialog that is centred on screen jumps when its body suddenly grows. The
 * content is measured, and the wrapper animates to that height.
 *
 * Clipping is on only while the height is moving, so a focus ring or an open
 * menu inside is never cut off at rest.
 */
import { motion, useReducedMotion } from 'motion/react';
import React, { useLayoutEffect, useRef, useState } from 'react';

export interface AnimatedHeightProps {
  children: React.ReactNode;
  className?: string;
}

export function AnimatedHeight({ children, className }: AnimatedHeightProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [moving, setMoving] = useState(false);
  const reducedMotion = useReducedMotion();

  useLayoutEffect(() => {
    const node = contentRef.current;
    // No ResizeObserver (a test environment): the content simply sizes itself.
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setHeight(node.offsetHeight));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <motion.div
      className={className}
      initial={false}
      animate={{ height: height ?? 'auto' }}
      transition={{ duration: reducedMotion ? 0 : 0.22, ease: [0.2, 0, 0, 1] }}
      style={{ overflow: moving ? 'hidden' : 'visible' }}
      onAnimationStart={() => setMoving(true)}
      onAnimationComplete={() => setMoving(false)}
    >
      <div ref={contentRef} className="animated-height-content">
        {children}
      </div>
    </motion.div>
  );
}
