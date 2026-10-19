// Builds the static site into dist/ for GitHub Pages: fetches the SOCS feed and
// writes the calendar JSON, the subscription feeds and one .ics per event
// alongside the files in public/. No dependencies.
//
//   node scripts/build.js                       fetch the live feed
//   FEED_FILE=feed.ics node scripts/build.js    build from a saved copy (no staff categories)
//
// PUBLIC_URL (e.g. https://mayfield-school.github.io/CalendarSite) is the site's
// address, used in subscription feeds and share links. The Pages workflow sets it.
//
// There are two views: the public one at / and a staff one at /staff/ that adds
// the staff-only categories. SOCS leaves those categories off events in its
// public feed, but its feed URL filtered to one of them (C1=<id>) returns
// exactly the events tagged with it, so each staff event is tagged that way.

import { readFile, writeFile, mkdir, rm, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseIcs, normaliseEvent, buildIcs } from '../lib/ics.js';
import { GROUPS, PRESETS, DEFAULT_PRESET, buildCategoryMeta } from '../lib/categories.js';
import { presetCats, makeMatcher, describeFilter, feedPath } from '../public/filter.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist');
// SOCS's own hostnames, not calendar.mayfieldgirls.org, so the build (and the
// SOCS feed links it gives out) keep working if that name is pointed at this site.
const FEED_URL = process.env.FEED_URL ||
  'https://calsync-website.socscms.com/calendarsync.ashx?Cal=Mayfield%20School%20Calendar&A=1&ID=3405';
// The same feed without "all events"; category filters are appended to it.
const SOCS_BASE = FEED_URL.replace(/&A=1\b/, '');
// SOCS's staff page lists every category with its id, including the staff-only ones (starred).
const STAFF_PAGE_URL = process.env.STAFF_PAGE_URL || 'https://calendar.misocs.com/staff/week.aspx?ID=3405';
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const CALENDAR_NAME = process.env.CALENDAR_NAME || 'Mayfield School';
const YEARS = [7, 8, 9, 10, 11, 12, 13];

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'MayfieldCalendar/1.0' }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
  return res.text();
}

const toEvents = (text) => parseIcs(text).map(normaliseEvent).filter(Boolean);
const byStart = (a, b) => a.s.localeCompare(b.s) || (a.st || '').localeCompare(b.st || '') || a.title.localeCompare(b.title);
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();

// name -> { param: 'C1=17633' | 'sid=15', staff }
async function socsCategories() {
  const html = await get(STAFF_PAGE_URL);
  const found = new Map();
  for (const m of html.matchAll(/id="(sCal|sid-)(\d+)"\s*\/?>\s*<label[^>]*>([^<]+)</g)) {
    const label = decode(m[3]);
    const staff = label.startsWith('*');
    found.set(staff ? label.slice(1).trim() : label, { param: `${m[1] === 'sCal' ? 'C1' : 'sid'}=${m[2]}`, staff });
  }
  if (!found.size) throw new Error('no categories found on the SOCS staff page');
  return found;
}

// ---------- fetch ----------

const text = process.env.FEED_FILE ? await readFile(process.env.FEED_FILE, 'utf8') : await get(FEED_URL);
// Fail the build rather than publish an empty calendar; Pages keeps the last good deploy.
if (!text.includes('BEGIN:VCALENDAR')) throw new Error('feed is not an iCalendar file');
const events = toEvents(text).sort(byStart);
if (!events.length) throw new Error('feed has no events');

let socs = new Map();
const staffEvents = structuredClone(events);
if (!process.env.FEED_FILE) {
  // If SOCS changes its page, keep publishing without staff categories rather than freezing the calendar.
  try { socs = await socsCategories(); } catch (err) { console.log(`::warning::Staff categories skipped: ${err.message}`); }
  const byId = new Map(staffEvents.map((ev) => [ev.id, ev]));
  for (const [name, { param, staff }] of socs) {
    if (!staff) continue;
    for (const ev of toEvents(await get(`${SOCS_BASE}&FT=OR&${param}&ST=0`))) {
      const known = byId.get(ev.id);
      if (known) { if (!known.cats.includes(name)) known.cats.push(name); }
      else { ev.cats.push(name); byId.set(ev.id, ev); staffEvents.push(ev); }
    }
  }
  staffEvents.sort(byStart);
}
const socsIds = new Map([...socs].map(([name, { param }]) => [name, param]));

// ---------- write ----------

await rm(OUT, { recursive: true, force: true });
await cp(path.join(ROOT, 'public'), OUT, { recursive: true });
const write = async (rel, body) => {
  await mkdir(path.dirname(path.join(OUT, rel)), { recursive: true });
  await writeFile(path.join(OUT, rel), body);
};
await write('.nojekyll', '');

