// Perf account on the target env (sign up once; see PERF_PROVISION in auth.perf.spec.ts).
export const PERF_USER = {
  email: process.env.PERF_EMAIL ?? 'perf-bot@test.local',
  password: process.env.PERF_PASSWORD ?? 'PerfTest1!',
};
