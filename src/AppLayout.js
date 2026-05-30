import { html } from 'htm/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { usePromptBuilder } from './hooks/usePromptBuilder.js';
import { useTokenCounters } from './hooks/useTokenCounters.js';
import { useTTS } from './hooks/useTTS.js';
import { useGenerationLogic } from './hooks/useGenerationLogic.js';
import { useTouchGestures } from './hooks/useTouchGestures.js';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts.js';
import { MarkdownPreview } from './components/MarkdownPreview.js';
import { ProbsDisplay } from './components/ProbsDisplay.js';
import { Sidebar } from './components/Sidebar.js';
import { Modals } from './components/Modals.js';
import { PromptContainer } from './components/PromptContainer.js';
import { SVResizeObserver } from 'scrollview-resize';
import { API_LLAMA_CPP, API_KOBOLD_CPP, API_OPENAI_COMPAT, API_AI_HORDE } from './constants.js';
import { usePersistentState } from './hooks/usePersistentState.js';
import { defaultPresets } from './defaults/presets.js';
import { defaultPrompt } from './defaults/prompt.js';
import { defaultThemes } from './defaults/themes.js';
import { exportText, normalizeEndpoint } from './api/common.js';
import { getTokenCount, serverTokenCount, getTokens, getModels, completion, chatCompletion, abortCompletion, loadServerTokenizer } from './api/index.js';
import { joinPrompt, replaceUnprintableBytes, replaceNewlines } from './utils/strings.js';
import { regexSplitString, regexIndexOf, regexLastIndexOf, memoize, createLenientPrefixRegex, createLenientRegex, prefixMatchLength, escapeRegExp } from './utils/regex.js';
import {
  SVG, SVG_Close, SVG_Confirm, SVG_Cancel, SVG_Trash, SVG_Rename,
  SVG_ArrowUp, SVG_ArrowDown, SVG_Settings, SVG_MobileSidebar,
  SVG_ShowKey, SVG_HideKey, SVG_SysPrompt, SVG_instTemplate,
  SVG_ChatMode, SVG_CompletionMode, SVG_Regen, SVG_Undo, SVG_Redo,
  SVG_SearchAndReplace, SVG_Moveable, SVG_Stop, SVG_SplitView
} from './components/icons/index.js';

import { useSettings } from './contexts/SettingsContext.js';
import { useGeneration } from './contexts/GenerationContext.js';

