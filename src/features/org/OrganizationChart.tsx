import '@mieweb/ychart';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import { useRouter } from '../../ui/router';
import { CompactTicketList } from '../profile/CompactTicketList';
import { useProfileTickets } from '../profile/useProfileTickets';

type ChartState = {
  svgWidth: number;
  svgHeight: number;
  [key: string]: unknown;
};

type OrgChartInstance = {
  render: () => OrgChartInstance;
  clear?: () => void;
  fit?: (params?: { animate?: boolean; scale?: boolean }) => OrgChartInstance;
  getChartState?: () => ChartState;
};

type YChartInstance = {
  initView(containerId: string, yaml: string): YChartInstance;
  destroy?: () => void;
  orgChart?: OrgChartInstance;
};

interface OrganizationChartMember {
  id: string;
  name: string;
  email: string;
  username: string | null;
  image: string | null;
  role: 'owner' | 'admin' | 'member';
  reportsToUserId?: string | null;
}

interface OrganizationChartProps {
  organizationName: string;
  members: OrganizationChartMember[];
  teams?: Array<{ id: string; name: string }>;
}

const ROOT_ID = 'org-root';

const roleLabel: Record<OrganizationChartMember['role'], string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
};

function resolvesToSelfCycle(
  memberId: string,
  parentId: string,
  reportsToMap: Map<string, string | null>,
): boolean {
  const visited = new Set<string>();
  let cursor: string | null = parentId;

  while (cursor) {
    if (cursor === memberId) return true;
    if (visited.has(cursor)) return true;
    visited.add(cursor);
    cursor = reportsToMap.get(cursor) ?? null;
  }

  return false;
}

function buildYaml(organizationName: string, members: OrganizationChartMember[]): string {
  const memberIds = new Set(members.map((member) => member.id));
  const reportsToMap = new Map(
    members.map((member) => [
      member.id,
      member.reportsToUserId && memberIds.has(member.reportsToUserId)
        ? member.reportsToUserId
        : null,
    ]),
  );

  const lines: string[] = [];
  lines.push('- id: "org-root"');
  lines.push(`  name: ${JSON.stringify(organizationName)}`);
  lines.push('  title: Organization');

  members.forEach((member) => {
    const candidateParent = reportsToMap.get(member.id) ?? null;
    const parentId =
      candidateParent && !resolvesToSelfCycle(member.id, candidateParent, reportsToMap)
        ? candidateParent
        : ROOT_ID;

    lines.push(`- id: ${JSON.stringify(member.id)}`);
    lines.push(`  parentId: ${JSON.stringify(parentId)}`);
    lines.push(`  name: ${JSON.stringify(member.name)}`);
    lines.push(`  title: ${JSON.stringify(roleLabel[member.role])}`);
  });

  return lines.join('\n');
}

