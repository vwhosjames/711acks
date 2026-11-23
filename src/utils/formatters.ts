const englishPluralRules = new Intl.PluralRules('en-US');
const relativeTimeFormatter = new Intl.RelativeTimeFormat('en', {
  numeric: 'auto',
});
const absoluteDateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

/**
 * Pluralizes a count using Intl.PluralRules so singular/plural forms
 * are always grammatically accurate without clunky "unit(s)" labels.
 */
export function formatPluralCount(
  count: number,
  singular: string,
  plural = `${singular}s`
): string {
  const rule = englishPluralRules.select(count);
  return `${count} ${rule === 'one' ? singular : plural}`;
}

/**
 * Formats an ISO timestamp:
 * - Within the last 7 days: relative phrasing (e.g., "Today", "Yesterday", "3 days ago")
 * - Older than 7 days (or in the future beyond 7 days): absolute date (e.g., "Nov 22, 2026")
 */
export function formatSmartTimestamp(
  isoDate: string | null | undefined,
  nowMs: number = Date.now()
): string {
  if (!isoDate) return 'Pending Verification';
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return 'Pending Verification';

  const diffMs = parsed.getTime() - nowMs;
  const absDiffMs = Math.abs(diffMs);
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  if (absDiffMs > SEVEN_DAYS_MS) {
    return absoluteDateFormatter.format(parsed);
  }

  const diffMinutes = Math.round(diffMs / (60 * 1000));
  if (Math.abs(diffMinutes) < 1) {
    return 'Just now';
  }
  if (Math.abs(diffMinutes) < 60) {
    return relativeTimeFormatter.format(diffMinutes, 'minute');
  }

  const diffHours = Math.round(diffMs / (60 * 60 * 1000));
  if (Math.abs(diffHours) < 24) {
    return relativeTimeFormatter.format(diffHours, 'hour');
  }

  const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
  const formatted = relativeTimeFormatter.format(diffDays, 'day');
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}
