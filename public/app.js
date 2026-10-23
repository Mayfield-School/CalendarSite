import { parseFilter, encodeFilter, makeMatcher, describeFilter, presetCats, sameSet, feedPath, socsFeed } from './filter.js';

// The staff view (/staff/) is this page with data-view="staff"; it loads data that includes the staff-only categories.
const STAFF = document.documentElement.dataset.view === 'staff';
const FILTER_KEY = STAFF ? 'mfcal:staff:filter' : 'mfcal:filter';

// ---------- helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

const pad = (n) => String(n).padStart(2, '0');
const fromKey = (k) => new Date(Date.UTC(+k.slice(0, 4), k.slice(5, 7) - 1, +k.slice(8, 10)));
const toKey = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addDays = (k, n) => { const d = fromKey(k); d.setUTCDate(d.getUTCDate() + n); return toKey(d); };
const addMonths = (k, n) => { const d = fromKey(k.slice(0, 8) + '01'); d.setUTCMonth(d.getUTCMonth() + n); return toKey(d); };
const dow = (k) => (fromKey(k).getUTCDay() + 6) % 7; // Monday = 0
const daysBetween = (a, b) => Math.round((fromKey(b) - fromKey(a)) / 86400000);
const todayKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
const fmt = (k, o) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...o }).format(fromKey(k));
const isKey = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(fromKey(s).getTime());
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const ICON = {
  clock: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  pin: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  users: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/></svg>',
  flag: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
};

// ---------- state ----------
const S = {
  data: null, meta: null, byId: new Map(), catByName: new Map(), catBySlug: new Map(),
  view: 'month', date: todayKey(), selected: null, listDays: 60, openEvent: null,
  showAll: false, // month view: every event in each day instead of three; never saved, so off on every load
  filter: null, match: () => true, byDay: new Map(), tt: new Map(),
};

const isTimetable = (ev) => ev.cats.length === 1 && ev.cats[0] === 'Timetable';
const displayTitle = (ev) => (ev.sport && ev.team && ev.opponent ? `${ev.sport} ${ev.team} vs ${ev.opponent}` : ev.title);
const catOf = (ev) => {
  const pick = ev.cats.find((c) => S.filter.cats.has(S.catByName.get(c)?.slug)) || ev.cats[0];
  return S.catByName.get(pick) || { color: '#013568', label: pick };
};
const colorOf = (ev) => catOf(ev).color;
const yearLabel = (ys) => (ys.length === 1 ? `Year ${ys[0]}` : `Years ${ys.slice(0, -1).join(', ')} & ${ys.at(-1)}`);

function venueBadge(ev) {
  if (!ev.venue) return '';
  return `<span class="venue ${ev.venue.toLowerCase()}" title="${ev.venue} fixture" aria-hidden="true">${ev.venue === 'Neutral' ? 'N' : ev.venue}</span><span class="sr-only">${ev.venue} fixture:</span>`;
}

function timeText(ev, day) {
  if (ev.allDay) {
    if (ev.e === ev.s) return 'All day';
    const n = daysBetween(ev.s, ev.e) + 1;
    if (day && day !== ev.s) return `Day ${daysBetween(ev.s, day) + 1} of ${n}`;
    return `All day · until ${fmt(ev.e, { weekday: 'short', day: 'numeric', month: 'short' })}`;
  }
  return ev.et ? `${ev.st} – ${ev.et}` : ev.st;
}

function whenLong(ev) {
  const long = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
  if (ev.allDay) {
    if (ev.s === ev.e) return `${fmt(ev.s, long)} · All day`;
    return `${fmt(ev.s, { weekday: 'long', day: 'numeric', month: 'long' })} – ${fmt(ev.e, long)} (${daysBetween(ev.s, ev.e) + 1} days)`;
  }
  if (ev.s !== ev.e) return `${fmt(ev.s, { weekday: 'short', day: 'numeric', month: 'short' })} ${ev.st} – ${fmt(ev.e, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}${ev.et ? ` ${ev.et}` : ''}`;
  return `${fmt(ev.s, long)} · ${ev.et ? `${ev.st} – ${ev.et}` : ev.st}`;
}

function relative(ev) {
  const t = todayKey();
  if (ev.s <= t && ev.e >= t) return ev.s === ev.e ? 'Today' : 'On now';
  const n = daysBetween(t, ev.s);
  if (n === 1) return 'Tomorrow';
  if (n < 14) return `In ${n} days`;
  if (n < 60) return `In ${Math.round(n / 7)} weeks`;
  return `In ${Math.round(n / 30)} months`;
}