export function AppLayout() {
	const {
		sessionStorage, templateStorage, themeStorage, useSessionState, useDBTemplates, useDBThemes, isMiyapadEndpoint,
		templates, setTemplates, templateReplacements, setTemplateReplacements, templatesImport, setTemplatesImport,
		selectedTemplate, setSelectedTemplate, chatMode, setChatMode, templateList, setTemplateList,
		fontSizeMultiplier, setFontSizeMultiplier, spellCheck, setSpellCheck, attachSidebar, setAttachSidebar,
		showProbsMode, setShowProbsMode, hideChatTemplates, setHideChatTemplates, systemPromptModeText, setSystemPromptModeText,
		editorFont, setEditorFont, uiFont, setUIFont,
		tokenHighlightMode, setTokenHighlightMode, tokenColorMode, setTokenColorMode,
		preserveCursorPosition, setPreserveCursorPosition, promptAreaWidth, setPromptAreaWidth, showAPIKey, setShowAPIKey,
		endpoint, setEndpoint, endpointAPI, setEndpointAPI, endpointAPIKey, setEndpointAPIKey, endpointModel, setEndpointModel,
		seed, setSeed, maxPredictTokens, setMaxPredictTokens, temperature, setTemperature, dynaTempRange, setDynaTempRange,
		dynaTempExp, setDynaTempExp, repeatPenalty, setRepeatPenalty, repeatLastN, setRepeatLastN, penalizeNl, setPenalizeNl,
		presencePenalty, setPresencePenalty, frequencyPenalty, setFrequencyPenalty, topK, setTopK, topP, setTopP, typicalP, setTypicalP,
		minP, setMinP, tfsZ, setTfsZ, mirostat, setMirostat, mirostatTau, setMirostatTau, mirostatEta, setMirostatEta,
		xtcThreshold, setXtcThreshold, xtcProbability, setXtcProbability, dryMultiplier, setDryMultiplier, dryBase, setDryBase,
		dryAllowedLength, setDryAllowedLength, dryPenaltyRange, setDryPenaltyRange, drySequenceBreakers, setDrySequenceBreakers,
		drySequenceBreakersError, setDrySequenceBreakersError, bannedTokens, setBannedTokens, bannedTokensError, setBannedTokensError,
		ignoreEos, setIgnoreEos, openaiPresets, setOpenaiPresets, stoppingStrings, setStoppingStrings, stoppingStringsError, setStoppingStringsError,
		useBasicStoppingMode, setUseBasicStoppingMode, basicStoppingModeType, setBasicStoppingModeType, logitBias, setLogitBias,
		logitBiasParam, setLogitBiasParam, contextLength, setContextLength, memoryTokens, setMemoryTokens, authorNoteTokens, setAuthorNoteTokens,
		authorNoteDepth, setAuthorNoteDepth, worldInfo, setWorldInfo, sillyTarvernWorldInfoJSON, setSillyTarvernWorldInfoJSON,
		enabledSamplers, setEnabledSamplers, grammar, setGrammar, useChatAPI, setUseChatAPI, useTokenStreaming, setUseTokenStreaming,
		disableLogprobs, setDisableLogprobs, postSamplingProbs, setPostSamplingProbs, showPromptPreview, setShowPromptPreview,
		promptPreviewTokens, setPromptPreviewTokens, currentThemeName, setCurrentThemeName, allThemes, setAllThemes,
		showMarkdownPreview, setShowMarkdownPreview, ttsEnabled, setTTSEnabled, ttsVoiceId, setTTSVoiceId, ttsPitch, setTTSPitch,
		ttsRate, setTTSRate, ttsVolume, setTTSVolume, ttsSpeakInputs, setTTSSpeakInputs, ttsMaxUserInput, setTTSMaxUserInput,
		useServerTokenization,
		tokenizerModel
	} = useSettings();

	const {
		promptArea, promptOverlay, undoStack, redoStack, probsDelayTimer, keyState, sessionReconnectTimer,
		useScrollSmoothing, hordeTaskId, promptPreviewElement, markdownPreviewRef, isSyncingScroll,
		promptChunks, setPromptChunks, currentPromptChunk, setCurrentPromptChunk, undoHovered, setUndoHovered,
		showProbs, setShowProbs, cancel, setCancel, sessionEndpointConnecting, setSessionEndpointConnecting,
		sessionEndpointError, setSessionEndpointError, rejectedAPIKey, setRejectedAPIKey, openaiModels, setOpenaiModels,
		tokens, setTokens, tokensPerSec, setTokensPerSec, predictStartTokens, setPredictStartTokens, lastError, setLastError,
		savedScrollTop, setSavedScrollTop, modalState, setModalState, contextMenuState, setContextMenuState,
		instructModalState, setInstructModalState, hordeQueuePos, setHordeQueuePos, hordeProcessing, setHordeProcessing,
		promptPreviewChunks, setPromptPreviewChunks, promptPreviewReroll, setPromptPreviewReroll, ttsAvailable, setTTSAvailable,
		ttsNewText, ttsLastChunk, ttsQueue, ttsVoices, ttsPaused, triggerPredict, setTriggerPredict, restartedPredict, setRestartedPredict,
		toggleModal, closeModal
	} = useGeneration();



	const {
		promptText, modifiedPromptText, fimPromptInfo, assembledWorldInfo,
		additionalContextPrompt, finalPromptText,
		replacePlaceholders, convertChatToJSON,
		displayPromptChunks, cleanPromptText, origToClean, cleanToOrig
	} = usePromptBuilder();

	const { handleauthorNoteTokensChange, handleMemoryTokensChange } = useTokenCounters();










	// predicts the prompt preview
	useEffect(() => {
		if (promptPreviewChunks.length) // Don't predict a new preview if we already have one.
			return;
		
		if (fimPromptInfo !== undefined || cancel || endpointAPI == API_AI_HORDE || tokenHighlightMode === -1 || !showPromptPreview)
			return;

		const ac = new AbortController();
		const signal = ac.signal;
		const to = setTimeout(async () => {
			if (signal.aborted) {
				return;
			}

			const customParams = {
				n_predict: promptPreviewTokens
			};

			const predicted = await predict(finalPromptText, promptChunks.length, (chunk) => {
				setPromptPreviewChunks((c) => [...c, chunk]);
				return true;
			}, ac, false, customParams);
		}, 500);

		ac.signal.addEventListener('abort', () => clearTimeout(to));
		return () => ac.abort();
	}, [finalPromptText, showPromptPreview, promptPreviewReroll, cancel, endpoint, endpointAPI, endpointAPIKey]);

	const promptPreviewText = useMemo(() => joinPrompt(promptPreviewChunks), [promptPreviewChunks]);

	const { predict, undo, redo, undoAndPredict, fillPredict } = useGenerationLogic();

	function setTitleToSession() {
		const sessionName = sessionStorage.getProperty('name');
		document.title = sessionName ? 'miyapad - ' + sessionName : 'miyapad';
	}

	useEffect(() => {
		setTitleToSession();
	}, [sessionStorage]);





	useLayoutEffect(() => {
		document.body.style.setProperty('--font-size-multiplier', fontSizeMultiplier);
	}, [fontSizeMultiplier]);

	const availableFonts = {
		"Default": { cssValue: null, url: null },
		"System Serif": { cssValue: "serif", url: null },
		"System Sans-serif": { cssValue: "sans-serif", url: null },
		"System Monospace": { cssValue: "monospace", url: null },
	};

	useLayoutEffect(() => {
		const editorFontInfo = availableFonts[editorFont];
		if (editorFontInfo) {
			let link = document.getElementById('dynamic-editor-font-link');
			if (editorFontInfo.url) {
				if (!link) {
					link = document.createElement('link');
					link.id = 'dynamic-editor-font-link';
					link.rel = 'stylesheet';
					document.head.appendChild(link);
				}
				if (link.href !== editorFontInfo.url) {
					link.href = editorFontInfo.url;
				}
			} else if (link) {
				link.remove();
			}
			if (editorFontInfo.cssValue) {
				document.documentElement.style.setProperty('--editor-font-family', editorFontInfo.cssValue);
			} else {
				document.documentElement.style.removeProperty('--editor-font-family');
			}
		}

		const uiFontInfo = availableFonts[uiFont];
		if (uiFontInfo) {
			let link = document.getElementById('dynamic-ui-font-link');
			if (uiFontInfo.url) {
				if (!link) {
					link = document.createElement('link');
					link.id = 'dynamic-ui-font-link';
					link.rel = 'stylesheet';
					document.head.appendChild(link);
				}
				if (link.href !== uiFontInfo.url) {
					link.href = uiFontInfo.url;
				}
			} else if (link) {
				link.remove();
			}
			if (uiFontInfo.cssValue) {
				document.documentElement.style.setProperty('--ui-font-family', uiFontInfo.cssValue);
			} else {
				document.documentElement.style.removeProperty('--ui-font-family');
			}
		}
	}, [editorFont, uiFont]);

	useLayoutEffect(() => {
		if (attachSidebar)
			document.body.classList.add('attachSidebar');
		else
			document.body.classList.remove('attachSidebar');
	}, [attachSidebar]);

	useLayoutEffect(() => {
		if (promptAreaWidth) {
			const container = document.querySelector('#prompt-container');
			container.style.setProperty('min-width', promptAreaWidth);
			container.style.setProperty('max-width', promptAreaWidth);
		}
	}, [promptAreaWidth]);
	
	useLayoutEffect(() => {
		const applyTheme = () => {
			for (const theme of Object.values(allThemes)) {
				document.documentElement.classList.remove(theme.className);
			}

	        const theme = allThemes[currentThemeName];
	        if (theme && theme.className !== 'default') {
	            document.documentElement.classList.add(theme.className);
	            const styleElement = document.getElementById('dynamic-theme-style');
	            if (styleElement) {
	                styleElement.textContent = theme.css;
	            }
	        } else {
	            const styleElement = document.getElementById('dynamic-theme-style');
	            if (styleElement) {
	                styleElement.textContent = '';
	            }
	        }
		};

		if (document.startViewTransition) {
			document.startViewTransition(applyTheme);
		} else {
			applyTheme();
		}
    }, [currentThemeName, allThemes]);

	useEffect(() => {
		try {
			JSON.parse(stoppingStrings);
			setStoppingStringsError(undefined);
		} catch (e) {
			setStoppingStringsError(e.toString());
		}
	}, [stoppingStrings]);

	useEffect(() => {
		try {
			JSON.parse(drySequenceBreakers);
			setDrySequenceBreakersError(undefined);
		} catch (e) {
			setDrySequenceBreakersError(e.toString());
		}
	}, [drySequenceBreakers]);

	useEffect(() => {
		try {JSON.parse(bannedTokens);
			setBannedTokensError(undefined);
		} catch (e) {
			setBannedTokensError(e.toString());
		}
	}, [bannedTokens]);

	useEffect(() => {
		if (showProbsMode === -1 || tokenHighlightMode === -1)
			return;

		const adjustProbsPosition = () => {
			const probsElement = document.getElementById('probs');
			if (!probsElement) {
				return;
			}

			probsElement.style.display = '';
			probsElement.style.setProperty('--probs-top', `${currentPromptChunk.top}px`);
			probsElement.style.setProperty('--probs-left', `${currentPromptChunk.left}px`);

			const probsRect = probsElement.getBoundingClientRect();
			const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
			const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

			// Adjust left position if element goes off-screen on the right
			if (probsRect.right > viewportWidth) {
				const newLeft = viewportWidth - probsRect.width / 2;
				probsElement.style.setProperty('--probs-left', `${newLeft}px`);
			}

			// Adjust right position if element goes off-screen on the left
			if (probsRect.left < 0) {
				probsElement.style.setProperty('--probs-left', `${probsRect.width / 2}px`);
			}
		};

		if (currentPromptChunk && showProbs) {
			setTimeout(() => {
				adjustProbsPosition();
			});
		}
	}, [currentPromptChunk, showProbs]);

	useTouchGestures();

	// Update the textarea in an uncontrolled way so the user doesn't lose their
	// selection or cursor position during prediction
	useLayoutEffect(() => {
		const elem = promptArea.current;
		const activePromptText = hideChatTemplates ? cleanPromptText : promptText;
		if (elem.value === activePromptText) {
			return;
		} else if (elem.value.length && activePromptText.startsWith(elem.value)) {
			const isTextSelected = elem.selectionStart !== elem.selectionEnd;
			const oldHeight = elem.scrollHeight;
			const atBottom = (elem.scrollTarget ?? elem.scrollTop) + elem.clientHeight + 1 > oldHeight;
			const oldLen = elem.value.length;
			// disable preserveCursorPosition in chatMode
			if ( (!isTextSelected && !preserveCursorPosition) || (chatMode || useChatAPI)) {
				elem.value = activePromptText;
			} else {
				elem.setRangeText(activePromptText.slice(oldLen), oldLen, oldLen, 'preserve');
			}
			const newHeight = elem.scrollHeight;
			if (atBottom && oldHeight !== newHeight) {
				if (elem.scrollHeight - (elem.scrollTop + elem.clientHeight + 1) >= 100) {
					// smooth scroll isn't keeping up with prediction speed =(
					useScrollSmoothing.current = false;
				}
				elem.scrollTarget = newHeight - elem.clientHeight;
				elem.scrollTo({
					top: newHeight - elem.clientHeight,
					behavior: useScrollSmoothing.current ? 'smooth' : 'instant',
				});
			}
		} else {
			elem.value = activePromptText;
		}
	}, [promptText, hideChatTemplates, cleanPromptText]);

	useLayoutEffect(() => {
		const elem = promptArea.current;
		const previewElem = promptPreviewElement.current;
		if (!elem || !previewElem)
			return;
		const oldHeight = elem.scrollHeight;
		const atBottom = (elem.scrollTarget ?? elem.scrollTop) + elem.clientHeight + 1 > oldHeight;
		previewElem.textContent = promptPreviewText;
		elem.style.paddingBottom = previewElem.offsetHeight + 'px';
		requestAnimationFrame(() => {
			const newHeight = elem.scrollHeight;
			if (atBottom && oldHeight !== newHeight) {
				if (elem.scrollHeight - (elem.scrollTop + elem.clientHeight + 1) >= 100) {
					// smooth scroll isn't keeping up with prediction speed =(
					useScrollSmoothing.current = false;
				}
				elem.scrollTarget = newHeight - elem.clientHeight;
				elem.scrollTo({
					top: newHeight - elem.clientHeight,
					behavior: useScrollSmoothing.current ? 'smooth' : 'instant',
				});
			}
		});
	}, [promptPreviewText]);

	useLayoutEffect(() => {
		if (cancel || promptPreviewText)
			return;
		promptArea.current.scrollTarget = undefined;
		promptArea.current.scrollTop = savedScrollTop;
		promptOverlay.current.scrollTop = savedScrollTop;
	}, [savedScrollTop, tokenHighlightMode, showProbsMode]);

	useEffect(() => {
		if (cancel)
			return;
		const ac = new AbortController();
		const to = setTimeout(async () => {
			try {
		const tokenCount = await (useServerTokenization && isMiyapadEndpoint && sessionStorage?.sessionEndpoint
				? serverTokenCount({ sessionEndpoint: sessionStorage.sessionEndpoint, content: finalPromptText, signal: ac.signal })
				: getTokenCount({
					endpoint,
					endpointAPI,
					...(endpointAPI == API_OPENAI_COMPAT || endpointAPI == API_LLAMA_CPP ? { endpointAPIKey } : {}),
					content: finalPromptText,
					signal: ac.signal,
					...(isMiyapadEndpoint ? { proxyEndpoint: sessionStorage.proxyEndpoint } : {})
				})
			);
				setTokens(tokenCount);
			} catch (e) {
				if (e.name !== 'AbortError')
					reportError(e);
			}
		}, 500);
		ac.signal.addEventListener('abort', () => clearTimeout(to));
		return () => ac.abort();
	}, [modalState["context"], promptText, endpoint, endpointAPI]);

	useEffect(() => {
		if (endpointAPI !== API_OPENAI_COMPAT && endpointAPI !== API_AI_HORDE) {
			return;
		}
		setRejectedAPIKey(false);
		const ac = new AbortController();
		const to = setTimeout(async () => {
			try {
				const models = await getModels({
					endpoint,
					endpointAPI,
					endpointAPIKey,
					signal: ac.signal,
					...(isMiyapadEndpoint ? { proxyEndpoint: sessionStorage.proxyEndpoint } : {})
				});
				setOpenaiModels(models);
			} catch (e) {
				if (e.name !== 'AbortError') {
					reportError(e);
					const errStr = e.toString();
					if (endpointAPI == API_OPENAI_COMPAT && errStr.includes("401")) {
						setRejectedAPIKey(true);
					}
				}
			}
		}, 500);
		ac.signal.addEventListener('abort', () => clearTimeout(to));
		return () => ac.abort();
	}, [endpoint, endpointAPI, endpointAPIKey]);

	useKeyboardShortcuts();

	const applyChatTemplate = () => {
		if (hideChatTemplates) {
			alert("Cannot apply chat template while they are hidden. Please show chat templates first.");
			return;
		}

		const promptString = promptArea.current.value;
		if (!promptString.trim()) return;

		let bestMessages = [];
		for (const templateName of Object.keys(templates)) {
			const messages = convertChatToJSON(promptString, templates[templateName]);
			if (messages.length > bestMessages.length) {
				bestMessages = messages;
			}
		}

		if (bestMessages.length === 0) {
			alert("Could not detect any chat template in the current text.");
			return;
		}

		const newTemplate = templates[selectedTemplate];
		if (!newTemplate) return;

		const sysPre = newTemplate.sysPre?.replace(/\\n/g, '\n') || "";
		const sysSuf = newTemplate.sysSuf?.replace(/\\n/g, '\n') || "";
		const instPre = newTemplate.instPre?.replace(/\\n/g, '\n') || "";
		const instSuf = newTemplate.instSuf?.replace(/\\n/g, '\n') || "";

		let newPrompt = "";
		for (const msg of bestMessages) {
			if (msg.role === 'system') newPrompt += sysPre + msg.content + sysSuf;
			else if (msg.role === 'user') newPrompt += instPre + msg.content + instSuf;
			else if (msg.role === 'assistant') newPrompt += msg.content;
		}

		const elem = promptArea.current;
		elem.value = newPrompt;
		if (elem.onInputHandler) {
			elem.onInputHandler({ target: elem });
		}
	};

	useEffect(() => {
		function onSessionChange() {
			redoStack.current = [];
			undoStack.current = [];
			setUndoHovered(false);
			setPromptPreviewChunks([]);
			setTitleToSession();
		}
		function onSessionError() {
			if (!sessionReconnectTimer.current) {
				sessionReconnectTimer.current = setInterval(async () => {
					try {
						await sessionStorage.dbAdapter.init();
						setSessionEndpointError(undefined);
						clearTimeout(sessionReconnectTimer.current);
						sessionReconnectTimer.current = undefined;
					} catch (e) {
						reportError(e);
					}
				}, 1000);
			}
			setSessionEndpointError("Miyapad server is unreachable!");
			setCurrentPromptChunk(undefined);
			setUndoHovered(false);
		}

		sessionStorage.addEventListener('sessionchange', onSessionChange);
		sessionStorage.addEventListener('error', onSessionError);
		return () => {
			sessionStorage.removeEventListener('sessionchange', onSessionChange);
			sessionStorage.removeEventListener('error', onSessionError);
		};
	}, []);

	useEffect(() => {
		if (!useServerTokenization || !tokenizerModel || !isMiyapadEndpoint) return;
		if (!sessionStorage?.sessionEndpoint) return;

		loadServerTokenizer({ sessionEndpoint: sessionStorage.sessionEndpoint, model: tokenizerModel })
			.catch(e => {
				if (e.name !== 'AbortError')
					reportError(e);
			});
	}, []);



	const sidebar = useRef(null);
	const [sidebarHeight, setSidebarHeight] = useState(0);
	const [isMobile, setIsMobile] = useState(false);
	useEffect(() => {
		setSidebarHeight(sidebar.current.scrollHeight);
		const observer = new SVResizeObserver(() => {
			setIsMobile(window.innerWidth < 767.8);
			setSidebarHeight(sidebar.current.scrollHeight);
		});
		observer.observe(sidebar.current);
		return () => observer.disconnect();
	}, []);


	const { ttsProcessQueue, ttsStop, ttsPushUserInput, ttsAddChunk, listTTSVoices } = useTTS();

	return html`
		<${PromptContainer} sidebarHeight=${sidebarHeight}/>
		<${MarkdownPreview} sidebarHeight=${sidebarHeight}/>
		<${ProbsDisplay}/>
		<${Sidebar}
			sidebarRef=${sidebar}
			toggleModal=${toggleModal}
			currentThemeName=${currentThemeName}
			setCurrentThemeName=${setCurrentThemeName}
			allThemes=${allThemes}
			showAPIKey=${showAPIKey}
			setShowAPIKey=${setShowAPIKey}/>

				<${Modals}
			toggleModal=${toggleModal}
			currentThemeName=${currentThemeName}
			setCurrentThemeName=${setCurrentThemeName}
			allThemes=${allThemes}
			setAllThemes=${setAllThemes}
			applyChatTemplate=${applyChatTemplate}/>
	`;
}
