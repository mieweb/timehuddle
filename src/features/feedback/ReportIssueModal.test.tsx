import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportIssueModal } from './ReportIssueModal';

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
  ModalHeader: ({ children }: { children: ReactNode }) => <div data-testid="modal-header">{children}</div>,
  ModalBody: ({ children }: { children: ReactNode }) => <div data-testid="modal-body">{children}</div>,
  ModalFooter: ({ children }: { children: ReactNode }) => <div data-testid="modal-footer">{children}</div>,
  Button: ({ children, onClick, ...rest }: { children: ReactNode; onClick?: () => void }) => (
    <button onClick={onClick} {...rest}>
      {children}
    </button>
  ),
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
    expect(screen.getByText('Report bugs, request features, or track development publicly')).toBeTruthy();
  });

  it('displays Pollenate Feedback option with description', () => {
    const onClose = vi.fn();
    render(<ReportIssueModal open={true} onClose={onClose} />);

    expect(screen.getByText('Pollenate Feedback')).toBeTruthy();
    expect(screen.getByText('Submit feedback or suggestions through our feedback portal')).toBeTruthy();
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
