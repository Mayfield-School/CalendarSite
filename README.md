# Mayfield School Calendar

A branded, filterable front-end for the school's SOCS calendar, published on GitHub Pages. It reads the public SOCS iCal feed, so nothing changes in SOCS. Staff keep entering events as they do now.

## How it works

GitHub Pages only serves static files, and the SOCS feed doesn't allow browsers to read it from another site. A GitHub Actions workflow ([.github/workflows/pages.yml](.github/workflows/pages.yml)) therefore fetches the feed and builds the whole site into `dist/`. It runs on every push to `main`, every 30 minutes and on demand (Actions tab → *Build and deploy calendar* → *Run workflow*). If SOCS can't be reached, the build fails and the last published version stays up.

The build ([scripts/build.js](scripts/build.js)) writes:

- `api/calendar.json`: every event plus the category metadata the page loads.
- `calendar.ics`: everything, for subscribing.
- `feeds/<preset>.ics` and `feeds/<preset>-y<7–13>.ics`: one feed per audience (Parents, Prospective families, Pupils, Staff), alone or with one year group.
- `feeds/cat-<category>.ics`: one feed per category.
- `event/<id>.ics`: one file per event, for "add to calendar".
- `CalendarSync.ashx` and `calendarsync.ashx`: copies of `calendar.ics` under SOCS's feed name. If calendar.mayfieldgirls.org is pointed at this site, parents who subscribed through SOCS (`webcal://calendar.mayfieldgirls.org/CalendarSync.ashx?…`) keep getting updates. Pages ignores the query string, so subscriptions that were filtered in SOCS get the full public calendar.
- `staff/index.html`, `api/calendar-staff.json`, `staff/calendar.ics` and `staff/feeds/…`: the staff view (see below).

The build also reads SOCS's staff page (`calendar.misocs.com/staff/week.aspx?ID=3405`) to get the SOCS ID for every category and sport. These IDs are used to build SOCS feed links for any mix of categories and to find the staff-only events.

## Features

- **Month, week and list views**, with the list view as the default on phones.
- **Filters:** audience presets, a year-group filter (Y7–Y13, including U-age fixtures), grouped categories and live search. Filters, view and date live in the URL, and the browser remembers each visitor's last filter.
- **Subscribe / Sync:** one-click subscribe for Apple Calendar, Google Calendar, Outlook 365 and Outlook.com, for whatever is filtered:
  - An audience preset (optionally with one year group), or a single category, uses this site's own feed, with tidied titles and Home/Away labels.
  - Any other mix of categories uses SOCS's own filtered feed (`CalendarSync.ashx?…&C1=<calendar id>&sid=<sport id>`), so every combination can be subscribed to. SOCS can't filter by year group or search text, so the dialog says when those aren't applied. "Other sport" has no SOCS ID and is left out of SOCS feeds unless every sport is selected.
  - "Everything" is always available.
- **Per-event options:** add to Apple, Outlook or Google, copy a link, share, or open the original SOCS page.
- **Print / PDF** (`print.html`): an A4 landscape, month-per-sheet calendar with From/To months, Per day, Max pages/month, Total pages, Fit all events, Min lines/day and Full titles. To make a PDF, use **Print / Save as PDF** and choose "Save as PDF" as the printer.

## Staff view

`/staff/` (for example `https://mayfield-school.github.io/CalendarSite/staff/`) works like SOCS's own `/staff` page. It is the same calendar plus a **Staff only** group: Staff Events, Governor Meetings, Report Deadlines, Lettings and Non-School Functions, each shown only when it has upcoming events. The "Staff / everything" preset includes them, while the Parents and Pupils presets leave them out. The staff view has its own subscription feeds and print page, and it isn't linked from the public page or indexed by search engines.

SOCS's public feed includes these events but leaves the staff category off them. The build adds it back by fetching SOCS's feed filtered to each staff category. Like SOCS's own `/staff` page, the staff view is unlisted rather than password-protected: anyone who knows the address can open it.

## Run locally

Requires Node.js 20 or later. There are no npm dependencies.

```sh
npm test
npm run build      # fetches the live feed into dist/
npm run preview    # http://127.0.0.1:8787
```

To build from a saved copy of the feed, run `FEED_FILE=path/to/feed.ics npm run build`. This works offline, so the staff categories and SOCS feed links are left out.

## GitHub Pages setup (once)

In the repository's **Settings → Pages**, set **Source** to **GitHub Actions**. The workflow sets the site address, including any custom domain, automatically.

Note that GitHub pauses scheduled workflows in a public repository after 60 days with no commits. If the "Calendar updated…" time in the footer stops moving, re-enable the workflow from the Actions tab or push any commit.

## Build settings (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `PUBLIC_URL` | set by the workflow | Site address used in subscription feeds and share links |
| `FEED_URL` | SOCS full feed for ID 3405 | Source iCal feed |
| `FEED_FILE` | (none) | Build from a local `.ics` file instead of fetching |
| `STAFF_PAGE_URL` | SOCS `calendar.misocs.com/staff/week.aspx?ID=3405` | Page the category IDs and staff-only categories are read from |
| `CALENDAR_NAME` | `Mayfield School` | Name shown in subscribers' calendar apps |

## Customising

- Category colours, groups, labels and audience presets are in [lib/categories.js](lib/categories.js). If SOCS adds a new category, it appears automatically under "Other" and gets its own feed. If SOCS adds a new staff-only (starred) category, the staff view picks it up automatically under "Other". Add it to that file with `staff: true` to put it in the "Staff only" group and keep it out of the Parents and Pupils presets.
- Brand colours and fonts are CSS variables at the top of [public/styles.css](public/styles.css).
