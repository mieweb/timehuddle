/**
 * The Media nav entry's state, worked out once for the app shell: TopNav and
 * BottomNav are both mounted (BottomNav is only hidden by CSS on a wide
 * window), and each reading Pulse itself would count drafts twice on every
 * `draftsChanged`. AppLayout wraps the shell in MediaNavProvider; both navs
 * read it with useMediaNav.
 */
import { createContext, useContext, type ReactNode } from 'react';

import { useMediaNavState, type MediaNavState } from './mediaVisibility';

const HIDDEN: MediaNavState = { visible: false, attention: 0 };

const MediaNavContext = createContext<MediaNavState | null>(null);

/** Counts once for every nav inside it. Goes inside PulseEmbedProvider. */
export function MediaNavProvider({ children }: { children: ReactNode }) {
  const state = useMediaNavState();
  return <MediaNavContext.Provider value={state}>{children}</MediaNavContext.Provider>;
}

/** The Media nav entry: whether it shows, and its attention badge. Hidden outside a provider. */
export function useMediaNav(): MediaNavState {
  return useContext(MediaNavContext) ?? HIDDEN;
}
