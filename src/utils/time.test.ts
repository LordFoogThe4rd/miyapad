import { describe, it, expect } from 'vitest';
import { formatRelativeTime } from './time';

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const fmt = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
/** What the gap should render as: only the unit and value are ours, the wording is Intl's. */
const expected = (value: number, unit: Intl.RelativeTimeFormatUnit) => fmt.format(value, unit);

describe('formatRelativeTime', () => {
	it('picks the coarsest unit the gap fills', () => {
		expect(formatRelativeTime(NOW - 500, NOW)).toBe(expected(0, 'second'));
		expect(formatRelativeTime(NOW - 45_000, NOW)).toBe(expected(-45, 'second'));
		expect(formatRelativeTime(NOW - 90 * 60_000, NOW)).toBe(expected(-1, 'hour'));
		expect(formatRelativeTime(NOW - 86_400_000, NOW)).toBe(expected(-1, 'day'));
		expect(formatRelativeTime(NOW - 50 * 86_400_000, NOW)).toBe(expected(-1, 'month'));
		expect(formatRelativeTime(NOW - 400 * 86_400_000, NOW)).toBe(expected(-1, 'year'));
	});

	it('rounds towards now instead of overshooting a unit', () => {
		expect(formatRelativeTime(NOW - 59.9 * 60_000, NOW)).toBe(expected(-59, 'minute'));
	});

	it('handles timestamps in the future', () => {
		expect(formatRelativeTime(NOW + 2 * 86_400_000, NOW)).toBe(expected(2, 'day'));
	});
});
