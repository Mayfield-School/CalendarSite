// Keeps a served copy of the site up to date (used in the container; see Dockerfile).
//
//   node scripts/publish.js           build now, then every 30 minutes
//   node scripts/publish.js --once    build once and stop
//   node scripts/publish.js --force   build once, and publish even if it has far fewer events
//   node scripts/publish.js --healthy exit 0 if the live copy was built in the last 2 hours
//
// Each build goes into its own folder under SITE_DIR/releases. Only a complete, believable build
// becomes SITE_DIR/current (a link, changed in one step), so on any failure the last good copy
// stays up. The last 3 are kept.

import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, readlink, rename, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { refusal } from '../lib/publish-check.js';

const SITE = path.resolve(process.env.SITE_DIR || '/site');
const RELEASES = path.join(SITE, 'releases');
const CURRENT = path.join(SITE, 'current');
const BUILD = path.join(path.dirname(fileURLToPath(import.meta.url)), 'build.js');
const EVERY = 30 * 60_000;
const RETRY = 5 * 60_000;
const BUILD_LIMIT = 10 * 60_000;
const STALE = 2 * 60 * 60_000;
const KEEP = 3;

const log = (text) => console.log(`${new Date().toISOString()} ${text}`);

async function health(folder) {
  try { return JSON.parse(await readFile(path.join(folder, 'health.json'), 'utf8')); } catch { return null; }
}

function build(out) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BUILD], {
      env: { ...process.env, OUT_DIR: out, STRICT: '1' }, stdio: 'inherit', timeout: BUILD_LIMIT, killSignal: 'SIGKILL',
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => (code === 0 ? resolve() : reject(new Error(`the build stopped (${signal || `code ${code}`})`))));
  });
}

// Removes all but the live copy and the newest others (including any left by an interrupted build).
async function tidy() {
  const live = await readlink(CURRENT).then((link) => path.basename(link), () => '');
  const names = (await readdir(RELEASES)).sort().reverse();
  const keep = new Set([live, ...names.filter((n) => n !== live).slice(0, KEEP - 1)]);
  for (const name of names) if (!keep.has(name)) await rm(path.join(RELEASES, name), { recursive: true, force: true });
}

async function publish({ force = false } = {}) {
  await mkdir(RELEASES, { recursive: true });
  const name = new Date().toISOString().replace(/[:.]/g, '-');
  const out = path.join(RELEASES, name);
  try {
    await build(out);
    const next = await health(out);
    const reason = refusal(await health(CURRENT), next);
    // Even --force never publishes an empty calendar.
    if (reason && !(force && !refusal(null, next))) throw new Error(`refused: ${reason}`);
    const link = path.join(SITE, 'next');
    await rm(link, { force: true });
    await symlink(path.join('releases', name), link);
    await rename(link, CURRENT);
  } catch (err) {
    await rm(out, { recursive: true, force: true });
    throw err;
  }
  log(`Published ${name}.`);
  // The new copy is live; a tidy problem must not count as a failed publish.
  await tidy().catch((err) => log(`Couldn't remove old copies: ${err.message}`));
}

const arg = process.argv[2];
if (arg === '--healthy') {
  const age = Date.now() - Date.parse((await health(CURRENT))?.builtAt ?? '');
  process.exit(age < STALE ? 0 : 1);
} else if (arg === '--once' || arg === '--force') {
  await publish({ force: arg === '--force' });
} else if (arg) {
  console.error(`Unknown option ${arg}`);
  process.exit(2);
} else {
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => process.exit(0));
  for (;;) {
    let wait = EVERY;
    try { await publish(); } catch (err) { log(`Not published, the last good copy stays up: ${err.message}`); wait = RETRY; }
    await new Promise((done) => setTimeout(done, wait));
  }
}
