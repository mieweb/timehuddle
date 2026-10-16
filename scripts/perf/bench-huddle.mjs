// Huddle page load benchmark — run before and after a change against the
// heavy feed from seed-huddle-heavy.js, and compare the JSON it prints.
//
//   node scripts/perf/bench-huddle.mjs --base http://localhost:3001 \
//     --team <teamId> --label before [--runs 3] [--kbps 1024]
//
// Each run is a signed-in user opening /app/huddle on a cold HTTP cache, then
// clicking an older day. --kbps throttles the browser's download speed to
// approximate production's link (measured at roughly 0.05–1.3 MB/s).

import { chromium } from 'playwright';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const BASE = arg('base', 'http://localhost:3001');
const TEAM = arg('team');
const LABEL = arg('label', 'run');
const RUNS = Number(arg('runs', 3));
const KBPS = Number(arg('kbps', 0));
const EMAIL = arg('email', 'perfprobe@test.local');
const PASSWORD = arg('password', 'PerfProbe1!');
// Which day to open after the first load, counted from the newest (0). The
// seed spreads posts over 30 days, so day 18 is well past the first week on
// whatever date the benchmark runs.
const OLDER_INDEX = Number(arg('older-index', 18));
const DAY_LABEL = /^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}/; // "Mon, Sep 14"
if (!TEAM) throw new Error('--team is required (printed by seed-huddle-heavy.js)');

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function signIn(browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/app`);
  await page.getByRole('textbox', { name: 'Email address' }).fill(EMAIL);
  await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(/\/app\/(?!$)/);
  const state = await ctx.storageState();
  await ctx.close();
  return state;
}

async function run(browser, state) {
  const ctx = await browser.newContext({ storageState: state }); // empty HTTP cache
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  if (KBPS) {
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 80,
      downloadThroughput: KBPS * 1024,
      uploadThroughput: 512 * 1024,
    });
  }

  const urls = new Map();
  let httpBytes = 0;
  let postsRestBytes = 0;
  let wsBytes = 0;
  let postsWsBytes = 0;
  let postsDocs = 0;
  const subs = new Map();
  let teamsReadyAt = null;
  const t0 = Date.now();
  cdp.on('Network.requestWillBeSent', (e) => urls.set(e.requestId, e.request.url));
  cdp.on('Network.loadingFinished', (e) => {
    httpBytes += e.encodedDataLength;
    if (/huddle_getPosts/.test(urls.get(e.requestId) ?? '')) postsRestBytes += e.encodedDataLength;
  });
  cdp.on('Network.webSocketFrameSent', ({ response }) => {
    try {
      const m = JSON.parse(response.payloadData);
      if (m.msg === 'sub') subs.set(m.id, m.name);
    } catch {}
  });
  cdp.on('Network.webSocketFrameReceived', ({ response }) => {
    const len = response.payloadData.length;
    wsBytes += len;
    try {
      const m = JSON.parse(response.payloadData);
      if (m.collection === 'huddlePosts') {
        postsWsBytes += len;
        postsDocs++;
      }
      if (m.msg === 'ready' && m.subs.some((id) => subs.get(id) === 'teams.byUser'))
        teamsReadyAt ??= Date.now() - t0;
    } catch {}
  });

  const start = Date.now();
  await page.goto(`${BASE}/app/huddle?team=${TEAM}`);
  const list = page.getByRole('complementary', { name: 'Conversations' });
  await list.getByRole('listitem').nth(1).waitFor({ timeout: 180000 });
  const listVisibleMs = Date.now() - start;
  await page
    .getByRole('group', { name: /^Chat:/ })
    .getByText('Update 1', { exact: false })
    .first()
    .waitFor({ timeout: 180000 });
  const todayVisibleMs = Date.now() - start;

  // An older day: scroll the list until it is there (lazy windows load on
  // scroll), then open it and wait for its posts.
  const clickStart = Date.now();
  const days = list.getByRole('button', { name: DAY_LABEL });
  for (let i = 0; i < 40 && (await days.count()) <= OLDER_INDEX; i++) {
    await list.getByRole('listitem').last().scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
  }
  const older = days.nth(OLDER_INDEX);
  const olderDay = (await older.textContent()).match(DAY_LABEL)[0];
  await older.click();
  await page
    .getByRole('group', { name: `Chat: ${olderDay}` })
    .getByText('Update', { exact: false })
    .first()
    .waitFor({ timeout: 180000 });
  const olderDayMs = Date.now() - clickStart;

  await page.waitForTimeout(1500); // let trailing frames land
  await ctx.close();
  const kb = (n) => Math.round(n / 1024);
  return {
    listVisibleMs,
    todayVisibleMs,
    teamsSubReadyMs: teamsReadyAt,
    olderDayMs,
    postsRestKB: kb(postsRestBytes),
    postsWsKB: kb(postsWsBytes),
    postsWsDocs: postsDocs,
    totalKB: kb(httpBytes + wsBytes),
  };
}

const browser = await chromium.launch();
const state = await signIn(browser);
const runs = [];
for (let i = 0; i < RUNS; i++) {
  const r = await run(browser, state);
  console.error(`${LABEL} run ${i + 1}:`, JSON.stringify(r));
  runs.push(r);
}
await browser.close();

const summary = Object.fromEntries(
  Object.keys(runs[0]).map((k) => [k, median(runs.map((r) => r[k] ?? Infinity))]),
);
console.log(
  JSON.stringify({ label: LABEL, kbps: KBPS || 'unthrottled', runs: RUNS, median: summary }),
);
