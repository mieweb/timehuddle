import { useEffect, useState } from 'react';

/**
 * The current time (epoch ms), updated every `intervalMs`. For a live timer
 * that re-renders only itself, not the page around it.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(tick);
  }, [intervalMs]);
  return now;
}
