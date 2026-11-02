import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sources = vi.hoisted(() => ({
  list: vi.fn(),
  check: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
}));
const redmine = vi.hoisted(() => ({ status: vi.fn(), connect: vi.fn(), disconnect: vi.fn() }));
vi.mock('../../lib/api', () => ({ sourcesApi: sources, redmineApi: redmine }));
vi.mock('../../lib/TeamContext', () => ({ useTeam: () => ({ activeClockEvent: null }) }));
vi.mock('../../lib/useRedmineStatus', () => ({ notifyRedmineChanged: vi.fn() }));
vi.mock('../tickets/redmine/RedmineHiddenSuggestions', () => ({
  RedmineHiddenSuggestions: () => <div>Hidden suggestions</div>,
}));
vi.mock('../tickets/redmine/useRedmineSuggestions', () => ({
  invalidateSuggestionsCache: vi.fn(),
}));

const { SourcesCard } = await import('./SourcesCard');

const MAIN = 'https://main.example.com';
const unlinked = { connected: false, defaultBaseUrl: MAIN };
const linked = { connected: true, baseUrl: MAIN, redmineLogin: 'ada' };
const other = {
  host: 'other.example.com',
  baseUrl: 'https://other.example.com',
  prefix: 'OT',
  type: 'redmine',
  main: false,
  connected: false,
  rejected: false,
  login: null,
};

describe('SourcesCard', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    redmine.status.mockResolvedValue(unlinked);
    sources.list.mockResolvedValue({ servers: [] });
  });
  afterEach(cleanup);

  it('says so when there is no server at all', async () => {
    redmine.status.mockResolvedValue({ connected: false, defaultBaseUrl: null });
    render(<SourcesCard />);
    expect(await screen.findByText(/No servers are set up/)).toBeTruthy();
  });

  it('lists the main server and a registered one as the same kind of row', async () => {
    sources.list.mockResolvedValue({
      servers: [{ ...other, host: 'main.example.com', prefix: 'RMX', main: true }, other],
    });
    render(<SourcesCard />);
    expect(await screen.findByLabelText('API key for main.example.com')).toBeTruthy();
    expect(screen.getByText('RMX')).toBeTruthy();
    expect(screen.getByLabelText('API key for other.example.com')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Connect to / })).toHaveLength(2);
  });

  it('connects the main server through its own method', async () => {
    redmine.connect.mockResolvedValue(linked);
    redmine.status.mockResolvedValueOnce(unlinked).mockResolvedValue(linked);
    render(<SourcesCard />);
    fireEvent.change(await screen.findByLabelText('API key for main.example.com'), {
      target: { value: ' secret ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect to main.example.com' }));
    await screen.findByText('@ada');
    expect(redmine.connect).toHaveBeenCalledWith('secret', undefined);
    expect(sources.connect).not.toHaveBeenCalled();
  });

  it('offers Check and Disconnect on a connected main server', async () => {
    redmine.status.mockResolvedValue(linked);
    sources.check.mockResolvedValue({});
    render(<SourcesCard />);
    fireEvent.click(await screen.findByRole('button', { name: /Check your key on main/ }));
    await screen.findByText('Your key works.');
    expect(sources.check).toHaveBeenCalledWith(MAIN);
    expect(screen.getByRole('button', { name: /Disconnect from main/ })).toBeTruthy();
  });

  it('connects a registered server with the typed key, then clears it', async () => {
    sources.list.mockResolvedValueOnce({ servers: [other] });
    sources.list.mockResolvedValue({ servers: [{ ...other, connected: true, login: 'grace' }] });
    sources.connect.mockResolvedValue({});
    render(<SourcesCard />);
    fireEvent.change(await screen.findByLabelText('API key for other.example.com'), {
      target: { value: 'secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect to other.example.com' }));
    await screen.findByText('OT · @grace');
    expect(sources.connect).toHaveBeenCalledWith(other.baseUrl, 'secret');
    expect(screen.queryByLabelText('API key for other.example.com')).toBeNull();
  });

  it('shows why a connect failed', async () => {
    sources.list.mockResolvedValue({ servers: [other] });
    sources.connect.mockRejectedValue(new Error('That API key was rejected by the server.'));
    render(<SourcesCard />);
    fireEvent.change(await screen.findByLabelText('API key for other.example.com'), {
      target: { value: 'bad' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect to other.example.com' }));
    expect((await screen.findByText(/rejected by the server/)).getAttribute('role')).toBe('alert');
  });

  it('rereads when a check fails, showing the key as rejected', async () => {
    const connected = { ...other, connected: true, login: 'grace' };
    sources.list.mockResolvedValueOnce({ servers: [connected] });
    sources.list.mockResolvedValue({ servers: [{ ...other, rejected: true }] });
    sources.check.mockRejectedValue(new Error('Your Redmine API key was rejected.'));
    render(<SourcesCard />);
    fireEvent.click(await screen.findByRole('button', { name: /Check your key on other/ }));
    await screen.findByText("Couldn't reach");
    await waitFor(() => expect(sources.list).toHaveBeenCalledTimes(2));
  });
});
