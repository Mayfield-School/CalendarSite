// Minimal iCalendar parser/generator tailored to the SOCS feed.
// All times are handled as UK wall-clock time (Europe/London).

import { createHash } from 'node:crypto';
import { SPORT_NAMES } from './categories.js';

export const TZ = 'Europe/London';

// ---------- parsing ----------

export function parseIcs(text) {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events = [];
  let cur = null;
  let nested = 0;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; nested = 0; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    if (line.startsWith('BEGIN:')) { nested++; continue; }
    if (line.startsWith('END:')) { nested--; continue; }
    if (nested > 0) continue;
    const m = /^([A-Za-z0-9-]+)((?:;[^:]*)?):(.*)$/.exec(line);
    if (!m) continue;
    const params = {};
    for (const p of m[2].split(';').slice(1)) {
      const [k, ...v] = p.split('=');
      params[k.toUpperCase()] = v.join('=');
    }
    cur[m[1].toUpperCase()] = { value: m[3], params };
  }
  return events;
}

function decodeEntities(s) {
  return s
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

export function unescapeText(v = '') {
  return decodeEntities(v.replace(/\\n/gi, '\n').replace(/\\([,;:\\])/g, '$1')).trim();
}

const londonFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function toLondon(date) {
  const p = Object.fromEntries(londonFmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

function parseDateProp(prop) {
  if (!prop) return null;
  const v = prop.value.trim();
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (m) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: null };
  m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (!m) return null;
  if (m[7] === 'Z') return toLondon(new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6])));
  // TZID "GMT Standard Time" (Windows name for Europe/London) or floating: already UK wall-clock.
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}` };
}

export function addDays(key, n) {
  const d = new Date(Date.UTC(+key.slice(0, 4), key.slice(5, 7) - 1, +key.slice(8, 10)));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const YEAR_WORD = '(?:Years?|Yrs?|Y)';
const YEAR_RE = new RegExp(`\\b${YEAR_WORD}\\s?(\\d{1,2})\\b((?:\\s*(?:,|&|and|to|-|–|\\/)\\s*(?:${YEAR_WORD}\\s?)?\\d{1,2}\\b)*)`, 'gi');

// Year groups an event title refers to (Mayfield is 11–18: Years 7–13).
export function extractYears(title) {
  const years = new Set();
  for (const m of title.matchAll(YEAR_RE)) {
    const nums = [...m[0].matchAll(/\d{1,2}/g)];
    for (let i = 0; i < nums.length; i++) {
      const n = +nums[i][0];
      years.add(n);
      if (i > 0) {
        const between = m[0].slice(nums[i - 1].index + nums[i - 1][0].length, nums[i].index);
        if (/to|-|–/i.test(between)) for (let k = +nums[i - 1][0] + 1; k < n; k++) years.add(k);
      }
    }
  }
  if (/\b(sixth form|6th form)\b/i.test(title)) { years.add(12); years.add(13); }
  if (/\b(L6|lower sixth)\b/i.test(title)) years.add(12);
  if (/\b(U6|upper sixth)\b/i.test(title)) years.add(13);
  for (const m of title.matchAll(/\bU(1[2-8])[A-Z]?\b/g)) {
    const age = +m[1];
    if (age <= 16) years.add(age - 5); else { years.add(12); years.add(13); }
  }
  return [...years].filter((y) => y >= 7 && y <= 13).sort((a, b) => a - b);
}

const VENUES = { H: 'Home', A: 'Away', N: 'Neutral' };

// Genuine capitals that must survive tidyCaps (same list as titan's calprint).
const KEEP_CAPS = new Set([
  'LAMDA', 'ABRSM', 'GCSE', 'GCSES', 'UCAS', 'HPGC', 'ESSKIA', 'HPV', 'ECA', 'ISI', 'PSHE', 'EPQ', 'IGCSE', 'BTEC',
  'STEM', 'PE', 'RS', 'DT', 'ICT', 'TBC', 'TBA', 'AM', 'PM', 'U11', 'U13', 'U14', 'U15', 'U16', 'U18', 'XI', 'XV',
  'NSEA', 'DOFE', 'SEN', 'SENCO', 'SLT',
]);

// Soften SHOUTED titles ("WEEK 1" -> "Week 1") without touching acronyms. Only a
// title that is entirely upper case is changed, and within it only purely
// alphabetic words of 4+ letters that aren't known acronyms.
export function tidyCaps(text) {
  const t = text.trim();
  if (!t || t !== t.toUpperCase() || !/[A-Z]/.test(t)) return text;
  return t.split(' ').map((tok) => {
    const core = tok.replace(/^[.,:;()[\]\-/&]+|[.,:;()[\]\-/&]+$/g, '');
    if (KEEP_CAPS.has(core.toUpperCase()) || core.length < 4 || !/^[A-Z]+$/.test(core)) return tok;
    return tok.replace(core, core[0] + core.slice(1).toLowerCase());
  }).join(' ');
}

export function normaliseEvent(raw) {
  const s = parseDateProp(raw.DTSTART);
  if (!s) return null;
  const e = parseDateProp(raw.DTEND) || s;
  const allDay = !s.time || raw['X-MICROSOFT-CDO-ALLDAYEVENT']?.value === 'TRUE';

  let endDate = e.date;
  if (allDay) { if (!e.time && e.date > s.date) endDate = addDays(e.date, -1); }
  else if (e.time === '00:00' && e.date > s.date) endDate = addDays(e.date, -1);
  if (endDate < s.date) endDate = s.date;

  const desc = unescapeText(raw.DESCRIPTION?.value);
  const url = /https?:\/\/\S+/.exec(desc)?.[0] || null;
  const eid = url && /[?&]EID=(\d+)/i.exec(url)?.[1];
  // SOCS UIDs look like "<start>-<end>-SOCS-SchoolCalendar-3561834@SOCS"; the trailing
  // number survives date changes, so subscribers don't get duplicates when an event moves.
  const uid = raw.UID?.value || '';
  const socs = /-SOCS-([A-Za-z]+)-(\d+)@/.exec(uid);
  const id = eid || (socs && `${socs[1][0].toLowerCase()}${socs[2]}`) ||
    createHash('sha1').update(uid + s.date).digest('hex').slice(0, 12);

  const title = tidyCaps(unescapeText(raw.SUMMARY?.value)) || 'Untitled event';
  let location = unescapeText(raw.LOCATION?.value);
  const tokens = (raw.CATEGORIES?.value || '').split(/(?<!\\),/).map(unescapeText).filter(Boolean);

  let cats = tokens;
  let sport = null;
  let venue = null;
  if (tokens.includes('Sport') || tokens.includes('Fixture')) {
    sport = tokens.find((t) => SPORT_NAMES.has(t)) || null;
    cats = [sport || 'Other sport', ...tokens.filter((t) => t !== 'Sport' && t !== 'Fixture' && t !== sport)];
    if (VENUES[location.toUpperCase()]) { venue = VENUES[location.toUpperCase()]; location = ''; }
  }
  if (!cats.length) cats = ['General'];

  // "Hockey Girls-U14A vs Dulwich Cranbrook" -> team "U14A", opponent "Dulwich Cranbrook"
  let team = null;
  let opponent = null;
  if (sport) {
    const m = /^(?:\w+\s+)?(?:Girls-)?(.+?)\s+vs\.?\s+(.+)$/i.exec(title);
    if (m) { team = m[1].replace(/^Girls-/i, ''); opponent = m[2]; }
  }

  return {
    id,
    title,
    s: s.date,
    e: endDate,
    st: allDay ? null : s.time,
    // SOCS gives fixtures end == start; treat that (and a midnight end) as "no end time".
    et: allDay || !e.time || (e.time === '00:00' && e.date > s.date) || (e.date === s.date && e.time === s.time) ? null : e.time,
    allDay,
    location: location || null,
    cats,
    years: extractYears(title),
    ...(sport && { sport, venue, team, opponent }),
    url,
  };
}

// ---------- generation ----------

const VTIMEZONE = [
  'BEGIN:VTIMEZONE', `TZID:${TZ}`, `X-LIC-LOCATION:${TZ}`,
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0000', 'TZOFFSETTO:+0100', 'TZNAME:BST', 'DTSTART:19700329T010000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0000', 'TZNAME:GMT', 'DTSTART:19701025T020000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
  'END:VTIMEZONE',
];

function esc(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
}

// Fold to 75 octets per RFC 5545, without splitting multi-byte characters.
function fold(line) {
  if (Buffer.byteLength(line) <= 75) return line;
  const parts = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > (parts.length ? 74 : 75)) { parts.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += b;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

const compact = (date, time) => date.replace(/-/g, '') + (time ? `T${time.replace(':', '')}00` : '');

function addHour(time) {
  const [h, m] = time.split(':').map(Number);
  return h >= 23 ? '23:59' : `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function buildIcs(events, { name, baseUrl = '' }) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const out = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Mayfield School//Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(name)}`, `X-WR-TIMEZONE:${TZ}`, 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H',
    ...VTIMEZONE,
  ];
  for (const ev of events) {
    out.push('BEGIN:VEVENT', `UID:${ev.id}@mayfield-calendar`, `DTSTAMP:${stamp}`);
    if (ev.allDay) {
      out.push(`DTSTART;VALUE=DATE:${compact(ev.s)}`, `DTEND;VALUE=DATE:${compact(addDays(ev.e, 1))}`);
    } else {
      const endTime = ev.et || (ev.e === ev.s ? addHour(ev.st) : '00:00');
      const endDate = ev.et || ev.e === ev.s ? ev.e : addDays(ev.e, 1);
      out.push(`DTSTART;TZID=${TZ}:${compact(ev.s, ev.st)}`, `DTEND;TZID=${TZ}:${compact(endDate, endTime)}`);
    }
    let summary = ev.title;
    if (ev.venue) summary += ` (${ev.venue})`;
    out.push(`SUMMARY:${esc(summary)}`);
    if (ev.location) out.push(`LOCATION:${esc(ev.location)}`);
    out.push(`CATEGORIES:${ev.cats.map(esc).join(',')}`);
    const link = baseUrl ? `${baseUrl}/?e=${ev.id}` : ev.url;
    if (link) out.push(`DESCRIPTION:${esc(`Details: ${link}`)}`, `URL:${esc(link)}`);
    out.push('END:VEVENT');
  }
  out.push('END:VCALENDAR');
  return out.map(fold).join('\r\n') + '\r\n';
}
