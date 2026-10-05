/**
 * NoAccessState — What a deep link shows when it can't show its resource.
 *
 * Two distinct states, never merged into one "not found or no access":
 *   • forbidden — it exists, but the user isn't in the team that owns it
 *   • not-found — it doesn't exist, or was deleted
 *
 * Used in place of the page, so a link to someone else's team never falls
 * back to showing the user's own team instead. No team name is shown: there
 * is no endpoint that can reveal one to a non-member safely.
 */
import { ErrorPage } from '@mieweb/ui';
import React from 'react';

import { useRouter } from './router';

export type NoAccessKind = 'forbidden' | 'not-found';
export type NoAccessResource =
  'team' | 'org' | 'ticket' | 'profile' | 'conversation' | 'post' | 'page';
/**
 * `page` and `post` are only ever missing, never withheld: there are no
 * admin-only routes, and a post in a team the reader can't see is covered by
 * the team gate before the post is ever looked up.
 */
export type ForbiddenResource = Exclude<NoAccessResource, 'page' | 'post'>;

interface NoAccessCopy {
  title: string;
  description: string;
}

/** All user-facing copy, kept together for translation. */
export const NO_ACCESS_COPY: {
  forbidden: Record<ForbiddenResource, NoAccessCopy>;
  'not-found': Record<NoAccessResource, NoAccessCopy>;
  goToDashboard: string;
} = {
  forbidden: {
    team: {
      title: 'You don’t have access to this team',
      description:
        'You aren’t a member of the team this link points to. Ask one of its admins for an invite, then open the link again.',
    },
    org: {
      title: 'You don’t have access to this organization',
      description:
        'You aren’t a member of the organization this link points to. Ask one of its admins for an invite, then open the link again.',
    },
    ticket: {
      title: 'You don’t have access to this ticket',
      description:
        'It belongs to a team you aren’t a member of. Ask one of its admins for an invite, then open the link again.',
    },
    profile: {
      title: 'This profile isn’t available to you',
      description: 'You can only view profiles of people who share a team with you.',
    },
    conversation: {
      title: 'You don’t have access to this conversation',
      description:
        'It belongs to a team you aren’t a member of. Ask one of its admins for an invite, then open the link again.',
    },
  },
  'not-found': {
    team: {
      title: 'This team doesn’t exist',
      description: 'It may have been deleted, or the link may be incomplete.',
    },
    org: {
      title: 'This organization doesn’t exist',
      description: 'It may have been deleted, or the link may be incomplete.',
    },
    ticket: {
      title: 'This ticket doesn’t exist or was deleted',
      description: 'Check that the link is complete, or look for the ticket in Tickets.',
    },
    profile: {
      title: 'This person doesn’t exist',
      description: 'The profile may have been removed, or the username may have changed.',
    },
    conversation: {
      title: 'This conversation isn’t here',
      description:
        'Its posts may have been deleted, or it may belong to another team or Thread by option. Pick a conversation from the list to carry on.',
    },
    page: {
      title: 'This page doesn’t exist',
      description:
        'The address may be mistyped, or the page may have moved. Check the link, or start again from the dashboard.',
    },
    post: {
      title: 'This post isn’t here',
      description:
        'It may have been deleted, or it may belong to a team you aren’t in. Pick a conversation from the list to carry on.',
    },
  },
  goToDashboard: 'Go to dashboard',
};

type NoAccessStateProps =
  | { kind: 'forbidden'; resource: ForbiddenResource }
  | { kind: 'not-found'; resource: NoAccessResource };

export const NoAccessState: React.FC<NoAccessStateProps> = (props) => {
  const { kind } = props;
  const { navigate } = useRouter();
  const { title, description } =
    props.kind === 'forbidden'
      ? NO_ACCESS_COPY.forbidden[props.resource]
      : NO_ACCESS_COPY['not-found'][props.resource];

  return (
    <section className="no-access-state" role="status" aria-live="polite" data-kind={kind}>
      <ErrorPage
        type={kind === 'forbidden' ? '403' : '404'}
        code=""
        size="sm"
        title={title}
        description={description}
        primaryAction={{
          label: NO_ACCESS_COPY.goToDashboard,
          onClick: () => navigate('/app/dashboard'),
        }}
      />
    </section>
  );
};
