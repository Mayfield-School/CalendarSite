// Print page: builds the printable calendar in the browser from the same
// filter (p/c/y/q) and print options (start, end, per_cell, ...) the URL carries.
import { parseFilter, encodeFilter, makeMatcher, describeFilter } from './filter.js';
import { resolveOptions, renderPrintPage } from './print-layout.js';

async function init() {
  const params = new URLSearchParams(location.search);
  // Opened from the staff view: use its data, and keep the flag through the options form.
  const staff = params.get('staff') === '1';
  if (staff) document.documentElement.dataset.view = 'staff';
  let data;
  try {
    const res = await fetch(staff ? 'api/calendar-staff.json' : 'api/calendar.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch {
    document.querySelector('.none').textContent = 'The calendar couldn’t be loaded. Please try again in a moment.';
    return;
  }
  const { categories, groups, presets, defaultPreset } = data;
  const meta = { categories, groups, presets, defaultPreset };

  const filter = parseFilter(params, meta);
  const match = makeMatcher(filter, meta);
  const filterParams = encodeFilter(filter, meta);
  if (filterParams.get('p') === defaultPreset && [...filterParams.keys()].length === 1) filterParams.delete('p');
  const homeHref = `${staff ? 'staff/' : './'}${filterParams.size ? `?${filterParams}` : ''}`;
  if (staff) filterParams.set('staff', '1');
  const colors = new Map(categories.map((c) => [c.name, c]));

  const events = data.events.filter(match);
  const ctx = {
    school: data.calendarName,
    subtitle: `${data.calendarName} Calendar`,
    filterLabel: describeFilter(filter, meta),
    filterParams,
    homeHref,
    colorOf: (ev) => (colors.get(ev.cats.find((c) => filter.cats.has(colors.get(c)?.slug)) || ev.cats[0]) || {}).color || '#013568',
    printed: new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date()),
  };

  const render = (p, focusName) => {
    const { title, body } = renderPrintPage(events, resolveOptions(p), ctx);
    document.title = title;
    document.body.innerHTML = body;
    document.getElementById('print-btn').addEventListener('click', () => window.print());
    // Ticking a box applies straight away, without the Update button.
    document.querySelectorAll('.controls input[type="checkbox"]').forEach((box) => box.addEventListener('change', () => {
      const next = new URLSearchParams(new FormData(box.form));
      history.replaceState(null, '', `?${next}`);
      render(next, box.name);
    }));
    if (focusName) document.querySelector(`.controls input[name="${focusName}"]`)?.focus();
  };
  render(params);
}

init();
