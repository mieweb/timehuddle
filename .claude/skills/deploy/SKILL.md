---
name: deploy
description: Deploy, back up, and debug TimeHuddle on its os.mieweb.org containers (timehuddledev, timecore-dev, huddle, betahuddle, timecore-prod). Every dev deploy ends by publishing the testflight OTA bundle, and every prod deploy ends by publishing the production OTA bundle. Use when the user asks to deploy, ship, update, redeploy, restart, roll back, back up or restore the frontend, backend or MongoDB on dev, beta or prod, asks why a deploy or server is broken, or asks how the servers are set up.
---

# Deploy TimeHuddle

**Read [reference.md](reference.md) first.** It covers how each host actually runs
(pm2 apps, ports, env, DB, files, backups) and how the frontend talks to the backend.
The hosts are not set up alike: dev backend runs `meteor run` from source, prod backend
runs a built bundle, and beta frontend points at the **prod** backend.

## Hosts

| Env  | Role     | SSH alias       | Public URL                                        |
| ---- | -------- | --------------- | ------------------------------------------------- |
| dev  | frontend | `timehuddledev` | https://timehuddledev.os.mieweb.org               |
| dev  | backend  | `timecore-dev`  | https://timecore-dev.os.mieweb.org                |
| beta | frontend | `betahuddle`    | https://betahuddle.os.mieweb.org (→ prod backend) |
| prod | frontend | `huddle`        | https://huddle.os.mieweb.org                      |
| prod | backend  | `timecore-prod` | https://timecore-prod.os.mieweb.org               |

Aliases live in `~/.ssh/config` with key `~/.ssh/id_ed25519`. To check access, run
`ssh -o BatchMode=yes <alias> true`. If you get `Permission denied`, the user runs
`! ssh-copy-id -i ~/.ssh/id_ed25519.pub <alias>`. You can't type passwords.

## Ground rules

1. **Name the env and role.** If the user didn't say both, ask. Never assume prod.
2. **Show what ships and what's live.** Run `git fetch origin && git log --oneline -5 origin/main`
   locally, and `ssh <alias> 'cd ~/timehuddle && git log -1 --oneline'` on the host.
   Deploys take `origin/main`. Unpushed local commits don't ship.
3. **Prod, beta, or anything touching the prod DB: get an explicit "yes" in this
   conversation, naming the commit and the steps.** Approval for an earlier step doesn't
   carry over.
4. **Before any prod backend deploy, restore, migration, or debugging that writes data:
   take a backup (P1), then pull it off the host (P2).** Without both, don't proceed.
5. `sudo pm2 …` always. Never `--update-env`, never `pm2 delete` on a backend, never
   `git clean -x`. See reference.md for why.
6. Never print env values or secrets. Key names only.
7. Builds take minutes. Use a 600000 ms timeout or run them in the background.
8. **Every deploy ends with an OTA publish for that environment.** After a dev deploy,
   publish the `testflight` channel (D-OTA below). After a prod deploy, publish the
   `production` channel (P5). A deploy isn't done until the OTA step has run and been
   verified, or you've told the user why it was skipped.
9. **Native iOS/Android store builds are never part of a deploy.** Only build or upload
   to TestFlight, the App Store or Google Play when the user explicitly asks. Use the
   `mobile-release` skill.

## Frontend deploy (timehuddledev, huddle, betahuddle)

The same steps work on every frontend host. Only the pm2 app name differs. It's
`timehuddle-frontend` on all three today.

```bash
ssh <alias> 'bash -s' <<'EOF'
set -euo pipefail
cd ~/timehuddle
echo "before: $(git log -1 --oneline)"; git status -s
git fetch origin && git checkout main && git reset --hard origin/main && git clean -fd
echo "now:    $(git log -1 --oneline)"
sudo rm -rf /tmp/dist.prev; sudo cp -a dist /tmp/dist.prev 2>/dev/null || true   # instant rollback copy
sudo rm -rf node_modules && sudo npm ci --no-audit --no-fund   # see "Why npm ci" below
sudo rm -rf dist && sudo npm run build
test -f dist/index.html
sudo pm2 restart timehuddle-frontend && sudo pm2 save
sleep 3; curl -s -o /dev/null -w "local: HTTP %{http_code}\n" http://localhost:80/
EOF
curl -s -o /dev/null -w "public: HTTP %{http_code}\n" https://<public-host>
```

