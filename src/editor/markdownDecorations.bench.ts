/**
 * Costs behind the two markdown-decoration optimisations, each benched against
 * its own absence: the viewport window (docs/prompt-editor.md, "Viewport
 * Window") and the deferred rebuild ("Deferred Rebuilds").
 *
 * These run under jsdom, whose DOM is far slower than a browser's, so the
 * absolute milliseconds do not transfer. Only the ratios between benches on one
 * machine mean anything; there is no stored baseline, so read them by hand.
 */
import { bench, describe } from 'vitest';
import { EditorState } from 'prosemirror-state';
import type { Node } from 'prosemirror-model';
import { schema } from './schema';
import { textToDoc } from './syncReactToPM';
import { markdownDecorationKey, markdownDecorationPlugin, paddedWindow } from './markdownDecorations';

/** Heading + bold/italic/strike prose + list + blockquote, repeated — heavy on markers, so both the lexer and the decoration walk have real work to do. */
function heavy(blocks: number): string {
	return Array.from({ length: blocks }, (_, i) => [
		`# Heading ${i}`,
		'',
		`Body **bold ${i}** and *em ${i}* and ~~struck ${i}~~ text that runs a while.`,
		'',
		`> quote ${i} with **emphasis**`,
		'',
		`- item ${i} *one*`,
		`- item ${i} two`,
		'',
	].join('\n')).join('\n');
}

/** PM position of the start of top-level child `index`. */
function paraStart(doc: Node, index: number): number {
	let pos = 0;
	for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
	return pos;
}

const BLOCKS = 400;
const DOC = textToDoc(schema, heavy(BLOCKS));
/** Inside the paragraph halfway down, where a viewport window aimed on load would sit. */
const AT = paraStart(DOC, DOC.childCount >> 1) + 2;

// Base states are built once, outside the benched closures: ProseMirror states
// are immutable, so `state.apply(tr)` never mutates `state` and the same base
// can be re-applied every sample. Building one inside the closure would time
// the initial full lex+build too — for the windowed case that is a *second*
// full build, since aiming the window still lexes the whole document.
const wholeBase = EditorState.create({ doc: DOC, plugins: [markdownDecorationPlugin({ current: true })] });
const windowedBase = wholeBase.apply(wholeBase.tr.setMeta(markdownDecorationKey, { window: paddedWindow(DOC, AT, AT, 60) }));

/**
 * A keystroke defers its rebuild, so all `apply` does is map the set forward
 * (markdownDecorations.ts, the `pending` branch). That makes the cost
 * proportional to how many decorations exist — ~3600 for the whole document
 * against ~120 for a ±60-paragraph window — which is what the window buys on
 * the typing path. Neither of these times a rebuild; the flush benches do.
 */
describe('markdownDecorationPlugin: keystroke maps the set forward', () => {
	bench('whole-document set', () => {
		wholeBase.apply(wholeBase.tr.insertText('x', AT));
	});

	bench('viewport-window set (±60 paragraphs)', () => {
		windowedBase.apply(windowedBase.tr.insertText('x', AT));
	});
});

/**
 * What deferring moves off the keystroke path: the whole-document lex and the
 * splice. One flush serves however many edits arrived since the last, so a
 * burst costs about the same as a single keystroke's flush.
 */
describe('markdownDecorationPlugin: deferred flush', () => {
	const flush = (s: EditorState): EditorState => s.apply(s.tr.setMeta(markdownDecorationKey, 'flush'));

	bench('one keystroke + its own flush', () => {
		flush(windowedBase.apply(windowedBase.tr.insertText('x', AT)));
	});

	bench('20 keystrokes coalesced into one flush', () => {
		let state = windowedBase;
		for (let k = 0; k < 20; k++) state = state.apply(state.tr.insertText('z', AT));
		flush(state);
	});
});
