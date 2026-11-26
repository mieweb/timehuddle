/**
 * BuildDetails — which code this app and its server are running: version,
 * when each was built and the git commit. A development build — one with
 * commits main doesn't have — also shows its branch and those commits.
 *
 * For debugging more than for reading: a debug build installed straight onto
 * a phone carries the same version number as the release it grew out of, so
 * the version alone can't say what's in it. The body of the About page.
 */
import { Accordion, Badge, Card, CardContent, CardHeader, CardTitle, Text } from '@mieweb/ui';
import React, { useEffect, useState } from 'react';

import {
  type BuildInfo,
  clientBuildInfo,
  fetchServerBuildInfo,
  isDevelopmentBuild,
  serverUrl,
} from './buildInfo';

const COMMIT_URL = 'https://github.com/mieweb/timehuddle/commit/';

const text = {
  title: 'Build details',
  app: 'App',
  server: 'Server',
  url: 'URL',
  version: 'Version',
  built: 'Built',
  started: 'Started',
  commit: 'Commit',
  branch: 'Branch',
  uncommitted: 'Uncommitted changes',
  unknown: 'Unknown',
  loading: 'Loading…',
  unreachable: 'Could not reach the server, or it is too old to say.',
  noBuildInfo: 'This build carries no build details.',
  commitsAhead: (count: number) => `${count} ${count === 1 ? 'commit' : 'commits'} not on main`,
  showingNewest: (shown: number) => `Showing the newest ${shown}.`,
};

function formatDateTime(iso: string | null): string {
  if (!iso) return text.unknown;
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
}

const DetailRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="build-details-row flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
    <dt className="build-details-label">
      <Text as="span" size="sm" variant="muted">
        {label}
      </Text>
    </dt>
    <dd className="build-details-value min-w-0 break-all text-end">
      <Text as="span" size="sm">
        {children}
      </Text>
    </dd>
  </div>
);

const CommitList: React.FC<{ info: BuildInfo; id: string }> = ({ info, id }) => {
  const { commitsAhead, commits } = info;
  if (!commitsAhead) return null;
  return (
    <Accordion
      className="build-details-commits mt-2"
      headingLevel="h4"
      items={[
        {
          id: `${id}-commits`,
          title: (
            <Text as="span" size="sm">
              {text.commitsAhead(commitsAhead)}
            </Text>
          ),
          content: (
            <div className="build-details-commit-panel flex flex-col gap-2">
              <ol className="build-details-commit-list flex flex-col gap-1.5">
                {commits.map((commit) => (
                  <li key={commit.sha} className="build-details-commit flex gap-2">
                    <Text as="span" size="xs" className="shrink-0 font-mono">
                      <a
                        href={`${COMMIT_URL}${commit.sha}`}
                        target="_blank"
                        rel="noreferrer"
                        className="underline underline-offset-2"
                      >
                        {commit.sha}
                      </a>
                    </Text>
                    <Text as="span" size="xs" className="min-w-0 break-words">
                      {commit.subject}
                    </Text>
                  </li>
                ))}
              </ol>
              {commits.length < commitsAhead && (
                <Text as="p" size="xs" variant="muted">
                  {text.showingNewest(commits.length)}
                </Text>
              )}
            </div>
          ),
        },
      ]}
    />
  );
};

const BuildSection: React.FC<{
  id: string;
  heading: string;
  builtLabel: string;
  info: BuildInfo | null;
  emptyMessage: string;
  /** Where it is reached — shown even when it can't be, since that's when it matters. */
  url?: string;
}> = ({ id, heading, builtLabel, info, emptyMessage, url }) => (
  <section className="build-details-section flex flex-col gap-1.5" aria-labelledby={id}>
    <Text as="h3" id={id} size="sm" weight="semibold">
      {heading}
    </Text>
    <dl className="build-details-list flex flex-col gap-1.5">
      {url && <DetailRow label={text.url}>{url}</DetailRow>}
      {info && (
        <>
          <DetailRow label={text.version}>{info.version ?? text.unknown}</DetailRow>
          <DetailRow label={builtLabel}>{formatDateTime(info.builtAt)}</DetailRow>
          <DetailRow label={text.commit}>
            {info.commit ? (
              <span className="build-details-commit-value inline-flex flex-wrap items-center justify-end gap-1.5">
                <span className="font-mono" title={info.commit}>
                  {info.commit.slice(0, 10)}
                </span>
                {info.dirty && (
                  <Badge variant="warning" size="sm">
                    {text.uncommitted}
                  </Badge>
                )}
              </span>
            ) : (
              text.unknown
            )}
          </DetailRow>
          {isDevelopmentBuild(info) && (
            <DetailRow label={text.branch}>{info.branch ?? text.unknown}</DetailRow>
          )}
        </>
      )}
    </dl>
    {info ? (
      <CommitList info={info} id={id} />
    ) : (
      <Text as="p" size="sm" variant="muted">
        {emptyMessage}
      </Text>
    )}
  </section>
);

type ServerState =
  { status: 'loading' } | { status: 'ready'; info: BuildInfo } | { status: 'error' };

export const BuildDetails: React.FC = () => {
  const [server, setServer] = useState<ServerState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    fetchServerBuildInfo(controller.signal).then(
      (info) => setServer({ status: 'ready', info }),
      () => {
        if (!controller.signal.aborted) setServer({ status: 'error' });
      },
    );
    return () => controller.abort();
  }, []);

  return (
    <Card className="build-details" aria-labelledby="build-details-title">
      <CardHeader>
        <CardTitle id="build-details-title">{text.title}</CardTitle>
      </CardHeader>
      <CardContent className="build-details-body grid gap-6 sm:grid-cols-2">
        <BuildSection
          id="build-details-app"
          heading={text.app}
          builtLabel={text.built}
          info={clientBuildInfo}
          emptyMessage={text.noBuildInfo}
        />
        <BuildSection
          id="build-details-server"
          heading={text.server}
          builtLabel={text.started}
          info={server.status === 'ready' ? server.info : null}
          emptyMessage={server.status === 'loading' ? text.loading : text.unreachable}
          url={serverUrl}
        />
      </CardContent>
    </Card>
  );
};