- **Rollback:** `sudo rm -rf dist && sudo mv /tmp/dist.prev dist && sudo pm2 restart timehuddle-frontend`
  (`git reset --hard <old sha>` too if you rebuild later).
- **Why npm ci, not npm install:** the root postinstall (`scripts/apply-patches.cjs`)
  fails with "Failed to apply patch for @kerebron/extension-menu" when `node_modules`
  still holds a previously patched copy. A clean `npm ci` (about 30 s) fixes it. This
  was hit on both dev hosts on 2026-11-22. CI's remote `npm install` in `main.yml` has
  the same flaw.
- **betahuddle** serves with `vite preview` and talks to the **prod** backend. Treat it
  as prod.

## Dev backend deploy (timecore-dev)

```bash
ssh timecore-dev 'bash -s' <<'EOF'
set -euo pipefail
cd ~/timehuddle
echo "before: $(git log -1 --oneline)"; git status -s
TS=$(date -u +%Y%m%dT%H%M%S); mkdir -p ~/backups
mongodump --quiet --db timecore --out ~/backups/dev_$TS     # cheap safety net
git fetch origin && git checkout main && git reset --hard origin/main && git clean -fd
echo "now:    $(git log -1 --oneline)"
sudo bash scripts/install-ffmpeg.sh || echo "⚠ keeping current ffmpeg"
sudo rm -rf node_modules && sudo npm ci --no-audit --no-fund
(cd meteor-backend && sudo npm install --no-audit --no-fund)
sudo pm2 restart timehuddle-meteor && sudo pm2 save
EOF
```

`meteor run` rebuilds from source on start, so health can take **1–3 minutes** to come
up. Do one bounded check, not a long poll:
`ssh timecore-dev 'for i in $(seq 1 18); do curl -sf localhost:3100/health && exit 0; sleep 10; done; exit 1'`.
If it still fails, read the logs (see Debugging).

## D-OTA: after a dev deploy, publish the testflight OTA

TestFlight installs load their web code from the dev backend's `testflight` channel.
Once both dev hosts are healthy on the new commit, publish that same commit there. The
user's working tree may be dirty (`vendor/ui`, WIP), so build from a clean worktree of
`origin/main`, never the working tree:

```bash
SHA=$(git rev-parse origin/main)                       # must equal what dev now runs
WT=<scratchpad>/ota-testflight
git worktree add --detach "$WT" "$SHA"
cp .env.testflight "$WT/"                              # dev backend URL + OTA_PUBLISH_TOKEN (gitignored)
(cd "$WT" && source ~/.nvm/nvm.sh && nvm use >/dev/null && npm ci --no-audit --no-fund && npm run ota:testflight)
git worktree remove --force "$WT"
curl -s "https://timecore-dev.os.mieweb.org/ota/latest?channel=testflight"   # version + publishedAt = now
```

- **Check the version first.** The bundle is published as `package.json`'s version, and
  phones only take a version **strictly newer** than the one they have. Prerelease tags
  are ignored. If `/ota/latest` already shows that version, publishing replaces the zip
  but TestFlight phones that have it won't update. Tell the user it needs a
  `package.json` bump (the normal release process), and don't invent a version.
- If the local publish fails on the token, run CI instead:
  `gh workflow run ota-publish.yml -f channel=testflight`. CI uses the repo's
  `OTA_PUBLISH_TOKEN` secret, which hasn't been confirmed against the dev backend.
- A publish writes into `meteor-backend/data/ota` on the dev backend, and `meteor run`
  may restart it. Re-check `/health` afterwards.

## Prod backend deploy (timecore-prod) ⚠️

