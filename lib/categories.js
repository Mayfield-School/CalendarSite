// Category groups, colours and audience presets.
// Categories not listed here (e.g. new ones added in SOCS later) still appear,
// under "Other", and are included by every exclude-based preset.
// Staff-only categories (starred on SOCS's /staff page) appear only on the
// staff view; the public feed omits them from its events.

export const GROUPS = [
  { id: 'staff', name: 'Staff only' },
  { id: 'key', name: 'Key dates' },
  { id: 'life', name: 'School life' },
  { id: 'trips', name: 'Trips & activities' },
  { id: 'sport', name: 'Sports fixtures' },
  { id: 'community', name: 'Community' },
  { id: 'timetable', name: 'Timetable' },
  { id: 'other', name: 'Other' },
];

export const CATEGORIES = [
  // Staff categories use the brand's supporting palette, meant for functional UI like this.
  { name: 'Staff Events', group: 'staff', color: '#3b98d8', staff: true },
  { name: 'Governor Meetings', group: 'staff', color: '#9371c7', staff: true },
  { name: 'Report Deadlines', group: 'staff', color: '#972571', staff: true },
  { name: 'Lettings', group: 'staff', color: '#df8d34', staff: true },
  { name: 'Non-School Functions', group: 'staff', color: '#008542', staff: true },

  { name: 'School Holidays', group: 'key', color: '#c9023b' },
  { name: 'Parents Meetings', group: 'key', color: '#013568' },
  { name: 'Examinations', group: 'key', color: '#7a3e9d' },
  { name: 'Marketing & Admissions Events', label: 'Open events & admissions', group: 'key', color: '#b07d00' },

  { name: 'School Functions', group: 'life', color: '#2b78bf' },
  { name: 'Assemblies', group: 'life', color: '#5b6b8c' },
  { name: 'Chaplaincy and Chapel', group: 'life', color: '#8a6d3b' },
  { name: 'Inter-House Events', group: 'life', color: '#d9661f' },
  { name: 'Boarding Events', group: 'life', color: '#4f8a63' },
  { name: 'Dance Drama & Music', group: 'life', color: '#b5487a' },
  { name: 'Health Centre / Vaccinations', label: 'Health centre & vaccinations', group: 'life', color: '#0f8b8d' },
  { name: 'Photographs', group: 'life', color: '#6b7280' },
  { name: 'General', group: 'life', color: '#6b7280' },

  { name: 'Trips', group: 'trips', color: '#7d8f2e' },
  { name: 'Co-curricular', label: 'Co-curricular (ECAs)', group: 'trips', color: '#8ebd9d' },
  { name: 'Residential Trips', group: 'trips', color: '#5e6b1f' },
  { name: 'Duke of Edinburgh', group: 'trips', color: '#2f7d4f' },
  { name: 'Careers and Higher Education', label: 'Careers & higher education', group: 'trips', color: '#3d5a80' },

  { name: 'Hockey', group: 'sport', color: '#0e7490' },
  { name: 'Netball', group: 'sport', color: '#be185d' },
  { name: 'Football', group: 'sport', color: '#166534' },
  { name: 'Cricket', group: 'sport', color: '#a16207' },
  { name: 'Tennis', group: 'sport', color: '#65a30d' },
  { name: 'Athletics', group: 'sport', color: '#9a3412' },
  { name: 'Other sport', group: 'sport', color: '#475569' },

  { name: 'Alumni', label: 'Alumnae', group: 'community', color: '#6d28d9' },

  { name: 'Timetable', label: 'Timetable week (1/2)', group: 'timetable', color: '#94a3b8' },
];

export const STAFF_SLUGS = CATEGORIES.filter((c) => c.staff).map((c) => slugify(c.name));

export const PRESETS = [
  { id: 'parents', name: 'Parents', exclude: ['timetable', 'alumni', ...STAFF_SLUGS] },
  {
    id: 'prospective', name: 'Prospective families',
    include: ['marketing-admissions-events', 'school-holidays', 'school-functions', 'dance-drama-music', 'inter-house-events', 'chaplaincy-and-chapel'],
  },
  { id: 'pupils', name: 'Pupils', exclude: ['alumni', 'marketing-admissions-events', 'parents-meetings', ...STAFF_SLUGS] },
  // Most staff don't want fixtures or ECA sessions in their calendar; "Everything" has them.
  { id: 'staff', name: 'Staff', exclude: ['co-curricular'], excludeGroups: ['sport'] },
  { id: 'everything', name: 'Everything', exclude: [] },
];

export const DEFAULT_PRESET = 'parents';

// SOCS has no co-curricular category; its ECA sessions are filed under Trips with
// titles such as "ECA Riding - Hurstwood Equestrian". These move to "Co-curricular".
export const CO_CURRICULAR_TITLE = /^ECAs?\b/i;

export const SPORT_NAMES = new Set(['Hockey', 'Netball', 'Football', 'Cricket', 'Tennis', 'Athletics', 'Lacrosse', 'Swimming', 'Rounders']);

export function slugify(name) {
  return name.toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const FALLBACK_COLORS = ['#475569', '#7c2d12', '#155e75', '#4d7c0f', '#86198f'];

// Build the category list the client sees: known categories first (in order),
// then anything new found in the feed. `socsIds` maps a category name to the
// filter SOCS uses for it in feed URLs, e.g. "C1=17633" or "sid=15".
export function buildCategoryMeta(seenNames, counts, { staff = false, socsIds = new Map() } = {}) {
  const known = new Map(CATEGORIES.map((c) => [c.name, c]));
  const out = [];
  for (const c of CATEGORIES) {
    if (c.staff && !staff) continue;
    out.push({ slug: slugify(c.name), name: c.name, label: c.label || c.name, group: c.group, color: c.color, count: counts.get(c.name) || 0, socs: socsIds.get(c.name) || null });
  }
  let i = 0;
  for (const name of [...seenNames].sort()) {
    if (known.has(name)) continue;
    // A sport SOCS adds later (e.g. Lacrosse) still counts as a fixture, so presets that leave out sport leave it out too.
    out.push({ slug: slugify(name), name, label: name, group: SPORT_NAMES.has(name) ? 'sport' : 'other', color: FALLBACK_COLORS[i++ % FALLBACK_COLORS.length], count: counts.get(name) || 0, socs: socsIds.get(name) || null });
  }
  return out;
}
