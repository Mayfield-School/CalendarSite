// Filter logic shared by the browser and the build (for the pre-built .ics feeds).
// URL format: ?p=<preset>  or  ?c=slug,slug,...   plus optional  &y=7,9  &q=text

export function presetCats(preset, categories) {
  if (preset.include) return new Set(preset.include);
  const ex = new Set(preset.exclude || []);
  const exGroups = new Set(preset.excludeGroups || []);
  return new Set(categories.filter((c) => !ex.has(c.slug) && !exGroups.has(c.group)).map((c) => c.slug));
}

export function parseFilter(params, meta) {
  const get = (k) => (typeof params.get === 'function' ? params.get(k) : params[k]) || '';
  const preset = meta.presets.find((p) => p.id === get('p')) ||
    (get('c') ? null : meta.presets.find((p) => p.id === meta.defaultPreset));
  const cats = preset
    ? presetCats(preset, meta.categories)
    : new Set(get('c') === 'all' ? meta.categories.map((c) => c.slug)
      : get('c') === 'none' ? [] : get('c').split(',').filter(Boolean));
  const years = new Set(get('y').split(',').map(Number).filter((n) => n >= 7 && n <= 13));
  return { cats, years, q: get('q').trim().slice(0, 100) };
}

export function sameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

// Returns URLSearchParams describing the filter as compactly as possible.
export function encodeFilter(f, meta) {
  const p = new URLSearchParams();
  const preset = meta.presets.find((pr) => sameSet(presetCats(pr, meta.categories), f.cats));
  if (preset) p.set('p', preset.id);
  else if (f.cats.size === meta.categories.length) p.set('c', 'all');
  else if (!f.cats.size) p.set('c', 'none');
  else p.set('c', [...f.cats].join(','));
  if (f.years.size) p.set('y', [...f.years].sort((a, b) => a - b).join(','));
  if (f.q) p.set('q', f.q);
  return p;
}

export function makeMatcher(f, meta) {
  const nameToSlug = new Map(meta.categories.map((c) => [c.name, c.slug]));
  const q = f.q.toLowerCase();
  return (ev) => {
    if (!ev.cats.some((c) => f.cats.has(nameToSlug.get(c)))) return false;
    // Events that name no year group are for everyone.
    if (f.years.size && ev.years.length && !ev.years.some((y) => f.years.has(y))) return false;
    if (q && !`${ev.title} ${ev.location || ''} ${ev.cats.join(' ')}`.toLowerCase().includes(q)) return false;
    return true;
  };
}

export function describeFilter(f, meta) {
  const preset = meta.presets.find((pr) => sameSet(presetCats(pr, meta.categories), f.cats));
  const labels = meta.categories.filter((c) => f.cats.has(c.slug)).map((c) => c.label);
  const named = !f.cats.size ? 'No categories'
    : labels.length <= 3 && labels.length
      ? labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} & ${labels.at(-1)}`
      : `${f.cats.size} of ${meta.categories.length} categories`;
  const parts = [preset ? preset.name : named];
  if (f.years.size) parts.push(`Year${f.years.size > 1 ? 's' : ''} ${[...f.years].sort((a, b) => a - b).join(', ')}`);
  if (f.q) parts.push(`“${f.q}”`);
  return parts.join(' · ');
}

// The site is static, so the build writes a tidied feed for each audience preset
// (alone or with one year group) and one per category; the staff view has its
// own set under staff/. Returns the feed matching the filter, or null.
export function feedPath(f, meta) {
  if (f.q || f.years.size > 1) return null;
  const dir = meta.feedPrefix || '';
  const y = f.years.size ? `-y${[...f.years][0]}` : '';
  const preset = meta.presets.find((pr) => sameSet(presetCats(pr, meta.categories), f.cats));
  if (preset) return `${dir}feeds/${preset.id}${y}.ics`;
  if (f.cats.size === 1 && !y) return `${dir}feeds/cat-${[...f.cats][0]}.ics`;
  return null;
}

// Any mix of categories can come straight from SOCS, whose feed URL takes one
// "C1=<id>" per calendar and "sid=<id>" per sport (or "AS=1" for all sports).
// SOCS can't filter by year group or search text, and some categories (such
// as "Other sport") have no SOCS id; those are listed in `missing`.
export function socsFeed(f, meta, base) {
  if (!base || !f.cats.size) return null;
  const chosen = meta.categories.filter((c) => f.cats.has(c.slug));
  const sports = meta.categories.filter((c) => c.socs?.startsWith('sid='));
  const allSports = sports.length > 0 && sports.every((c) => f.cats.has(c.slug));
  const parts = ['FT=OR'];
  const missing = [];
  for (const c of chosen) {
    if (c.socs?.startsWith('C1=')) parts.push(c.socs);
    else if (c.group === 'sport' && allSports) continue;
    else if (c.socs) parts.push(c.socs);
    else missing.push(c.label);
  }
  if (allSports) parts.push('AS=1');
  if (parts.length === 1) return null;
  parts.push('ST=0');
  return { url: `${base}&${parts.join('&')}`, missing };
}
