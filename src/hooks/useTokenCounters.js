import { useEffect } from 'react';
import { useSettings } from '../contexts/SettingsContext.js';
import { useGeneration } from '../contexts/GenerationContext.js';
import { usePromptBuilder } from './usePromptBuilder.js';
import { getTokenCount, serverTokenCount } from '../api/index.js';
import { API_OPENAI_COMPAT, API_LLAMA_CPP } from '../constants.js';

export function useTokenCounters() {
	const { endpoint, endpointAPI, endpointAPIKey, sessionStorage, isMiyapadEndpoint, useServerTokenization, contextLength, authorNoteTokens, setAuthorNoteTokens, memoryTokens, setMemoryTokens, worldInfo } = useSettings();
	const { cancel, modalState } = useGeneration();
	const { templateReplacements, replacePlaceholders } = usePromptBuilder();

	function handleauthorNoteTokensChange(key,value) {
		setAuthorNoteTokens((prevauthorNoteTokens) => ({ ...prevauthorNoteTokens, [key]: value }));
	}
	// token counts for an
	useEffect(() => {
		const order = ["prefix","text","suffix"]
		const assembled = authorNoteTokens.text && authorNoteTokens.text !== ""
			? order.map(key => authorNoteTokens[key]).join("")
			: "";	
		if (assembled == "" || endpointAPI == API_OPENAI_COMPAT) {
			setAuthorNoteTokens((prevauthorNoteTokens) => ({ ...prevauthorNoteTokens, "tokens": 0 }))
			return
		}
		const ac = new AbortController();
		const to = setTimeout(async () => {
			try {
				const content = `${replacePlaceholders(assembled,templateReplacements)}`;
				const tokenCount = await (useServerTokenization && isMiyapadEndpoint && sessionStorage?.sessionEndpoint
					? serverTokenCount({ sessionEndpoint: sessionStorage.sessionEndpoint, content, signal: ac.signal })
					: getTokenCount({
						endpoint,
						endpointAPI,
						...(endpointAPI == API_OPENAI_COMPAT || endpointAPI == API_LLAMA_CPP ? { endpointAPIKey } : {}),
						content,
						signal: ac.signal,
						...(isMiyapadEndpoint ? { proxyEndpoint: sessionStorage.proxyEndpoint } : {})
					})
				);
				setAuthorNoteTokens((prevauthorNoteTokens) => ({
					...prevauthorNoteTokens,
					"tokens": tokenCount - 1 
				}));
			} catch (e) {
				if (e.name !== 'AbortError'){
					reportError(e);
					setAuthorNoteTokens((prevauthorNoteTokens) => ({ ...prevauthorNoteTokens, "tokens": 0 }))
				}	
			}
		}, 500);

		ac.signal.addEventListener('abort', () => clearTimeout(to));
		return () => ac.abort();
	},[modalState["context"],authorNoteTokens.text,authorNoteTokens.prefix,authorNoteTokens.suffix,contextLength,cancel,endpoint,endpointAPI,useServerTokenization])

	function handleMemoryTokensChange(key,value) {
		setMemoryTokens((prevMemoryTokens) => ({ ...prevMemoryTokens, [key]: value }));
	}
	// token counts for memory
	useEffect(() => {
		const order = ["prefix","text","suffix"]
		const assembled = memoryTokens.text && memoryTokens.text !== ""
			? order.map(key => memoryTokens[key]).join("")
			: "";	
		if (assembled == "" || endpointAPI == API_OPENAI_COMPAT){
			setMemoryTokens((prevMemoryTokens) => ({ ...prevMemoryTokens, "tokens": 0 }));
			return
		}

		const ac = new AbortController();
		const to = setTimeout(async () => {
			try {
				const content = `${replacePlaceholders(assembled,templateReplacements)}`;
				const tokenCount = await (useServerTokenization && isMiyapadEndpoint && sessionStorage?.sessionEndpoint
					? serverTokenCount({ sessionEndpoint: sessionStorage.sessionEndpoint, content, signal: ac.signal })
					: getTokenCount({
						endpoint,
						endpointAPI,
						...(endpointAPI == API_OPENAI_COMPAT || endpointAPI == API_LLAMA_CPP ? { endpointAPIKey } : {}),
						content,
						signal: ac.signal,
						...(isMiyapadEndpoint ? { proxyEndpoint: sessionStorage.proxyEndpoint } : {})
					})
				);
				setMemoryTokens((prevMemoryTokens) => ({
					...prevMemoryTokens,
					"tokens": tokenCount - 1 
				}));
			} catch (e) {
				if (e.name !== 'AbortError'){
					reportError(e);
					setMemoryTokens((prevMemoryTokens) => ({ ...prevMemoryTokens, "tokens": 0 }));
				}
			}
		}, 500);

		ac.signal.addEventListener('abort', () => clearTimeout(to));
		return () => ac.abort();
	},[modalState["context"],memoryTokens.text,memoryTokens.prefix,memoryTokens.suffix,cancel,endpoint,endpointAPI,useServerTokenization])
	// token counts for wi
	useEffect(() => {
		const assembled = memoryTokens.worldInfo && memoryTokens.worldInfo !== ""
			? [worldInfo.prefix,memoryTokens.worldInfo,worldInfo.suffix].join("")
			: "";
		if (assembled == "" || endpointAPI == API_OPENAI_COMPAT){
			setMemoryTokens((prevMemoryTokens) => ({ ...prevMemoryTokens, "tokensWI": 0 }));
			return
		}

		const ac = new AbortController();
		const to = setTimeout(async () => {
			try {
				const content = `${replacePlaceholders(assembled,templateReplacements)}`;
				const tokenCount = await (useServerTokenization && isMiyapadEndpoint && sessionStorage?.sessionEndpoint
					? serverTokenCount({ sessionEndpoint: sessionStorage.sessionEndpoint, content, signal: ac.signal })
					: getTokenCount({
						endpoint,
						endpointAPI,
						...(endpointAPI == API_OPENAI_COMPAT || endpointAPI == API_LLAMA_CPP ? { endpointAPIKey } : {}),
						content,
						signal: ac.signal,
						...(isMiyapadEndpoint ? { proxyEndpoint: sessionStorage.proxyEndpoint } : {})
					})
				);
				setMemoryTokens((prevMemoryTokens) => ({
					...prevMemoryTokens,
					"tokensWI": tokenCount - 1 
				}));
			} catch (e) {
				if (e.name !== 'AbortError'){
					reportError(e);
					setMemoryTokens((prevMemoryTokens) => ({ ...prevMemoryTokens, "tokensWI": 0 }));
				}
			}
		}, 500);

		ac.signal.addEventListener('abort', () => clearTimeout(to));
		return () => ac.abort();
	},[modalState["context"],worldInfo.prefix,memoryTokens.worldInfo,worldInfo.suffix,cancel,endpoint,endpointAPI,useServerTokenization])

	return { handleauthorNoteTokensChange, handleMemoryTokensChange };
}
