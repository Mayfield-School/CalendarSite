import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIcs, normaliseEvent, normaliseSocsRow, buildIcs, extractYears } from '../lib/ics.js';
import { buildCategoryMeta, GROUPS, PRESETS, DEFAULT_PRESET } from '../lib/categories.js';
import { parseFilter, encodeFilter, makeMatcher, feedPath, socsFeed } from '../public/filter.js';

const FEED = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:20260810-20260815-SOCS-SchoolCalendar-3558784@SOCS
DTSTART;TZID=GMT Standard Time;VALUE=DATE:20260810
DTEND;TZID=GMT Standard Time;VALUE=DATE:20260815
LOCATION:Ceramics 1
CATEGORIES:School Functions
SUMMARY:Ceramics Workshop\\, Years 7-9
DESCRIPTION:Event Details\\: https\\://calendar.misocs.com/EventDetails.aspx?ID=3405&EID=18589742&T=SchoolCalendar&P=1
X-MICROSOFT-CDO-ALLDAYEVENT:TRUE
END:VEVENT
BEGIN:VEVENT
UID:20260915T150000Z-20260915T150000Z-SOCS-Fixture-901@SOCS
DTSTART;TZID=GMT Standard Time:20260915T150000
DTEND;TZID=GMT Standard Time:20260915T150000
LOCATION:A
CATEGORIES:Sport, Hockey, Fixture
SUMMARY:Hockey Girls-U14A vs Dulwich Cranbrook
X-MICROSOFT-CDO-ALLDAYEVENT:FALSE
END:VEVENT
BEGIN:VEVENT
UID:20260907-20260908-SOCS-SchoolCalendar-1@SOCS
DTSTART;TZID=GMT Standard Time;VALUE=DATE:20260907
DTEND;TZID=GMT Standard Time;VALUE=DATE:20260908
CATEGORIES:Dance Drama &amp; Music
SUMMARY:Concert
END:VEVENT
END:VCALENDAR`;

const events = parseIcs(FEED).map(normaliseEvent);

test('all-day multi-day event has inclusive end and SOCS id', () => {
  const ev = events[0];
  assert.equal(ev.id, '18589742');
  assert.equal(ev.s, '2026-08-10');
  assert.equal(ev.e, '2026-08-14');
  assert.equal(ev.allDay, true);
  assert.equal(ev.title, 'Ceramics Workshop, Years 7-9');
  assert.deepEqual(ev.years, [7, 8, 9]);
});

test('fixtures get sport, venue, team and a stable id', () => {
  const ev = events[1];
  assert.equal(ev.id, 'f901');
  assert.deepEqual(ev.cats, ['Hockey']);
  assert.equal(ev.venue, 'Away');
  assert.equal(ev.location, null);
  assert.equal(ev.team, 'U14A');
  assert.equal(ev.opponent, 'Dulwich Cranbrook');
  assert.equal(ev.et, null);
  assert.deepEqual(ev.years, [9]);
});

test('HTML entities in categories are decoded', () => {
  assert.deepEqual(events[2].cats, ['Dance Drama & Music']);
});

test('year extraction', () => {
  assert.deepEqual(extractYears('Induction Day for girls in Years 7, 9 and 12'), [7, 9, 12]);
  assert.deepEqual(extractYears('Y10-Y13 Tutor Time'), [10, 11, 12, 13]);
  assert.deepEqual(extractYears('Sixth Form Ball'), [12, 13]);
  assert.deepEqual(extractYears('Review of 2026'), []);
});

test('generated iCal is well formed', () => {
  const ics = buildIcs(events, { name: 'Test', baseUrl: 'https://cal.example' });
  assert.match(ics, /DTSTART;VALUE=DATE:20260810\r\nDTEND;VALUE=DATE:20260815/);
  assert.match(ics, /DTSTART;TZID=Europe\/London:20260915T150000\r\nDTEND;TZID=Europe\/London:20260915T160000/);
  assert.match(ics, /SUMMARY:Hockey Girls-U14A vs Dulwich Cranbrook \(Away\)/);
  assert.match(ics, /SUMMARY:Ceramics Workshop\\, Years 7-9/);
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, line);
});

test('filters: presets, years and round-tripping', () => {
  const meta = { categories: buildCategoryMeta(new Set(events.flatMap((e) => e.cats)), new Map()), groups: GROUPS, presets: PRESETS, defaultPreset: DEFAULT_PRESET };
  const f = parseFilter(new URLSearchParams('c=hockey&y=10'), meta);
  const match = makeMatcher(f, meta);
  assert.equal(match(events[1]), false, 'U14 = Year 9, not Year 10');
  f.years = new Set([9]);
  assert.equal(makeMatcher(f, meta)(events[1]), true);
  assert.equal(encodeFilter(f, meta).toString(), 'c=hockey&y=9');
  const parents = parseFilter(new URLSearchParams(), meta);
  assert.equal(encodeFilter(parents, meta).get('p'), 'parents');
  assert.equal(parents.cats.has('timetable'), false);
});

test('staff-only categories appear only in the staff view and stay out of public presets', () => {
  const pub = buildCategoryMeta(new Set(['Trips']), new Map());
  const staff = buildCategoryMeta(new Set(['Trips']), new Map(), { staff: true });
  assert.ok(!pub.some((c) => c.slug === 'staff-events'));
  assert.equal(staff.find((c) => c.slug === 'staff-events').group, 'staff');
  const meta = { categories: staff, presets: PRESETS, defaultPreset: DEFAULT_PRESET };
  assert.ok(!parseFilter(new URLSearchParams('p=parents'), meta).cats.has('staff-events'));
  assert.ok(parseFilter(new URLSearchParams('p=staff'), meta).cats.has('staff-events'));
  assert.ok(parseFilter(new URLSearchParams('p=everything'), meta).cats.has('staff-events'));
});

test('feed paths: presets with up to one year, single categories, staff prefix', () => {
  const categories = buildCategoryMeta(new Set(), new Map());
  const meta = { categories, presets: PRESETS, defaultPreset: DEFAULT_PRESET };
  const f = (q) => feedPath(parseFilter(new URLSearchParams(q), meta), meta);
  assert.equal(f('p=parents'), 'feeds/parents.ics');
  assert.equal(f('p=pupils&y=9'), 'feeds/pupils-y9.ics');
  assert.equal(f('c=hockey'), 'feeds/cat-hockey.ics');
  assert.equal(f('p=parents&y=9,10'), null);
  assert.equal(f('c=hockey,netball'), null);
  assert.equal(f('p=parents&q=trip'), null);
  assert.equal(feedPath(parseFilter(new URLSearchParams('p=staff'), meta), { ...meta, feedPrefix: 'staff/' }), 'staff/feeds/staff.ics');
});

test('SOCS feed URL for any mix of categories', () => {
  const socsIds = new Map([['Trips', 'C1=17628'], ['Hockey', 'sid=15'], ['Netball', 'sid=18'], ['Football', 'sid=26'],
    ['Cricket', 'sid=9'], ['Tennis', 'sid=31'], ['Athletics', 'sid=3']]);
  const categories = buildCategoryMeta(new Set(), new Map(), { socsIds });
  const meta = { categories, presets: PRESETS, defaultPreset: DEFAULT_PRESET };
  const s = (q) => socsFeed(parseFilter(new URLSearchParams(q), meta), meta, 'https://x/CalendarSync.ashx?ID=1');
  assert.equal(s('c=trips,hockey,netball').url, 'https://x/CalendarSync.ashx?ID=1&FT=OR&C1=17628&sid=15&sid=18&ST=0');
  assert.deepEqual(s('c=trips,other-sport').missing, ['Other sport']);
  const allSport = s('c=hockey,netball,football,cricket,tennis,athletics,other-sport');
  assert.equal(allSport.url, 'https://x/CalendarSync.ashx?ID=1&FT=OR&AS=1&ST=0');
  assert.deepEqual(allSport.missing, []);
  assert.equal(s('c=other-sport'), null);
});

test('the Staff preset leaves out sport (including sports SOCS adds later) and co-curricular; Everything keeps them', () => {
  const categories = buildCategoryMeta(new Set(['Lacrosse', 'Trips']), new Map(), { staff: true });
  const meta = { categories, presets: PRESETS, defaultPreset: DEFAULT_PRESET };
  const staff = parseFilter(new URLSearchParams('p=staff'), meta).cats;
  const all = parseFilter(new URLSearchParams('p=everything'), meta).cats;
  for (const slug of ['hockey', 'other-sport', 'lacrosse', 'co-curricular']) {
    assert.ok(!staff.has(slug), slug);
    assert.ok(all.has(slug), slug);
  }
  for (const slug of ['trips', 'school-holidays', 'staff-events', 'timetable']) assert.ok(staff.has(slug), slug);
});

test('ECA sessions move from Trips to Co-curricular', () => {
  const ev = (summary, cats) => normaliseEvent(parseIcs(`BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:1-2-SOCS-SchoolCalendar-1@SOCS\nDTSTART:20261020T160000\nSUMMARY:${summary}\nCATEGORIES:${cats}\nEND:VEVENT\nEND:VCALENDAR`)[0]);
  assert.deepEqual(ev('ECA Riding - Hurstwood Equestrian - Group 1', 'Trips').cats, ['Co-curricular']);
  assert.deepEqual(ev('ECA Drama', 'Trips, Dance Drama & Music').cats, ['Co-curricular', 'Dance Drama & Music']);
  assert.deepEqual(ev('Geography Field Trip', 'Trips').cats, ['Trips']);
  assert.deepEqual(ev('Decathlon visit', 'Trips').cats, ['Trips']);
});

test('rows from SOCS staff page data become events', () => {
  const timed = normaliseSocsRow({ OrigEventID: '3561876', StartDate: '24 Sep 2026', EndDate: '24 Sep 2026', StartTime: '11:00', EndTime: '14:00', Venue: 'The Space', Title: 'F and GP Governors Meeting' }, ['Governor Meetings']);
  assert.deepEqual(timed, { id: 's3561876', title: 'F and GP Governors Meeting', s: '2026-09-24', e: '2026-09-24', st: '11:00', et: '14:00', allDay: false, location: 'The Space', cats: ['Governor Meetings'], years: [], url: null });
  // EndDate is the last day, so a Thursday-Friday inset is two days.
  const inset = normaliseSocsRow({ OrigEventID: '1', StartDate: '3 Sep 2026', EndDate: '4 Sep 2026', StartTime: 'All Day', EndTime: '00:00', Venue: '', Title: 'Staff Inset Day' }, ['Staff Events']);
  assert.deepEqual([inset.s, inset.e, inset.allDay, inset.st, inset.et, inset.location], ['2026-09-03', '2026-09-04', true, null, null, null]);
  const noEnd = normaliseSocsRow({ OrigEventID: '2', StartDate: '5 Oct 2026', EndDate: '5 Oct 2026', StartTime: '14:00', EndTime: '', Title: 'Y11 Autumn Report &amp; Grade Card' }, ['Report Deadlines']);
  assert.deepEqual([noEnd.et, noEnd.title, noEnd.years], [null, 'Y11 Autumn Report & Grade Card', [11]]);
  assert.equal(normaliseSocsRow({ OrigEventID: '3', StartDate: 'soon', Title: 'x' }, []), null);
});
