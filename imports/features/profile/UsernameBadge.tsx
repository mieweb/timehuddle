/**
 * UsernameBadge — Clickable username used in chat message groups.
 *
 * Fetches the sender's public profile from timecore (GET /v1/users/:id)
 * and shows the name if available, falling back to the stored `username`.
 *
 * Clicking navigates to /app/profile/:userId.
 */
import React, { useEffect, useState } from 'react';

import { userApi } from '../../lib/api';
import { useRouter } from '../../ui/router';

interface UsernameBadgeProps {
  userId: string;
  /** Fallback display if the profile fetch fails or is pending */
  username: string;
}

export const UsernameBadge: React.FC<UsernameBadgeProps> = ({ userId, username }) => {
  const { navigate } = useRouter();
  const [displayName, setDisplayName] = useState(username);

  useEffect(() => {
    userApi
      .getUser(userId)
      .then((p) => {
        if (p.name) setDisplayName(p.name);
      })
      .catch(() => {
        /* keep fallback */
      });
  }, [userId]);

  return (
    <button
      type="button"
      onClick={() => navigate(`/app/profile/${userId}`)}
      className="text-sm font-semibold text-neutral-900 hover:underline dark:text-neutral-100"
    >
      {displayName}
    </button>
  );
};
