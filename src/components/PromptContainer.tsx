import { html } from 'htm/react';
import { useEffect, useRef } from 'react';
import { EditorState, Plugin } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';
import { useSettings } from '../contexts/SettingsContext';
import { useGeneration } from '../contexts/GenerationContext';
import { usePromptBuilder } from '../hooks/usePromptBuilder';
import { useGenerationLogic } from '../hooks/useGenerationLogic';
import { useT } from '../i18n';
import { SVG_Settings, SVG_SearchAndReplace, SVG_SplitView, SVG_Camera } from './icons/index';
import { SearchAndReplaceWidget } from './SearchAndReplaceWidget';
import { useScreenshotCapture } from '../hooks/useScreenshotCapture';
import { chunkDecorationPlugin, chunkDecorationKey, type ChunkDecorationState } from '../editor/chunkDecorations';
import { diffPromptChunksWithMeta, applyChunksToPM, textToDoc } from '../editor/syncReactToPM';
import { ProseMirrorAdapter } from '../editor/EditorAdapter';
import { schema } from '../editor/schema';
import type { PromptContainerProps } from '../types/components';

const UNDO_COALESCE_MS = 500;

function scrollSyncPlugin(
	isSyncingScroll: { current: boolean },
	markdownPreviewRef: { current: HTMLDivElement | null }
) {
	return new Plugin({
		view(editorView: EditorView) {
			const container = editorView.dom.closest('#prompt-container') as HTMLElement | null;
			if (!container) return { destroy() {} };
			const scrollEl: HTMLElement = container;
			function onScroll() {
				if (isSyncingScroll.current) return;
				const preview = markdownPreviewRef.current;
				if (!preview) return;
				const ratio = scrollEl.scrollTop / Math.max(1, scrollEl.scrollHeight - scrollEl.clientHeight);
				isSyncingScroll.current = true;
				preview.scrollTop = ratio * (preview.scrollHeight - preview.clientHeight);
				requestAnimationFrame(() => { isSyncingScroll.current = false; });
			}
			container.addEventListener('scroll', onScroll, { passive: true });
			return {
				destroy() {
					container.removeEventListener('scroll', onScroll);
				},
			};
		},
	});
}