CI's `deploy_prod` **does not rebuild the bundle**, so backend code only reaches prod
through these steps. Get confirmation (rule 3) before starting.

**P1 — Back up on the host** (pre-deploy snapshot, ~40 MB without videos):

```bash
ssh timecore-prod 'bash -s' <<'EOF'
set -euo pipefail
TS=$(date -u +%Y-%m-%dT%H-%M-%S); B=~/backups/predeploy_$TS
mkdir -p "$B" && chmod 700 "$B"
cd ~/timehuddle
git rev-parse HEAD > "$B/git-head"
mongodump --quiet --db timecore --out "$B/mongodb"
tar -czf "$B/uploads.tgz" -C meteor-backend uploads
sudo cp /root/.pm2/dump.pm2 "$B/pm2-dump.json"          # runtime env, holds secrets
cp meteor-backend/.env "$B/meteor-backend.env" 2>/dev/null || true
cp ecosystem.config.cjs "$B/" 2>/dev/null || true
sudo chown -R "$USER" "$B"; chmod 600 "$B"/*.json "$B"/*.env "$B"/*.cjs 2>/dev/null || true
# verify: one .bson per collection
echo "collections live: $(mongosh --quiet timecore --eval 'db.getCollectionNames().length')"
echo "collections dumped: $(ls "$B/mongodb/timecore"/*.bson | wc -l)"
du -sh "$B"; echo "BACKUP=$B"; df -h / | tail -1
EOF
```

The live and dumped collection counts must match. Videos (4 GB) are left out because
deploys don't touch them. Include `tar -czf "$B/videos.tgz" -C meteor-backend/data videos`
only if the change affects media, and check `df -h` first, since the disk is ~80% full.

