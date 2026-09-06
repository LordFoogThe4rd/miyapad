import type { Node } from 'prosemirror-model';

const cache = new WeakMap<Node, string>();

/**
 * Flat source text of the doc, '\n' between paragraphs — the app-wide text contract.
 * PM docs are immutable, so memoising per doc node is safe; the WeakMap lets old
 * docs be collected.
 */
export function docText(doc: Node): string {
	let text = cache.get(doc);
	if (text === undefined) {
		text = doc.textBetween(0, doc.content.size, '\n');
		cache.set(doc, text);
	}
	return text;
}

/**
 * docText(doc).length without building the string. Paragraph-only schema: each
 * paragraph adds textLen + 2 to content.size and one '\n' per gap.
 */
export function flatTextLength(doc: Node): number {
	return doc.content.size - doc.childCount - 1;
}
