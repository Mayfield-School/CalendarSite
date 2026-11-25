import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refusal } from '../lib/publish-check.js';

const good = { events: 1000, staffEvents: 1700, staffOnly: 700, feeds: 145 };

test('a first build, and a normal one, are published', () => {
  assert.equal(refusal(null, good), '');
  assert.equal(refusal(good, { ...good, events: 950, staffOnly: 650 }), '');
});

test('an empty or incomplete build is refused, even as the first', () => {
  assert.match(refusal(null, null), /missing/);
  assert.match(refusal(null, { ...good, staffOnly: 0 }), /staffOnly/);
  assert.match(refusal(null, { ...good, events: undefined }), /events/);
});

test('far fewer events, staff events or feeds is refused', () => {
  assert.match(refusal(good, { ...good, events: 700 }), /events fell from 1000 to 700/);
  assert.match(refusal(good, { ...good, staffOnly: 300 }), /staffOnly/);
  assert.match(refusal(good, { ...good, feeds: 100 }), /feeds/);
});
