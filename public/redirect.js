// Runs on the "page not found" page. calendar.mayfieldgirls.org used to be the SOCS
// calendar, so old bookmarks and links point at SOCS pages; send those to the new calendar.
//   week.aspx, month.aspx, … (any .aspx page)  -> the calendar
//   staff/… (SOCS's staff calendar)            -> the staff calendar
//   EventDetails.aspx?…&EID=123                -> that event, opened on the calendar
(() => {
  const base = document.documentElement.dataset.base || '/';
  const rel = location.pathname.startsWith(base) ? location.pathname.slice(base.length) : location.pathname.replace(/^\//, '');
  const page = decodeURIComponent(rel).toLowerCase();
  const staff = /^staff(\/|$)/.test(page) ? 'staff/' : '';
  const eid = new URLSearchParams(location.search).get('EID');

  let target = null;
  if (/(^|\/)eventdetails\.aspx$/.test(page) && /^\d+$/.test(eid || '')) target = `${staff}?e=${eid}`;
  else if (staff || /\.aspx$/.test(page)) target = staff;
  if (target !== null) location.replace(base + target);
})();
