import { describe, it, expect, vi } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { DecorationSet, EditorView } from 'prosemirror-view';
import type { Decoration } from 'prosemirror-view';
import type { Node } from 'prosemirror-model';
import { schema } from './schema';
import { textToDoc } from './syncReactToPM';
import {
	buildMarkdownDecorations,
	markdownDecorationKey,
	markdownDecorationPlugin,
	paddedWindow,
} from './markdownDecorations';

function decosFor(text: string): Decoration[] {
	return buildMarkdownDecorations(textToDoc(schema, text)).find();
}

function classOf(d: Decoration): string {
	// attrs (not spec) carry the class; Decoration exposes spec publicly but
	// attrs only via the internal DecorationType.
	const attrs = (d as unknown as { type: { attrs: Record<string, unknown> } }).type.attrs;
	return (attrs?.class as string) ?? '';
}

function byClass(decos: Decoration[], className: string): Decoration[] {
	return decos.filter((d) => classOf(d).split(' ').includes(className));
}

describe('buildMarkdownDecorations', () => {
	it('styles a heading paragraph with its level class', () => {
		const d = byClass(decosFor('# Title'), 'pm-md-heading-h1');
		expect(d).toHaveLength(1);
		expect(d[0].from).toBe(0);
		expect(d[0].to).toBe(9); // paragraph node size: 7 chars + 2 borders
	});

	it('distinguishes heading levels', () => {
		expect(byClass(decosFor('## Sub'), 'pm-md-heading-h2')).toHaveLength(1);
		expect(byClass(decosFor('### Sub'), 'pm-md-heading-h3')).toHaveLength(1);
		expect(byClass(decosFor('###### Sub'), 'pm-md-heading-h6')).toHaveLength(1);
	});

	it('styles inline strong content at exact positions, excluding markers', () => {
		const d = byClass(decosFor('a **bold** c'), 'pm-md-strong');
		expect(d).toHaveLength(1);
		// positions: p(0) a(1) space(2) *(3) *(4) b(5..7) d(8) *(9) *(10)
		expect(d[0].from).toBe(5);
		expect(d[0].to).toBe(9);
	});

	it('styles inline em and del content', () => {
		const em = byClass(decosFor('x *it* y'), 'pm-md-em');
		expect(em).toHaveLength(1);
		expect([em[0].from, em[0].to]).toEqual([4, 6]);

		const del = byClass(decosFor('x ~~gone~~ y'), 'pm-md-del');
		expect(del).toHaveLength(1);
		expect([del[0].from, del[0].to]).toEqual([5, 9]);
	});

	it('styles inline marks inside heading content', () => {
		const d = byClass(decosFor('# **B**'), 'pm-md-strong');
		expect(d).toHaveLength(1);
		expect([d[0].from, d[0].to]).toEqual([5, 6]);
	});

	it('resolves repeated text spans sequentially', () => {
		const d = byClass(decosFor('dup **a** x **a** dup'), 'pm-md-strong');
		expect(d).toHaveLength(2);
		expect([d[0].from, d[0].to]).toEqual([7, 8]);
		expect([d[1].from, d[1].to]).toEqual([15, 16]);
	});

	it('recurses into nested inline marks', () => {
		const d = decosFor('**a _b_ c**');
		const strong = byClass(d, 'pm-md-strong');
		const em = byClass(d, 'pm-md-em');
		expect(strong).toHaveLength(1);
		expect([strong[0].from, strong[0].to]).toEqual([3, 10]);
		expect(em).toHaveLength(1);
		expect([em[0].from, em[0].to]).toEqual([6, 7]);
	});

	it('clips a br-split strong span at the paragraph boundary', () => {
		const d = byClass(decosFor('**a\nb**'), 'pm-md-strong');
		expect(d).toHaveLength(2);
		// paragraph 1 "**a": strong content 'a' at flat 2 → PM pos 3
		expect([d[0].from, d[0].to]).toEqual([3, 4]);
		// paragraph 2 "b**" node starts at 5 (para1 nodeSize 3+2), 'b' at flat 4 → pos 6
		expect([d[1].from, d[1].to]).toEqual([6, 7]);
	});

	it('styles a multi-paragraph blockquote per paragraph including the empty line', () => {
		const d = byClass(decosFor('> a\n>\n> b'), 'pm-md-blockquote');
		expect(d).toHaveLength(3);
		expect(d[0].from).toBe(0);
		expect(d[0].to).toBe(5); // "> a" node size 3+2
		expect(d[1].to - d[1].from).toBe(3); // paragraph ">"
	});

	it('styles inline marks inside blockquotes', () => {
		const d = decosFor('> **a**\n>\n> b');
		const strong = byClass(d, 'pm-md-strong');
		expect(strong).toHaveLength(1);
		expect([strong[0].from, strong[0].to]).toEqual([5, 6]);
	});

	it('styles inline marks inside list items', () => {
		const d = decosFor('- item *one*');
		const em = byClass(d, 'pm-md-em');
		expect(em).toHaveLength(1);
		expect([em[0].from, em[0].to]).toEqual([9, 12]);
		const list = byClass(d, 'pm-md-list');
		const item = byClass(d, 'pm-md-list-item');
		expect(list).toHaveLength(1);
		expect(item).toHaveLength(1);
	});

	it('merges node classes when a nested list sits in a blockquote', () => {
		const d = decosFor('> - item');
		const blockquote = byClass(d, 'pm-md-blockquote');
		expect(blockquote).toHaveLength(1);
		const classes = classOf(blockquote[0]);
		expect(classes).toContain('pm-md-list');
		expect(classes).toContain('pm-md-list-item');
	});

	it('styles a multi-line blockquote strong spanning a marker line', () => {
		const d = byClass(decosFor('> **a\n> b**'), 'pm-md-strong');
		expect(d).toHaveLength(2);
		expect([d[0].from, d[0].to]).toEqual([5, 6]);
		// paragraph 2 "> b**" node starts at 7, 'b' at flat 8 → pos 10
		expect([d[1].from, d[1].to]).toEqual([10, 11]);
	});

	it('styles tables with header and row classes per paragraph', () => {
		const d = decosFor('a | b\n-|-\n1 | 2');
		expect(byClass(d, 'pm-md-table')).toHaveLength(3);
		expect(byClass(d, 'pm-md-table-header')).toHaveLength(1);
		expect(byClass(d, 'pm-md-table-row')).toHaveLength(2);
	});

	it('styles horizontal rules', () => {
		const d = byClass(decosFor('before\n\n---'), 'pm-md-hr');
		expect(d).toHaveLength(1);
	});

	it('emits no decorations for plain text', () => {
		expect(decosFor('just plain text\n\nmore text')).toHaveLength(0);
	});

	it('emits no decorations for an empty document', () => {
		expect(decosFor('')).toHaveLength(0);
	});
});

