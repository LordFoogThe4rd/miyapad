import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { Node } from 'prosemirror-model';
import { marked } from 'marked';
import type { Token, Tokens } from 'marked';
import { docText } from './docText';

/** Mirrors the persisted editorMode setting; read whenever decorations are built. */
export interface MarkdownModeRef {
	current: boolean;
}

export const markdownDecorationKey = new PluginKey<DecorationSet>('markdownDecorations');

interface ParaEntry {
	offStart: number;
	offEnd: number;
	nodeStart: number;
	nodeSize: number;
}

interface LineSeg {
	textStart: number;
	textEnd: number;
	srcStart: number;
}

const INLINE_STYLE_KINDS = new Set(['strong', 'em', 'del']);

export function buildMarkdownDecorations(doc: Node): DecorationSet {
	const source = docText(doc);
	const paras: ParaEntry[] = [];
	let flatOffset = 0;
	doc.forEach((para, offset) => {
		paras.push({
			offStart: flatOffset,
			offEnd: flatOffset + para.textContent.length,
			nodeStart: offset,
			nodeSize: para.nodeSize,
		});
		flatOffset += para.textContent.length + 1;
	});

	const nodeClasses = new Map<number, string[]>();
	const decorations: Decoration[] = [];

	// greatest paragraph index with offStart <= offset
	const paraIndexAt = (offset: number): number => {
		let lo = 0;
		let hi = paras.length - 1;
		let ans = 0;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			if (paras[mid].offStart <= offset) {
				ans = mid;
				lo = mid + 1;
			} else {
				hi = mid - 1;
			}
		}
		return ans;
	};

	const addNodeClass = (className: string, from: number, to: number): void => {
		for (let i = paraIndexAt(from); i < paras.length; i++) {
			const p = paras[i];
			if (p.offStart >= to) break;
			const overlaps = p.offStart < to && from < p.offEnd;
			const coversEmpty = p.offStart === p.offEnd && from <= p.offStart && p.offStart < to;
			if (!overlaps && !coversEmpty) continue;
			let classes = nodeClasses.get(i);
			if (!classes) {
				classes = [];
				nodeClasses.set(i, classes);
			}
			if (!classes.includes(className)) classes.push(className);
		}
	};

	// Every span is clipped to paragraph bounds: br-split paragraphs and
	// blockquote/list hard breaks split one token across several PM paragraphs,
	// and separator newlines belong to no paragraph.
	const addInlineSpan = (from: number, to: number, className: string): void => {
		if (from >= to) return;
		for (let i = paraIndexAt(from); i < paras.length; i++) {
			const p = paras[i];
			if (to <= p.offStart) break;
			const start = Math.max(from, p.offStart);
			const end = Math.min(to, p.offEnd);
			if (start < end) {
				decorations.push(Decoration.inline(
					p.nodeStart + 1 + (start - p.offStart),
					p.nodeStart + 1 + (end - p.offStart),
					{ class: className },
				));
			}
		}
	};

	// Maps token.text offsets to source offsets. Marked strips per-line markers
	// ("> ", "- ", indentation) from raw to build text, so each text line is
	// matched sequentially in the source from a monotonic cursor — never
	// indexOf(text) over the whole source, repeated text must resolve per-line.
	const buildLineMap = (srcStart: number, text: string): LineSeg[] => {
		const segs: LineSeg[] = [];
		let textCursor = 0;
		let srcCursor = srcStart;
		while (textCursor < text.length) {
			const nl = text.indexOf('\n', textCursor);
			const lineEnd = nl === -1 ? text.length : nl;
			const line = text.slice(textCursor, lineEnd);
			const at = line.length === 0 ? srcCursor : source.indexOf(line, srcCursor);
			if (at !== -1) srcCursor = at;
			segs.push({ textStart: textCursor, textEnd: lineEnd, srcStart: srcCursor });
			srcCursor += line.length;
			if (lineEnd < text.length) {
				textCursor = lineEnd + 1;
				const srcNl = source.indexOf('\n', srcCursor);
				srcCursor = srcNl === -1 ? source.length : srcNl + 1;
			} else {
				textCursor = lineEnd;
			}
		}
		return segs;
	};

	const mapText = (segs: LineSeg[], offset: number): number => {
		for (const seg of segs) {
			if (offset >= seg.textStart && offset <= seg.textEnd) {
				return seg.srcStart + (offset - seg.textStart);
			}
		}
		const last = segs[segs.length - 1];
		return last ? last.srcStart + last.textEnd - last.textStart : 0;
	};

	const walkTextChildren = (text: string, tokens: Token[], srcStart: number): void => {
		const segs = buildLineMap(srcStart, text);
		let textCursor = 0;
		for (const child of tokens) {
			const at = text.indexOf(child.raw, textCursor);
			if (at === -1) continue;
			textCursor = at + child.raw.length;
			if (INLINE_STYLE_KINDS.has(child.type)) {
				const inline = child as Tokens.Strong | Tokens.Em | Tokens.Del;
				const opening = inline.raw.indexOf(inline.text);
				const contentTextStart = at + opening;
				// Emit one span per content line: a content region crossing lines
				// contains blockquote/list markers between lines, so a flat span
				// clipped to paragraph bounds would style marker characters.
				let lineStart = 0;
				for (const line of inline.text.split('\n')) {
					const from = mapText(segs, contentTextStart + lineStart);
					const to = mapText(segs, contentTextStart + lineStart + line.length);
					addInlineSpan(from, to, `pm-md-${child.type}`);
					lineStart += line.length + 1;
				}
				if (inline.tokens.length > 0) {
					walkTextChildren(inline.text, inline.tokens, mapText(segs, contentTextStart));
				}
			} else if (child.type === 'text') {
				const textToken = child as Tokens.Text;
				if (textToken.tokens && textToken.tokens.length > 0) {
					walkTextChildren(textToken.text, textToken.tokens, mapText(segs, at));
				}
			} else {
				walkToken(child, mapText(segs, at), mapText(segs, at + child.raw.length));
			}
		}
	};

	const walkToken = (token: Token, srcStart: number, srcEnd: number): void => {
		switch (token.type) {
			case 'heading': {
				const heading = token as Tokens.Heading;
				// raw embeds the trailing blank line; style only up to content end
				const opening = heading.raw.indexOf(heading.text);
				addNodeClass(`pm-md-heading-h${heading.depth}`, srcStart, srcStart + opening + heading.text.length);
				walkTextChildren(heading.text, heading.tokens, srcStart);
				break;
			}
			case 'paragraph': {
				const paragraph = token as Tokens.Paragraph;
				walkTextChildren(paragraph.text, paragraph.tokens, srcStart);
				break;
			}
			case 'blockquote': {
				const blockquote = token as Tokens.Blockquote;
				addNodeClass('pm-md-blockquote', srcStart, srcEnd);
				walkTextChildren(blockquote.text, blockquote.tokens, srcStart);
				break;
			}
			case 'list': {
				const list = token as Tokens.List;
				addNodeClass('pm-md-list', srcStart, srcEnd);
				let cursor = srcStart;
				for (const item of list.items) {
					const itemStart = cursor;
					cursor += item.raw.length;
					walkToken(item, itemStart, cursor);
				}
				break;
			}
			case 'list_item': {
				const item = token as Tokens.ListItem;
				addNodeClass('pm-md-list-item', srcStart, srcEnd);
				walkTextChildren(item.text, item.tokens, srcStart);
				break;
			}
			case 'table': {
				addNodeClass('pm-md-table', srcStart, srcEnd);
				const first = paras[paraIndexAt(srcStart)];
				addNodeClass('pm-md-table-header', first.offStart, first.offEnd);
				addNodeClass('pm-md-table-row', first.offEnd + 1, srcEnd);
				break;
			}
			case 'hr':
				addNodeClass('pm-md-hr', srcStart, srcEnd);
				break;
			default:
				break;
		}
	};

	const tokens = marked.lexer(source, { gfm: true, breaks: true });
	let cursor = 0;
	for (const token of tokens) {
		const start = cursor;
		cursor += token.raw.length;
		walkToken(token, start, cursor);
	}

	for (const [idx, classes] of nodeClasses) {
		const p = paras[idx];
		decorations.push(Decoration.node(p.nodeStart, p.nodeStart + p.nodeSize, { class: classes.join(' ') }));
	}

	return DecorationSet.create(doc, decorations);
}

export function markdownDecorationPlugin(mode: MarkdownModeRef): Plugin<DecorationSet> {
	return new Plugin<DecorationSet>({
		key: markdownDecorationKey,
		state: {
			init(_config, state) {
				return mode.current ? buildMarkdownDecorations(state.doc) : DecorationSet.empty;
			},
			apply(tr, decorations) {
				if (tr.getMeta(markdownDecorationKey)) {
					return mode.current ? buildMarkdownDecorations(tr.doc) : DecorationSet.empty;
				}
				if (!mode.current) return DecorationSet.empty;
				if (tr.docChanged) return buildMarkdownDecorations(tr.doc);
				return decorations.map(tr.mapping, tr.doc);
			},
		},
		props: {
			decorations(state) {
				return markdownDecorationKey.getState(state) || DecorationSet.empty;
			},
		},
	});
}
