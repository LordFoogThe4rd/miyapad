import { useEffect, useRef } from 'react';
import { useSettings } from '../contexts/SettingsContext.js';
import { useGeneration } from '../contexts/GenerationContext.js';
import { usePromptBuilder } from './usePromptBuilder.js';
import { useTTS } from './useTTS.js';
import { getTokenCount, serverTokenCount, completion, chatCompletion, abortCompletion } from '../api/index.js';
import { API_LLAMA_CPP, API_KOBOLD_CPP, API_OPENAI_COMPAT, API_AI_HORDE } from '../constants.js';
import { replaceNewlines } from '../utils/strings.js';
import { regexLastIndexOf, createLenientRegex } from '../utils/regex.js';

export function useGenerationLogic() {
	const { endpoint, endpointAPI, endpointAPIKey, endpointModel, seed, maxPredictTokens, temperature, dynaTempRange, dynaTempExp, repeatPenalty, repeatLastN, penalizeNl, presencePenalty, frequencyPenalty, topK, topP, typicalP, minP, tfsZ, mirostat, mirostatTau, mirostatEta, xtcThreshold, xtcProbability, dryMultiplier, dryBase, dryAllowedLength, dryPenaltyRange, drySequenceBreakers, bannedTokens, ignoreEos, openaiPresets, stoppingStrings, useBasicStoppingMode, basicStoppingModeType, logitBias, logitBiasParam, enabledSamplers, grammar, useChatAPI, useTokenStreaming, disableLogprobs, postSamplingProbs, showPromptPreview, promptPreviewTokens, templates, selectedTemplate, chatMode, setChatMode, setUseChatAPI, setSelectedTemplate, isMiyapadEndpoint, sessionStorage, ttsEnabled, useServerTokenization } = useSettings();
	const { promptArea, promptOverlay, undoStack, redoStack, probsDelayTimer, keyState, sessionReconnectTimer, useScrollSmoothing, hordeTaskId, promptPreviewElement, markdownPreviewRef, isSyncingScroll, promptChunks, setPromptChunks, currentPromptChunk, setCurrentPromptChunk, undoHovered, setUndoHovered, showProbs, setShowProbs, cancel, setCancel, sessionEndpointConnecting, setSessionEndpointConnecting, sessionEndpointError, setSessionEndpointError, rejectedAPIKey, setRejectedAPIKey, openaiModels, setOpenaiModels, tokens, setTokens, tokensPerSec, setTokensPerSec, predictStartTokens, setPredictStartTokens, lastError, setLastError, savedScrollTop, setSavedScrollTop, modalState, setModalState, contextMenuState, setContextMenuState, instructModalState, setInstructModalState, hordeQueuePos, setHordeQueuePos, hordeProcessing, setHordeProcessing, promptPreviewChunks, setPromptPreviewChunks, promptPreviewReroll, setPromptPreviewReroll, ttsAvailable, setTTSAvailable, ttsNewText, ttsLastChunk, ttsQueue, ttsVoices, ttsPaused, activeGenId, abortControllerRef, triggerPredict, setTriggerPredict, restartedPredict, setRestartedPredict } = useGeneration();
	const { fimPromptInfo, finalPromptText, convertChatToJSON } = usePromptBuilder();
	const { ttsProcessQueue, ttsStop, ttsPushUserInput, ttsAddChunk, listTTSVoices } = useTTS();

	// predicts one {fill} placeholder
	async function fillPredict() {
		if (fimPromptInfo === undefined)
			return false;

		const { fimLeftChunks, fimRightChunks } = fimPromptInfo;
		const myId = activeGenId.current;
		predict(finalPromptText, fimLeftChunks.length, (chunk) => {
			if (myId !== activeGenId.current) return false;
			fimLeftChunks.push(chunk);
			setPromptChunks(p => [
				...fimLeftChunks,
				...fimRightChunks
			]);
			setTokens(t => t + (chunk?.completion_probabilities?.length ?? 1));
			return true;
		}, undefined, true);

		return true;
	}

	async function predict(prompt = finalPromptText, chunkCount = promptChunks.length, callback = undefined, abortController = undefined, invalidatesUndo = false, customParams = {}) {
		const myId = ++activeGenId.current;

		if (!abortController && cancel) {
			cancel?.();

			// llama.cpp server sometimes generates gibberish if we stop and
			// restart right away (???)
			let cancelled = false;
			setCancel(() => () => cancelled = true);
			await new Promise(resolve => setTimeout(resolve, 500));
			if (cancelled)
				return false;
		}

		// predict the fill placeholder if it is present in the prompt.
		if (!callback && !restartedPredict && await fillPredict())
			return true;

		let ac;
		let cancelThis;
		if (!abortController) {
			ac = new AbortController();
			abortControllerRef.current = ac;
			cancelThis = () => {
				abortCompletion({
					endpoint,
					endpointAPI,
					...(endpointAPI == API_AI_HORDE ? { hordeTaskId: hordeTaskId.current } : {}),
					...(isMiyapadEndpoint ? { proxyEndpoint: sessionStorage.proxyEndpoint } : {})
				});
				ac.abort();
			};
			setCancel(() => cancelThis);
		} else {
			ac = abortController;
			cancelThis = () => {
				abortCompletion({
					endpoint,
					endpointAPI,
					...(endpointAPI == API_AI_HORDE ? { hordeTaskId: hordeTaskId.current } : {}),
					...(isMiyapadEndpoint ? { proxyEndpoint: sessionStorage.proxyEndpoint } : {})
				});
			};
			ac.signal.addEventListener('abort', cancelThis);
		}
		setLastError(undefined);

		let predictCount = 0;
		ttsPushUserInput(); ttsPaused.current = false;
		try {
			// sometimes "getTokenCount" can take a while because the server is busy
			// so let's set the predictStartTokens beforehand.
			setPredictStartTokens(tokens);
			if (showPromptPreview) setPromptPreviewChunks([]); // Discard current preview.

			if (!callback) {
				const tokenCount = await (useServerTokenization && isMiyapadEndpoint && sessionStorage?.sessionEndpoint
					? serverTokenCount({ sessionEndpoint: sessionStorage.sessionEndpoint, content: prompt, signal: ac.signal })
					: getTokenCount({
						endpoint,
						endpointAPI,
						...(endpointAPI == API_OPENAI_COMPAT || endpointAPI == API_LLAMA_CPP ? { endpointAPIKey } : {}),
						content: prompt,
						signal: ac.signal,
						...(isMiyapadEndpoint ? { proxyEndpoint: sessionStorage.proxyEndpoint } : {})
					})
				);
				if (myId !== activeGenId.current) return;
				setTokens(tokenCount);
				setPredictStartTokens(tokenCount);

				// Chat Mode
				if ((chatMode || useChatAPI) && !restartedPredict && templates[selectedTemplate]) {
					// add user EOT template (instruct suffix) if not switch completion
					const { instSuf, instPre } = replaceNewlines(templates[selectedTemplate]);
					const instSufIndex = instSuf ? regexLastIndexOf(prompt, createLenientRegex(instSuf)) : -1;
					const instPreIndex = instPre ? regexLastIndexOf(prompt, createLenientRegex(instPre)) : -1;
					if (instSufIndex <= instPreIndex) {
						setPromptChunks(p => [...p, { type: 'user', content: instSuf }])
						prompt += instSuf;
					}
				}
				setRestartedPredict(false)

				if (myId === activeGenId.current) {
					const lastUndo = undoStack.current.length > 0 ? undoStack.current[undoStack.current.length - 1] : -1;
					while (lastUndo >= chunkCount && undoStack.current.length > 0)
						undoStack.current.pop();
					if (Array.isArray(undoStack.current)) undoStack.current.push(chunkCount);
				}
			}
			if (invalidatesUndo && myId === activeGenId.current) {
				undoStack.current = [];
			}
			if (myId === activeGenId.current) {
				redoStack.current = [];
				setUndoHovered(false);
				setRejectedAPIKey(false);
				promptArea.current.scrollTarget = undefined;
				useScrollSmoothing.current = true;
			}

			let stopParam = [];
			if (useBasicStoppingMode) {
				switch (basicStoppingModeType) {
					case 'new_line':
						stopParam = ['\n'];
						break;
					case 'fill_suffix':
						if (fimPromptInfo !== undefined) {
							const { fimLeftChunks, fimRightChunks } = fimPromptInfo;
							const suffix = fimRightChunks[0]?.content;
							if (suffix && suffix.length > 0) {
								stopParam = [suffix.trim().substring(0, 2)];
							}
						}
						break;
				}
			} else {
				try {
					stopParam = JSON.parse(stoppingStrings);
				} catch (e) {
					console.error('Failed to parse stopping strings', stoppingStrings, e);
					stopParam = [];
				}
			}

			if (useChatAPI && !templates[selectedTemplate]) {
				const defaultTemplate = templates["Mistral"] || Object.values(templates)[0];
				if (!defaultTemplate) {
					// this is bad...
					setChatMode(false);
					setUseChatAPI(false);
				} else {
					setSelectedTemplate(defaultTemplate);
				}
				setTriggerPredict(true);
				return;
			}

			let startTime = 0;
			setTokensPerSec(0.0);
			
			for await (const chunk of (useChatAPI ? chatCompletion : completion)({
				endpoint,
				endpointAPI,
				...(endpointAPI == API_OPENAI_COMPAT || endpointAPI == API_LLAMA_CPP || endpointAPI == API_AI_HORDE ? {
					endpointAPIKey,
					model: endpointModel
				} : {}),
				...(useChatAPI ? { messages: convertChatToJSON(prompt, templates[selectedTemplate]) } : { prompt }),
				...(seed != -1 ? { seed } : {}),
				...(enabledSamplers.includes('temperature') ? {
					temperature
				} : {}),
				...(!openaiPresets || endpointAPI != API_OPENAI_COMPAT ? {
					...(enabledSamplers.includes('dynatemp') ? {
						dynatemp_range: dynaTempRange,
						dynatemp_exponent: dynaTempExp,
					} : {}),
					...(enabledSamplers.includes('rep_pen') ? {
						repeat_penalty: repeatPenalty,
						repeat_last_n: repeatLastN,
					} : {}),
					penalize_nl: penalizeNl,
					ignore_eos: ignoreEos,
				} : {}),
				...(Object.keys(logitBias.bias).length > 0 ? {
					logit_bias: logitBiasParam,
				} : {}),
				...((!openaiPresets || endpointAPI != API_OPENAI_COMPAT) && grammar.length ? { grammar } : {}),
				...(enabledSamplers.includes('pres_pen') ? {
					presence_penalty: presencePenalty,
				} : {}),
				...(enabledSamplers.includes('freq_pen') ? {
					frequency_penalty: frequencyPenalty,
				} : {}),
				...((enabledSamplers.includes('mirostat') && mirostat && (!openaiPresets || endpointAPI != API_OPENAI_COMPAT)) ? {
					mirostat,
					mirostat_tau: mirostatTau,
					mirostat_eta: mirostatEta,
				} : {
					...(enabledSamplers.includes('top_p') ? {
						top_p: topP,
					} : {}),
					...(!openaiPresets || endpointAPI != API_OPENAI_COMPAT ? {
						...(enabledSamplers.includes('top_k') ? {
							top_k: topK,
						} : {}),
						...(enabledSamplers.includes('typical_p') ? {
							typical_p: typicalP,
						} : {}),
						...(enabledSamplers.includes('min_p') ? {
							min_p: minP,
						} : {}),
						...(enabledSamplers.includes('tfs_z') ? {
							tfs_z: tfsZ
						} : {}),
						...(enabledSamplers.includes('xtc') ? {
							xtc_threshold: xtcThreshold,
							xtc_probability: xtcProbability,
						}: {}),
						...(enabledSamplers.includes('dry') ? {
							dry_multiplier: dryMultiplier,
							dry_base: dryBase,
							dry_allowed_length: dryAllowedLength,
							dry_penalty_last_n: dryPenaltyRange,
							dry_sequence_breakers: endpointAPI == API_OPENAI_COMPAT ? 
								drySequenceBreakers : 
								JSON.parse(drySequenceBreakers),
						}: {}),
						...(enabledSamplers.includes('ban_tokens') ? {
							banned_tokens: JSON.parse(bannedTokens),
						}: {}),
					} : {})
				}),
				n_predict: maxPredictTokens,
				n_probs: disableLogprobs ? 0 : 10,
				...(endpointAPI === API_LLAMA_CPP ? { post_sampling_probs: postSamplingProbs } : {}),
				stream: useTokenStreaming,
				...(stopParam.length ? { stop: stopParam } : {}),
				signal: ac.signal,
				...(isMiyapadEndpoint ? { proxyEndpoint: sessionStorage.proxyEndpoint } : {}),
				...customParams
			})) {
				if (myId !== activeGenId.current) break;
				ac.signal.throwIfAborted();
				if (chunk.stopping_word)
					chunk.content = chunk.stopping_word;
				if (endpointAPI === API_AI_HORDE) {
					switch (chunk.status) {
					case 'queue_init':
						hordeTaskId.current = chunk.taskId;
						continue;
					case 'queue_status':
						setHordeQueuePos(chunk.position);
						setHordeProcessing(chunk.processing);
						continue;
					}
				}
				if (!chunk.content) {
					continue;
				}
				if (startTime === 0) {
					startTime = performance.now();
				} else {
					if (predictCount === 1) {
						startTime -= performance.now() - startTime; // compensate for the first token
					}
					const elapsedTime = (performance.now() - startTime) / 1000; // in seconds
					setTokensPerSec((predictCount + 1) / elapsedTime);
				}
				if (callback) {
					if (!callback(chunk))
						break;
				} else {
					if (myId !== activeGenId.current) break;
					setPromptChunks(p => [...p, chunk]);
					setTokens(t => t + (chunk?.completion_probabilities?.length ?? 1));
				}
				predictCount += 1;
				ttsAddChunk(chunk.content);
			}
		} catch (e) {
			if (e.name !== 'AbortError') {
				reportError(e);
				const errStr = e.toString();
				if ((endpointAPI == API_OPENAI_COMPAT || endpointAPI == API_LLAMA_CPP) && errStr.includes("401")) {
					setLastError("Error: Rejected API Key");
					setRejectedAPIKey(true);
				} else if (endpointAPI == API_OPENAI_COMPAT && errStr.includes("429")) {
					setLastError("Error: Insufficient Quota");
				} else {
					setLastError(errStr);
				}
			}
			return false;
		} finally {
			if (myId === activeGenId.current) {
				setCancel(c => c === cancelThis ? null : c);
				abortControllerRef.current = null;
			}
			if (abortController)
				ac.signal.removeEventListener('abort', cancelThis);
			if (!callback) {
				if (predictCount === 0 && myId === activeGenId.current && Array.isArray(undoStack.current))
					undoStack.current.pop();
			}
			setTokensPerSec(0.0);
			hordeTaskId.current = undefined;
			setHordeQueuePos(undefined);
			setHordeProcessing(false);
			if (ttsEnabled) {
				if (ttsNewText.current.length) {
					if (!ttsPaused.current)
						ttsQueue.current.push(ttsNewText.current);
					ttsNewText.current = "";
				}
				if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) ttsProcessQueue();
			}
		}

		// Chat Mode
		if (myId === activeGenId.current && !callback && (chatMode || useChatAPI) && predictCount > 0) {
			// add bot EOT template (instruct prefix)
			const eotBot = templates[selectedTemplate]?.instPre.replace(/\\n/g, '\n')
			setPromptChunks(p => [...p, { type: 'user', content: eotBot }])
			prompt += `${eotBot}`
		}
		
		return true;
	}

	function undo() {
		if (!undoStack.current || !Array.isArray(undoStack.current) || !undoStack.current.length)
			return false;
		activeGenId.current++; // Invalidate any active generation
		if (showPromptPreview) setPromptPreviewChunks([]); // Discard current preview so that a new one is generated.
		const lastUndoPos = undoStack.current[undoStack.current.length - 1];
		if (Array.isArray(redoStack.current)) redoStack.current.push(promptChunks.slice(lastUndoPos));
		setPromptChunks(p => p.slice(0, undoStack.current.pop()));
		return true;
	}

	function redo() {
		if (!redoStack.current || !Array.isArray(redoStack.current) || !redoStack.current.length)
			return false;
		activeGenId.current++; // Invalidate any active generation
		if (showPromptPreview) setPromptPreviewChunks([]); // Discard current preview so that a new one is generated.
		if (Array.isArray(undoStack.current)) undoStack.current.push(promptChunks.length);
		setPromptChunks(p => [...p, ...redoStack.current.pop()]);
		setUndoHovered(false);
		return true;
	}
	function undoAndPredict() {
		if (!undoStack.current.length) return;
		if (triggerPredict) return;
		const didUndo = undo();
		if (didUndo) {
			setTriggerPredict(true);
		}
	}
	useEffect(() => {
		if (triggerPredict) {
			predict();
			setTriggerPredict(false);
		}
	}, [triggerPredict]);
	return { predict, undo, redo, undoAndPredict, fillPredict };
}