let feedCount = 0;
async function writeView(list, { staff }) {
  const prefix = staff ? 'staff/' : '';
  const name = staff ? `${CALENDAR_NAME} Staff` : CALENDAR_NAME;
  const baseUrl = PUBLIC_URL && `${PUBLIC_URL}${staff ? '/staff' : ''}`;
  const seen = new Set();
  const counts = new Map();
  const today = new Date().toISOString().slice(0, 10);
  for (const ev of list) for (const c of ev.cats) {
    seen.add(c);
    if (ev.e >= today) counts.set(c, (counts.get(c) || 0) + 1);
  }
  const meta = {
    categories: buildCategoryMeta(seen, counts, { staff, socsIds }),
    groups: GROUPS, presets: PRESETS, defaultPreset: staff ? 'staff' : DEFAULT_PRESET, feedPrefix: prefix,
  };
  await write(`api/calendar${staff ? '-staff' : ''}.json`, JSON.stringify({
    fetchedAt: new Date().toISOString(), calendarName: name, publicUrl: PUBLIC_URL || null, socsFeedUrl: SOCS_BASE, ...meta, events: list,
  }));

  // Subscription feeds. Each is named by feedPath() so the browser links to the right one.
  const feed = (evs, title) => buildIcs(evs, { name: title, baseUrl });
  await write(`${prefix}calendar.ics`, feed(list, name));
  // Parents who subscribed through SOCS have webcal://calendar.mayfieldgirls.org/CalendarSync.ashx?...
  // saved. If that name points here, Pages serves this file and ignores the query string,
  // so every old subscription gets the full public calendar. SOCS's redirect uses the lower-case name.
  if (!staff) for (const old of ['CalendarSync.ashx', 'calendarsync.ashx']) await write(old, feed(list, name));
  const filters = [
    ...PRESETS.flatMap((p) => [undefined, ...YEARS].map((y) => ({ cats: presetCats(p, meta.categories), years: new Set(y ? [y] : []), q: '' }))),
    ...meta.categories.map((c) => ({ cats: new Set([c.slug]), years: new Set(), q: '' })),
  ];
  for (const f of filters) await write(feedPath(f, meta), feed(list.filter(makeMatcher(f, meta)), `${name} – ${describeFilter(f, meta)}`));
  feedCount += filters.length + 1;
}

await writeView(events, { staff: false });
await writeView(staffEvents, { staff: true });

// One file per event for "add to calendar". The public copy is used where an event is in both views.
const publicIds = new Set(events.map((ev) => ev.id));
for (const ev of [...events, ...staffEvents.filter((e) => !publicIds.has(e.id))]) {
  await write(`event/${ev.id}.ics`, buildIcs([ev], { name: CALENDAR_NAME, baseUrl: PUBLIC_URL }));
}

// The staff view is the same page pointed at the staff data; <base> keeps its links at the site root.
const page = await readFile(path.join(ROOT, 'public', 'index.html'), 'utf8');
const staffPage = page
  .replace('<html lang="en-GB">', '<html lang="en-GB" data-view="staff">')
  .replace('<meta charset="utf-8">', '<meta charset="utf-8">\n  <base href="../">\n  <meta name="robots" content="noindex">')
  .replace('<title>School Calendar | Mayfield School</title>', '<title>Staff Calendar | Mayfield School</title>')
  .replace('<img src="logo.svg" alt="Mayfield" width="183" height="48">', '<img src="logo.svg" alt="Mayfield" width="183" height="48"><span class="staff-badge">Staff</span>')
  .replace('<h1>School Calendar</h1>', '<h1>Staff Calendar</h1>')
  .replace('<p class="eyebrow">Mayfield School</p>', '<p class="eyebrow">Mayfield School · Staff</p>')
  .replace(/<p class="lede">[^<]*<\/p>/, '<p class="lede">Everything on the school calendar plus staff-only events. This page isn’t linked from the public calendar.</p>');
if (!['data-view="staff"', '<base href', 'staff-badge', 'staff-only events', '<h1>Staff Calendar</h1>'].every((t) => staffPage.includes(t))) throw new Error('could not build the staff page from public/index.html');
await write('staff/index.html', staffPage);

const staffOnly = staffEvents.filter((ev) => ev.cats.some((c) => socs.get(c)?.staff)).length;
console.log(`Built dist/ with ${events.length} events (${staffOnly} with staff categories), ${feedCount} feeds${PUBLIC_URL ? ` for ${PUBLIC_URL}` : ''}.`);
