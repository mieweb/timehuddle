/**
 * The one control that says where a ticket is tracked: TimeHuddle only, a
 * GitHub link, or a Redmine issue — an existing one (found by number or link
 * and previewed), or a new one created from the ticket.
 *
 * Used inside the create dialog and the ticket page's "Linked issue" section,
 * so there is a single place, and a single look, for choosing a ticket's link.
 * It only collects the choice; `applyTicketLink` carries it out.
 */
import { Alert, AlertDescription, Badge, Button, Input, Select, Spinner, Text } from '@mieweb/ui';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import React, { useEffect, useRef, useState } from 'react';

import { redmineApi, type RedmineNamed } from '../../../lib/api';
import { onOtherRedmineServer, useRedmineStatus } from '../../../lib/useRedmineStatus';
import { AnimatedHeight } from '../../../ui/AnimatedHeight';
import { useRouter } from '../../../ui/router';
import { SegmentedSwitcher, type SegmentedOption } from '../../../ui/SegmentedSwitcher';
import { redmineErrorMessage, toId, toOptions } from '../redmine/redmineForm';

import { isHttpsUrl, type LinkFormState, type LinkKind, type RedmineMode } from './ticketLinkForm';
import { ticketLinkText } from './ticketLinkStrings';

const KIND_OPTIONS: readonly SegmentedOption<LinkKind>[] = [
  { value: 'none', label: ticketLinkText.kindNone },
  { value: 'github', label: ticketLinkText.kindGithub },
  { value: 'redmine', label: ticketLinkText.kindRedmine },
];

const LINKED_KIND_OPTIONS = KIND_OPTIONS.filter((option) => option.value !== 'none');

const MODE_OPTIONS: readonly SegmentedOption<RedmineMode>[] = [
  { value: 'existing', label: ticketLinkText.modeExisting },
  { value: 'new', label: ticketLinkText.modeNew },
];

export interface TicketLinkFieldsProps {
  value: LinkFormState;
  onChange: (patch: Partial<LinkFormState>) => void;
  /** Distinguishes the radio groups when two of these controls are on one page. */
  name: string;
  disabled?: boolean;
  /**
   * Offer "TimeHuddle" (no link) as a choice. On for a new ticket; off when
   * changing an existing ticket's link, where removing it is "Unlink".
   */
  allowNone?: boolean;
}