describe('markdownDecorationPlugin', () => {
	function createState(text: string, active: boolean) {
		return EditorState.create({
			doc: textToDoc(schema, text),
			plugins: [markdownDecorationPlugin({ current: active })],
		});
	}

	it('builds decorations when active at init and stays empty when inactive', () => {
		expect(markdownDecorationKey.getState(createState('# T', true))!.decos.find().length).toBe(1);
		expect(markdownDecorationKey.getState(createState('# T', false))!.decos.find().length).toBe(0);
	});

	it('rebuilds decorations on doc changes while active', () => {
		const state = createState('a **b**', true);
		expect(markdownDecorationKey.getState(state)!.decos.find().length).toBe(1);
		const typed = state.apply(state.tr.insertText('x', 1));
		const next = typed.apply(typed.tr.setMeta(markdownDecorationKey, 'flush'));
		expect(markdownDecorationKey.getState(next)!.decos.find().length).toBe(1);
		expect(markdownDecorationKey.getState(next)!.decos.find()[0].from).toBe(6);
	});

	it('defers the rebuild off the edit and flushes it from the view', async () => {
		const container = document.createElement('div');
		document.body.appendChild(container);
		const view = new EditorView(container, { state: createState('a **b** c', true) });
		expect(container.querySelectorAll('.pm-md-strong')).toHaveLength(1);

		// The new strong is not styled yet — the edit only mapped the old set...
		view.dispatch(view.state.tr.insertText('**d** ', 1));
		expect(markdownDecorationKey.getState(view.state)!.pending).not.toBeNull();
		expect(container.querySelectorAll('.pm-md-strong')).toHaveLength(1);

		// ...until the scheduled flush lands (jsdom has no requestIdleCallback,
		// so this is the setTimeout fallback).
		await new Promise(resolve => setTimeout(resolve, 250));
		expect(markdownDecorationKey.getState(view.state)!.pending).toBeNull();
		expect(container.querySelectorAll('.pm-md-strong')).toHaveLength(2);

		view.destroy();
		container.remove();
	});

	it('activates and deactivates via a meta transaction', () => {
		const mode = { current: false };
		const state = EditorState.create({
			doc: textToDoc(schema, '# T'),
			plugins: [markdownDecorationPlugin(mode)],
		});
		expect(markdownDecorationKey.getState(state)!.decos.find().length).toBe(0);

		mode.current = true;
		const on = state.apply(state.tr.setMeta(markdownDecorationKey, true));
		expect(markdownDecorationKey.getState(on)!.decos.find().length).toBe(1);

		mode.current = false;
		const off = on.apply(on.tr.setMeta(markdownDecorationKey, true));
		expect(markdownDecorationKey.getState(off)!.decos.find().length).toBe(0);
	});

	it('renders decoration classes in the view DOM', () => {
		const container = document.createElement('div');
		document.body.appendChild(container);
		const view = new EditorView(container, { state: createState('# Title\n\n**bold**', true) });
		expect(container.querySelectorAll('.pm-md-heading-h1')).toHaveLength(1);
		expect(container.querySelectorAll('.pm-md-strong')).toHaveLength(1);
		view.destroy();
		container.remove();
	});
});

