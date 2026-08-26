import type { Transaction } from 'prosemirror-state';

/**
 * The span of `tr.doc` the transaction's steps touched — `{ Infinity, -Infinity }`
 * when nothing changed. A decoration lying wholly outside it came through
 * `map()` untouched, which is what lets the decoration plugins reuse it instead
 * of rebuilding the whole set.
 */
export function changedRange(tr: Transaction): { from: number; to: number } {
	let from = Infinity;
	let to = -Infinity;
	for (let i = 0; i < tr.steps.length; i++) {
		// Each step's map reports positions in the doc as of that step; carry
		// them through the remaining steps to land in tr.doc's coordinates.
		const rest = tr.mapping.slice(i + 1);
		tr.steps[i].getMap().forEach((_oldStart, _oldEnd, newStart, newEnd) => {
			const start = rest.map(newStart, -1);
			const end = rest.map(newEnd, 1);
			if (start < from) from = start;
			if (end > to) to = end;
		});
	}
	return { from, to };
}
