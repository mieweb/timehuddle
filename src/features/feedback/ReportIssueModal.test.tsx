import { Share } from '@capacitor/share';
import type { PulseClient } from '@mieweb/pulse-embed';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SUPPORT_TEXT } from '../pulse-embed/support/supportStrings';
import { PULSE_EMBED_OFF, PulseEmbedContext, type PulseEmbed } from '../pulse-embed/usePulseEmbed';
import { ReportIssueModal } from './ReportIssueModal';

vi.mock('@capacitor/share', () => ({ Share: { share: vi.fn() } }));

// Mock window.open
const mockWindowOpen = vi.fn();

beforeEach(() => {
  vi.stubGlobal('window', {
    ...window,
    open: mockWindowOpen,
  });
});

afterEach(() => {
  cleanup();
  mockWindowOpen.mockClear();
  vi.unstubAllGlobals();
});

// Mock @mieweb/ui components
vi.mock('@mieweb/ui', () => ({
  Modal: ({
    children,
    open,
  }: {
    children: ReactNode;
    open: boolean;
    onOpenChange: (isOpen: boolean) => void;
  }) => (open ? <div data-testid="modal">{children}</div> : null),
  ModalHeader: ({ children }: { children: ReactNode }) => (
    <div data-testid="modal-header">{children}</div>
  ),
  ModalBody: ({ children }: { children: ReactNode }) => (
    <div data-testid="modal-body">{children}</div>
  ),
  ModalFooter: ({ children }: { children: ReactNode }) => (
    <div data-testid="modal-footer">{children}</div>
  ),
  Button: ({ children, onClick, ...rest }: { children: ReactNode; onClick?: () => void }) => (
    <button onClick={onClick} {...rest}>
      {children}
    </button>
  ),
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));

describe('ReportIssueModal', () => {
  it('does not render when open is false', () => {
    const onClose = vi.fn();
    render(<ReportIssueModal open={false} onClose={onClose} />);

    expect(screen.queryByTestId('modal')).toBeNull();
  });

  it('renders when open is true', () => {
    const onClose = vi.fn();
    render(<ReportIssueModal open={true} onClose={onClose} />);

    expect(screen.getByTestId('modal')).toBeTruthy();
    expect(screen.getByText('Report an Issue')).toBeTruthy();
  });

  it('displays GitHub Issues option with description', () => {
    const onClose = vi.fn();
    render(<ReportIssueModal open={true} onClose={onClose} />);

    expect(screen.getByText('GitHub Issues')).toBeTruthy();
    expect(
      screen.getByText('Report bugs, request features, or track development publicly'),
    ).toBeTruthy();
  });

  it('displays Pollenate Feedback option with description', () => {
    const onClose = vi.fn();
    render(<ReportIssueModal open={true} onClose={onClose} />);

    expect(screen.getByText('Pollenate Feedback')).toBeTruthy();
    expect(
      screen.getByText('Submit feedback or suggestions through our feedback portal'),
    ).toBeTruthy();
  });

  it('opens GitHub in new window and closes modal when GitHub option is clicked', () => {
    const onClose = vi.fn();
    render(<ReportIssueModal open={true} onClose={onClose} />);

    const githubButton = screen.getByText('GitHub Issues').closest('button');
    expect(githubButton).toBeTruthy();

    fireEvent.click(githubButton!);

    expect(mockWindowOpen).toHaveBeenCalledWith(
      'https://github.com/mieweb/timehuddle/issues/new',
      '_blank',
      'noopener,noreferrer',
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('opens Pollenate in new window and closes modal when Pollenate option is clicked', () => {
    const onClose = vi.fn();
    render(<ReportIssueModal open={true} onClose={onClose} />);

    const pollenateButton = screen.getByText('Pollenate Feedback').closest('button');
    expect(pollenateButton).toBeTruthy();

    fireEvent.click(pollenateButton!);

    // The URL will use whatever VITE_POLLENATE_BUGS_PAGE_SLUG is set to in the environment
    // Default is 'bug-reports', but in test environment it may be different
    expect(mockWindowOpen).toHaveBeenCalledTimes(1);
    expect(mockWindowOpen.mock.calls[0][0]).toMatch(
      /^https:\/\/pollenate\.dev\/f\/medical-informatics-engineering-3\/.+$/,
    );
    expect(mockWindowOpen.mock.calls[0][1]).toBe('_blank');
    expect(mockWindowOpen.mock.calls[0][2]).toBe('noopener,noreferrer');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes modal when Cancel button is clicked', () => {
    const onClose = vi.fn();
    render(<ReportIssueModal open={true} onClose={onClose} />);

    const cancelButton = screen.getByText('Cancel');
    expect(cancelButton).toBeTruthy();

    fireEvent.click(cancelButton);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockWindowOpen).not.toHaveBeenCalled();
  });
});

describe('ReportIssueModal with Pulse in the app', () => {
  const LOG = SUPPORT_TEXT.log;
  const logFile = vi.fn();
  const share = vi.mocked(Share.share);

  const renderWith = (pulse: Partial<PulseEmbed>, onClose = vi.fn()) =>
    render(
      <PulseEmbedContext.Provider value={{ ...PULSE_EMBED_OFF, ...pulse }}>
        <ReportIssueModal open={true} onClose={onClose} />
      </PulseEmbedContext.Provider>,
    );
  const ready = () => ({
    status: 'ready' as const,
    client: { logFile } as unknown as PulseClient,
  });

  beforeEach(() => {
    // The file's window stub (for window.open) is a plain copy that waitFor
    // can't observe; these tests open no window.
    vi.unstubAllGlobals();
    logFile.mockResolvedValue({
      rel: 'logs/pulse.log',
      path: '/data/PulseKit/ns/logs/pulse.log',
      webUrl: 'capacitor://localhost/_capacitor_file_/data/PulseKit/ns/logs/pulse.log',
    });
    share.mockResolvedValue({});
  });

  afterEach(() => {
    logFile.mockReset();
    share.mockReset();
  });

  it('offers no Pulse log outside the app, or before Pulse is ready', () => {
    renderWith({});
    expect(screen.queryByText(LOG.title)).toBeNull();
    cleanup();
    renderWith({ status: 'starting' });
    expect(screen.queryByText(LOG.title)).toBeNull();
  });

  it("attaches Pulse's log through the share sheet and keeps the dialog open", async () => {
    const onClose = vi.fn();
    renderWith(ready(), onClose);
    expect(screen.getByText(LOG.description)).toBeTruthy();

    fireEvent.click(screen.getByText(LOG.title).closest('button')!);

    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(LOG.shared));
    expect(logFile).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledWith({
      title: LOG.fileTitle,
      files: ['file:///data/PulseKit/ns/logs/pulse.log'],
    });
    expect(onClose).not.toHaveBeenCalled();
    // The person still picks where to report it.
    expect(screen.getByText('GitHub Issues')).toBeTruthy();
  });

  it("says so when Pulse can't give its log", async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    logFile.mockRejectedValueOnce(new Error('unsupported'));
    renderWith(ready());

    fireEvent.click(screen.getByText(LOG.title).closest('button')!);

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(LOG.failed));
    expect(share).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('shows nothing when the person closes the share sheet', async () => {
    share.mockRejectedValueOnce(new Error('Share canceled'));
    renderWith(ready());

    fireEvent.click(screen.getByText(LOG.title).closest('button')!);

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(''));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