export function TicketLinkFields({
  value,
  onChange,
  name,
  disabled = false,
  allowNone = true,
}: TicketLinkFieldsProps) {
  const { navigate } = useRouter();
  const redmineStatus = useRedmineStatus();
  // Either way Redmine cannot be offered: no account, or one on another server.
  const otherServer = onOtherRedmineServer(redmineStatus);
  const redmineMissing = redmineStatus?.connected === false || otherServer;

  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [projects, setProjects] = useState<RedmineNamed[] | null>(null);
  const [trackers, setTrackers] = useState<RedmineNamed[]>([]);

  const creatingNew = value.kind === 'redmine' && value.redmineMode === 'new' && !redmineMissing;

  const reducedMotion = useReducedMotion();
  const panelMotion = {
    initial: { opacity: 0, y: -6 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -6 },
    transition: { duration: reducedMotion ? 0 : 0.14, ease: 'easeOut' as const },
  };

  // Projects are only needed once someone chooses to create a new issue.
  useEffect(() => {
    if (!creatingNew || projects) return;
    let cancelled = false;
    redmineApi.projects
      .list()
      .then(({ projects: list }) => {
        if (cancelled) return;
        setProjects(list);
        if (list.length === 1) onChange({ projectId: String(list[0].id) });
      })
      .catch((err) => !cancelled && setMessage(redmineErrorMessage(err)));
    return () => {
      cancelled = true;
    };
    // `onChange` is a fresh function each render; the load runs once per open.
  }, [creatingNew, projects]);

  // A project decides which trackers exist; the first one is the default.
  const projectId = toId(value.projectId);
  useEffect(() => {
    if (!creatingNew || !projectId) return;
    let cancelled = false;
    redmineApi.projects
      .formOptions(projectId)
      .then((options) => {
        if (cancelled) return;
        setTrackers(options.trackers);
        onChange({ trackerId: options.trackers[0] ? String(options.trackers[0].id) : '' });
      })
      // Tracker is optional: without the list, Redmine applies its own default.
      .catch(() => !cancelled && setTrackers([]));
    return () => {
      cancelled = true;
    };
  }, [creatingNew, projectId]);

  // Searches are numbered, and editing the query retires the one in flight, so
  // an answer can never be installed under text it was not asked for.
  const searchSeq = useRef(0);

  const findIssue = async () => {
    const text = value.query.trim();
    if (!text) return;
    const seq = ++searchSeq.current;
    setSearching(true);
    setMessage(null);
    onChange({ issue: null });
    try {
      const result = await redmineApi.issues.search(text);
      if (seq !== searchSeq.current) return;
      const issue = result.issues[0];
      if (result.kind !== 'id' && result.kind !== 'url') {
        setMessage(ticketLinkText.needNumberOrLink);
      } else if (!issue) {
        setMessage(ticketLinkText.notFound);
      } else {
        onChange({ issue });
      }
    } catch (err) {
      if (seq === searchSeq.current) setMessage(redmineErrorMessage(err));
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  };

  return (
    <div className="ticket-link-fields flex flex-col gap-3">
      <SegmentedSwitcher
        name={`${name}-kind`}
        label={ticketLinkText.kindLabel}
        options={allowNone ? KIND_OPTIONS : LINKED_KIND_OPTIONS}
        value={value.kind}
        disabled={disabled}
        onValueChange={(kind) => {
          setMessage(null);
          onChange({ kind });
        }}
      />

      {/* The fields for the chosen target ease in as the switcher's highlight
          lands, and the space they need opens smoothly: a dialog around this
          control would otherwise jump as its height snapped. */}
      <AnimatedHeight>
        <div className="ticket-link-panel">
          <AnimatePresence mode="wait" initial={false}>
            {value.kind === 'github' && (
              <motion.div key="github" className="ticket-link-github" {...panelMotion}>
                <Input
                  label={ticketLinkText.githubLabel}
                  type="url"
                  placeholder={ticketLinkText.githubPlaceholder}
                  value={value.github}
                  disabled={disabled}
                  error={
                    value.github.trim() && !isHttpsUrl(value.github)
                      ? ticketLinkText.httpsOnly
                      : undefined
                  }
                  onChange={(e) => onChange({ github: e.target.value })}
                />
              </motion.div>
            )}

            {value.kind === 'redmine' && redmineMissing && (
              <motion.div
                key="redmine-needed"
                className="ticket-link-redmine-needed space-y-2"
                {...panelMotion}
              >
                <Alert variant="warning">
                  <AlertDescription>
                    {otherServer ? ticketLinkText.otherServer : ticketLinkText.redmineNeeded}
                  </AlertDescription>
                </Alert>
                {!otherServer && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => navigate('/app/settings')}
                  >
                    {ticketLinkText.goToSettings}
                  </Button>
                )}
              </motion.div>
            )}

            {value.kind === 'redmine' && !redmineMissing && (
              <motion.div key="redmine" className="ticket-link-redmine space-y-3" {...panelMotion}>
                <SegmentedSwitcher
                  name={`${name}-redmine-mode`}
                  label={ticketLinkText.redmineModeLabel}
                  options={MODE_OPTIONS}
                  value={value.redmineMode}
                  disabled={disabled}
                  onValueChange={(redmineMode) => {
                    setMessage(null);
                    onChange({ redmineMode });
                  }}
                />

                {value.redmineMode === 'existing' ? (
                  <>
                    <div className="ticket-link-find flex items-end gap-2">
                      <div className="ticket-link-find-field flex-1">
                        <Input
                          label={ticketLinkText.existingLabel}
                          placeholder={ticketLinkText.existingPlaceholder}
                          value={value.query}
                          autoComplete="off"
                          disabled={disabled}
                          onChange={(e) => {
                            searchSeq.current += 1;
                            setSearching(false);
                            setMessage(null);
                            onChange({ query: e.target.value, issue: null });
                          }}
                          onKeyDown={(e) => {
                            // Enter finds the issue; it must not submit the form around this control.
                            if (e.key !== 'Enter') return;
                            e.preventDefault();
                            void findIssue();
                          }}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={disabled || !value.query.trim() || searching}
                        aria-busy={searching}
                        onClick={() => void findIssue()}
                      >
                        {searching ? ticketLinkText.finding : ticketLinkText.find}
                      </Button>
                    </div>
                    {value.issue && (
                      <div
                        className="ticket-link-preview rounded-md border border-border p-3"
                        role="group"
                        aria-label={ticketLinkText.previewLabel}
                      >
                        <div className="ticket-link-preview-meta flex flex-wrap items-center gap-2">
                          <Text size="sm" variant="muted" className="font-mono">
                            #{value.issue.id}
                          </Text>
                          {value.issue.status && (
                            <Badge
                              size="sm"
                              variant={value.issue.status.isClosed ? 'secondary' : 'success'}
                            >
                              {value.issue.status.name}
                            </Badge>
                          )}
                          {value.issue.project && (
                            <Text size="sm" variant="muted">
                              {value.issue.project.name}
                            </Text>
                          )}
                        </div>
                        <Text size="sm" className="mt-1 font-medium">
                          {value.issue.subject}
                        </Text>
                      </div>
                    )}
                  </>
                ) : projects === null && !message ? (
                  <Spinner size="sm" label={ticketLinkText.loadingProjects} />
                ) : (
                  <>
                    <div className="ticket-link-new grid gap-4 sm:grid-cols-2">
                      <Select
                        label={ticketLinkText.projectLabel}
                        searchable
                        placeholder={ticketLinkText.projectPlaceholder}
                        options={toOptions(projects ?? [])}
                        value={value.projectId}
                        disabled={disabled}
                        onValueChange={(next) => {
                          // The old project's trackers must not stay selectable
                          // while the new project's are loading.
                          setTrackers([]);
                          onChange({ projectId: next, trackerId: '' });
                        }}
                      />
                      <Select
                        label={ticketLinkText.trackerLabel}
                        options={toOptions(trackers)}
                        value={value.trackerId}
                        disabled={disabled || trackers.length === 0}
                        onValueChange={(trackerId) => onChange({ trackerId })}
                      />
                    </div>
                    <Text size="sm" variant="muted">
                      {ticketLinkText.newIssueHelp}
                    </Text>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Always present so it is announced; it takes no room until it says something. */}
          <div className="ticket-link-message" aria-live="polite">
            {message && (
              <Text size="sm" variant="muted" className="block pt-3">
                {message}
              </Text>
            )}
          </div>
        </div>
      </AnimatedHeight>
    </div>
  );
}
