export declare function isValidTimeZone(timeZone: string | null | undefined): boolean;

export declare function getLocalDayBoundary(
  epochMs: number,
  timeZone: string | null | undefined,
): { startMs: number; endMs: number };

export declare function getLocalDateKey(
  epochMs: number,
  timeZone: string | null | undefined,
): string;
