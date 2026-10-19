// Printable month-per-sheet calendar, rendered in the browser by print.html. Port of titan's calprint (grid.py and
// calendar.html), with the same options and the same pagination rules:
//
// - A4 landscape, one month per sheet, Monday in the first column.
// - Continue mode (default): each day shows `perCell` events per sheet and
//   the SAME grid repeats on continuation sheets, so a date never moves.
//   Page count follows the busiest day. Past `maxPages` the remainder is
//   marked "+N more" rather than silently dropped.
// - Fit mode: one grid, each week row grows to its fullest day, and a long
//   month breaks between weeks, never through one. Every cell keeps a floor
//   of `minRows` written lines so quiet months still have room to write.
// - Full titles: wrap instead of ellipsing.
// - The month heading and day names repeat on every sheet (<thead>).


const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MAX_RANGE_MONTHS = 24;

export const DEFAULTS = { perCell: 5, maxPages: 4, minRows: 5 };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const addDays = (k, n) => { const d = new Date(`${k}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dow = (k) => (new Date(`${k}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
const lastOfMonth = (y, m) => `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
export const londonToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());

// ---------- options ----------

// Lenient on purpose: an empty form box submits "name=", which must mean
// "not set" rather than an error (the 422 calprint once hit).
function intOrNull(v) {
  const n = Number.parseInt(String(v ?? '').trim(), 10);
  return Number.isFinite(n) ? n : null;
}
const clamp = (v, lo, hi, dflt) => Math.max(lo, Math.min(intOrNull(v) ?? dflt, hi));
const truthy = (v) => /^(1|true|on|yes)$/i.test(String(v ?? ''));

function parseMonth(v) {
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(String(v ?? '').trim());
  return m && +m[2] >= 1 && +m[2] <= 12 ? { y: +m[1], m: +m[2] } : null;
}

export function resolveOptions(params) {
  const get = (k) => params.get(k);
  const today = londonToday();
  const thisMonth = { y: +today.slice(0, 4), m: +today.slice(5, 7) };
  // Default: this month to the end of next month.
  const nextMonth = thisMonth.m === 12 ? { y: thisMonth.y + 1, m: 1 } : { y: thisMonth.y, m: thisMonth.m + 1 };
  let start = parseMonth(get('start')) || thisMonth;
  let end = parseMonth(get('end')) || nextMonth;
  const idx = (x) => x.y * 12 + x.m - 1;
  if (idx(end) < idx(start)) [start, end] = [end, start];
  if (idx(end) - idx(start) >= MAX_RANGE_MONTHS) {
    const e = idx(start) + MAX_RANGE_MONTHS - 1;
    end = { y: Math.floor(e / 12), m: (e % 12) + 1 };
  }
  const maxTotal = intOrNull(get('max_total'));
  return {
    start, end,
    perCell: clamp(get('per_cell'), 1, 12, DEFAULTS.perCell),
    maxPages: clamp(get('max_pages'), 1, 8, DEFAULTS.maxPages),
    maxTotal: maxTotal && maxTotal > 0 ? Math.min(maxTotal, 120) : null,
    minRows: clamp(get('min_rows'), 1, 20, DEFAULTS.minRows),
    fit: truthy(get('fit')),
    wrap: truthy(get('wrap')),
  };
}

export function optionParams(o) {
  const p = new URLSearchParams({
    start: `${o.start.y}-${pad(o.start.m)}`, end: `${o.end.y}-${pad(o.end.m)}`,
    per_cell: o.perCell, max_pages: o.maxPages, min_rows: o.minRows,
  });
  if (o.maxTotal) p.set('max_total', o.maxTotal);
  if (o.fit) p.set('fit', 'true');
  if (o.wrap) p.set('wrap', 'true');
  return p;
}

// ---------- layout ----------

const isTimetable = (ev) => ev.cats.length === 1 && ev.cats[0] === 'Timetable';

function sortEvents(a, b) {
  // All-day first, longest span first among those, then by time.
  return (b.allDay - a.allDay) || (a.allDay ? b.e.localeCompare(a.e) : 0) ||
    (a.st || '').localeCompare(b.st || '') || a.title.localeCompare(b.title);
}

function buildMonth(byDay, y, m, o) {
  const first = `${y}-${pad(m)}-01`;
  const last = lastOfMonth(y, m);
  const weeksRaw = [];
  for (let d = addDays(first, -dow(first)); d <= last; d = addDays(d, 7)) {
    weeksRaw.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
  }
  const inMonth = (d) => d >= first && d <= last;
  const busiest = Math.max(0, ...weeksRaw.flat().filter(inMonth).map((d) => byDay.get(d)?.length || 0));

  let parts;
  let perCell = o.perCell;
  if (o.fit) { parts = 1; perCell = Math.max(busiest, 1); }
  else parts = Math.min(Math.max(1, Math.ceil(busiest / perCell)), o.maxPages);

  const pages = [];
  for (let part = 0; part < parts; part++) {
    const lo = part * perCell;
    const hi = lo + perCell;
    const lastPage = part === parts - 1;
    const weeks = weeksRaw.map((wk) => wk.map((d) => {
      if (!inMonth(d)) return { day: d, inMonth: false, events: [], hidden: 0 };
      const all = byDay.get(d) || [];
      return { day: d, inMonth: true, events: all.slice(lo, hi), hidden: lastPage && all.length > hi ? all.length - hi : 0 };
    }));
    pages.push({ y, m, part: part + 1, parts, weeks, busiest });
  }
  return pages;
}

export function buildPages(events, o) {
  const rangeStart = `${o.start.y}-${pad(o.start.m)}-01`;
  const rangeEnd = lastOfMonth(o.end.y, o.end.m);
  const byDay = new Map();
  const tt = new Map();
  for (const ev of events) {
    if (ev.e < rangeStart || ev.s > rangeEnd) continue;
    let d = ev.s < rangeStart ? rangeStart : ev.s;
    for (let i = 0; d <= ev.e && d <= rangeEnd && i < 400; i++, d = addDays(d, 1)) {
      if (isTimetable(ev)) { tt.set(d, ev.title); continue; }
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(ev);
    }
  }
  for (const list of byDay.values()) list.sort(sortEvents);

  let pages = [];
  const truncatedMonths = [];
  let dropped = 0;
  for (let y = o.start.y, m = o.start.m; y * 12 + m <= o.end.y * 12 + o.end.m; m === 12 ? (y++, m = 1) : m++) {
    const mp = buildMonth(byDay, y, m, o);
    const hidden = mp.reduce((n, p) => n + p.weeks.flat().reduce((k, c) => k + c.hidden, 0), 0);
    if (hidden) { truncatedMonths.push(`${MONTHS[m - 1]} ${y}`); dropped += hidden; }
    pages.push(...mp);
  }
  let hitTotalCap = false;
  if (o.maxTotal && pages.length > o.maxTotal) { pages = pages.slice(0, o.maxTotal); hitTotalCap = true; }

  const shown = new Set();
  for (const p of pages) for (const c of p.weeks.flat()) for (const ev of c.events) shown.add(ev.id);
  return {
    pages, tt, truncatedMonths, dropped, hitTotalCap,
    eventCount: shown.size,
    busiest: Math.max(0, ...pages.map((p) => p.busiest)),
  };
}

// ---------- rendering ----------

function displayTitle(ev) {
  const t = ev.sport && ev.team && ev.opponent ? `${ev.sport} ${ev.team} vs ${ev.opponent}` : ev.title;
  return ev.venue ? `${t} (${ev.venue[0]})` : t;
}

function renderCell(c, ctx, today) {
  const cls = [!c.inMonth && 'out', c.inMonth && dow(c.day) >= 5 && 'we', c.day === today && 'now'].filter(Boolean).join(' ');
  const tt = c.inMonth && ctx.tt.get(c.day);
  let html = `<td class="${cls}"><div class="dn"><span>${+c.day.slice(8)}</span>${tt ? `<span class="wk">${esc(tt)}</span>` : ''}</div>`;
  for (const ev of c.events) {
    const color = ctx.colorOf(ev);
    const cont = ev.allDay && ev.s < c.day;
    const tip = `${displayTitle(ev)}${ev.location ? ` — ${ev.location}` : ''}`;
    html += `<div class="ev${ev.allDay ? ' ad' : ''}${cont ? ' cont' : ''}" style="--c:${color}">` +
      (ev.allDay ? '' : `<span class="t">${ev.st}</span>`) +
      `<span class="s" title="${esc(tip)}">${esc(displayTitle(ev))}</span></div>`;
  }
  if (c.hidden) html += `<div class="more">+${c.hidden} more</div>`;
  return html + '</td>';
}

function renderSheet(p, ctx, o, today) {
  const title = `${MONTHS[p.m - 1]} ${p.y}`;
  const sub = p.parts === 1 ? '' : p.part === 1 ? `page 1 of ${p.parts}` : `continued — page ${p.part} of ${p.parts}`;
  const cls = ['cal', `rows-${p.weeks.length}`, o.fit && 'fit', o.wrap && 'wrap'].filter(Boolean).join(' ');
  return `<section class="sheet"><table class="${cls}"${o.fit ? ` style="--minrows:${o.minRows}"` : ''}><thead>` +
    `<tr class="mh"><th colspan="7"><div class="head"><h2>${title}</h2>${sub ? `<span class="cont">${sub}</span>` : ''}` +
    `<span class="sch">${esc(ctx.subtitle)}</span></div></th></tr>` +
    `<tr class="dh">${DAYS.map((d) => `<th>${d}</th>`).join('')}</tr></thead><tbody>` +
    p.weeks.map((w) => `<tr>${w.map((c) => renderCell(c, ctx, today)).join('')}</tr>`).join('') +
    `</tbody></table><div class="foot"><span>${esc(ctx.school)} · ${title}${p.parts > 1 ? ` · sheet ${p.part} of ${p.parts}` : ''}` +
    `${ctx.filterLabel ? ` · ${esc(ctx.filterLabel)}` : ''}</span><span>printed ${ctx.printed}</span></div></section>`;
}

function controls(o, ctx, built) {
  const f = (label, name, value, extra = '', tip = '') =>
    `<label class="f" title="${esc(tip)}"><span>${label}</span><input name="${name}" value="${esc(value)}" ${extra}></label>`;
  const check = (label, name, on, tip) =>
    `<label class="chk" title="${esc(tip)}"><input type="checkbox" name="${name}" value="true"${on ? ' checked' : ''}> ${label}</label>`;
  const hidden = [...ctx.filterParams].map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');
  const warn = [];
  if (built.truncatedMonths.length && !o.fit) {
    warn.push(`<b>${built.dropped} event${built.dropped === 1 ? '' : 's'} not shown.</b> ${esc(built.truncatedMonths.join(', '))} needed more than ${o.maxPages} page${o.maxPages === 1 ? '' : 's'}. ` +
      'Raise “Max pages/month”, lower “Per day”, or tick “Fit all events”. Affected days are marked <span class="more-i">+N more</span>.');
  }
  if (built.hitTotalCap) warn.push(`<b>Stopped at ${built.pages.length} pages.</b> The range needed more than the total-page limit. Raise it or shorten the range.`);

  return `<header class="bar noprint"><h1 class="sr-only">Print the calendar</h1><div class="bar-in">
  <a class="brand" href="${esc(ctx.homeHref)}" title="Back to the calendar"><img src="logo.svg" alt="Mayfield" width="137" height="36"></a>
  <form class="controls" method="get" action="print.html">${hidden}
    ${f('From', 'start', `${o.start.y}-${pad(o.start.m)}`, 'type="month" required')}
    ${f('To', 'end', `${o.end.y}-${pad(o.end.m)}`, 'type="month" required')}
    ${f('Per day', 'per_cell', o.perCell, 'type="number" min="1" max="12"', 'Events shown per day before continuing onto another sheet')}
    ${f('Max pages/month', 'max_pages', o.maxPages, 'type="number" min="1" max="8"', 'Most sheets any single month may use')}
    ${f('Total pages', 'max_total', o.maxTotal || '', 'type="number" min="1" max="120" placeholder="all"', 'Hard stop on total sheets')}
    ${f('Min lines/day', 'min_rows', o.minRows, 'type="number" min="1" max="20"', 'Smallest day box in fit mode, in written lines — keeps room to write on quiet months')}
    <div class="checks">
      ${check('Fit all events', 'fit', o.fit, 'Grow each row to fit its busiest day instead of continuing onto more sheets')}
      ${check('Full titles', 'wrap', o.wrap, 'Show each title in full, wrapping onto more lines, instead of cutting it off')}
    </div>
    <div class="actions">
      <button class="btn" type="submit">Update</button>
      <button class="btn btn-go" type="button" id="print-btn" title="Choose “Save as PDF” as the printer for a file to put in SharePoint or email">Print / Save as PDF</button>
    </div>
  </form></div>
  <div class="meta"><span>Showing <strong>${esc(ctx.filterLabel || 'all events')}</strong> · <a href="${esc(ctx.homeHref)}">change filters</a></span>
    <span>${built.pages.length} sheet${built.pages.length === 1 ? '' : 's'}${o.fit ? ` · fit mode, busiest day ${built.busiest} events` : ''} · ${built.eventCount} events in range</span></div>
</header>
${warn.map((w) => `<div class="warn noprint">${w}</div>`).join('')}`;
}

// Returns the page title and the <body> markup; print.html puts them in place.
export function renderPrintPage(events, o, ctx) {
  const built = buildPages(events, o);
  const today = londonToday();
  const fullCtx = { ...ctx, tt: built.tt };
  const range = o.start.y === o.end.y && o.start.m === o.end.m
    ? `${MONTHS[o.start.m - 1]} ${o.start.y}` : `${MONTHS[o.start.m - 1]} ${o.start.y} to ${MONTHS[o.end.m - 1]} ${o.end.y}`;
  const sheets = built.pages.length
    ? built.pages.map((p) => renderSheet(p, fullCtx, o, today)).join('\n')
    : '<section class="sheet"><p class="none">No events in that range.</p></section>';
  return {
    built,
    title: `${ctx.school} Calendar · ${range}`,
    body: `${controls(o, fullCtx, built)}
<main class="sheets">
${sheets}
</main>`,
  };
}
