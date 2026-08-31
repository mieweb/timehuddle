export declare const VERSION_RE: RegExp;
export declare function isValidVersion(value: unknown): boolean;
export declare function versionTuple(value: string | undefined | null): [number, number, number];
export declare function compareVersions(
  a: string | undefined | null,
  b: string | undefined | null,
): -1 | 0 | 1;
export declare function isOlder(
  candidate: string | undefined | null,
  than: string | undefined | null,
): boolean;
export declare function isNewer(
  candidate: string | undefined | null,
  current: string | undefined | null,
): boolean;
