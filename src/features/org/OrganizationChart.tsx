import '@mieweb/ychart';
import React, { useEffect, useMemo, useRef } from 'react';

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
  role: 'owner' | 'admin' | 'member';
  reportsToUserId?: string | null;
}

interface OrganizationChartProps {
  organizationName: string;
  members: OrganizationChartMember[];
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
    if (member.email) {
      lines.push(`  email: ${JSON.stringify(member.email)}`);
    }
  });

  return lines.join('\n');
}

const OrganizationChartMount: React.FC<{ yaml: string }> = ({ yaml }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<YChartInstance | null>(null);
  const chartId = useRef(`oc-${Date.now()}-${Math.random().toString(36).slice(2)}`).current;

  useEffect(() => {
    const containerElement = containerRef.current!;
    containerElement.id = chartId;
    let fitTimerId = 0;

    const frameId = requestAnimationFrame(() => {
      if (!containerElement.isConnected) return;
      try {
        instanceRef.current = new window.YChartEditor().initView(chartId, yaml);
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

export const OrganizationChart: React.FC<OrganizationChartProps> = ({
  organizationName,
  members,
}) => {
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

  return (
    <div
      style={{ width: '100%', height: '100%', isolation: 'isolate' }}
      aria-label={`Org chart for ${organizationName}`}
    >
      <OrganizationChartMount key={yaml} yaml={yaml} />
    </div>
  );
};
