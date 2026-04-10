/**
 * TeamChart — Renders an interactive org chart using @mieweb/ychart (YChartEditor).
 */
import '@mieweb/ychart';
import React, { useEffect, useRef, useMemo } from 'react';

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
  handleFit?: () => void;
  orgChart?: OrgChartInstance;
};

declare global {
  interface Window {
    YChartEditor: new () => YChartInstance;
  }
}

interface Member {
  id: string;
  name: string;
  email?: string;
  isAdmin?: boolean;
}

interface TeamChartProps {
  teamName: string;
  members: Member[];
}

function buildYaml(teamName: string, members: Member[]): string {
  const lines: string[] = [];
  lines.push(`- id: 0`);
  lines.push(`  name: ${JSON.stringify(teamName)}`);
  lines.push(`  title: Team`);
  members.forEach((m, i) => {
    lines.push(`- id: ${i + 1}`);
    lines.push(`  parentId: 0`);
    lines.push(`  name: ${JSON.stringify(m.name)}`);
    if (m.isAdmin) lines.push(`  title: Admin`);
    if (m.email) lines.push(`  email: ${JSON.stringify(m.email)}`);
  });
  return lines.join('\n');
}

// Inner component: one mount = one initView, one unmount = one clean teardown.
// Remounted via key= in the outer component when data changes.
const TeamChartMount: React.FC<{ yaml: string; wrapperRef: React.RefObject<HTMLDivElement | null> }> = ({ yaml, wrapperRef }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<YChartInstance | null>(null);
  const chartId = useRef(
    `tc-${Date.now()}-${Math.random().toString(36).slice(2)}`
  ).current;

  useEffect(() => {
    const el = containerRef.current!;
    el.id = chartId;
    let fitTimerId = 0;

    // One RAF so the container has real layout dimensions before initView
    const rafId = requestAnimationFrame(() => {
      if (!el.isConnected) return;
      try {
        // Hide the outer wrapper while ychart does its animated initial layout
        // so the user never sees nodes flying in.
        const wrapper = wrapperRef.current;
        if (wrapper) wrapper.style.display = 'none';
        instanceRef.current = new window.YChartEditor().initView(chartId, yaml);
        // d3-org-chart's initial render runs a 400ms animated transition.
        // Wait until it completes, then show the wrapper (so
        // getBoundingClientRect returns real dimensions), snap-fit, done.
        fitTimerId = window.setTimeout(() => {
          const oc = instanceRef.current?.orgChart;
          if (!oc || !el.isConnected) return;
          if (wrapper) wrapper.style.display = '';
          // ychart defaults svgHeight to window.innerHeight-100, not the
          // container height. Correct both dimensions before calling fit so
          // the zoom calculation uses the actual visible area.
          const rect = el.getBoundingClientRect();
          const state = oc.getChartState?.();
          if (state && rect.width > 0 && rect.height > 0) {
            state.svgWidth = rect.width;
            state.svgHeight = rect.height;
          }
          oc.fit?.({ animate: false });
        }, 450);
      } catch (err) {
        // Unmounted before RAF fired is expected; anything else is a real error
        if (el.isConnected) console.error('[TeamChart] initView failed:', err);
      }
    });

    return () => {
      cancelAnimationFrame(rafId);
      window.clearTimeout(fitTimerId);

      const inst = instanceRef.current;
      if (inst) {
        // Step 1: Remove d3-org-chart's window resize + keydown listeners.
        // Without this, those listeners fire after the DOM is cleared and crash
        // on null.getBoundingClientRect().
        inst.orgChart?.clear?.();

        // Step 2: Patch render to a no-op as a safety net for any already-queued
        // RAF callbacks that slip through before clear() takes effect.
        if (inst.orgChart) {
          const oc = inst.orgChart;
          oc.render = () => oc;
        }

        // Step 3: Now safe — destroy clears innerHTML and frees React roots
        inst.destroy?.();
        instanceRef.current = null;
      }
    };
  }, []);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
};

export const TeamChart: React.FC<TeamChartProps> = ({ teamName, members }) => {
  const memberKey = members.map((m) => `${m.id}:${m.name}:${m.email ?? ''}:${m.isAdmin ? '1' : '0'}`).join(',');
  const yaml = useMemo(() => buildYaml(teamName, members), [teamName, memberKey]);
  const wrapperRef = useRef<HTMLDivElement>(null);

  if (members.length === 0) {
    return (
      <p className="text-center text-sm text-neutral-500 py-8">No members to display.</p>
    );
  }

  return (
    <div
      ref={wrapperRef}
      style={{ width: '100%', height: '500px' }}
      aria-label={`Org chart for ${teamName}`}
    >
      <TeamChartMount key={yaml} yaml={yaml} wrapperRef={wrapperRef} />
    </div>
  );
};
