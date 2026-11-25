// Is a new build fit to replace the live one? Compares the counts in their health.json files.
// Returns '' if it is, or the reason it isn't.
const LEAST = { events: 0.8, staffEvents: 0.8, staffOnly: 0.5, feeds: 0.8 };

export function refusal(live, next) {
  for (const key of Object.keys(LEAST)) {
    if (!Number.isInteger(next?.[key]) || next[key] < 1) return `${key} is missing or 0`;
  }
  if (!live) return '';
  for (const [key, share] of Object.entries(LEAST)) {
    if (Number.isInteger(live[key]) && next[key] < live[key] * share) return `${key} fell from ${live[key]} to ${next[key]}`;
  }
  return '';
}