describe('markdownDecorationPlugin incremental rebuilds', () => {
	function activeState(text: string) {
		return EditorState.create({
			doc: textToDoc(schema, text),
			plugins: [markdownDecorationPlugin({ current: true })],
		});
	}

	/** Sorted (from, to, class) triples, so two sets can be compared regardless of build order. */
	function normalise(decos: Decoration[]): string[] {
		return decos.map(d => `${d.from}-${d.to}:${classOf(d)}`).sort();
	}

	function pluginDecos(state: EditorState): string[] {
		return normalise(markdownDecorationKey.getState(state)!.decos.find());
	}

	function fullDecos(state: EditorState): string[] {
		return normalise(buildMarkdownDecorations(state.doc).find());
	}

	/** Runs the rebuild the edits deferred, as the plugin's view() would on idle. */
	function flush(state: EditorState): EditorState {
		return state.apply(state.tr.setMeta(markdownDecorationKey, 'flush'));
	}

	const SAMPLE = [
		'# Title',
		'',
		'A paragraph with **bold** and *italic* and ~~struck~~ words.',
		'',
		'- first **item**',
		'- second item',
		'',
		'> quoted **text** here',
		'',
		'| a | b |',
		'| - | - |',
		'| 1 | 2 |',
		'',
		'## Second heading',
		'',
		'Trailing paragraph with *emphasis*.',
	].join('\n');

	it('matches a full rebuild after an edit in each block', () => {
		let state = activeState(SAMPLE);
		// walk a caret through every paragraph, typing into each in turn
		for (let para = 0; para < state.doc.childCount; para++) {
			let pos = 1;
			for (let i = 0; i < para; i++) pos += state.doc.child(i).nodeSize;
			state = flush(state.apply(state.tr.insertText('z', pos)));
			expect(pluginDecos(state)).toEqual(fullDecos(state));
		}
	});

	it('matches a full rebuild across inserts, deletes, splits and joins', () => {
		let state = activeState(SAMPLE);
		let seed = 12345;
		const rnd = (n: number) => {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;
			return seed % n;
		};
		for (let step = 0; step < 200; step++) {
			const para = rnd(state.doc.childCount);
			let start = 0;
			for (let i = 0; i < para; i++) start += state.doc.child(i).nodeSize;
			const len = state.doc.child(para).content.size;
			const at = start + 1 + rnd(len + 1);
			const kind = rnd(4);
			let tr = state.tr;
			if (kind === 0) tr = tr.insertText('*_# >-|`abc '[rnd(12)], at);
			else if (kind === 1 && len > 0) tr = tr.delete(at, Math.min(at + 1, start + 1 + len));
			else if (kind === 2) tr = tr.split(at);
			else if (kind === 3 && para > 0) tr = tr.join(start);
			if (!tr.docChanged) continue;
			state = flush(state.apply(tr));
			expect(pluginDecos(state)).toEqual(fullDecos(state));
		}
	});

	it('accumulates the changed range across deferred edits', () => {
		const state = activeState(SAMPLE);
		const first = state.apply(state.tr.insertText('Z', state.doc.content.size - 1));
		const tail = markdownDecorationKey.getState(first)!.pending!;
		const second = first.apply(first.tr.insertText('Y', 1));
		const dirty = markdownDecorationKey.getState(second)!.pending!;
		// The second edit shifted the first one's range forward by a character
		// and the union still has to reach it: the flush is bounded by every
		// edit it stands in for, not by the last transaction alone.
		expect(dirty.from).toBeLessThanOrEqual(1);
		expect(dirty.to).toBeGreaterThanOrEqual(tail.to + 1);
		expect(markdownDecorationKey.getState(flush(second))!.pending).toBeNull();
	});

	it('matches a full rebuild when several edits share one flush', () => {
		let state = activeState(SAMPLE);
		let seed = 4242;
		const rnd = (n: number) => {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;
			return seed % n;
		};
		for (let round = 0; round < 60; round++) {
			// A burst of edits in unrelated blocks, then a single rebuild — what a
			// debounced flush sees, and what makes the accumulated changed range
			// rather than one transaction's the thing the splice is bounded by.
			for (let step = 0; step < 1 + rnd(5); step++) {
				const para = rnd(state.doc.childCount);
				let start = 0;
				for (let i = 0; i < para; i++) start += state.doc.child(i).nodeSize;
				const len = state.doc.child(para).content.size;
				const at = start + 1 + rnd(len + 1);
				const kind = rnd(4);
				let tr = state.tr;
				if (kind === 0) tr = tr.insertText('*_# >-|`abc '[rnd(12)], at);
				else if (kind === 1 && len > 0) tr = tr.delete(at, Math.min(at + 1, start + 1 + len));
				else if (kind === 2) tr = tr.split(at);
				else if (kind === 3 && para > 0) tr = tr.join(start);
				if (!tr.docChanged) continue;
				state = state.apply(tr);
			}
			state = flush(state);
			expect(pluginDecos(state)).toEqual(fullDecos(state));
		}
	});

	it('matches a full rebuild when a fence opened early reparses the rest', () => {
		let state = activeState('text\n\n```\n\nsome **bold**\n\nmore *text*\n');
		expect(pluginDecos(state)).toEqual(fullDecos(state));

		// closing the fence turns the trailing lines back into real markdown
		const end = state.doc.content.size - 1;
		state = flush(state.apply(state.tr.insertText('```', end)));
		expect(pluginDecos(state)).toEqual(fullDecos(state));
	});

	it('leaves the lex and the splice to the flush', () => {
		const state = activeState(SAMPLE);
		const before = markdownDecorationKey.getState(state)!.decos.find();
		const typed = state.apply(state.tr.insertText(' **new**', 7));
		const deferred = markdownDecorationKey.getState(typed)!.decos.find();
		// Mapped, not rebuilt: same decorations carried forward, the new strong
		// still unstyled — which is exactly what makes the set differ from a
		// fresh build until the flush runs.
		expect(deferred).toHaveLength(before.length);
		expect(pluginDecos(typed)).not.toEqual(fullDecos(typed));
		expect(pluginDecos(flush(typed))).toEqual(fullDecos(typed));
	});

	it('splices a streamed append instead of rebuilding the whole set', () => {
		const state = activeState(SAMPLE);
		const create = vi.spyOn(DecorationSet, 'create');
		const next = flush(state.apply(state.tr.insertText(' and **more**', state.doc.content.size - 1)));
		expect(create).not.toHaveBeenCalled();
		create.mockRestore();
		expect(pluginDecos(next)).toEqual(fullDecos(next));
	});
});

