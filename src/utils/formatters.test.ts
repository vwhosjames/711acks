import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPluralCount, formatSmartTimestamp } from './formatters';

test('formatPluralCount uses Intl.PluralRules for singular, zero, and plural counts', () => {
  assert.equal(formatPluralCount(0, 'unit'), '0 units');
  assert.equal(formatPluralCount(1, 'unit'), '1 unit');
  assert.equal(formatPluralCount(2, 'unit'), '2 units');
  assert.equal(formatPluralCount(1, 'published drink hack'), '1 published drink hack');
  assert.equal(formatPluralCount(5, 'published drink hack'), '5 published drink hacks');
  assert.equal(formatPluralCount(1, 'entry', 'entries'), '1 entry');
  assert.equal(formatPluralCount(3, 'entry', 'entries'), '3 entries');
});

test('formatSmartTimestamp formats <= 7 days relatively and > 7 days as absolute dates', () => {
  const now = new Date('2026-11-23T12:00:00Z').getTime();

  assert.equal(formatSmartTimestamp('2026-11-23T12:00:00Z', now), 'Just now');
  assert.equal(formatSmartTimestamp('2026-11-23T11:30:00Z', now), '30 minutes ago');
  assert.equal(formatSmartTimestamp('2026-11-23T09:00:00Z', now), '3 hours ago');
  assert.equal(formatSmartTimestamp('2026-11-22T12:00:00Z', now), 'Yesterday');
  assert.equal(formatSmartTimestamp('2026-11-20T12:00:00Z', now), '3 days ago');

  // Older than 7 days -> absolute date
  assert.equal(formatSmartTimestamp('2026-11-10T12:00:00Z', now), 'Nov 10, 2026');
  assert.equal(formatSmartTimestamp('2026-01-05T12:00:00Z', now), 'Jan 5, 2026');

  // Invalid or empty dates
  assert.equal(formatSmartTimestamp(null, now), 'Pending Verification');
  assert.equal(formatSmartTimestamp('', now), 'Pending Verification');
});