// ---------- indexing ----------
function buildIndex() {
  S.match = makeMatcher(S.filter, S.meta);
  const byDay = new Map();
  const tt = new Map();
  for (const ev of S.data.events) {
    if (!S.match(ev)) continue;
    let d = ev.s;
    for (let i = 0; d <= ev.e && i < 120; i++, d = addDays(d, 1)) {
      if (isTimetable(ev)) { tt.set(d, ev.title.replace(/^week\s*/i, 'Week ')); continue; }
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(ev);
    }
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => (b.allDay - a.allDay) ||
      (a.allDay ? daysBetween(b.s, b.e) - daysBetween(a.s, a.e) : 0) ||
      (a.st || '').localeCompare(b.st || '') || a.title.localeCompare(b.title));
  }
  S.byDay = byDay;
  S.tt = tt;
}

// ---------- rendering ----------
function chip(ev, day) {
  const cont = ev.allDay && ev.s < day;
  return `<button class="ev${ev.allDay ? ' allday' : ''}${cont ? ' cont-l' : ''}" data-id="${ev.id}" style="--c:${colorOf(ev)}" title="${esc(displayTitle(ev))}">` +
    `${ev.allDay ? '' : `<span class="t">${ev.st}</span>`}${venueBadge(ev)}<span class="n">${esc(displayTitle(ev))}</span></button>`;
}

function card(ev, day) {
  const cat = catOf(ev);
  const meta = [`<span>${timeText(ev, day)}</span>`];
  if (ev.location) meta.push(`<span>${esc(ev.location)}</span>`);
  if (ev.venue) meta.push(`<span>${ev.venue}</span>`);
  meta.push(`<span class="tag">${esc(cat.label)}</span>`);
  if (ev.years.length) meta.push(`<span>${yearLabel(ev.years)}</span>`);
  return `<button class="card" data-id="${ev.id}" style="--c:${cat.color}"><span><span class="card-title">${esc(displayTitle(ev))}</span>` +
    `<span class="card-meta">${meta.join('')}</span></span></button>`;
}

function agendaDay(d, evs) {
  const t = S.tt.get(d);
  const body = evs.length ? evs.map((ev) => card(ev, d)).join('') : '<p class="hint">No events match your filters on this day.</p>';
  return `<div class="agenda-day"><div class="ad-date${d === todayKey() ? ' today' : ''}">` +
    `<div class="dow">${fmt(d, { weekday: 'short' })}</div><div class="d">${+d.slice(8)}</div><div class="m">${fmt(d, { month: 'short' })}</div>` +
    `${t ? `<span class="tt">${esc(t)}</span>` : ''}</div><div>${body}</div></div>`;
}

function emptyState(msg) {
  return `<div class="empty-state"><h3>Nothing to show</h3><p>${msg}</p>` +
    `<button class="btn btn-ghost" data-action="reset">Reset filters</button></div>`;
}

function renderMonth() {
  const first = S.date.slice(0, 8) + '01';
  const month = first.slice(0, 7);
  const today = todayKey();
  let d = addDays(first, -dow(first));
  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  let html = `<div class="month" role="table" aria-label="${fmt(first, { month: 'long', year: 'numeric' })}"><div class="dow-row" role="row">${DOW.map((x, i) => `<div role="columnheader" aria-label="${dayNames[i]}">${x}</div>`).join('')}</div>`;
  do {
    html += '<div class="week-row" role="row">';
    for (let i = 0; i < 7; i++, d = addDays(d, 1)) {
      const evs = S.byDay.get(d) || [];
      const t = S.tt.get(d);
      const cls = ['day', d.slice(0, 7) !== month && 'other', i >= 5 && 'weekend', d === today && 'today', d === S.selected && 'selected'].filter(Boolean).join(' ');
      const max = S.showAll ? Infinity : 3;
      html += `<div class="${cls}" data-day="${d}" role="cell">` +
        `<div class="day-head"><button class="num" data-day="${d}" aria-controls="day-panel" aria-label="${fmt(d, { weekday: 'long', day: 'numeric', month: 'long' })}${d === today ? ' (today)' : ''}, ${evs.length} event${evs.length === 1 ? '' : 's'}">${+d.slice(8)}</button>${t ? `<span class="tt">${esc(t)}</span>` : ''}</div>` +
        evs.slice(0, max).map((ev) => chip(ev, d)).join('') +
        (evs.length > max ? `<button class="more" data-day="${d}">+${evs.length - max} more</button>` : '') +
        `<div class="dots" aria-hidden="true">${evs.slice(0, 5).map((ev) => `<i style="--c:${colorOf(ev)}"></i>`).join('')}</div></div>`;
    }
    html += '</div>';
  } while (d.slice(0, 7) === month);
  html += '</div><div class="day-panel" id="day-panel"></div>';
  $('#view').innerHTML = html;
  renderDayPanel();
}

