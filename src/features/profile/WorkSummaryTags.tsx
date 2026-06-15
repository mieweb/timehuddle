/**
 * WorkSummaryTags — Displays recent work items as clickable tags.
 * Fetches the 48-hour work summary for a given user and renders as tag buttons.
 */
import React, { useEffect, useState } from 'react';

import { activityApi } from '../../lib/api';
import { useRouter } from '../../ui/router';

interface WorkSummaryTagsProps {
  userId: string;
}

export const WorkSummaryTags: React.FC<WorkSummaryTagsProps> = ({ userId }) => {
  const [workSummary, setWorkSummary] = useState<{ id: string; title: string }[]>([]);
  const { navigate } = useRouter();

  useEffect(() => {
    activityApi
      .getUserWorkSummary(userId)
      .then(({ items }) => setWorkSummary(items))
      .catch(() => setWorkSummary([]));
  }, [userId]);

  if (workSummary.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {workSummary.map((t) => (
        <button
          key={t.id}
          aria-label={`View ticket: ${t.title}`}
          className="rounded-md bg-neutral-100 px-2.5 py-1 text-sm font-medium text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
          onClick={() => navigate(`/app/tickets/${t.id}`)}
        >
          {t.title}
        </button>
      ))}
    </div>
  );
};
