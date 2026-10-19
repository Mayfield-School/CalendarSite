import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveOptions, buildPages, renderPrintPage } from '../public/print-layout.js';
import { tidyCaps } from '../lib/ics.js';

const ev = (id, s, opts = {}) => ({ id: String(id), title: `Event ${id}`, s, e: opts.e || s, st: opts.allDay ? null : (opts.st || '09:00'), et: null, allDay: !!opts.allDay, location: null, cats: opts.cats || ['General'], years: [] });
const opts = (q) => resolveOptions(new URLSearchParams(q));

// 7 events on 24 Nov 2026, 1 on the 2nd, a timetable marker, and a 3-day all-day event.
const events = [
  ...Array.from({ length: 7 }, (_, i) => ev(i, '2026-11-24', { st: `1${i}:00` })),
  ev(100, '2026-11-02'),
  ev(200, '2026-11-09', { allDay: true, cats: ['Timetable'] }),
  ev(300, '2026-11-10', { allDay: true, e: '2026-11-12' }),
];

test('blank and junk form values fall back to defaults instead of failing', () => {
  const o = opts('start=junk&end=&per_cell=&max_pages=abc&max_total=&min_rows=');
  assert.equal(o.perCell, 5);
  assert.equal(o.maxPages, 4);
  assert.equal(o.maxTotal, null);
  assert.equal(o.minRows, 5);
  assert.equal(opts('per_cell=99&min_rows=0').perCell, 12);
  assert.equal(opts('per_cell=99&min_rows=0').minRows, 1);
});

test('range is ordered, and capped at 24 months', () => {
  const o = opts('start=2027-03&end=2026-11');
  assert.deepEqual([o.start, o.end], [{ y: 2026, m: 11 }, { y: 2027, m: 3 }]);
  const big = opts('start=2026-01&end=2035-12');
  assert.deepEqual(big.end, { y: 2027, m: 12 });
});

test('continue mode: busiest day sets the sheet count, same grid repeats', () => {
  const b = buildPages(events, opts('start=2026-11&end=2026-11&per_cell=3'));
  assert.equal(b.pages.length, 3); // 7 events / 3 per day
  assert.equal(b.pages[0].weeks.length, 6, 'Nov 2026 spans six Monday-first weeks');
  assert.equal(b.pages[0].weeks[0][0].day, '2026-10-26', 'grid starts on a Monday');
  const day24 = (p) => p.weeks.flat().find((c) => c.day === '2026-11-24');
  assert.deepEqual(b.pages.map((p) => day24(p).events.length), [3, 3, 1]);
  assert.equal(b.dropped, 0);
});

test('continue mode: events past max_pages are counted as "+N more"', () => {
  const b = buildPages(events, opts('start=2026-11&end=2026-11&per_cell=2&max_pages=2'));
  assert.equal(b.pages.length, 2);
  assert.equal(b.pages[1].weeks.flat().find((c) => c.day === '2026-11-24').hidden, 3);
  assert.equal(b.dropped, 3);
  assert.deepEqual(b.truncatedMonths, ['November 2026']);
});

test('fit mode: one sheet holding every event', () => {
  const b = buildPages(events, opts('start=2026-11&end=2026-11&per_cell=2&fit=true'));
  assert.equal(b.pages.length, 1);
  assert.equal(b.pages[0].weeks.flat().find((c) => c.day === '2026-11-24').events.length, 7);
  assert.equal(b.busiest, 7);
});

test('total page cap', () => {
  const b = buildPages(events, opts('start=2026-10&end=2026-12&per_cell=1&max_total=2'));
  assert.equal(b.pages.length, 2);
  assert.equal(b.hitTotalCap, true);
});

test('timetable becomes a day label; multi-day events appear on each day', () => {
  const b = buildPages(events, opts('start=2026-11&end=2026-11'));
  assert.equal(b.tt.get('2026-11-09'), 'Event 200');
  const days = b.pages[0].weeks.flat().filter((c) => c.events.some((e) => e.id === '300')).map((c) => c.day);
  assert.deepEqual(days, ['2026-11-10', '2026-11-11', '2026-11-12']);
});

test('rendered page escapes titles and carries the options', () => {
  const nasty = [{ ...ev(1, '2026-11-03'), title: '<script>alert(1)</script>' }];
  const { body: html } = renderPrintPage(nasty, opts('start=2026-11&end=2026-11&fit=true&min_rows=7'), {
    school: 'Mayfield School', subtitle: 'Cal', filterLabel: 'Parents', filterParams: new URLSearchParams(),
    colorOf: () => '#013568', printed: '1 Nov 2026',
  });
  assert.ok(!html.includes('<script>alert'));
  assert.match(html, /--minrows:7/);
  assert.match(html, /name="start" value="2026-11"/);
});

test('tidyCaps softens shouting but keeps acronyms', () => {
  assert.equal(tidyCaps('WEEK 1'), 'Week 1');
  assert.equal(tidyCaps('LAMDA EXAMS'), 'LAMDA Exams');
  assert.equal(tidyCaps('Y8 HPV'), 'Y8 HPV');
  assert.equal(tidyCaps('GCSE Results Day'), 'GCSE Results Day');
});
