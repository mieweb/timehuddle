import { QueryClient } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import {
  removeOldestQuery,
  type PersistQueryClientOptions,
} from '@tanstack/react-query-persist-client';

const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Always revalidate on mount, but render cached data while it runs.
      staleTime: 0,
      // Must be at least the persisted maxAge, or restored entries are dropped.
      gcTime: CACHE_MAX_AGE_MS,
      // DDP pushes live updates and the app re-checks its socket on resume.
      refetchOnWindowFocus: false,
      // Requests already time out on their own; one retry is enough.
      retry: 1,
    },
  },
});

const PERSISTED_ROOTS = new Set(['huddle', 'tickets']);

const persister = createAsyncStoragePersister({
  storage: typeof window === 'undefined' ? undefined : window.localStorage,
  key: 'app:queryCache',
  throttleTime: 1000,
  // localStorage is ~5 MB; drop the oldest query instead of failing the save.
  retry: removeOldestQuery,
});

export const persistOptions: Omit<PersistQueryClientOptions, 'queryClient'> = {
  persister,
  maxAge: CACHE_MAX_AGE_MS,
  // A new app version may change response shapes — start from an empty cache.
  buster: import.meta.env.VITE_APP_VERSION ?? '',
  dehydrateOptions: {
    shouldDehydrateQuery: (query) =>
      query.state.status === 'success' && PERSISTED_ROOTS.has(String(query.queryKey[0])),
  },
};

/** Drops every cached response, in memory and on disk — on sign-out or when the user changes. */
export async function clearCachedData(): Promise<void> {
  queryClient.clear();
  await persister.removeClient();
}
