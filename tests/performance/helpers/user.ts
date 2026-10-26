// Perf account on the target env (sign up once; see PERF_PROVISION in auth.perf.spec.ts).
// No default credentials are shipped here on purpose — set PERF_EMAIL/PERF_PASSWORD
// so a working password for a real account is never published in the repo.
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is required to run the performance suite — set it to the perf test account's credentials.`,
    );
  }
  return value;
}

export const PERF_USER = {
  get email(): string {
    return requireEnv('PERF_EMAIL');
  },
  get password(): string {
    return requireEnv('PERF_PASSWORD');
  },
};
