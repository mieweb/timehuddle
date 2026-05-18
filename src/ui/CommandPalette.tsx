/**
 * CommandPalette — Global command menu triggered by Cmd+K (Mac) or Ctrl+K (Windows/Linux).
 *
 * Features:
 *   • Quick navigation to any page in the app
 *   • GitHub issue/PR URL detection and ticket creation
 *
 * Uses cmdk for the command menu behavior and integrates with the app's custom router.
 */
import {
  faBell,
  faCheck,
  faClock,
  faClockRotateLeft,
  faEnvelope,
  faGauge,
  faGear,
  faListCheck,
  faSitemap,
  faSpinner,
  faStopwatch,
  faTable,
  faTriangleExclamation,
  faUsers,
} from '@fortawesome/free-solid-svg-icons';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Command } from 'cmdk';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import {
  createTicketFromGithub,
  fetchGithubIssue,
  isGithubIssueUrl,
  type GitHubIssue,
} from '../features/tickets/githubIssue';
import { useTeam } from '../lib/TeamContext';
import { useRouter } from './router';

interface NavItem {
  icon: IconDefinition;
  label: string;
  href: string;
  keywords?: string[];
}

interface NavSection {
  heading: string;
  items: NavItem[];
}

const NAV_ITEMS: NavSection[] = [
  {
    heading: 'Workspace',
    items: [
      { icon: faGauge, label: 'Dashboard', href: '/app/dashboard', keywords: ['home', 'overview'] },
      { icon: faStopwatch, label: 'Work', href: '/app/work', keywords: ['timer', 'tracking'] },
      { icon: faListCheck, label: 'Tickets', href: '/app/tickets', keywords: ['tasks', 'issues'] },
      { icon: faTable, label: 'Timesheet', href: '/app/timesheet', keywords: ['hours', 'log'] },
    ],
  },
  {
    heading: 'Manage',
    items: [
      { icon: faUsers, label: 'Teams', href: '/app/teams', keywords: ['members', 'groups'] },
      { icon: faSitemap, label: 'Org Chart', href: '/app/org', keywords: ['organization', 'hierarchy', 'chart', 'structure'] },
      { icon: faEnvelope, label: 'Messages', href: '/app/messages', keywords: ['chat', 'inbox'] },
      {
        icon: faBell,
        label: 'Notifications',
        href: '/app/notifications',
        keywords: ['alerts', 'updates'],
      },
      {
        icon: faClockRotateLeft,
        label: 'Activity Log',
        href: '/app/activity',
        keywords: ['history', 'audit'],
      },
    ],
  },
  {
    heading: 'System',
    items: [
      { icon: faClock, label: 'Clock', href: '/app/clock', keywords: ['punch', 'in', 'out'] },
      {
        icon: faGear,
        label: 'Settings',
        href: '/app/settings',
        keywords: ['preferences', 'config'],
      },
    ],
  },
];

type PreviewState =
  | { status: 'idle' }
  | { status: 'loading'; url: string }
  | { status: 'ready'; url: string; issue: GitHubIssue }
  | { status: 'error'; url: string; message: string }
  | { status: 'creating'; url: string; issue: GitHubIssue };

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#*_~>]/g, '')
    .replace(/\n+/g, ' ')
    .trim();
}

