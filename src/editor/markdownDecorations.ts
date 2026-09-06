import { Plugin, PluginKey } from 'prosemirror-state';
import type { Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { EditorView } from 'prosemirror-view';
import type { Node } from 'prosemirror-model';
import { marked } from 'marked';
import type { Token, Tokens } from 'marked';
import { changedRange } from './changedRange';
import { docText } from './docText';

/** Mirrors the persisted editorMode setting; read whenever decorations are built. */
export interface MarkdownModeRef {
	current: boolean;
}

/** The PM range that is decorated. Both ends sit on paragraph boundaries. */
export interface MarkdownWindow {
	from: number;
	to: number;
}

/** A span of the current document whose decorations may be stale. */
interface DirtyRange {
	from: number;
	to: number;
}

export interface MarkdownPluginState {
	decos: DecorationSet;
	/** Top-level tokens `decos` was built from; null while markdown mode is off. */
	tokens: Token[] | null;
	/** Range `decos` covers; null when the whole document is decorated. */
	window: MarkdownWindow | null;
	/**
	 * Union of the changed ranges of the edits whose rebuild is still deferred,
	 * in current-document coordinates; null when `decos` is up to date. While it
	 * is set `tokens` describes an older document, so nothing may reuse it as a
	 * lex of this one.
	 */
	pending: DirtyRange | null;
}

/**
 * Meta carried on `markdownDecorationKey`: `true` re-reads the mode ref and
 * rebuilds (or clears) everything, a window object re-aims the decorated range
 * after a scroll or a resize, and `'flush'` performs the rebuild the edits since
 * the last one deferred.
 */
export type MarkdownDecorationMeta = true | 'flush' | { window: MarkdownWindow };

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
 * changed and are inside the viewport window. Lexing stays whole-document on
 * purpose: it is the cheap half (18 ms of a 97 ms rebuild at 50k chars) and
 * re-lexing a slice is not sound, because a code fence or `> ` changes how the
 * following lines parse. The expensive half is `DecorationSet.create`, which is
 * O(paragraphs x decorations) — that is what narrowing the token range lets the
 * caller skip.
 *
 * `prevTokens` is the token list the existing set was built from; `dirtyFrom`/
 * `dirtyTo` bound what the steps of every transaction since then touched, since
 * only decorations outside that span survived `map()` intact. Pass `prevTokens`
 * null to rebuild everything. `win` bounds the result to what is on screen;
 * pass null to decorate the whole document. `lexed` skips the lex when the
 * caller already holds this document's token list — a scroll re-aims the window
 * without touching the text.
 */
function buildDecorations(
	doc: Node,
	prevTokens: Token[] | null,
	dirtyFrom: number,
	dirtyTo: number,
	win: MarkdownWindow | null,
	lexed: Token[] | null = null,
): MarkdownBuild {
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

	// Source range of the top-level token being walked. Every span is clamped to
	// it: the plugin splices the set on token boundaries, so a span that escaped
	// its own block would be re-emitted on the next build without the stale copy
	// being cleared, and the block it landed in would be styled by a construct
	// that is not there. Only reachable when the text-to-source mapping below
	// loses track, which mangled half-typed markdown is good at provoking.
	let blockFrom = 0;
	let blockTo = 0;

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

	const addNodeClass = (className: string, rawFrom: number, rawTo: number): void => {
		const from = Math.max(rawFrom, blockFrom);
		const to = Math.min(rawTo, blockTo);
		if (from >= to) return;
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
	const addInlineSpan = (rawFrom: number, rawTo: number, className: string): void => {
		const from = Math.max(rawFrom, blockFrom);
		const to = Math.min(rawTo, blockTo);
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
			// Bounded to the source line the cursor sits on. Past it the text has
			// stopped corresponding, and a stray match in a repeated line further
			// down would drag the token's spans into an unrelated block.
			const lineNl = source.indexOf('\n', srcCursor);
			const srcLineEnd = lineNl === -1 ? source.length : lineNl;
			const at = line.length === 0 ? srcCursor : source.indexOf(line, srcCursor);
			if (at !== -1 && at + line.length <= srcLineEnd) srcCursor = at;
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
				addInlineSpan(srcStart, srcEnd, 'pm-md-hr-marker');
				break;
			default:
				break;
		}
	};

	const tokens = lexed ?? marked.lexer(source, { gfm: true, breaks: true });
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

	if (win && tokens.length > 0) {
		// greatest paragraph index with nodeStart <= pmPos
		const paraIndexAtPM = (pmPos: number): number => {
			let lo = 0;
			let hi = paras.length - 1;
			let ans = 0;
			while (lo <= hi) {
				const mid = (lo + hi) >> 1;
				if (paras[mid].nodeStart <= pmPos) {
					ans = mid;
					lo = mid + 1;
				} else {
					hi = mid - 1;
				}
			}
			return ans;
		};
		const srcOffsetAtPM = (pmPos: number): number =>
			pmPos >= doc.content.size ? source.length : paras[paraIndexAtPM(pmPos)].offStart;
		// greatest token index with starts[i] <= offset
		const tokenIndexAt = (offset: number): number => {
			let lo = 0;
			let hi = tokens.length - 1;
			let ans = 0;
			while (lo <= hi) {
				const mid = (lo + hi) >> 1;
				if (starts[mid] <= offset) {
					ans = mid;
					lo = mid + 1;
				} else {
					hi = mid - 1;
				}
			}
			return ans;
		};
		// The token straddling the window start is kept whole — it is one block,
		// and splitting the set inside it would leave half a construct styled.
		const winFrom = tokenIndexAt(srcOffsetAtPM(win.from));
		const winEndSrc = srcOffsetAtPM(win.to);
		const lastInside = tokenIndexAt(winEndSrc);
		const winTo = Math.min(starts[lastInside] === winEndSrc ? lastInside : lastInside + 1, tokens.length);
		if (from < winFrom) from = winFrom;
		if (to > winTo) to = winTo;
		if (to < from) to = from;
	}

	let walkCursor = starts[from];
	for (let i = from; i < to; i++) {
		const start = walkCursor;
		walkCursor += tokens[i].raw.length;
		blockFrom = start;
		blockTo = walkCursor;
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
	return DecorationSet.create(doc, buildDecorations(doc, null, 0, doc.content.size, null).decorations);
}

const INACTIVE: MarkdownPluginState = { decos: DecorationSet.empty, tokens: null, window: null, pending: null };

function fullBuild(doc: Node, win: MarkdownWindow | null, lexed: Token[] | null = null): MarkdownPluginState {
	const built = buildDecorations(doc, null, 0, doc.content.size, win, lexed);
	return { decos: DecorationSet.create(doc, built.decorations), tokens: built.tokens, window: win, pending: null };
}

/**
 * The edited span carried forward: `prev` mapped into `tr.doc`, unioned with
 * what this transaction touched. Deferring the rebuild means several
 * transactions' worth of edits have to be described by one range — the token
 * diff says which blocks changed, but only this says which decorations `map()`
 * left where they were.
 */
function mergeDirty(prev: DirtyRange | null, tr: Transaction): DirtyRange | null {
	const mapped = prev ? { from: tr.mapping.map(prev.from, -1), to: tr.mapping.map(prev.to, 1) } : null;
	const cur = changedRange(tr);
	// changedRange's empty sentinel: steps that mapped nothing, so `prev` is still
	// the whole of what is dirty.
	if (cur.from > cur.to) return mapped;
	if (!mapped) return cur;
	return { from: Math.min(mapped.from, cur.from), to: Math.max(mapped.to, cur.to) };
}

/**
 * Re-lexes and splices in decorations for everything `dirty` covers. Runs off
 * the keystroke path, from the idle callback `rebuildScheduler` books.
 *
 * `prev.decos` is already in `doc`'s coordinates — every deferred transaction
 * mapped it forward and the flush itself changes no text — so there is nothing
 * left to map here.
 */
function rebuild(prev: MarkdownPluginState, doc: Node, dirty: DirtyRange): MarkdownPluginState {
	const win = prev.window;
	if (!prev.tokens) return fullBuild(doc, win);
	const built = buildDecorations(doc, prev.tokens, dirty.from, dirty.to, win);
	// Empty rebuild range: the edits landed on tokens outside the window, so
	// nothing in the set is stale.
	if (built.toPM <= built.fromPM) {
		return { decos: prev.decos, tokens: built.tokens, window: win, pending: null };
	}
	const whole = win
		? built.fromPM <= win.from && built.toPM >= win.to
		: built.fromPM === 0 && built.toPM >= doc.content.size;
	if (whole) {
		return { decos: DecorationSet.create(doc, built.decorations), tokens: built.tokens, window: win, pending: null };
	}
	// find() is inclusive at both ends and the rebuilt range is bounded by
	// paragraph node starts, so drop only what falls fully inside it.
	const stale = prev.decos.find(built.fromPM, built.toPM)
		.filter(deco => deco.from >= built.fromPM && deco.to <= built.toPM);
	return {
		decos: prev.decos.remove(stale).add(doc, built.decorations),
		tokens: built.tokens,
		window: win,
		pending: null,
	};
}

/** Paragraphs decorated on each side of the viewport, so small scrolls need no rebuild. */
const PAD_PARAGRAPHS = 60;
/** Re-aim once the viewport comes within this many paragraphs of the window edge. */
const KEEP_PARAGRAPHS = 20;
/** Re-aim once edits have stretched the window to this multiple of a fresh one. */
const MAX_SLACK = 2;

interface ParaPos {
	index: number;
	start: number;
}

/** The paragraph holding `pos`, and the position it starts at. */
function paraAt(doc: Node, pos: number): ParaPos {
	let start = 0;
	for (let i = 0; i < doc.childCount - 1; i++) {
		const end = start + doc.child(i).nodeSize;
		if (pos < end) return { index: i, start };
		start = end;
	}
	return { index: doc.childCount - 1, start };
}

/** The range spanning `lo`..`hi`, widened by `pad` paragraphs on each side. */
function expand(doc: Node, lo: ParaPos, hi: ParaPos, pad: number): MarkdownWindow {
	let from = lo.start;
	for (let i = lo.index - 1; i >= 0 && lo.index - i <= pad; i--) from -= doc.child(i).nodeSize;
	let to = hi.start;
	for (let i = hi.index; i < doc.childCount && i - hi.index <= pad; i++) to += doc.child(i).nodeSize;
	return { from, to };
}

/** The window covering the paragraphs of [from, to] plus `pad` paragraphs either side. */
export function paddedWindow(doc: Node, from: number, to: number, pad: number): MarkdownWindow {
	return expand(doc, paraAt(doc, from), paraAt(doc, to), pad);
}

function mapWindow(win: MarkdownWindow | null, tr: Transaction): MarkdownWindow | null {
	// Biased outwards, so text typed against either edge lands inside the window
	// — including the streamed tail, which is appended at the document end.
	return win ? { from: tr.mapping.map(win.from, -1), to: tr.mapping.map(win.to, 1) } : null;
}

/** Nearest scrollable ancestor, the one whose scrollTop absorbs a height change. */
function scrollParent(el: HTMLElement): HTMLElement | null {
	const win = el.ownerDocument.defaultView;
	if (!win) return null;
	for (let p = el.parentElement; p; p = p.parentElement) {
		const overflowY = win.getComputedStyle(p).overflowY;
		if (overflowY === 'auto' || overflowY === 'scroll') return p;
	}
	return null;
}

/** PM range on screen, or null when the editor cannot be measured (no layout, offscreen). */
function visibleRange(view: EditorView, scroller: HTMLElement | null): { from: number; to: number } | null {
	const win = view.dom.ownerDocument.defaultView;
	if (!win) return null;
	const content = view.dom.getBoundingClientRect();
	const box = scroller ? scroller.getBoundingClientRect() : content;
	const top = Math.max(content.top, box.top, 0);
	const bottom = Math.min(content.bottom, box.bottom, win.innerHeight);
	// Clipped on both axes: posAtCoords hit-tests the rendered page, so a point
	// outside the browser viewport resolves to nothing. The editor overflows it
	// vertically by design, and horizontally whenever the prompt pane has been
	// dragged wider than the window.
	const leftEdge = Math.max(content.left, box.left, 0);
	const rightEdge = Math.min(content.right, box.right, win.innerWidth);
	if (bottom <= top || rightEdge <= leftEdge) return null;
	// Sampled down the middle of what is left: the toolbar buttons are sticky
	// over the left gutter, and posAtCoords resolves whatever is under the point.
	const left = (leftEdge + rightEdge) / 2;
	const from = view.posAtCoords({ left, top: top + 1 });
	const to = view.posAtCoords({ left, top: bottom - 1 });
	return { from: from ? from.pos : 0, to: to ? to.pos : view.state.doc.content.size };
}

/**
 * Keeps the decorated window over the viewport. `props.decorations` is a pure
 * function of state, so scrolling has to dispatch to change what is decorated;
 * every burst of scroll/resize/update events is coalesced into one frame.
 */
function viewportTracker(view: EditorView, mode: MarkdownModeRef) {
	const win = view.dom.ownerDocument.defaultView;
	const scroller = scrollParent(view.dom);
	let frame = 0;

	const sync = (): void => {
		frame = 0;
		if (!mode.current) return;
		const state = markdownDecorationKey.getState(view.state);
		if (!state) return;
		const vis = visibleRange(view, scroller);
		if (!vis) return;
		const doc = view.state.doc;
		const lo = paraAt(doc, vis.from);
		const hi = paraAt(doc, vis.to);
		const cur = state.window ?? { from: 0, to: doc.content.size };
		const keep = expand(doc, lo, hi, KEEP_PARAGRAPHS);
		const want = expand(doc, lo, hi, PAD_PARAGRAPHS);
		// Edits inside the window stretch it (mapping biases outwards), so a
		// window that still covers the viewport is also checked for having grown
		// — otherwise a long stream would widen it back to the whole document.
		const covers = cur.from <= keep.from && cur.to >= keep.to;
		if (covers && cur.to - cur.from <= MAX_SLACK * (want.to - want.from)) return;
		// Nothing would change: bail rather than dispatch every frame. Reachable
		// when posAtCoords cannot resolve the edges and the fallback range is
		// already what is decorated.
		if (want.from === cur.from && want.to === cur.to) return;
		// Undecorating what is above the viewport shrinks it — headings are
		// larger, blockquotes and lists are indented — which would slide the text
		// the user is reading. Pin the topmost visible position across the swap.
		const before = view.coordsAtPos(vis.from).top;
		view.dispatch(view.state.tr.setMeta(markdownDecorationKey, { window: want }));
		if (!scroller) return;
		const delta = view.coordsAtPos(vis.from).top - before;
		if (delta) scroller.scrollTop += delta;
	};

	const schedule = (): void => {
		if (!frame && win) frame = win.requestAnimationFrame(sync);
	};

	// Scroll events do not bubble; a capturing listener on the window catches the
	// scroller's without having to identify it first.
	win?.addEventListener('scroll', schedule, true);
	win?.addEventListener('resize', schedule);
	const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
	observer?.observe(view.dom);
	schedule();

	return {
		update: schedule,
		destroy(): void {
			if (frame) win?.cancelAnimationFrame(frame);
			win?.removeEventListener('scroll', schedule, true);
			win?.removeEventListener('resize', schedule);
			observer?.disconnect();
		},
	};
}

/**
 * Longest the styling may lag an edit. `requestIdleCallback` normally runs in
 * the gap after the frame that painted it; the timeout is what bounds the lag
 * while a generation keeps the main thread busy.
 */
const FLUSH_MS = 100;

/**
 * Runs the rebuild `apply` deferred. A keystroke or a streamed token only maps
 * the set forward, because the one thing left on that path is the
 * whole-document lex and it is O(document); the real work happens in the next
 * idle slot instead. One callback stays in flight at a time, so a burst of
 * edits coalesces into a single rebuild over the union of their changed ranges.
 */
function rebuildScheduler(view: EditorView) {
	const win = view.dom.ownerDocument.defaultView;
	let idle = 0;
	let timer = 0;

	const flush = (): void => {
		idle = 0;
		timer = 0;
		// A window re-aim or a mode toggle in the meantime rebuilt everything
		// already; there is nothing left to splice.
		if (!markdownDecorationKey.getState(view.state)?.pending) return;
		view.dispatch(view.state.tr.setMeta(markdownDecorationKey, 'flush'));
	};

	const cancel = (): void => {
		if (idle) win?.cancelIdleCallback(idle);
		if (timer) win?.clearTimeout(timer);
		idle = 0;
		timer = 0;
	};

	return {
		update(): void {
			if (!markdownDecorationKey.getState(view.state)?.pending) {
				cancel();
				return;
			}
			if (idle || timer || !win) return;
			// Not universal — jsdom has none and Safari only got it in 16.4. A plain
			// timeout gives the same debounce without the idle-slot scheduling.
			if (typeof win.requestIdleCallback === 'function') {
				idle = win.requestIdleCallback(flush, { timeout: FLUSH_MS });
			} else {
				timer = win.setTimeout(flush, FLUSH_MS);
			}
		},
		destroy: cancel,
	};
}

export function markdownDecorationPlugin(mode: MarkdownModeRef): Plugin<MarkdownPluginState> {
	return new Plugin<MarkdownPluginState>({
		key: markdownDecorationKey,
		view(view) {
			const tracker = viewportTracker(view, mode);
			const scheduler = rebuildScheduler(view);
			return {
				update(): void {
					tracker.update();
					scheduler.update();
				},
				destroy(): void {
					tracker.destroy();
					scheduler.destroy();
				},
			};
		},
		state: {
			init(_config, state): MarkdownPluginState {
				// There is no view yet, so no viewport to aim at; the tracker
				// narrows this to the visible window on the first frame.
				return mode.current ? fullBuild(state.doc, null) : INACTIVE;
			},
			apply(tr, prev): MarkdownPluginState {
				const meta = tr.getMeta(markdownDecorationKey) as MarkdownDecorationMeta | undefined;
				// The token list still describes the document only while nothing has
				// changed since it was lexed — neither this transaction nor an edit
				// whose rebuild is still deferred.
				const lexed = tr.docChanged || prev.pending ? null : prev.tokens;
				if (meta === true) return mode.current ? fullBuild(tr.doc, null, lexed) : INACTIVE;
				if (!mode.current) return INACTIVE;
				if (meta === 'flush') return prev.pending ? rebuild(prev, tr.doc, prev.pending) : prev;
				if (meta) return fullBuild(tr.doc, meta.window, lexed);
				if (!tr.docChanged) return prev;
				const win = mapWindow(prev.window, tr);
				// No set to carry forward (mode was off until now), so there is nothing
				// deferring would save.
				if (!prev.tokens) return fullBuild(tr.doc, win);
				// Map only: positions stay correct, styling lags by an idle slot. The
				// lex and the splice are left to the flush the view() schedules.
				return {
					decos: prev.decos.map(tr.mapping, tr.doc),
					tokens: prev.tokens,
					window: win,
					pending: mergeDirty(prev.pending, tr),
				};
			},
		},
		props: {
			decorations(state) {
				return markdownDecorationKey.getState(state)?.decos || DecorationSet.empty;
			},
		},
	});
}