function renderDayPanel() {
  const panel = $('#day-panel');
  if (!panel) return;
  panel.innerHTML = S.selected ? agendaDay(S.selected, S.byDay.get(S.selected) || []) : '';
}

function renderWeek() {
  const start = addDays(S.date, -dow(S.date));
  const today = todayKey();
  let html = '<div class="week-grid">';
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i);
    const evs = S.byDay.get(d) || [];
    const t = S.tt.get(d);
    html += `<div class="week-col${d === today ? ' today' : ''}"><div class="week-col-head"><div class="dow">${fmt(d, { weekday: 'short' })}${t ? ` · <span class="tt">${esc(t)}</span>` : ''}</div><div class="d">${+d.slice(8)} <small style="font-size:14px;font-family:var(--sans);color:var(--muted)">${fmt(d, { month: 'short' })}</small></div></div>` +
      `<div class="week-col-body">${evs.length ? evs.map((ev) => card(ev, d)).join('') : '<div class="empty">No events</div>'}</div></div>`;
  }
  $('#view').innerHTML = html + '</div>';
}

function renderList() {
  const span = S.filter.q ? 730 : S.listDays;
  let html = '';
  let lastMonth = '';
  let count = 0;
  for (let i = 0, d = S.date; i < span; i++, d = addDays(d, 1)) {
    const evs = S.byDay.get(d);
    if (!evs?.length) continue;
    if (d.slice(0, 7) !== lastMonth) { lastMonth = d.slice(0, 7); html += `<h3 class="month-sep">${fmt(d, { month: 'long', year: 'numeric' })}</h3>`; }
    html += agendaDay(d, evs);
    count++;
  }
  const end = addDays(S.date, span);
  const moreLeft = [...S.byDay.keys()].some((k) => k >= end);
  if (!count) html = emptyState(S.filter.q ? `No events match “${esc(S.filter.q)}”.` : 'No events match your filters in this period.');
  if (moreLeft && !S.filter.q) html += '<div class="load-more"><button class="btn btn-ghost" data-action="more">Show more events</button></div>';
  $('#view').innerHTML = html;
}

