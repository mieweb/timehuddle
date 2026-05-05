/**
 * UsernameBadge — Clickable username used in chat message groups.
 *
 * Fetches the sender's public profile from timecore (GET /v1/users/:id)
 * and shows the name if available, falling back to the stored `username`.
 *
 * Clicking navigates to /:username (public profile) if available,
 * or falls back to the /app/profile/:userId internal view.
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
  const [profileUsername, setProfileUsername] = useState<string | null>(null);

  useEffect(() => {
    userApi
      .getUser(userId)
      .then((p) => {
        if (p.name) setDisplayName(p.name);
        if (p.username) setProfileUsername(p.username);
      })
      .catch(() => {
        /* keep fallback */
      });
  }, [userId]);

  const handleClick = () => {
    if (profileUsername) {
      // Full navigation: /:username is a separate SPA mount outside the AppLayout shell
      window.location.href = `/${profileUsername}`;
    } else {
      navigate(`/app/profile/${userId}`);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="text-sm font-semibold text-neutral-900 hover:underline dark:text-neutral-100"
    >
      {displayName}
    </button>
  );
};
