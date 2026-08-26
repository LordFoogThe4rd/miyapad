import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { Node } from 'prosemirror-model';
import { marked } from 'marked';
import type { Token, Tokens } from 'marked';
import { changedRange } from './changedRange';
import { docText } from './docText';

/** Mirrors the persisted editorMode setting; read whenever decorations are built. */
export interface MarkdownModeRef {
	current: boolean;
}

export interface MarkdownPluginState {
	decos: DecorationSet;
	/** Top-level tokens `decos` was built from; null while markdown mode is off. */
	tokens: Token[] | null;
}

export const markdownDecorationKey = new PluginKey<MarkdownPluginState>('markdownDecorations');

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

interface MarkdownBuild {
	decorations: Decoration[];
	/** Every top-level token of the document, to diff the next build against. */
	tokens: Token[];
	/** PM range `decorations` covers, and that the caller must clear first. */
	fromPM: number;
	toPM: number;
}

/**
 * Lexes the whole document and builds decorations for the top-level tokens that
 * changed. Lexing stays whole-document on purpose: it is the cheap half (18 ms
 * of a 97 ms rebuild at 50k chars) and re-lexing a slice is not sound, because
 * a code fence or `> ` changes how the following lines parse. The expensive
 * half is `DecorationSet.create`, which is O(paragraphs x decorations) — that
 * is what narrowing the token range lets the caller skip.
 *
 * `prevTokens` is the token list the existing set was built from; `dirtyFrom`/
 * `dirtyTo` bound what the transaction's steps touched, since only decorations
 * outside that span survived `map()` intact. Pass `prevTokens` null to rebuild
 * everything.
 */
function buildDecorations(doc: Node, prevTokens: Token[] | null, dirtyFrom: number, dirtyTo: number): MarkdownBuild {
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
	// Top-level token raws tile the source exactly, so their starts double as
	// the block boundaries the decorations can be split on.
	const starts: number[] = new Array(tokens.length + 1);
	let cursor = 0;
	for (let i = 0; i < tokens.length; i++) {
		starts[i] = cursor;
		cursor += tokens[i].raw.length;
	}
	starts[tokens.length] = source.length;

	// Block decorations cover whole paragraphs, so a token boundary sits on the
	// node start of the paragraph it opens.
	const boundaryPM = (offset: number): number =>
		offset >= source.length ? doc.content.size : paras[paraIndexAt(offset)].nodeStart;
	const atLineStart = (offset: number): boolean =>
		offset === 0 || offset >= source.length || source.charCodeAt(offset - 1) === 10;

	let from = 0;
	let to = tokens.length;
	if (prevTokens) {
		const maxCommon = Math.min(prevTokens.length, tokens.length);
		while (from < maxCommon && prevTokens[from].raw === tokens[from].raw) from++;
		let suffix = 0;
		while (suffix < maxCommon - from
			&& prevTokens[prevTokens.length - 1 - suffix].raw === tokens[tokens.length - 1 - suffix].raw) suffix++;
		to = tokens.length - suffix;
		// Identical raw is not enough on its own: a decoration only survives if
		// the steps left its positions alone.
		while (from > 0 && boundaryPM(starts[from]) > dirtyFrom) from--;
		while (to < tokens.length && boundaryPM(starts[to]) < dirtyTo) to++;
		// Should never fire — every block token starts on its own line. Rebuild
		// wholesale rather than split the set on a position mid-paragraph.
		if (!atLineStart(starts[from]) || !atLineStart(starts[to])) {
			from = 0;
			to = tokens.length;
		}
	}

	let walkCursor = starts[from];
	for (let i = from; i < to; i++) {
		const start = walkCursor;
		walkCursor += tokens[i].raw.length;
		walkToken(tokens[i], start, walkCursor);
	}

	for (const [idx, classes] of nodeClasses) {
		const p = paras[idx];
		decorations.push(Decoration.node(p.nodeStart, p.nodeStart + p.nodeSize, { class: classes.join(' ') }));
	}

	return { decorations, tokens, fromPM: boundaryPM(starts[from]), toPM: boundaryPM(starts[to]) };
}

/** Full-document build, for the initial set and whenever reuse is not possible. */
export function buildMarkdownDecorations(doc: Node): DecorationSet {
	return DecorationSet.create(doc, buildDecorations(doc, null, 0, doc.content.size).decorations);
}

const INACTIVE: MarkdownPluginState = { decos: DecorationSet.empty, tokens: null };

function fullBuild(doc: Node): MarkdownPluginState {
	const built = buildDecorations(doc, null, 0, doc.content.size);
	return { decos: DecorationSet.create(doc, built.decorations), tokens: built.tokens };
}

export function markdownDecorationPlugin(mode: MarkdownModeRef): Plugin<MarkdownPluginState> {
	return new Plugin<MarkdownPluginState>({
		key: markdownDecorationKey,
		state: {
			init(_config, state): MarkdownPluginState {
				return mode.current ? fullBuild(state.doc) : INACTIVE;
			},
			apply(tr, prev): MarkdownPluginState {
				if (tr.getMeta(markdownDecorationKey)) {
					return mode.current ? fullBuild(tr.doc) : INACTIVE;
				}
				if (!mode.current) return INACTIVE;
				if (!tr.docChanged) return prev;
				if (!prev.tokens) return fullBuild(tr.doc);
				const dirty = changedRange(tr);
				const built = buildDecorations(tr.doc, prev.tokens, dirty.from, dirty.to);
				if (built.fromPM === 0 && built.toPM >= tr.doc.content.size) {
					return { decos: DecorationSet.create(tr.doc, built.decorations), tokens: built.tokens };
				}
				const mapped = prev.decos.map(tr.mapping, tr.doc);
				// find() is inclusive at both ends and the rebuilt range is bounded
				// by paragraph node starts, so drop only what falls fully inside it.
				const stale = mapped.find(built.fromPM, built.toPM)
					.filter(deco => deco.from >= built.fromPM && deco.to <= built.toPM);
				return { decos: mapped.remove(stale).add(tr.doc, built.decorations), tokens: built.tokens };
			},
		},
		props: {
			decorations(state) {
				return markdownDecorationKey.getState(state)?.decos || DecorationSet.empty;
			},
		},
	});
}
