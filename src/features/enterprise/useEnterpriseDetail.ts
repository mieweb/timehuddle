import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError, enterpriseApi } from '../../lib/api';
import { useRefresh } from '../../lib/RefreshContext';
import { useTeam } from '../../lib/TeamContext';
import { ENTERPRISE_STRINGS } from './enterpriseStrings';

export type EnterpriseDetail = Awaited<ReturnType<typeof enterpriseApi.get>>;

/**
 * The selected enterprise's detail (name, defaults, owners and admins), for
 * its owners and admins. Never returns another enterprise's data while a newer
 * selection loads.
 */
export function useEnterpriseDetail() {
  const { selectedEnterpriseId } = useTeam();
  const [loaded, setLoaded] = useState<EnterpriseDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);

  const reload = useCallback(async () => {
    const seq = ++seqRef.current;
    // Only an ObjectId can name an enterprise; anything else is a stale selection.
    if (!selectedEnterpriseId || !/^[0-9a-f]{24}$/i.test(selectedEnterpriseId)) {
      setLoaded(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const detail = await enterpriseApi.get(selectedEnterpriseId);
      if (seq === seqRef.current) setLoaded(detail);
    } catch (err) {
      if (seq === seqRef.current)
        setError(err instanceof ApiError ? err.message : ENTERPRISE_STRINGS.page.loadFailed);
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [selectedEnterpriseId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useRefresh(reload);

  const enterprise = loaded?.id === selectedEnterpriseId ? loaded : null;
  /**
   * Merge a partial update (a rename, a settings view) into the loaded detail.
   * A reload still in flight was asked before this save, so its answer is dropped.
   */
  const patch = useCallback((update: Partial<EnterpriseDetail> & { id: string }) => {
    seqRef.current++;
    setLoading(false);
    setLoaded((prev) => (prev?.id === update.id ? { ...prev, ...update } : prev));
  }, []);

  return { enterprise, loading, error, reload, patch };
}