function renderLabel() {
  $('#show-all-wrap').hidden = S.view !== 'month';
  let label;
  if (S.view === 'month') label = fmt(S.date, { month: 'long', year: 'numeric' });
  else if (S.view === 'week') {
    const a = addDays(S.date, -dow(S.date)); const b = addDays(a, 6);
    label = a.slice(0, 7) === b.slice(0, 7)
      ? `${+a.slice(8)} – ${fmt(b, { day: 'numeric', month: 'long', year: 'numeric' })}`
      : `${fmt(a, { day: 'numeric', month: 'short' })} – ${fmt(b, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  } else label = S.filter.q ? 'Search results' : `From ${fmt(S.date, { day: 'numeric', month: 'long', year: 'numeric' })}`;
  $('#range-label').textContent = label;
  document.querySelectorAll('.segmented button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === S.view)));
  const unit = { month: 'month', week: 'week', list: '30 days' }[S.view];
  $('#prev').setAttribute('aria-label', `Previous ${unit}`);
  $('#next').setAttribute('aria-label', `Next ${unit}`);
}

function renderActiveFilters() {
  const def = presetCats(S.meta.presets.find((p) => p.id === S.meta.defaultPreset), S.meta.categories);
  const isDefault = sameSet(def, S.filter.cats) && !S.filter.years.size && !S.filter.q;
  $('#active-filters').innerHTML = `<span>Showing: <strong>${esc(describeFilter(S.filter, S.meta))}</strong></span>` +
    (isDefault ? '' : '<button class="link-btn" data-action="reset">Reset</button>');
  const n = (sameSet(def, S.filter.cats) ? 0 : 1) + (S.filter.years.size ? 1 : 0);
  $('#filter-count').textContent = n || '';
}

function renderComingUp() {
  const keySlugs = new Set(S.meta.categories.filter((c) => c.group === 'key').map((c) => c.slug));
  const match = makeMatcher({ cats: keySlugs, years: S.filter.years, q: '' }, S.meta);
  const today = todayKey();
  const perCat = new Map();
  const seen = new Set();
  const picks = [];
  for (const ev of S.data.events) {
    if (picks.length >= 4) break;
    if (ev.e < today || !match(ev) || seen.has(ev.title)) continue;
    const c = ev.cats[0];
    if ((perCat.get(c) || 0) >= 2) continue;
    perCat.set(c, (perCat.get(c) || 0) + 1);
    seen.add(ev.title);
    picks.push(ev);
  }
  $('#coming-up').innerHTML = picks.map((ev) => `<button class="cu-card" data-id="${ev.id}">` +
    `<span class="cu-date"><span class="d">${+ev.s.slice(8)}</span><span class="m">${fmt(ev.s, { month: 'short' })}</span></span>` +
    `<span class="cu-text"><span class="cu-title">${esc(displayTitle(ev))}</span><span class="cu-when">${relative(ev)}</span></span></button>`).join('');
}

function render() {
  renderLabel();
  renderActiveFilters();
  if (S.view === 'month') renderMonth();
  else if (S.view === 'week') renderWeek();
  else renderList();
}

// ---------- filters panel ----------
function renderFilters() {
  const f = S.filter;
  $('#presets').innerHTML = S.meta.presets.map((p) =>
    `<button class="chip" data-preset="${p.id}" aria-pressed="${sameSet(presetCats(p, S.meta.categories), f.cats)}">${esc(p.name)}</button>`).join('');

  const years = [7, 8, 9, 10, 11, 12, 13];
  const yLabel = { 12: 'Y12 (L6)', 13: 'Y13 (U6)' };
  $('#years').innerHTML = `<button class="chip" data-year="all" aria-pressed="${!f.years.size}">All</button>` +
    years.map((y) => `<button class="chip" data-year="${y}" aria-pressed="${f.years.has(y)}">${yLabel[y] || `Y${y}`}</button>`).join('');

  $('#categories').innerHTML = S.meta.groups.map((g) => {
    // Hide categories with no upcoming events to keep the list short.
    const cats = S.meta.categories.filter((c) => c.group === g.id && c.count > 0);
    if (!cats.length) return '';
    const allOn = cats.every((c) => f.cats.has(c.slug));
    return `<div class="cat-group"><div class="cat-group-head"><strong>${esc(g.name)}</strong>` +
      `<button class="link-btn" data-group="${g.id}" data-on="${!allOn}">${allOn ? 'None' : 'All'}</button></div>` +
      cats.map((c) => `<label class="cat" style="--c:${c.color}"><input type="checkbox" data-cat="${c.slug}"${f.cats.has(c.slug) ? ' checked' : ''}>` +
        `<span class="box"></span><span class="name">${esc(c.label)}</span><span class="count" title="Upcoming events">${c.count}<span class="sr-only"> upcoming</span></span></label>`).join('') +
      '</div>';
  }).join('');
}

function filtersChanged({ keepFocus } = {}) {
  buildIndex();
  if (!keepFocus) renderFilters();
  else {
    // Update pressed states without rebuilding (keeps keyboard focus on the checkbox).
    document.querySelectorAll('[data-preset]').forEach((b) => b.setAttribute('aria-pressed', String(sameSet(presetCats(S.meta.presets.find((p) => p.id === b.dataset.preset), S.meta.categories), S.filter.cats))));
    document.querySelectorAll('[data-group]').forEach((b) => {
      const cats = S.meta.categories.filter((c) => c.group === b.dataset.group && c.count > 0);
      const allOn = cats.every((c) => S.filter.cats.has(c.slug));
      b.textContent = allOn ? 'None' : 'All'; b.dataset.on = String(!allOn);
    });
  }
  renderComingUp();
  render();
  syncUrl();
}

function resetFilters() {
  S.filter = parseFilter(new URLSearchParams(), S.meta);
  $('#search').value = '';
  filtersChanged();
}

function toggleDrawer(open) {
  $('#filters').classList.toggle('open', open);
  document.body.classList.toggle('filters-shown', open);
  $('#filters-open').setAttribute('aria-expanded', String(open));
  if (open) $('#filters-close').focus();
  else if (matchMedia('(max-width: 1000px)').matches) $('#filters-open').focus();
}

// ---------- URL ----------
function filterParams() {
  const p = encodeFilter(S.filter, S.meta);
  if (p.get('p') === S.meta.defaultPreset && [...p.keys()].length === 1) p.delete('p');
  return p;
}

function syncUrl() {
  const p = filterParams();
  store.set(FILTER_KEY, p.toString());
  if (S.view) p.set('v', S.view);
  if (S.date !== todayKey()) p.set('d', S.date);
  if (S.openEvent) p.set('e', S.openEvent);
  history.replaceState(null, '', `${location.pathname}${p.size ? `?${p}` : ''}`);

  // Print the month on screen and the one after, with the same filters.
  const pp = filterParams();
  pp.set('start', S.date.slice(0, 7));
  pp.set('end', addMonths(S.date, 1).slice(0, 7));
  if (STAFF) pp.set('staff', '1');
  $('#print-link').href = `print.html?${pp}`;
}

// ---------- event dialog ----------
function googleLink(ev) {
  const c = (d, t) => d.replace(/-/g, '') + (t ? `T${t.replace(':', '')}00` : '');
  let dates;
  if (ev.allDay) dates = `${c(ev.s)}/${c(addDays(ev.e, 1))}`;
  else {
    const [h, m] = ev.st.split(':').map(Number);
    const end = ev.et || `${pad(Math.min(h + 1, 23))}:${pad(m)}`;
    dates = `${c(ev.s, ev.st)}/${c(ev.e, end)}`;
  }
  const p = new URLSearchParams({ action: 'TEMPLATE', text: displayTitle(ev), dates, ctz: 'Europe/London', details: shareUrl(ev), location: ev.location || '' });
  return `https://calendar.google.com/calendar/render?${p}`;
}

function outlookLink(ev) {
  const p = new URLSearchParams({ path: '/calendar/action/compose', rru: 'addevent', subject: displayTitle(ev), location: ev.location || '', body: shareUrl(ev) });
  if (ev.allDay) { p.set('allday', 'true'); p.set('startdt', ev.s); p.set('enddt', addDays(ev.e, 1)); }
  else {
    const [h, m] = ev.st.split(':').map(Number);
    p.set('startdt', `${ev.s}T${ev.st}:00`);
    p.set('enddt', `${ev.e}T${ev.et || `${pad(Math.min(h + 1, 23))}:${pad(m)}`}:00`);
  }
  return `https://outlook.office.com/calendar/0/deeplink/compose?${p}`;
}

// The site root. publicUrl is its full address without a trailing slash, e.g.
// https://mayfield-school.github.io/CalendarSite; the staff page's <base> points at the root too.
const siteBase = () => (S.data.publicUrl ? `${S.data.publicUrl}/` : new URL('.', document.baseURI).href);
const pageBase = () => siteBase() + (STAFF ? 'staff/' : '');
const shareUrl = (ev) => `${pageBase()}?e=${ev.id}`;

function openEvent(id) {
  // Staff-only events have SOCS's own number with an "s" in front (old SOCS staff links use the number alone).
  const ev = S.byId.get(id) || S.byId.get(`s${id}`);
  if (!ev) return;
  id = ev.id;
  const dlg = $('#event-dialog');
  dlg.style.setProperty('--c', colorOf(ev));
  const row = (icon, html) => `<div class="ev-row">${icon}<span>${html}</span></div>`;
  const rows = [row(ICON.clock, esc(whenLong(ev)))];
  if (ev.venue) rows.push(row(ICON.flag, `${ev.venue} fixture${ev.opponent ? ` vs ${esc(ev.opponent)}` : ''}`));
  if (ev.location) rows.push(row(ICON.pin, esc(ev.location)));
  if (ev.years.length) rows.push(row(ICON.users, yearLabel(ev.years)));
  $('#event-body').innerHTML =
    `<h2 id="ev-title">${esc(displayTitle(ev))}</h2>` +
    `<div class="ev-rows">${rows.join('')}</div>` +
    `<div>${ev.cats.map((c) => { const m = S.catByName.get(c); return `<span class="pill" style="--c:${m?.color || '#013568'}">${esc(m?.label || c)}</span>`; }).join('')}</div>` +
    '<h3>Add to your calendar</h3><div class="btn-row">' +
    `<a class="btn btn-ghost" href="event/${ev.id}.ics" download>Apple / Outlook app (.ics)</a>` +
    `<a class="btn btn-ghost" href="${esc(googleLink(ev))}" target="_blank" rel="noopener">Google Calendar</a>` +
    `<a class="btn btn-ghost" href="${esc(outlookLink(ev))}" target="_blank" rel="noopener">Outlook on the web</a></div>` +
    '<h3>Share</h3><div class="btn-row">' +
    `<button class="btn btn-ghost" data-copy="${esc(shareUrl(ev))}">Copy link</button>` +
    (navigator.share ? `<button class="btn btn-ghost" data-share="${ev.id}">Share…</button>` : '') +
    (ev.url ? `<a class="btn btn-ghost" href="${esc(ev.url)}" target="_blank" rel="noopener">Details on SOCS <span aria-hidden="true">↗</span><span class="sr-only">(opens in a new tab)</span></a>` : '') + '</div>';
  S.openEvent = id;
  syncUrl();
  if (!dlg.open) dlg.showModal();
}

// ---------- subscribe dialog ----------
// Three kinds of feed: this site's tidied feed for the current filter (presets,
// optionally with one year group, or a single category), SOCS's own feed for
// any other mix of categories, and everything.
function feedLinks(mode) {
  const https = mode === 'current' ? siteBase() + feedPath(S.filter, S.meta)
    : mode === 'socs' ? socsFeed(S.filter, S.meta, S.data.socsFeedUrl).url
    : `${siteBase()}${S.meta.feedPrefix || ''}calendar.ics`;
  const webcal = https.replace(/^https?:/, 'webcal:');
  const name = mode === 'all' ? `${S.data.calendarName} – everything` : `${S.data.calendarName} – ${describeFilter(S.filter, S.meta)}`;
  const enc = encodeURIComponent;
  return {
    https, webcal,
    google: `https://calendar.google.com/calendar/render?cid=${enc(webcal)}`,
    outlook365: `https://outlook.office.com/calendar/0/addfromweb?url=${enc(https)}&name=${enc(name)}`,
    outlookcom: `https://outlook.live.com/calendar/0/addfromweb?url=${enc(https)}&name=${enc(name)}`,
  };
}

function renderSubscribe(mode) {
  const own = feedPath(S.filter, S.meta);
  const socs = own ? null : socsFeed(S.filter, S.meta, S.data.socsFeedUrl);
  const available = [own && 'current', socs && 'socs', 'all'].filter(Boolean);
  if (!available.includes(mode)) mode = available[0];
  const today = todayKey();
  const upcoming = (match) => S.data.events.filter((e) => e.e >= today && match(e)).length;
  const L = feedLinks(mode);
  const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname) && !S.data.publicUrl;
  const radio = (value, title, detail, disabled = false) =>
    `<label class="radio"><input type="radio" name="submode" value="${value}"${mode === value ? ' checked' : ''}${disabled ? ' disabled' : ''}><span><strong>${title}</strong><small>${detail}</small></span></label>`;

  let mine;
  if (own) mine = radio('current', 'My filtered calendar', `${esc(describeFilter(S.filter, S.meta))} — ${upcoming(S.match)} upcoming events`);
  else if (socs) {
    // SOCS filters by category only, so count what it will actually send.
    const catsOnly = makeMatcher({ cats: S.filter.cats, years: new Set(), q: '' }, S.meta);
    const caveats = [
      S.filter.years.size && 'SOCS can’t filter by year group, so this includes every year.',
      S.filter.q && `The search “${esc(S.filter.q)}” isn’t applied.`,
      socs.missing.length && `Not included: ${esc(socs.missing.join(', '))}.`,
    ].filter(Boolean);
    mine = radio('socs', 'My filtered calendar', `${esc(describeFilter(S.filter, S.meta))} — about ${upcoming(catsOnly)} upcoming events, sent straight from the school’s SOCS calendar.${caveats.length ? ` ${caveats.join(' ')}` : ''}`);
  } else mine = radio('current', 'My filtered calendar', 'Choose at least one category to subscribe to a filtered calendar.', true);

  $('#subscribe-body').innerHTML =
    '<h2 id="sub-title">Sync to your calendar</h2>' +
    '<p class="note" style="margin-top:8px">Subscribe once and new or changed events appear on your phone and computer automatically.</p>' +
    `<div class="sub-options">${mine}` +
    radio('all', 'Everything', `All categories${STAFF ? ', including staff-only' : ''} — ${upcoming(() => true)} upcoming events`) + '</div>' +
    (mode === 'socs' ? '<p class="note">Tip: for a feed limited to one year group, choose an “I am…” option and a single year.</p>' : '') +
    '<div class="sub-apps">' +
    `<a class="app-btn" href="${esc(L.webcal)}"><strong>Apple Calendar</strong><small>iPhone, iPad and Mac</small></a>` +
    `<a class="app-btn" href="${esc(L.google)}" target="_blank" rel="noopener"><strong>Google Calendar</strong><small>Android and web — then it syncs to your phone</small></a>` +
    `<a class="app-btn" href="${esc(L.outlook365)}" target="_blank" rel="noopener"><strong>Outlook (work / school)</strong><small>Microsoft 365 accounts</small></a>` +
    `<a class="app-btn" href="${esc(L.outlookcom)}" target="_blank" rel="noopener"><strong>Outlook.com</strong><small>Personal Hotmail / Outlook accounts</small></a></div>` +
    '<h3>Other apps</h3><p class="note" style="margin-top:0">Copy this address into your calendar app’s “Subscribe” or “Add from URL” option.</p>' +
    `<div class="copy-row"><input readonly value="${esc(L.https)}" aria-label="Calendar feed address"><button class="btn btn-primary" data-copy="${esc(L.https)}">Copy</button></div>` +
    `<p class="note">Prefer a one-off snapshot? <a href="${esc(L.https)}" download="mayfield-calendar.ics">Download an .ics file</a> instead (won’t update automatically). Google can take up to 24 hours to show changes; Apple and Outlook update every few hours.</p>` +
    (local && mode !== 'socs' ? '<div class="warn"><strong>Preview mode:</strong> this site is running on a private address, so subscription links only work on this computer. They will work for everyone once the calendar is published at a public web address.</div>' : '');
}