describe('markdownDecorationPlugin viewport window', () => {
	// 40 blocks x 6 lines: heading, blank, inline-marked body, blank, quote, blank
	const LONG = Array.from({ length: 40 }, (_, i) => [
		`# Heading ${i}`,
		'',
		`Body **bold ${i}** and *em ${i}* text.`,
		'',
		`> quote ${i}`,
		'',
	]).flat().join('\n');

	function activeState(text: string) {
		return EditorState.create({
			doc: textToDoc(schema, text),
			plugins: [markdownDecorationPlugin({ current: true })],
		});
	}

	function normalise(decos: Decoration[]): string[] {
		return decos.map(d => `${d.from}-${d.to}:${classOf(d)}`).sort();
	}

	function pluginDecos(state: EditorState): string[] {
		return normalise(markdownDecorationKey.getState(state)!.decos.find());
	}

	function paraStart(doc: Node, index: number): number {
		let pos = 0;
		for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
		return pos;
	}

	/** Paragraphs lying wholly inside `win`, as { start, size }. */
	function parasInside(doc: Node, win: { from: number; to: number }) {
		const inside: { start: number; size: number }[] = [];
		let pos = 0;
		for (let i = 0; i < doc.childCount; i++) {
			const size = doc.child(i).nodeSize;
			if (pos >= win.from && pos + size <= win.to) inside.push({ start: pos, size });
			pos += size;
		}
		return inside;
	}

	function aimAt(state: EditorState, win: { from: number; to: number }): EditorState {
		return state.apply(state.tr.setMeta(markdownDecorationKey, { window: win }));
	}

	function flush(state: EditorState): EditorState {
		return state.apply(state.tr.setMeta(markdownDecorationKey, 'flush'));
	}

	it('pads the window by whole paragraphs on each side', () => {
		const doc = textToDoc(schema, LONG);
		const win = paddedWindow(doc, paraStart(doc, 100), paraStart(doc, 100), 3);
		expect(win.from).toBe(paraStart(doc, 97));
		expect(win.to).toBe(paraStart(doc, 104));
	});

	it('clamps the padded window to the document edges', () => {
		const doc = textToDoc(schema, LONG);
		expect(paddedWindow(doc, 0, doc.content.size, 5)).toEqual({ from: 0, to: doc.content.size });
	});

	it('decorates the window and nothing else', () => {
		const doc = textToDoc(schema, LONG);
		const win = paddedWindow(doc, paraStart(doc, 120), paraStart(doc, 126), 2);
		const decos = markdownDecorationKey.getState(aimAt(activeState(LONG), win))!.decos.find();
		const full = buildMarkdownDecorations(doc).find();
		expect(decos.length).toBeGreaterThan(0);
		expect(decos.length).toBeLessThan(full.length / 5);
		// nothing invented...
		expect(normalise(full)).toEqual(expect.arrayContaining(normalise(decos)));
		// ...and nothing the full build has inside the window is missing
		const inside = (d: Decoration) => d.from >= win.from && d.to <= win.to;
		expect(normalise(decos.filter(inside))).toEqual(normalise(full.filter(inside)));
	});

	it('matches a fresh windowed build across edits inside the window', () => {
		let state = activeState(LONG);
		let win = paddedWindow(state.doc, paraStart(state.doc, 100), paraStart(state.doc, 110), 4);
		state = aimAt(state, win);
		let seed = 987;
		const rnd = (n: number) => {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;
			return seed % n;
		};
		for (let step = 0; step < 100; step++) {
			const inside = parasInside(state.doc, win);
			const para = inside[rnd(inside.length)];
			const len = para.size - 2;
			const at = para.start + 1 + rnd(len + 1);
			const kind = rnd(4);
			let tr = state.tr;
			if (kind === 0) tr = tr.insertText('*_# >-|`abc '[rnd(12)], at);
			else if (kind === 1 && len > 0) tr = tr.delete(at, Math.min(at + 1, para.start + 1 + len));
			else if (kind === 2) tr = tr.split(at);
			else if (kind === 3 && para.start > win.from) tr = tr.join(para.start);
			if (!tr.docChanged) continue;
			state = flush(state.apply(tr));
			win = { from: tr.mapping.map(win.from, -1), to: tr.mapping.map(win.to, 1) };
			expect(markdownDecorationKey.getState(state)!.window).toEqual(win);
			expect(pluginDecos(state)).toEqual(pluginDecos(aimAt(state, win)));
		}
	});

	it('leaves the set alone for edits outside the window', () => {
		const win = paddedWindow(activeState(LONG).doc, 0, paraStart(activeState(LONG).doc, 14), 2);
		const state = aimAt(activeState(LONG), win);
		const before = pluginDecos(state);
		const create = vi.spyOn(DecorationSet, 'create');
		const next = flush(state.apply(state.tr.insertText('x', paraStart(state.doc, 200) + 1)));
		expect(create).not.toHaveBeenCalled();
		create.mockRestore();
		expect(pluginDecos(next)).toEqual(before);
	});

	it('extends the window over the streamed tail', () => {
		let state = activeState(LONG);
		const win = paddedWindow(state.doc, paraStart(state.doc, 230), state.doc.content.size, 2);
		state = aimAt(state, win);
		const tr = state.tr.insertText(' **tail**', state.doc.content.size - 1);
		const next = flush(state.apply(tr));
		const grown = markdownDecorationKey.getState(next)!.window!;
		expect(grown.from).toBe(win.from);
		expect(grown.to).toBe(next.doc.content.size);
		expect(pluginDecos(next)).toEqual(pluginDecos(aimAt(next, grown)));
	});

	it('re-lexes when a re-aim overtakes a deferred rebuild', () => {
		const state = activeState(LONG);
		const win = paddedWindow(state.doc, paraStart(state.doc, 100), paraStart(state.doc, 110), 4);
		const aimed = aimAt(state, win);
		// Edit first, re-aim before the flush: the stored token list now describes
		// the pre-edit document, so the window build has to lex again rather than
		// reuse it the way an unedited re-aim does.
		const typed = aimed.apply(aimed.tr.insertText(' **late**', paraStart(aimed.doc, 102) + 1));
		const moved = paddedWindow(typed.doc, paraStart(typed.doc, 104), paraStart(typed.doc, 114), 4);
		const reaimed = aimAt(typed, moved);
		expect(markdownDecorationKey.getState(reaimed)!.pending).toBeNull();
		expect(pluginDecos(reaimed)).toEqual(pluginDecos(aimAt(flush(typed), moved)));
	});

	it('rebuilds the whole document when the mode is toggled', () => {
		const state = activeState(LONG);
		const win = paddedWindow(state.doc, paraStart(state.doc, 10), paraStart(state.doc, 14), 2);
		const aimed = aimAt(state, win);
		expect(markdownDecorationKey.getState(aimed)!.window).toEqual(win);
		const toggled = aimed.apply(aimed.tr.setMeta(markdownDecorationKey, true));
		expect(markdownDecorationKey.getState(toggled)!.window).toBeNull();
		expect(pluginDecos(toggled)).toEqual(normalise(buildMarkdownDecorations(toggled.doc).find()));
	});
});