const OrganizationChartMount: React.FC<{
  yaml: string;
  onMemberDetails: (nodeData: Record<string, unknown>) => void;
}> = ({ yaml, onMemberDetails }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<YChartInstance | null>(null);
  const chartId = useRef(`oc-${Date.now()}-${Math.random().toString(36).slice(2)}`).current;
  const onMemberDetailsRef = useRef(onMemberDetails);
  onMemberDetailsRef.current = onMemberDetails;

  useEffect(() => {
    const containerElement = containerRef.current!;
    containerElement.id = chartId;
    let fitTimerId = 0;

    const frameId = requestAnimationFrame(() => {
      if (!containerElement.isConnected) return;
      try {
        instanceRef.current = new window.YChartEditor().initView(chartId, yaml);

        // Patch the built-in details panel to use our custom modal instead
        const instance = instanceRef.current as YChartInstance & {
          showNodeDetails?: (data: Record<string, unknown>) => void;
        };
        if (typeof instance.showNodeDetails === 'function') {
          instance.showNodeDetails = (data: Record<string, unknown>) => {
            onMemberDetailsRef.current(data);
          };
        }
        fitTimerId = window.setTimeout(() => {
          const orgChart = instanceRef.current?.orgChart;
          if (!orgChart || !containerElement.isConnected) return;

          const rect = containerElement.getBoundingClientRect();
          const state = orgChart.getChartState?.();
          if (state && rect.width > 0 && rect.height > 0) {
            state.svgWidth = rect.width;
            state.svgHeight = rect.height;
          }

          orgChart.fit?.({ animate: false });
        }, 450);
      } catch (error) {
        if (containerElement.isConnected) {
          console.error('[OrganizationChart] initView failed:', error);
        }
      }
    });

    return () => {
      cancelAnimationFrame(frameId);
      window.clearTimeout(fitTimerId);

      const instance = instanceRef.current;
      if (instance) {
        instance.orgChart?.clear?.();
        if (instance.orgChart) {
          const orgChart = instance.orgChart;
          orgChart.render = () => orgChart;
        }
        instance.destroy?.();
        instanceRef.current = null;
      }
    };
  }, [chartId, yaml]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
};

type SelectedMember = OrganizationChartMember;

export const OrganizationChart: React.FC<OrganizationChartProps> = ({
  organizationName,
  members,
  teams = [],
}) => {
  const { navigate } = useRouter();
  const [selectedMember, setSelectedMember] = useState<SelectedMember | null>(null);
  const { activeTickets, loading: ticketsLoading } = useProfileTickets(
    selectedMember?.id ?? '',
    teams,
  );

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  const handleMemberDetails = (nodeData: Record<string, unknown>) => {
    const id = String(nodeData.id ?? '');
    const member = memberById.get(id);
    if (!member) return;
    setSelectedMember(member);
  };
  const membersKey = members
    .map(
      (member) =>
        `${member.id}:${member.name}:${member.email}:${member.role}:${member.reportsToUserId ?? ''}`,
    )
    .join(',');

  const yaml = useMemo(
    () => buildYaml(organizationName, members),
    [membersKey, members, organizationName],
  );

  if (members.length === 0) {
    return <p className="py-8 text-center text-sm text-neutral-500">No members to display.</p>;
  }

  const profilePath = selectedMember
    ? selectedMember.username
      ? `/${selectedMember.username}`
      : `/app/profile/${selectedMember.id}`
    : '';

  const handleNavigateProfile = () => {
    navigate(profilePath);
  };

  return (
    <div
      style={{ width: '100%', height: '100%', isolation: 'isolate' }}
      aria-label={`Org chart for ${organizationName}`}
    >
      <OrganizationChartMount key={yaml} yaml={yaml} onMemberDetails={handleMemberDetails} />

      {selectedMember && (
        <>
          {/* Overlay backdrop — click to close */}
          <div
            className="absolute inset-0 bg-black/30 transition-opacity dark:bg-black/50"
            onClick={() => setSelectedMember(null)}
            role="button"
            tabIndex={0}
            aria-label="Close profile"
            onKeyDown={(e) => e.key === 'Escape' && setSelectedMember(null)}
          />

          {/* Lightbox card */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-end">
            <div className="pointer-events-auto mr-6 w-full max-w-sm rounded-xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900">
              {/* Header with close button */}
              <div className="flex items-start justify-between border-b border-neutral-200 p-6 dark:border-neutral-700">
                <div>
                  <h2 className="text-lg font-semibold text-neutral-900 dark:text-white">
                    {selectedMember.name}
                  </h2>
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">
                    {selectedMember.username ? `@${selectedMember.username}` : 'No handle'}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedMember(null)}
                  className="flex-shrink-0 text-neutral-400 transition-colors hover:text-neutral-600 dark:hover:text-neutral-300"
                  aria-label="Close"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>

              {/* Content */}
              <div className="space-y-4 p-6">
                {/* Avatar */}
                {selectedMember.image && (
                  <div className="flex justify-center">
                    <img
                      src={selectedMember.image}
                      alt={selectedMember.name}
                      className="h-20 w-20 rounded-full object-cover ring-4 ring-neutral-100 dark:ring-neutral-800"
                    />
                  </div>
                )}

                {/* Role */}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                    Role
                  </p>
                  <p className="mt-1 text-sm font-medium capitalize text-neutral-900 dark:text-white">
                    {selectedMember.role}
                  </p>
                </div>

                {/* Email */}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                    Email
                  </p>
                  <p className="mt-1 truncate text-sm text-neutral-700 dark:text-neutral-300">
                    {selectedMember.email}
                  </p>
                </div>

                {/* Active tickets (if teams available) */}
                {teams.length > 0 && (
                  <div className="border-t border-neutral-200 pt-4 dark:border-neutral-700">
                    <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                      Work
                    </p>
                    <CompactTicketList
                      tickets={activeTickets}
                      loading={ticketsLoading}
                      maxItems={3}
                    />
                  </div>
                )}
              </div>

              {/* Footer with action button */}
              <div className="border-t border-neutral-200 p-6 dark:border-neutral-700">
                <button
                  onClick={handleNavigateProfile}
                  className="w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-neutral-800 dark:bg-neutral-700 dark:hover:bg-neutral-600"
                >
                  View Full Profile
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
