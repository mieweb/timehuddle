import { seedImportApi } from '../../lib/api';

export type SeedImportOutcome = {
  summary: string;
  created: {
    enterprises: number;
    organizations: number;
    teams: number;
    users: number;
    tickets: number;
  };
  updated: {
    enterprises: number;
    organizations: number;
    teams: number;
    users: number;
  };
};

/**
 * Parse-validates then imports a YAML seed document.
 * Throws if the YAML is structurally invalid or if the backend rejects it.
 * @param orgId - Optional organization ID to add top-level teams to.
 */
export async function runSeedImport(yaml: string, orgId?: string): Promise<SeedImportOutcome> {
  const preview = await seedImportApi.parse(yaml);
  if (!preview.ok) throw new Error(preview.error.message);
  const result = await seedImportApi.import(yaml, orgId);
  const summary =
    result.summary ??
    `Created: ${result.created.users} users, ${result.created.organizations} orgs, ${result.created.teams} teams, ${result.created.tickets} tickets`;
  return { ...result, summary };
}
