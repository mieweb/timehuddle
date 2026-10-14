import { useEffect, useRef, useState } from 'react';

import styles from './site.module.css';

/**
 * Fades an element up the first time it scrolls into view.
 *
 * A plain IntersectionObserver instead of an animation library, so the public
 * site stays light. Reduced motion is handled in CSS, where `.reveal` is
 * simply visible.
 */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || shown) return;
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShown(true);
          observer.disconnect();
        }
      },
      { rootMargin: '0px 0px -10% 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [shown]);

  return { ref, className: `${styles.reveal} ${shown ? styles.revealed : ''}` };
}
