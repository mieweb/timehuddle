/**
 * LoadFailedBoundary — wraps a code-split part of a page (`React.lazy`).
 *
 * That part is downloaded on first use, and the download can fail: Vite
 * re-bundled a dependency in dev, or a deploy replaced the file a tab still
 * asks for. Unhandled, the error unmounts the whole page and leaves a blank
 * area. Here it says so and offers a reload, which fetches the current file;
 * a retry in place cannot, since `React.lazy` keeps the failed result.
 */
import { Button, Text } from '@mieweb/ui';
import React from 'react';

interface Props {
  children: React.ReactNode;
}

export class LoadFailedBoundary extends React.Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('[LoadFailedBoundary]', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        role="alert"
        className="load-failed flex h-full flex-col items-center justify-center gap-3 p-6 text-center"
      >
        <Text variant="muted" size="sm">
          This part of the page didn’t load.
        </Text>
        <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    );
  }
}
