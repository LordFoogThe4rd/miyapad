import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorState, Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { markdownDecorationKey } from './markdownDecorations';

/**
 * Reveals the markdown markers `markdownDecorationPlugin` hides. Block prefixes
 * ("# ", "> ", "- ") come back when the caret is anywhere in their paragraph,
 * inline delimiters ("**", backticks, the brackets of a link) only when it is
 * inside the construct they delimit.
 *
 * Inline beats line: while any inline construct is revealed, its line's
 * prefixes stay hidden, so being inside a word does not also expose the
 * heading marker for the whole line. Obsidian differs here and reveals a
 * heading's "#" whenever the caret is anywhere on the line.
 *
 * That precedence is only between the two kinds. Nested inline constructs all
 * reveal together, so a caret in the italic of "**bold *and italic***" shows
 * both pairs: you see the whole of what you are editing inside.
 *
 * Known limitation: an inline construct spanning a soft line break is split
 * into paragraph-local decorations (`addInlineSpan` clips to paragraph bounds,
 * and the schema is one paragraph per line), and only the caret's paragraph is
 * searched. In "**bold\ntext**" a caret in the first line reveals the opening
 * "**" and leaves the closing one hidden.
 *
 * Both are pure CSS once the classes are there — `.pm-md-active` on the
 * paragraph node, `.pm-md-reveal` on the individual marker spans — so a cursor
 * move never re-lexes or rebuilds the markdown set. That separation is the
 * point: this plugin runs on every selection change, the other one must not.
 *
 * Must be registered *after* `markdownDecorationPlugin`. ProseMirror applies
 * plugins in array order, and `apply` only sees the new state of the plugins
 * declared before it.
 */
export const markdownCaretKey = new PluginKey<DecorationSet>('markdownCaret');

function build(state: EditorState): DecorationSet {
	const md = markdownDecorationKey.getState(state);
	// tokens is null exactly while markdown mode is off.
	if (!md || !md.tokens) return DecorationSet.empty;

	const sel = state.selection;
	const $head = sel.$head;
	// depth 1 is the paragraph — the schema has no block nesting.
	if ($head.depth < 1) return DecorationSet.empty;
	const paraFrom = $head.before(1);
	const paraTo = paraFrom + $head.parent.nodeSize;

	// Grouped by spec.md, so the construct's extent comes from the decorations'
	// own (already mapped) positions rather than offsets stored at build time.
	const groups = new Map<number, { from: number; to: number; markers: Decoration[] }>();
	for (const deco of md.decos.find(paraFrom, paraTo)) {
		const spec = deco.spec as { md?: number; marker?: boolean } | null;
		if (spec?.md === undefined) continue;
		let g = groups.get(spec.md);
		if (!g) {
			g = { from: deco.from, to: deco.to, markers: [] };
			groups.set(spec.md, g);
		} else {
			if (deco.from < g.from) g.from = deco.from;
			if (deco.to > g.to) g.to = deco.to;
		}
		if (spec.marker) g.markers.push(deco);
	}

	const revealed: Decoration[] = [];
	for (const g of groups.values()) {
		// Inclusive at both ends: the caret has to be able to sit just past a
		// closing "**" to delete it, and that position is outside the construct.
		if (sel.from > g.to || sel.to < g.from) continue;
		for (const m of g.markers) revealed.push(Decoration.inline(m.from, m.to, { class: 'pm-md-reveal' }));
	}

	// Inline beats line. A construct with nothing to reveal (its markers were
	// left visible because text was not a substring of raw) leaves this empty,
	// which correctly falls through to revealing the line.
	if (revealed.length > 0) return DecorationSet.create(state.doc, revealed);
	return DecorationSet.create(state.doc, [Decoration.node(paraFrom, paraTo, { class: 'pm-md-active' })]);
}

export const markdownCaretPlugin = new Plugin<DecorationSet>({
	key: markdownCaretKey,
	state: {
		init(_config, state): DecorationSet {
			return build(state);
		},
		apply(tr: Transaction, prev: DecorationSet, _old, next): DecorationSet {
			// Nothing else can move the caret or the markers it points at. A
			// meta-only transaction (hover, window re-aim) leaves both alone.
			if (!tr.selectionSet && !tr.docChanged && !tr.getMeta(markdownDecorationKey)) return prev;
			return build(next);
		},
	},
	props: {
		decorations(state) {
			return markdownCaretKey.getState(state) ?? DecorationSet.empty;
		},
	},
});
