# Performance benchmarks

Reproduce a production slowdown locally and measure a fix before and after.

## Huddle page

Production's slow Huddle team carried pasted screenshots inline as base64 in
post text (~12 MB for 71 posts), downloaded twice per load (REST + the
`huddlePosts.byTeam` subscription).

1. Sign up `perfprobe@test.local` / `PerfProbe1!` in the local app (dev DB only).
2. Seed the heavy feed into the **local** database — never production:

   ```bash
   mongosh "mongodb://127.0.0.1:27017/timehuddle?replicaSet=rs0" scripts/perf/seed-huddle-heavy.js
   ```

   It prints the team id. Rerunning recreates the team from scratch. The
   backend's startup migration (`meteor-backend/server/inline-images.js`)
   moves the inline images out on its next restart, so for a "before" number
   run the benchmark against a backend without that migration.

3. Build the frontend against the local backend, serve it on a CORS-allowed
   port, and benchmark:

   ```bash
   VITE_TIMECORE_URL=http://localhost:3100 npx vite build --outDir /tmp/dist-bench
   npx serve -s /tmp/dist-bench -l 3001 &
   node scripts/perf/bench-huddle.mjs --team <teamId> --label after --runs 3 --kbps 1024
   ```

`--kbps` throttles the browser's download speed (production measured roughly
0.05–1.3 MB/s); omit it for an unthrottled run. The script prints medians as
JSON; compare the `before` and `after` lines.
