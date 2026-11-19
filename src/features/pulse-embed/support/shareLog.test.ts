import { describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/share', () => ({ Share: { share: vi.fn() } }));

import { fileUrlOf, sharePulseLog } from './shareLog';
import { SUPPORT_TEXT as T } from './supportStrings';

const LOG = {
  rel: 'logs/pulse.log',
  path: '/var/mobile/Containers/Data/Application/A B/Library/PulseKit/ns/logs/pulse.log',
  webUrl: 'capacitor://localhost/_capacitor_file_/x',
};

describe('fileUrlOf', () => {
  it('makes a native path a file URL, and leaves a URL alone', () => {
    expect(fileUrlOf('/a b/pulse.log')).toBe('file:///a%20b/pulse.log');
    expect(fileUrlOf('file:///a/pulse.log')).toBe('file:///a/pulse.log');
    expect(fileUrlOf('content://x/pulse.log')).toBe('content://x/pulse.log');
  });
});

describe('sharePulseLog', () => {
  it("hands Pulse's log file to the share sheet", async () => {
    const client = { logFile: vi.fn().mockResolvedValue(LOG) };
    const share = vi.fn().mockResolvedValue({});
    await expect(sharePulseLog(client, share)).resolves.toBe('shared');
    expect(client.logFile).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledWith({ title: T.log.fileTitle, files: [fileUrlOf(LOG.path)] });
  });

  it('reads a closed share sheet as dismissed, not a failure', async () => {
    const client = { logFile: vi.fn().mockResolvedValue(LOG) };
    const share = vi.fn().mockRejectedValue(new Error('Share canceled'));
    await expect(sharePulseLog(client, share)).resolves.toBe('dismissed');
  });

  it("fails when Pulse can't give its log or the sheet fails", async () => {
    const broken = { logFile: vi.fn().mockRejectedValue(new Error('unsupported')) };
    const share = vi.fn();
    await expect(sharePulseLog(broken, share)).rejects.toThrow('unsupported');
    expect(share).not.toHaveBeenCalled();
    const client = { logFile: vi.fn().mockResolvedValue(LOG) };
    await expect(
      sharePulseLog(client, vi.fn().mockRejectedValue(new Error('no activity'))),
    ).rejects.toThrow('no activity');
  });
});
