/**
 * The Pulse log for a bug report (TH-4, RR-15): Pulse writes its own log on
 * the phone (`logFile()`, redacted), and Report an Issue hands it to the share
 * sheet, so the person can attach it to the GitHub issue or the feedback
 * form. TimeHuddle has no crash reporter yet; this is what support gets
 * meanwhile.
 */
import type { PulseClient } from '@mieweb/pulse-embed';
import { Share } from '@capacitor/share';

import { SUPPORT_TEXT as T } from './supportStrings';

/** A native path as the share sheet takes it: a `file://` URL. */
export function fileUrlOf(path: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) return path;
  return `file://${path.startsWith('/') ? '' : '/'}${encodeURI(path)}`;
}

export type ShareLogResult = 'shared' | 'dismissed';

/**
 * Ask Pulse for its log and open the share sheet with it. Resolves
 * `dismissed` when the person closed the sheet (which rejects on some
 * platforms); throws when Pulse or the sheet failed.
 */
export async function sharePulseLog(
  client: Pick<PulseClient, 'logFile'>,
  share: (options: { title: string; files: string[] }) => Promise<unknown> = (options) =>
    Share.share(options),
): Promise<ShareLogResult> {
  const file = await client.logFile();
  try {
    await share({ title: T.log.fileTitle, files: [fileUrlOf(file.path)] });
    return 'shared';
  } catch (error) {
    if (/cancel/i.test(String((error as { message?: unknown })?.message ?? error))) {
      return 'dismissed';
    }
    throw error;
  }
}
