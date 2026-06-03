function readEnv(name: string): string | undefined {
  const raw = process.env[name];
  const value = raw?.trim();
  return value ? value : undefined;
}

export const DEFAULT_ORG_KEY = readEnv("DEFAULT_ORG_KEY") ?? "default";
export const DEFAULT_ORG_NAME = readEnv("DEFAULT_ORG_NAME") ?? "Default Organization";
export const DEFAULT_ENTERPRISE_SLUG =
  readEnv("DEFAULT_ENTERPRISE_SLUG") ?? `${DEFAULT_ORG_KEY}-enterprise`;
export const DEFAULT_ENTERPRISE_NAME = readEnv("DEFAULT_ENTERPRISE_NAME") ?? "Default Enterprise";