export const CommandPalette: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [preview, setPreview] = useState<PreviewState>({ status: 'idle' });
  const { navigate } = useRouter();
  const { selectedTeamId, teamsReady } = useTeam();
  const fetchControllerRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetState = useCallback(() => {
    setSearch('');
    setPreview({ status: 'idle' });
    if (fetchControllerRef.current) {
      fetchControllerRef.current.abort();
      fetchControllerRef.current = null;
    }
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => {
          if (prev) resetState();
          return !prev;
        });
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [resetState]);

  useEffect(() => {
    if (!open) {
      resetState();
    }
  }, [open, resetState]);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    if (fetchControllerRef.current) {
      fetchControllerRef.current.abort();
      fetchControllerRef.current = null;
    }

    const trimmed = search.trim();
    if (!trimmed || !isGithubIssueUrl(trimmed)) {
      setPreview({ status: 'idle' });
      return;
    }

    setPreview({ status: 'loading', url: trimmed });

    debounceRef.current = setTimeout(() => {
      const controller = new AbortController();
      fetchControllerRef.current = controller;

      fetchGithubIssue(trimmed)
        .then((issue) => {
          if (controller.signal.aborted) return;
          if (issue) {
            setPreview({ status: 'ready', url: trimmed, issue });
          } else {
            setPreview({ status: 'error', url: trimmed, message: "Couldn't load issue" });
          }
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setPreview({ status: 'error', url: trimmed, message: "Couldn't load issue" });
        });
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [search]);

  const handleSelect = useCallback(
    (href: string) => {
      navigate(href);
      setOpen(false);
    },
    [navigate],
  );

  const handleCreateTicket = useCallback(async () => {
    if (preview.status !== 'ready' || !selectedTeamId) return;

    const { url, issue } = preview;
    setPreview({ status: 'creating', url, issue });

    try {
      await createTicketFromGithub({
        teamId: selectedTeamId,
        url,
        title: issue.title,
        description: issue.body,
      });
      window.dispatchEvent(new CustomEvent('tickets:refetch'));
      navigate('/app/tickets');
      setOpen(false);
    } catch {
      setPreview({ status: 'error', url, message: 'Failed to create ticket' });
    }
  }, [preview, selectedTeamId, navigate]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && preview.status === 'ready' && selectedTeamId) {
        e.preventDefault();
        void handleCreateTicket();
      }
    },
    [preview.status, selectedTeamId, handleCreateTicket],
  );

  const isGithubMode = preview.status !== 'idle';
  const canCreate = preview.status === 'ready' && selectedTeamId;

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command Menu"
      className="fixed inset-0 z-50"
      shouldFilter={!isGithubMode}
    >
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/20" onClick={() => setOpen(false)} aria-hidden />

      {/* Dialog container */}
      <div className="fixed inset-0 flex items-start justify-center pt-[20vh]">
        <div className="w-full max-w-lg overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-[0_25px_50px_-12px_rgba(0,0,0,0.4)] dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-[0_25px_50px_-12px_rgba(0,0,0,0.7)]">
          <Command.Input
            placeholder="Type a command, search, or paste a GitHub URL..."
            value={search}
            onValueChange={setSearch}
            onKeyDown={handleKeyDown}
            className="w-full border-b border-neutral-200 bg-transparent px-4 py-3 text-base text-neutral-900 outline-none placeholder:text-neutral-500 dark:border-neutral-800 dark:text-neutral-100 dark:placeholder:text-neutral-400"
          />

          {/* GitHub preview panel */}
          {isGithubMode && (
            <div className="border-b border-neutral-200 p-3 dark:border-neutral-800">
              {preview.status === 'loading' && (
                <div className="flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
                  <FontAwesomeIcon icon={faSpinner} className="h-4 w-4 animate-spin" />
                  <span>Fetching issue...</span>
                </div>
              )}

              {preview.status === 'creating' && (
                <div className="flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
                  <FontAwesomeIcon icon={faSpinner} className="h-4 w-4 animate-spin" />
                  <span>Creating ticket...</span>
                </div>
              )}

              {preview.status === 'error' && (
                <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
                  <FontAwesomeIcon icon={faTriangleExclamation} className="h-4 w-4" />
                  <span>{preview.message}</span>
                </div>
              )}

              {preview.status === 'ready' && (
                <div className="rounded-lg border border-green-500/40 bg-green-50 p-3 dark:bg-green-950/30">
                  <div className="flex items-center gap-2 text-xs font-medium text-green-700 dark:text-green-400">
                    <FontAwesomeIcon icon={faCheck} className="h-3 w-3" />
                    <span>GitHub issue identified</span>
                  </div>
                  <p className="mt-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                    {preview.issue.title}
                  </p>
                  {preview.issue.body && (
                    <p className="mt-1 line-clamp-2 text-xs text-neutral-600 dark:text-neutral-400">
                      {stripMarkdown(preview.issue.body)}
                    </p>
                  )}
                  {!selectedTeamId && teamsReady && (
                    <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                      Select a team first to create a ticket
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <Command.List className="max-h-80 overflow-y-auto p-2 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-neutral-300 dark:[&::-webkit-scrollbar-thumb]:bg-neutral-700 [&::-webkit-scrollbar-thumb:hover]:bg-neutral-400 dark:[&::-webkit-scrollbar-thumb:hover]:bg-neutral-600">
            {!isGithubMode && (
              <>
                <Command.Empty className="px-4 py-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
                  No results found.
                </Command.Empty>

                {NAV_ITEMS.map((section) => (
                  <Command.Group
                    key={section.heading}
                    heading={section.heading}
                    className="**:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:py-1.5 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-neutral-500 **:[[cmdk-group-heading]]:dark:text-neutral-400"
                  >
                    {section.items.map((item) => (
                      <Command.Item
                        key={item.href}
                        value={`${item.label} ${item.keywords?.join(' ') ?? ''}`}
                        onSelect={() => handleSelect(item.href)}
                        className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm text-neutral-700 outline-none transition-colors data-[selected=true]:bg-neutral-100 dark:text-neutral-300 dark:data-[selected=true]:bg-neutral-800"
                      >
                        <FontAwesomeIcon
                          icon={item.icon}
                          className="h-4 w-4 text-neutral-500 dark:text-neutral-400"
                        />
                        <span>{item.label}</span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                ))}
              </>
            )}

            {isGithubMode &&
              preview.status !== 'loading' &&
              preview.status !== 'creating' &&
              !(preview.status === 'ready' && canCreate) && (
                <div className="px-4 py-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
                  {preview.status === 'ready'
                    ? 'Select a team to create ticket'
                    : 'Enter a valid GitHub issue or PR URL'}
                </div>
              )}
          </Command.List>

          <div className="border-t border-neutral-200 px-4 py-2 dark:border-neutral-800">
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              <kbd className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] dark:bg-neutral-800">
                ↵
              </kbd>{' '}
              {canCreate ? 'to create ticket' : 'to select'}{' '}
              <kbd className="ml-2 rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] dark:bg-neutral-800">
                esc
              </kbd>{' '}
              to close
            </p>
          </div>
        </div>
      </div>
    </Command.Dialog>
  );
};
