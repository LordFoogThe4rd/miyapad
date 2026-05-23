import { html } from 'htm/react';
import { useEffect, useRef } from 'react';
import { useSettings } from '../contexts/SettingsContext.js';
import { useGeneration } from '../contexts/GenerationContext.js';
import { usePromptBuilder } from '../hooks/usePromptBuilder.js';
import { SVG_Settings, SVG_SearchAndReplace, SVG_SplitView, SVG_Camera } from './icons/index.js';
import { SearchAndReplaceWidget } from './SearchAndReplaceWidget.js';
import { useScreenshotCapture } from '../hooks/useScreenshotCapture.js';

export function PromptContainer({ sidebarHeight }) {
	const { showMarkdownPreview, setShowMarkdownPreview, isMobile, tokenHighlightMode, tokenColorMode, showPromptPreview, promptAreaWidth, setPromptAreaWidth, showProbsMode, setShowProbsMode, hideChatTemplates, systemPromptModeText, setSystemPromptModeText } = useSettings();
	const { promptArea, promptOverlay, cancel, promptPreviewElement, promptChunks, setPromptChunks, currentPromptChunk, setCurrentPromptChunk, undoHovered, setUndoHovered, undoStack, redoStack, showProbs, setShowProbs, promptPreviewChunks, setPromptPreviewChunks, modalState, closeModal, toggleModal, markdownPreviewRef, isSyncingScroll, setSavedScrollTop, spellCheck, keyState, probsDelayTimer, setTriggerPredict } = useGeneration();
	const { promptText, displayPromptChunks, cleanPromptText, origToClean, cleanToOrig } = usePromptBuilder();
	const { takeScreenshot } = useScreenshotCapture();
	const lastMouseToken = useRef(null);

	useEffect(() => {
		if (promptArea.current) {
			promptArea.current.onInputHandler = onInput;
		}
	});

	// textarea resize
	useEffect(() => {
		const container = document.querySelector('#prompt-container');

		let isDragging = false;
		let startX;
		let startEdge;
		let startNumericWidth;
		let edgeDetectionZone = 5; // Pixels from edge to trigger resize

		function getNearEdge(e) {
			const rect = container.getBoundingClientRect();
			if (e.clientX - rect.left < edgeDetectionZone && e.clientX - rect.left > 0) {
				return 'left';
			} else if (rect.right - e.clientX < edgeDetectionZone && rect.right - e.clientX > 0) {
				return 'right';
			}
			return false;
		}

		function startDragging(e) {
			const edge = getNearEdge(e);
			if (!edge) return; // Only drag from edges

			// reset selection
			promptArea.current.selectionStart = promptArea.current.selectionEnd;

			isDragging = true;

			const invEdgePos = edge == 'right' ? container.getBoundingClientRect().left : container.getBoundingClientRect().right;
			startX = e.clientX - invEdgePos;
			startNumericWidth = container.getBoundingClientRect().width;
			startEdge = edge;
		}

		function drag(e) {
			switch (getNearEdge(e)) {
				case 'right':
					promptArea.current.style.cursor = 'col-resize';
					container.style.cursor = 'col-resize';
					container.style.borderRight = '2px dotted var(--color-light)';
					break;
				case 'left':
					promptArea.current.style.cursor = 'col-resize';
					container.style.cursor = 'col-resize';
					container.style.borderLeft = '2px dotted var(--color-light)';
					break;
				default:
					promptArea.current.style.cursor = '';
					container.style.cursor = '';
					container.style.borderRight = '2px dotted transparent';
					container.style.borderLeft = '2px dotted transparent';
					break;
			}

			if (!isDragging) return;

			// reset selection
			promptArea.current.selectionStart = promptArea.current.selectionEnd;

			const minWidth = 200;
			const invEdgePos = startEdge == 'right' ? container.getBoundingClientRect().left : container.getBoundingClientRect().right;
			const currentX = e.clientX - invEdgePos;
			const delta = (currentX - startX) * (startEdge == 'right' ? 1 : -1);

			// Calculate the new width and ensure it's not less than minWidth
			const newWidth = Math.max(minWidth, startNumericWidth + delta);

			setPromptAreaWidth(`${newWidth}px`);
		}

		function stopDragging() {
			isDragging = false;
		}

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

	function onInput({ target }) {
		if (showPromptPreview) {
			setPromptPreviewChunks([]);
		}

		let nv = target.value;
		if (hideChatTemplates && cleanToOrig) {
			let startCount = 0;
			while (startCount < cleanPromptText.length && startCount < nv.length && cleanPromptText[startCount] === nv[startCount]) {
				startCount++;
			}
			let oldEnd = cleanPromptText.length;
			let newEnd = nv.length;
			while (oldEnd > startCount && newEnd > startCount && cleanPromptText[oldEnd - 1] === nv[newEnd - 1]) {
				oldEnd--;
				newEnd--;
			}
			const inserted = nv.slice(startCount, newEnd);
			const origStart = cleanToOrig[startCount];
			const origEnd = cleanToOrig[oldEnd];

			let affixesInDeleted = "";
			let cleanIndex = startCount;
			for (let k = origStart; k < origEnd; k++) {
				if (cleanIndex < oldEnd && cleanToOrig[cleanIndex] === k) {
					cleanIndex++;
				} else {
					affixesInDeleted += promptText[k];
				}
			}

			nv = promptText.slice(0, origStart) + inserted + affixesInDeleted + promptText.slice(origEnd);
		}

		setPromptChunks(oldPrompt => {
			const start = [];
			const end = [];
			let newValue = nv;

			let i = 0;
			for (; i < oldPrompt.length; i++) {
				const chunk = oldPrompt[i];
				if (!newValue.startsWith(chunk.content))
					break;
				start.push(chunk);
				newValue = newValue.slice(chunk.content.length);
			}

			for (let j = oldPrompt.length; j > i; j--) {
				const chunk = oldPrompt[j - 1];
				if (!newValue.endsWith(chunk.content))
					break;
				end.unshift(chunk);
				newValue = newValue.slice(0, -chunk.content.length);
			}

			// Merge chunks if they're from the user
			let mergeUserChunks = (chunks, newContent) => {
				let lastChunk = chunks[chunks.length - 1];
				while (lastChunk && lastChunk.type === 'user') {
					lastChunk.content += newContent;
					if (chunks[chunks.length - 2] && chunks[chunks.length - 2].type === 'user') {
						newContent = lastChunk.content;
						lastChunk = chunks[chunks.length - 2];
						chunks.splice(chunks.length - 1, 1);
					} else {
						return chunks;
					}
				}
				return [...chunks, { type: 'user', content: newContent }];
			};

			let newPrompt = [...start];
			if (newValue) {
				newPrompt = mergeUserChunks(newPrompt, newValue);
			}
			if (end.length && end[0].type === 'user') {
				newPrompt = mergeUserChunks(newPrompt, end.shift().content);
			}
			newPrompt.push(...end);

			// Remove all undo positions within the modified range.
			undoStack.current = undoStack.current.filter(pos => pos > start.length && pos < newPrompt.length);
			if (!undoStack.current.length)
				setUndoHovered(false);

			// Adjust undo/redo stacks.
			const chunkDifference = oldPrompt.length - newPrompt.length;
			undoStack.current = undoStack.current.map(pos => {
				if (pos >= start.length) {
					return pos - chunkDifference;
				}
				return pos;
			});

			// Reset redo stack if a new chunk is added/removed at the end.
			if (chunkDifference < 0 && !end.length) {
				redoStack.current = [];
			}

			return newPrompt;
		});
	}

	function onScroll({ target }) {
		if (target.scrollTop === target.scrollTarget)
			target.scrollTarget = undefined;

		const newTop = target.scrollTop;
		const oldTop = promptOverlay.current.scrollTop;

		if (newTop < oldTop) {
			// user scrolled up
			target.scrollTarget = undefined;
		}

		promptOverlay.current.scrollTop = target.scrollTop;
		promptOverlay.current.scrollLeft = target.scrollLeft;
		setSavedScrollTop(newTop);

		if (showProbsMode !== -1) {
			const probsElement = document.getElementById('probs');
			if (probsElement) {
				const probsTop = getComputedStyle(probsElement).getPropertyValue('top');
				probsElement.style.setProperty('--probs-top', `calc(${probsTop} + ${oldTop - newTop}px)`);
			} else if (currentPromptChunk) {
				currentPromptChunk.top += oldTop - newTop;
			}
		}

		if (showMarkdownPreview && markdownPreviewRef.current && !isSyncingScroll.current) {
			isSyncingScroll.current = true;
			const editor = target;
			const preview = markdownPreviewRef.current;
			if (editor.scrollHeight > editor.clientHeight) {
				const scrollPercentage = editor.scrollTop / (editor.scrollHeight - editor.clientHeight);
				preview.scrollTop = scrollPercentage * (preview.scrollHeight - preview.clientHeight);
			}
			requestAnimationFrame(() => {
				isSyncingScroll.current = false;
			});
		}
	}

	function onPromptMouseMove({ clientX, clientY }) {
		if (showProbsMode === -1 && tokenHighlightMode === -1)
			return;
		promptOverlay.current.style.pointerEvents = 'auto';
		const elem = document.elementFromPoint(clientX, clientY);
		const pc = elem?.closest?.('[data-promptchunk]');
		const probs = elem?.closest?.('#probs');
		promptOverlay.current.style.pointerEvents = 'none';

		if (probs) {
			if (probsDelayTimer.current?.hiding) {
				clearTimeout(probsDelayTimer.current.id);
				probsDelayTimer.current = undefined;
			}
			return;
		}

		if (!pc) {
			if (lastMouseToken.current !== null) {
				if (showProbs && !probsDelayTimer.current?.hiding) {
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
			}
			return;
		}

		const rects = pc.getClientRects();
		let rect = rects[rects.length - 1];
		for (const r of rects) {
			if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
				rect = r;
				break;
			}
		}
		const index = +pc.dataset.promptchunk;
		const top = rect.top;
		const left = rect.left + rect.width / 2;
		const tokenKey = `${index}-${Math.round(top)}-${Math.round(left)}`;

		const isSameToken = lastMouseToken.current === tokenKey;
		if (!isSameToken) {
			lastMouseToken.current = tokenKey;
			setCurrentPromptChunk({ index, top, left });
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
				if (showProbs !== keyState.current.ctrlKey) {
					setShowProbs(keyState.current.ctrlKey);
				}
				break;
		}
	}

	return html`
		<div id="prompt-container" onMouseMove=${onPromptMouseMove} style=${{ 'margin-bottom': isMobile && !showMarkdownPreview ? sidebarHeight + 'px' : 0 }}>
			<button
				title="Preferences"
				className="textAreaSettings"
				onClick=${() => toggleModal("preferences")}>
				<${SVG_Settings}/>
			</button>
			<button
				title="Search & Replace"
				style=${{ "margin-top": "1.5em" }}
				className="textAreaSettings"
				onClick=${() => toggleModal("searchAndReplace")}>
				<${SVG_SearchAndReplace} style=${{ "height": "1.3em" }} />
			</button>
			<button
				title="Toggle Markdown Preview"
				style=${{ "margin-top": "3em" }}
				className="textAreaSettings"
				onClick=${() => setShowMarkdownPreview(p => !p)}>
				<${SVG_SplitView}/>
			</button>
			<button
				title="Take Screenshot"
				style=${{ "margin-top": "4.5em" }}
				className="textAreaSettings"
				onClick=${takeScreenshot}>
				<${SVG_Camera} style=${{ "height": "1.3em" }} />
			</button>
			${hideChatTemplates && html`<textarea
				id="system-prompt-area"
				className="wi-textarea"
				style=${{ 'margin-bottom': '1em', 'min-height': '6em', 'flex': 'none' }}
				placeholder="System Prompt"
				value=${systemPromptModeText}
				readOnly=${!!cancel}
				onInput=${e => setSystemPromptModeText(e.target.value)} />`}
			<textarea
				ref=${promptArea}
				readOnly=${!!cancel}
				spellCheck=${spellCheck}
				id="prompt-area"
				onInput=${onInput}
				onScroll=${onScroll}
				...${showPromptPreview && { style: { 'padding-bottom': promptPreviewElement.current?.offsetHeight ?? '0px' } }}/>
			<div
				ref=${promptOverlay}
				id="prompt-overlay"
				aria-hidden
				...${showPromptPreview && { style: { 'padding-bottom': promptPreviewElement.current?.offsetHeight ?? '0px' } }}>
				${tokenHighlightMode !== -1 ? html`
					${(hideChatTemplates ? displayPromptChunks : promptChunks).map((chunk, i) => {
		const getRatioColor = (ratio) => {
			const sRatio = Math.max(0, Math.min(1, ratio));
			if (sRatio <= 0.5) {
				// Scale ratio from [0, 0.5] to [0, 1]
				const adjustedRatio = sRatio / 0.5;
				return `color-mix(in srgb, red ${100 - adjustedRatio * 100}%, yellow ${adjustedRatio * 100}%)`;
			} else {
				// Scale ratio from [0.5, 1] to [0, 1]
				const adjustedRatio = (sRatio - 0.5) / 0.5;
				return `color-mix(in srgb, yellow ${100 - adjustedRatio * 100}%, var(--color-miku) ${adjustedRatio * 100}%)`;
			}
		};
		const chunkProb = chunk.prob ?? 1;
		let bgColor = "";
		if (tokenColorMode === 1 && chunkProb < 1) {
			bgColor = getRatioColor(chunkProb);
		} else if (tokenColorMode === 2 && chunkProb < 1) {
			const chunkProbs = chunk.completion_probabilities?.[0]?.probs ?? [];
			const minChunkProb = chunkProbs.length < 10 ? Math.min(...chunkProbs.map(p => p.prob)) : 0;
			const maxChunkProb = chunkProbs.length > 0 ? Math.max(...chunkProbs.map(p => p.prob)) : 1;
			bgColor = getRatioColor((chunkProb - minChunkProb) / (maxChunkProb - minChunkProb));
		}
		const isCurrent = currentPromptChunk && currentPromptChunk.index === i;
		const lastUndoPos = undoStack.current.length > 0 ? undoStack.current[undoStack.current.length - 1] : -1;
		const isNextUndo = undoHovered && !!undoStack.current.length && lastUndoPos <= i;
		return html`
							<span
								key=${i}
								data-promptchunk=${i}
								style=${bgColor ? { '--bg-color': bgColor } : {}}
								className=${`${(tokenHighlightMode === 1 && !isCurrent) || chunk.type === 'user' ? 'user' : 'machine'} ${isCurrent ? 'current' : ''} ${isNextUndo ? 'erase' : ''}`}>
								${(chunk.content === '\n' ? ' \n' : chunk.content) + (i === (hideChatTemplates ? displayPromptChunks : promptChunks).length - 1 && chunk.content.endsWith('\n') && promptPreviewChunks.length === 0 ? '\u00a0' : '')}
							</span>`;
	})}
					${(showPromptPreview && promptPreviewChunks.length) ? html`
						<span ref=${promptPreviewElement} className="preview"></span>
						<span class="preview nudge">Tab</span>` : null}` : null}
			</div>
			<${SearchAndReplaceWidget}
				isOpen=${modalState.searchAndReplace}
				closeWidget=${() => closeModal("searchAndReplace")}
				id="searchAndReplace"
				promptArea=${promptArea}
				promptText=${hideChatTemplates ? cleanPromptText : promptText}
				cancel=${cancel}/>
		</div>
	`;
}
