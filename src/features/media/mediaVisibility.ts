/**
 * When the Media page and its nav entry show (PLAN §7.2 visibility rule, O1,
 * AD25), and the attention count its nav entry carries (§5.2).
 *
 * The page is back only under the rule (usePulseEmbed's `surfacesVisible`:
 * Pulse runs on this phone, and a team has "Pulse in the app" on or Pulse
 * holds unsent videos). Otherwise `/app/media` goes to the Dashboard exactly
 * as it did while it was retired: same place, same query, no history entry.
 */
import { useEffect, useState } from 'react';

import { usePulseEmbed, type PulseEmbed } from '../pulse-embed/usePulseEmbed';

export const MEDIA_PATH = '/app/media';

/** Where `/app/media` went while it was retired, and where it goes when the rule is false. */
export const MEDIA_FALLBACK_PATH = '/app/dashboard';

/** What the page does now: show, go to the Dashboard, or wait for Pulse's answer. */
export type MediaGate = 'render' | 'redirect' | 'wait';

/** How long the page waits for Pulse's answer before it goes to the Dashboard. */
export const MEDIA_GATE_WAIT_MS = 5_000;

/**
 * The page's decision. Shown as soon as the rule holds. Never shown in a
 * browser or without the plugin. In the app, it waits until both of the
 * rule's facts are in (the team settings and Pulse's usage): deciding on
 * half of them would send someone with unsent videos away.
 */
export function mediaGate(
  embed: Pick<PulseEmbed, 'status' | 'surfacesVisible' | 'usage' | 'teams'>,
): MediaGate {
  if (embed.surfacesVisible) return 'render';
  if (embed.status === 'off' || embed.status === 'unavailable') return 'redirect';
  if (embed.status === 'ready' && embed.usage !== null && embed.teams !== null) return 'redirect';
  return 'wait';
}

/** The Dashboard with the query the link carried (as `resolveUrl` rewrote a retired route). */
export function mediaRedirectTarget(search: string): string {
  return `${MEDIA_FALLBACK_PATH}${search}`;
}

/**
 * The attention count (§5.2): failed sends, and kept videos not yet moved or
 * dismissed, on this phone. Zero while the Media surfaces are hidden.
 */
export function useMediaAttention(): number {
  const { client, surfacesVisible } = usePulseEmbed();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!client || !surfacesVisible) {
      setCount(0);
      return;
    }
    let alive = true;
    let running = false;
    let again = false;
    const read = async () => {
      if (running) {
        again = true;
        return;
      }
      running = true;
      do {
        again = false;
        try {
          const by = await client.countDrafts({
            by: 'contextKind',
            attentionOnly: true,
            states: ['failed', 'sent'],
          });
          const total = Object.values(by).reduce((sum, n) => sum + (Number(n) || 0), 0);
          if (alive) setCount(total);
        } catch (error) {
          console.warn('[media] counting videos that need attention failed:', error);
        }
      } while (again && alive);
      running = false;
    };
    const off = client.on('draftsChanged', () => void read());
    void read();
    return () => {
      alive = false;
      off();
    };
  }, [client, surfacesVisible]);

  return count;
}

/** The Media nav entry: whether it shows, and its attention badge. */
export function useMediaNav(): { visible: boolean; attention: number } {
  const { surfacesVisible } = usePulseEmbed();
  const attention = useMediaAttention();
  return { visible: surfacesVisible, attention: surfacesVisible ? attention : 0 };
}