// ---------- misc ----------
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Link copied'); }
  catch { prompt('Copy this link:', text); }
}

function move(dir) {
  if (S.view === 'month') S.date = addMonths(S.date, dir);
  else if (S.view === 'week') S.date = addDays(S.date, 7 * dir);
  else { S.date = addDays(S.date, 30 * dir); S.listDays = 60; }
  S.selected = null;
  render(); syncUrl();
}

function setView(v) {
  if (!['month', 'week', 'list'].includes(v)) return;
  S.view = v; S.listDays = 60;
  render(); syncUrl();
}

function updatedText() {
  if (!S.data.fetchedAt) return '';
  const mins = Math.round((Date.now() - new Date(S.data.fetchedAt)) / 60000);
  const when = mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.round(mins / 60)} h ago` : new Date(S.data.fetchedAt).toLocaleDateString('en-GB');
  return `Calendar updated ${when}.`;
}

function bind() {
  document.addEventListener('click', (e) => {
    const t = e.target.closest('button, a, .day, input');
    if (e.target === document.body && document.body.classList.contains('filters-shown')) return toggleDrawer(false);
    if (!t) return;
    if (t.dataset.id) return openEvent(t.dataset.id);
    if (t.dataset.copy) return copy(t.dataset.copy);
    if (t.dataset.share) { const ev = S.byId.get(t.dataset.share); return navigator.share({ title: displayTitle(ev), text: whenLong(ev), url: shareUrl(ev) }).catch(() => {}); }
    if (t.dataset.view) return setView(t.dataset.view);
    if (t.dataset.action === 'reset') return resetFilters();
    if (t.dataset.action === 'clear-cats') { S.filter.cats.clear(); return filtersChanged(); }
    if (t.dataset.action === 'more') { S.listDays += 60; return renderList(); }
    if (t.dataset.preset) { S.filter.cats = presetCats(S.meta.presets.find((p) => p.id === t.dataset.preset), S.meta.categories); return filtersChanged(); }
    if (t.dataset.year) {
      if (t.dataset.year === 'all') S.filter.years.clear();
      else { const y = +t.dataset.year; S.filter.years.has(y) ? S.filter.years.delete(y) : S.filter.years.add(y); }
      return filtersChanged();
    }
    if (t.dataset.group) {
      const on = t.dataset.on === 'true';
      for (const c of S.meta.categories) if (c.group === t.dataset.group) on ? S.filter.cats.add(c.slug) : S.filter.cats.delete(c.slug);
      return filtersChanged();
    }
    if (t.dataset.day && S.view === 'month') {
      S.selected = S.selected === t.dataset.day ? null : t.dataset.day;
      document.querySelectorAll('.day.selected').forEach((x) => x.classList.remove('selected'));
      if (S.selected) document.querySelector(`.day[data-day="${S.selected}"]`)?.classList.add('selected');
      renderDayPanel();
      if (S.selected && (t.classList.contains('more') || matchMedia('(max-width: 720px)').matches)) $('#day-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });

  $('#categories').addEventListener('change', (e) => {
    const slug = e.target.dataset.cat;
    if (!slug) return;
    e.target.checked ? S.filter.cats.add(slug) : S.filter.cats.delete(slug);
    filtersChanged({ keepFocus: true });
  });

  let searchTimer;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      S.filter.q = e.target.value.trim();
      if (S.filter.q && S.view !== 'list') { S.view = 'list'; S.date = todayKey(); }
      filtersChanged({ keepFocus: true });
    }, 180);
  });

  $('#today').addEventListener('click', () => { S.date = todayKey(); S.selected = S.view === 'month' ? S.date : null; render(); syncUrl(); });
  $('#prev').addEventListener('click', () => move(-1));
  $('#next').addEventListener('click', () => move(1));
  $('#reset-filters').addEventListener('click', resetFilters);
  $('#filters-open').addEventListener('click', () => toggleDrawer(true));
  $('#filters-close').addEventListener('click', () => toggleDrawer(false));
  $('#filters-done').addEventListener('click', () => toggleDrawer(false));

  // Browsers restore a ticked box on reload; start unticked to match S.showAll.
  $('#show-all').checked = false;
  $('#show-all').addEventListener('change', (e) => { S.showAll = e.target.checked; if (S.view === 'month') renderMonth(); });

  $('#subscribe-open').addEventListener('click', () => { renderSubscribe(); $('#subscribe-dialog').showModal(); });
  $('#subscribe-body').addEventListener('change', (e) => { if (e.target.name === 'submode') renderSubscribe(e.target.value); });

  for (const dlg of document.querySelectorAll('dialog')) {
    dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); });
  }
  $('#event-dialog').addEventListener('close', () => { S.openEvent = null; syncUrl(); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('filters-shown')) return toggleDrawer(false);
    if (document.querySelector('dialog[open]') || e.ctrlKey || e.metaKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.key === 'ArrowLeft') move(-1);
    else if (e.key === 'ArrowRight') move(1);
  });
}

// ---------- boot ----------
async function init() {
  try {
    const res = await fetch(STAFF ? 'api/calendar-staff.json' : 'api/calendar.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    S.data = await res.json();
  } catch {
    $('#view').innerHTML = '<div class="empty-state"><h3>The calendar couldn’t be loaded</h3><p>Please try again in a moment, or use the <a href="https://calendar.misocs.com/week.aspx?ID=3405">original school calendar</a>.</p></div>';
    return;
  }
  const { categories, groups, presets, defaultPreset, feedPrefix } = S.data;
  S.meta = { categories, groups, presets, defaultPreset, feedPrefix };
  for (const ev of S.data.events) S.byId.set(ev.id, ev);
  for (const c of categories) { S.catByName.set(c.name, c); S.catBySlug.set(c.slug, c); }

  const params = new URLSearchParams(location.search);
  let fp = params;
  if (!['p', 'c', 'y', 'q'].some((k) => params.has(k))) fp = new URLSearchParams(store.get(FILTER_KEY) || '');
  S.filter = parseFilter(fp, S.meta);
  $('#search').value = S.filter.q;
  S.view = params.get('v') || (matchMedia('(max-width: 720px)').matches ? 'list' : 'month');
  if (isKey(params.get('d'))) S.date = params.get('d');

  bind();
  buildIndex();
  renderFilters();
  renderComingUp();
  render();
  syncUrl();
  $('#updated').textContent = updatedText();
  setInterval(() => { $('#updated').textContent = updatedText(); }, 60_000);
  if (params.get('e')) openEvent(params.get('e'));
}

init();
