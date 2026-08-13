import { describe, it, expect } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { Decoration } from 'prosemirror-view';
import { schema } from './schema';
import { textToDoc } from './syncReactToPM';
import {
	buildMarkdownDecorations,
	markdownDecorationKey,
	markdownDecorationPlugin,
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
		expect(markdownDecorationKey.getState(createState('# T', true))!.find().length).toBe(1);
		expect(markdownDecorationKey.getState(createState('# T', false))!.find().length).toBe(0);
	});

	it('rebuilds decorations on doc changes while active', () => {
		const state = createState('a **b**', true);
		expect(markdownDecorationKey.getState(state)!.find().length).toBe(1);
		const next = state.apply(state.tr.insertText('x', 1));
		expect(markdownDecorationKey.getState(next)!.find().length).toBe(1);
		expect(markdownDecorationKey.getState(next)!.find()[0].from).toBe(6);
	});

	it('activates and deactivates via a meta transaction', () => {
		const mode = { current: false };
		const state = EditorState.create({
			doc: textToDoc(schema, '# T'),
			plugins: [markdownDecorationPlugin(mode)],
		});
		expect(markdownDecorationKey.getState(state)!.find().length).toBe(0);

		mode.current = true;
		const on = state.apply(state.tr.setMeta(markdownDecorationKey, true));
		expect(markdownDecorationKey.getState(on)!.find().length).toBe(1);

		mode.current = false;
		const off = on.apply(on.tr.setMeta(markdownDecorationKey, true));
		expect(markdownDecorationKey.getState(off)!.find().length).toBe(0);
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
