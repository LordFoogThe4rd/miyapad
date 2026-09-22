const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

/** Coarsest unit first. Weeks are left out so "last week" never stands in for 13 days. */
const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
	['year', 31536000000],
	['month', 2592000000],
	['day', 86400000],
	['hour', 3600000],
	['minute', 60000],
	['second', 1000],
];

/** "3 minutes ago", "yesterday", "now" — the coarsest unit the gap fills, in the browser's locale. */
export function formatRelativeTime(ts: number, now = Date.now()): string {
	const diff = ts - now;
	for (const [unit, ms] of UNITS) {
		if (Math.abs(diff) >= ms) return relative.format(Math.trunc(diff / ms), unit);
	}
	return relative.format(0, 'second');
}
