/**
 * ProfileNotices — Renders one or more profile surface banners from a config array.
 *
 * Usage:
 *   import { ProfileNotices } from './ProfileNotices';
 *   <ProfileNotices notices={[{ type: 'coming-soon' }]} />
 *   <ProfileNotices notices={[{ type: 'username', state: 'required', onAction: startEdit }]} />
 */
import { faCircleExclamation, faCircleInfo } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button } from '@mieweb/ui';
import React from 'react';

// ─── Notice descriptors ───────────────────────────────────────────────────────

export type UsernameState = 'pending' | 'blocked' | 'required';

export type NoticeConfig =
  | { type: 'coming-soon' }
  | { type: 'username'; state: UsernameState; onAction?: () => void };

// ─── Individual banners (internal) ───────────────────────────────────────────

const ComingSoonBanner: React.FC = () => (
  <div
    role="status"
    aria-live="polite"
    className="profile-coming-soon flex items-center gap-2 rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
  >
    <FontAwesomeIcon icon={faCircleInfo} className="shrink-0 text-blue-500 dark:text-blue-400" aria-hidden="true" />
    <span>Full profile support coming soon!</span>
  </div>
);

const USERNAME_COPY: Record<UsernameState, { message: string; action: string }> = {
  pending:  { message: 'Your username is being reviewed.',         action: 'Check status' },
  blocked:  { message: 'Your requested username is unavailable.',  action: 'Choose a different username' },
  required: { message: 'Set a username to complete your profile.', action: 'Choose a username' },
};

const UsernameBanner: React.FC<{ state: UsernameState; onAction?: () => void }> = ({ state, onAction }) => {
  const { message, action } = USERNAME_COPY[state];
  return (
    <div
      role="status"
      aria-live="polite"
      className="username-notice flex items-center gap-2 rounded-lg border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-800 dark:border-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-300"
    >
      <FontAwesomeIcon icon={faCircleExclamation} className="shrink-0 text-yellow-500 dark:text-yellow-400" aria-hidden="true" />
      <span>{message}</span>
      {onAction && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onAction}
          className="ml-auto whitespace-nowrap font-medium underline underline-offset-2 hover:no-underline"
          aria-label={`${action} — username action required`}
        >
          {action}
        </Button>
      )}
    </div>
  );
};

// ─── Public component ─────────────────────────────────────────────────────────

interface ProfileNoticesProps {
  notices: NoticeConfig[];
}

export const ProfileNotices: React.FC<ProfileNoticesProps> = ({ notices }) => (
  <>
    {notices.map((n, i) => {
      if (n.type === 'coming-soon') return <ComingSoonBanner key={i} />;
      if (n.type === 'username') return <UsernameBanner key={i} state={n.state} onAction={n.onAction} />;
    })}
  </>
);