**P2 — Copy the backup off the host** (to the user's machine, outside the repo):

```bash
mkdir -p ~/timehuddle-backups/prod
rsync -a timecore-prod:backups/predeploy_<TS> ~/timehuddle-backups/prod/
```

**P3 — Build and switch:**

```bash
ssh timecore-prod 'bash -s' <<'EOF'
set -euo pipefail
cd ~/timehuddle
git fetch origin && git checkout main && git reset --hard origin/main && git clean -fd
echo "now: $(git log -1 --oneline)"
cd meteor-backend
sudo rm -rf prod-build.prev && sudo cp -a prod-build prod-build.prev   # rollback copy
sudo npm install --no-audit --no-fund
(cd .. && sudo rm -rf node_modules && sudo npm ci --no-audit --no-fund)
sudo npm run build:prod                     # several minutes; overwrites prod-build/
(cd prod-build/bundle/programs/server && sudo npm install --omit=dev --no-audit --no-fund)
sudo pm2 restart timehuddle-meteor && sudo pm2 save
EOF
```

**P4 — Verify:**

```bash
ssh timecore-prod 'for i in $(seq 1 12); do curl -sf localhost:80/health && exit 0; sleep 5; done; exit 1'
curl -s https://timecore-prod.os.mieweb.org/health    # {"status":"ok",...}
curl -s https://timecore-prod.os.mieweb.org/hi        # hi from meteor backend
ssh timecore-prod 'sudo pm2 list; sudo pm2 logs timehuddle-meteor --err --lines 30 --nostream'
```

Then open https://huddle.os.mieweb.org and confirm login and the clock page load.

**P5 — Publish the production OTA** (after both prod backend and prod frontend are
verified). App Store and Play installs load their web code from the prod backend's
`production` channel. There's no production token locally, so this goes through CI. CI
builds `main`, so first check that `git rev-parse origin/main` still equals the commit
you just deployed. If main moved, stop and ask.

```bash
curl -s "https://timecore-prod.os.mieweb.org/ota/latest?channel=production"   # version before
gh workflow run ota-publish.yml -f channel=production
sleep 5; RUN=$(gh run list --workflow ota-publish.yml --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RUN" --exit-status
curl -s "https://timecore-prod.os.mieweb.org/ota/latest?channel=production"   # publishedAt = now
```

This reaches every store user, so it's covered by rule 3: name it in the prod
confirmation. The same version rule as D-OTA applies. If `/ota/latest` already has
`package.json`'s version, phones on it won't update until the version is bumped.

> `ota-publish.yml` also publishes `production` on **every push to main**, before prod
> is deployed. That breaks the "production OTA only with a prod deploy" rule and can ship
> web code that needs backend methods prod doesn't have yet. It only reaches phones when
> the version was bumped. The fix is to drop the `push:` trigger from `ota-publish.yml`.
> That's a workflow change, so make it only when the user asks.

**Rollback (code):**

```bash
ssh timecore-prod 'cd ~/timehuddle/meteor-backend && sudo mv prod-build prod-build.failed && sudo mv prod-build.prev prod-build && sudo pm2 restart timehuddle-meteor && sudo pm2 save'
```

Then reset the checkout to the SHA in `$B/git-head`.

**Restore (data). Destructive, so get explicit approval first:**

```bash
ssh timecore-prod 'sudo pm2 stop timehuddle-meteor &&
  mongorestore --drop --nsInclude "timecore.*" ~/backups/predeploy_<TS>/mongodb &&
  sudo pm2 start timehuddle-meteor'
```

Before restoring, take a fresh P1 backup, so the restore can be undone too.

## Backups: housekeeping

- List them: `ssh timecore-prod 'du -sh ~/backups/* | sort -k2'`.
- Prod disk is ~80% full. Suggest pruning old `full_backup_*` (about 1 GB each) **only
  with the user's approval**, and only once an off-host copy exists.
- Restore drill (safe, doesn't touch live data):
  `mongorestore --nsFrom 'timecore.*' --nsTo 'restore_check.*' <dir>/mongodb`, compare
  counts, then `mongosh restore_check --eval 'db.dropDatabase()'`.

## Debugging

| Symptom                                                    | Look at                                                                                                                                                                             |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Site down / 502                                            | `ssh <alias> 'sudo pm2 list'`. If pm2 is empty after a reboot: `sudo pm2 resurrect` (frontends have no startup unit)                                                                |
| App online but erroring                                    | `sudo pm2 logs <app> --lines 100 --nostream` (`--err` for stderr only)                                                                                                              |
| Frontend loads, but API calls fail or there's a CORS error | The backend's `CORS_ORIGINS` (pm2 env) must contain the frontend origin. Check which backend the bundle uses: `grep -o 'https://timecore[^"]*' dist/assets/*.js \| sort -u`         |
| Frontend points at the wrong backend                       | The `VITE_TIMECORE_URL` in the frontend host's `.env*` was baked into the build, so fix it and **rebuild**                                                                          |
| Backend health fails                                       | `curl -s localhost:<3100 dev / 80 prod>/health`, pm2 logs, `systemctl is-active mongod`, `mongosh --quiet --eval 'rs.status().ok'`                                                  |
| Mongo down                                                 | `sudo systemctl status mongod`, `sudo tail -50 /var/log/mongodb/mongod.log`                                                                                                         |
| Dev backend restart loop                                   | `sudo grep "timehuddle-meteor.*exited" /root/.pm2/pm2.log \| tail`. Usually a bad `npm install`, so try `sudo rm -rf node_modules && sudo npm ci` in the root and `meteor-backend/` |
| Disk full                                                  | `df -h /`, `sudo du -sh ~/backups/* /var/log/* ~/.pm2/logs`                                                                                                                         |
| See the runtime env (keys only)                            | `sudo pm2 jlist \| python3 -c "import json,sys;[print(sorted(p['pm2_env'].get('env',{}).keys())) for p in json.load(sys.stdin)]"`                                                   |
| CI not deploying                                           | `gh run list --workflow main.yml --limit 5`, then `gh run view <id> --log-failed`. A failed check skips the deploy                                                                  |

After any fix or deploy, update [reference.md](reference.md) if what you saw differs
from what it says.