export function PromptContainer({ sidebarHeight }: PromptContainerProps) {
	const { showMarkdownPreview, setShowMarkdownPreview, isMobile, tokenHighlightMode, tokenColorMode, promptAreaWidth, setPromptAreaWidth, showProbsMode, setShowProbsMode, spellCheck } = useSettings();
	const { promptEditorView, promptChunks, setPromptChunks, currentPromptChunk, setCurrentPromptChunk, undoHovered, setUndoHovered, undoStack, redoStack, lastEditMsRef, showProbs, setShowProbs, cancel, markdownPreviewRef, isSyncingScroll, keyState, probsDelayTimer, modalState, closeModal, toggleModal, setTriggerPredict } = useGeneration();
	const { promptText } = usePromptBuilder();
	const { undo, redo, undoAndPredict } = useGenerationLogic();
	const t = useT();
	const { takeScreenshot } = useScreenshotCapture();

	const editorRef = useRef<HTMLDivElement>(null);
	const viewRef = useRef<EditorView>(null);
	const lastPromptChunksRef = useRef<PromptChunk[]>([]);
	const suppressSyncRef = useRef(false);
	const lastMouseToken = useRef<string | null>(null);
	const lastMousePos = useRef({ x: 0, y: 0 });
	const undoRef = useRef(undo);
	const redoRef = useRef(redo);
	const cancelRef = useRef(cancel);
	useEffect(() => {
		undoRef.current = undo;
		redoRef.current = redo;
		cancelRef.current = cancel;
	});

	useEffect(() => {
		if (!editorRef.current) return;
		const initialText = promptChunks.map((c: PromptChunk) => c.content).join('');
		const startState = EditorState.create({
			doc: textToDoc(schema, initialText),
			plugins: [
				chunkDecorationPlugin,
				keymap({
					'Mod-z': () => { if (cancelRef.current) (cancelRef.current as () => void)(); undoRef.current(); return true; },
					'Mod-y': () => { if (cancelRef.current) (cancelRef.current as () => void)(); redoRef.current(); return true; },
					'Shift-Mod-z': () => { if (cancelRef.current) (cancelRef.current as () => void)(); redoRef.current(); return true; },
					// PM preventDefaults Escape (captureKeyDown) so the window handler never
					// sees it while the editor is focused; handle cancel here instead.
					'Escape': () => { if (cancelRef.current) (cancelRef.current as () => void)(); return true; },
				}),
				keymap({ 'Mod-Enter': () => { setTriggerPredict(true); return true; } }),
				keymap(baseKeymap),
				scrollSyncPlugin(isSyncingScroll, markdownPreviewRef),
			],
		});
		const view = new EditorView(editorRef.current, {
			state: startState,
			editable: () => !cancel,
			attributes: { spellcheck: String(spellCheck) },
			handleDOMEvents: {
				keydown: (_v, e) => { keyState.current[(e as KeyboardEvent).key] = true; return false; },
				keyup: (_v, e) => { keyState.current[(e as KeyboardEvent).key] = false; return false; },
			},
			dispatchTransaction(tr) {
				const newState = view.state.apply(tr);
				view.updateState(newState);
				if (tr.docChanged && !suppressSyncRef.current) {
					const newDoc = newState.doc.textBetween(0, newState.doc.content.size, '\n');
					const prevChunks = lastPromptChunksRef.current;
					const { chunks: newChunks } = diffPromptChunksWithMeta(prevChunks, newDoc);
					// Snapshot the pre-edit chunks as an undo checkpoint so the user's edit is
					// itself undoable, and invalidate any redo history. Consecutive edits within
					// UNDO_COALESCE_MS share one checkpoint, so a burst of typing is one undo step.
					const now = Date.now();
					const lastEntry = undoStack.current[undoStack.current.length - 1];
					if (!(Array.isArray(lastEntry) && now - lastEditMsRef.current < UNDO_COALESCE_MS)) {
						undoStack.current.push(prevChunks);
					}
					redoStack.current = [];
					lastEditMsRef.current = now;
					lastPromptChunksRef.current = newChunks;
					setPromptChunks(newChunks);
				}
			},
		});
		viewRef.current = view;
		promptEditorView.current = new ProseMirrorAdapter(view);
		lastPromptChunksRef.current = promptChunks;
		const decoState: ChunkDecorationState = {
			chunks: promptChunks, tokenColorMode, tokenHighlightMode,
			currentPromptChunk: null, undoHovered: null,
		};
		view.dispatch(view.state.tr.setMeta(chunkDecorationKey, decoState));
		return () => {
			view.destroy();
			promptEditorView.current = null;
		};
	}, []);

	useEffect(() => {
		const view = viewRef.current;
		if (!view) return;
		const newText = promptChunks.map((c: PromptChunk) => c.content).join('');
		const textChanged = newText !== view.state.doc.textBetween(0, view.state.doc.content.size, '\n');
		const lastUndo = undoStack.current.length > 0 ? undoStack.current[undoStack.current.length - 1] : null;
		const undoHoveredPos = undoHovered && typeof lastUndo === 'number' ? lastUndo : null;
		const decoState: ChunkDecorationState = {
			chunks: promptChunks, tokenColorMode, tokenHighlightMode,
			currentPromptChunk: currentPromptChunk?.index ?? null,
			undoHovered: undoHoveredPos,
		};
		suppressSyncRef.current = true;
		if (textChanged) {
			applyChunksToPM(view, promptChunks, decoState, !!cancel);
		} else {
			view.dispatch(view.state.tr.setMeta(chunkDecorationKey, decoState));
		}
		lastPromptChunksRef.current = promptChunks;
		suppressSyncRef.current = false;
	}, [promptChunks, currentPromptChunk, tokenColorMode, tokenHighlightMode, undoHovered]);

	useEffect(() => {
		const el = editorRef.current;
		if (!el) return;
		function hideProbs(e: Event) {
			const related = (e as MouseEvent).relatedTarget as HTMLElement | null;
			if (related?.closest?.('#probs')) return;
			if (probsDelayTimer.current) {
				clearTimeout(probsDelayTimer.current.id);
				probsDelayTimer.current = undefined;
			}
			lastMouseToken.current = null;
			setCurrentPromptChunk(undefined);
			setShowProbs(false);
		}
		el.addEventListener('mouseleave', hideProbs);
		const pm = el.querySelector('.ProseMirror');
		pm?.addEventListener('mouseleave', hideProbs);
		return () => {
			el.removeEventListener('mouseleave', hideProbs);
			pm?.removeEventListener('mouseleave', hideProbs);
		};
	}, [setShowProbs, setCurrentPromptChunk]);

	useEffect(() => {
		viewRef.current?.setProps({ attributes: { spellcheck: String(spellCheck) } });
	}, [spellCheck]);

	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			setShowProbs(e.ctrlKey || e.metaKey);
		}
		function onKeyUp(e: KeyboardEvent) {
			setShowProbs(e.ctrlKey || e.metaKey);
		}
		if (showProbsMode === 1) {
			window.addEventListener('keydown', onKeyDown);
			window.addEventListener('keyup', onKeyUp);
		}
		return () => {
			window.removeEventListener('keydown', onKeyDown);
			window.removeEventListener('keyup', onKeyUp);
		};
	}, [showProbsMode, setShowProbs]);

	// textarea resize (operates on #prompt-container boundaries, unchanged from original)
	useEffect(() => {
		const container = document.querySelector('#prompt-container') as HTMLElement;
		if (!container) return;
		let isDragging = false;
		let startX: number | undefined;
		let startEdge: string | undefined;
		let startNumericWidth: number | undefined;
		const edgeDetectionZone = 5;
		function getNearEdge(e: MouseEvent) {
			const rect = container.getBoundingClientRect();
			if (e.clientX - rect.left < edgeDetectionZone && e.clientX - rect.left > 0) {
				return 'left';
			} else if (rect.right - e.clientX < edgeDetectionZone && rect.right - e.clientX > 0) {
				return 'right';
			}
			return false;
		}
		function startDragging(e: MouseEvent) {
			const edge = getNearEdge(e);
			if (!edge) return;
			isDragging = true;
			const invEdgePos = edge === 'right' ? container.getBoundingClientRect().left : container.getBoundingClientRect().right;
			startX = e.clientX - invEdgePos;
			startNumericWidth = container.getBoundingClientRect().width;
			startEdge = edge;
		}
		function drag(e: MouseEvent) {
			switch (getNearEdge(e)) {
				case 'right':
					container.style.cursor = 'col-resize';
					container.style.borderRight = '2px dotted var(--color-light)';
					break;
				case 'left':
					container.style.cursor = 'col-resize';
					container.style.borderLeft = '2px dotted var(--color-light)';
					break;
				default:
					container.style.cursor = '';
					container.style.borderRight = '2px dotted transparent';
					container.style.borderLeft = '2px dotted transparent';
					break;
			}
			if (!isDragging) return;
			const minWidth = 200;
			const invEdgePos = startEdge === 'right' ? container.getBoundingClientRect().left : container.getBoundingClientRect().right;
			const currentX = e.clientX - invEdgePos;
			const delta = (currentX - startX!) * (startEdge === 'right' ? 1 : -1);
			setPromptAreaWidth(`${Math.max(minWidth, startNumericWidth! + delta)}px`);
		}
		function stopDragging() { isDragging = false; }
		container.addEventListener('mousedown', startDragging);
		document.addEventListener('mousemove', drag);
		document.addEventListener('mouseup', stopDragging);
		document.addEventListener('mouseleave', stopDragging);
		return () => {
			container.removeEventListener('mousedown', startDragging);
			document.removeEventListener('mousemove', drag);
			document.removeEventListener('mouseup', stopDragging);
			document.removeEventListener('mouseleave', stopDragging);
		};
	}, []);

	function onEditorMouseMove(e: React.MouseEvent<HTMLDivElement>) {
		const adapter = promptEditorView.current;
		if (!adapter) return;
		if (showProbsMode === -1 && tokenHighlightMode === -1) return;
		const dx = Math.abs(e.clientX - lastMousePos.current.x);
		const dy = Math.abs(e.clientY - lastMousePos.current.y);
		if (dx < 5 && dy < 5 && lastMouseToken.current !== null) return;
		lastMousePos.current = { x: e.clientX, y: e.clientY };

		const probs = (e.target as HTMLElement)?.closest?.('#probs');
		if (probs) {
			if (probsDelayTimer.current?.hiding) {
				clearTimeout(probsDelayTimer.current.id);
				probsDelayTimer.current = undefined;
			}
			return;
		}

		const pos = adapter.posAtCoords({ x: e.clientX, y: e.clientY });
		if (pos === null) {
			if (lastMouseToken.current !== null && showProbs && !probsDelayTimer.current?.hiding) {
				clearTimeout(probsDelayTimer.current?.id);
				const timer = setTimeout(() => {
					probsDelayTimer.current = undefined;
					lastMouseToken.current = null;
					setCurrentPromptChunk(undefined);
					setShowProbs(false);
				}, 500);
				probsDelayTimer.current = { id: timer, hiding: true };
			} else if (!showProbs && !probsDelayTimer.current) {
				setCurrentPromptChunk(undefined);
			}
			return;
		}

		let offset = 0;
		let targetIndex = -1;
		for (let i = 0; i < promptChunks.length; i++) {
			const end = offset + promptChunks[i].content.length;
			if (pos >= offset && pos <= end) { targetIndex = i; break; }
			offset = end;
		}
		if (targetIndex === -1) return;

		const coords = adapter.coordsAtPos(Math.min(pos, adapter.getText().length));
		if (!coords) return;
		const top = coords.top;
		const left = coords.left + (coords.right - coords.left) / 2;
		const tokenKey = `${targetIndex}-${Math.round(top)}-${Math.round(left)}`;

		const isSameToken = lastMouseToken.current === tokenKey;
		if (!isSameToken) {
			lastMouseToken.current = tokenKey;
			setCurrentPromptChunk({ index: targetIndex, top, left });
		}

		if (isSameToken && probsDelayTimer.current?.hiding) {
			clearTimeout(probsDelayTimer.current.id);
			probsDelayTimer.current = undefined;
		}

		switch (showProbsMode) {
			case 0:
				const isTimerForThisToken = probsDelayTimer.current?.tokenKey === tokenKey;
				if (!isSameToken || (!showProbs && !isTimerForThisToken)) {
					if (showProbs) setShowProbs(false);
					clearTimeout(probsDelayTimer.current?.id);
					const timer = setTimeout(() => {
						probsDelayTimer.current = undefined;
						setShowProbs(true);
					}, 300);
					probsDelayTimer.current = { id: timer, hiding: false, tokenKey: tokenKey };
				}
				break;
			case 1:
				if (showProbs !== (e.ctrlKey || e.metaKey)) {
					setShowProbs(e.ctrlKey || e.metaKey);
				}
				break;
		}
	}

	return html`
		<div id="prompt-container" onMouseMove=${onEditorMouseMove} style=${{ 'margin-bottom': isMobile && !showMarkdownPreview ? sidebarHeight + 'px' : 0 }}>
			<div style=${{ position: 'sticky', top: 0, zIndex: 1 }}>
				<button
					title=${t('prompt.preferences')}
					className="textAreaSettings"
					onClick=${() => toggleModal("preferences")}>
					<${SVG_Settings}/>
				</button>
				<button
					title=${t('prompt.searchAndReplace')}
					style=${{ "margin-top": "1.5em" }}
					className="textAreaSettings"
					onClick=${() => toggleModal("searchAndReplace")}>
					<${SVG_SearchAndReplace} style=${{ "height": "1.3em" }} />
				</button>
				<button
					title=${t('prompt.toggleMarkdownPreview')}
					style=${{ "margin-top": "3em" }}
					className="textAreaSettings"
					onClick=${() => setShowMarkdownPreview((p: boolean) => !p)}>
					<${SVG_SplitView}/>
				</button>
				<button
					title=${t('prompt.takeScreenshot')}
					style=${{ "margin-top": "4.5em" }}
					className="textAreaSettings"
					onClick=${takeScreenshot}>
					<${SVG_Camera} style=${{ "height": "1.3em" }} />
				</button>
			</div>
			<div ref=${editorRef} id="pm-editor" />
			<${SearchAndReplaceWidget}
				isOpen=${modalState.searchAndReplace}
				closeWidget=${() => closeModal("searchAndReplace")}
				id="searchAndReplace"
				editorView=${promptEditorView}
				promptText=${promptText}
				cancel=${cancel}/>
		</div>
	`;
}
