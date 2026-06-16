import { useEffect } from 'react';
import { useSettings } from '../contexts/SettingsContext';
import { useGeneration } from '../contexts/GenerationContext';
import { usePromptBuilder } from './usePromptBuilder';
import { getTokenCount, serverTokenCount } from '../api/index';
import { API_OPENAI_COMPAT, API_LLAMA_CPP, API_DEEPSEEK } from '../constants';
import { isAbortError } from '../utils/errors';

export function useTokenCounters() {
	const { endpoint, endpointAPI, endpointAPIKey, sessionStorage, isMiyapadEndpoint, useServerTokenization, contextLength, authorNoteTokens, setAuthorNoteTokens, memoryTokens, setMemoryTokens, worldInfo } = useSettings();
	const { cancel, modalState } = useGeneration();
	const { templateReplacements, replacePlaceholders } = usePromptBuilder();

	function handleauthorNoteTokensChange<K extends keyof AuthorNoteData>(key: K, value: AuthorNoteData[K]) {
		setAuthorNoteTokens((prevauthorNoteTokens: AuthorNoteData) => ({ ...prevauthorNoteTokens, [key]: value }));
	}
	// token counts for an
	useEffect(() => {
		const order: (keyof AuthorNoteData)[] = ["prefix","text","suffix"]
		const assembled = authorNoteTokens.text && authorNoteTokens.text !== ""
			? order.map(key => authorNoteTokens[key]).join("")
			: "";	
		if (assembled == "" || endpointAPI == API_OPENAI_COMPAT || endpointAPI == API_DEEPSEEK) {
			setAuthorNoteTokens((prevauthorNoteTokens: AuthorNoteData) => ({ ...prevauthorNoteTokens, "tokens": 0 }))
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
						...(endpointAPI == API_OPENAI_COMPAT || endpointAPI == API_LLAMA_CPP || endpointAPI == API_DEEPSEEK ? { endpointAPIKey } : {}),
						content,
						signal: ac.signal,
						...(isMiyapadEndpoint ? { proxyEndpoint: sessionStorage.proxyEndpoint } : {})
					})
				);
				setAuthorNoteTokens((prevauthorNoteTokens: AuthorNoteData) => ({
					...prevauthorNoteTokens,
					"tokens": tokenCount - 1 
				}));
			} catch (e: unknown) {
				if (!isAbortError(e)){
					reportError(e);
					setAuthorNoteTokens((prevauthorNoteTokens: AuthorNoteData) => ({ ...prevauthorNoteTokens, "tokens": 0 }))
				}
			}
		}, 500);

		ac.signal.addEventListener('abort', () => clearTimeout(to));
		return () => ac.abort();
	},[modalState["context"],authorNoteTokens.text,authorNoteTokens.prefix,authorNoteTokens.suffix,contextLength,cancel,endpoint,endpointAPI,endpointAPIKey,isMiyapadEndpoint,sessionStorage,useServerTokenization,templateReplacements])

	function handleMemoryTokensChange<K extends keyof MemoryTokensData>(key: K, value: MemoryTokensData[K]) {
		setMemoryTokens((prevMemoryTokens: MemoryTokensData) => ({ ...prevMemoryTokens, [key]: value }));
	}
	// token counts for memory
	useEffect(() => {
		const order: (keyof MemoryTokensData)[] = ["prefix","text","suffix"]
		const assembled = memoryTokens.text && memoryTokens.text !== ""
			? order.map(key => memoryTokens[key]).join("")
			: "";	
		if (assembled == "" || endpointAPI == API_OPENAI_COMPAT || endpointAPI == API_DEEPSEEK){
			setMemoryTokens((prevMemoryTokens: MemoryTokensData) => ({ ...prevMemoryTokens, "tokens": 0 }));
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
						...(endpointAPI == API_OPENAI_COMPAT || endpointAPI == API_LLAMA_CPP || endpointAPI == API_DEEPSEEK ? { endpointAPIKey } : {}),
						content,
						signal: ac.signal,
						...(isMiyapadEndpoint ? { proxyEndpoint: sessionStorage.proxyEndpoint } : {})
					})
				);
				setMemoryTokens((prevMemoryTokens: MemoryTokensData) => ({
					...prevMemoryTokens,
					"tokens": tokenCount - 1 
				}));
			} catch (e: unknown) {
				if (!isAbortError(e)){
					reportError(e);
					setMemoryTokens((prevMemoryTokens: MemoryTokensData) => ({ ...prevMemoryTokens, "tokens": 0 }));
				}
			}
		}, 500);

		ac.signal.addEventListener('abort', () => clearTimeout(to));
		return () => ac.abort();
	},[modalState["context"],memoryTokens.text,memoryTokens.prefix,memoryTokens.suffix,cancel,endpoint,endpointAPI,endpointAPIKey,isMiyapadEndpoint,sessionStorage,useServerTokenization,templateReplacements])
	// token counts for wi
	useEffect(() => {
		const assembled = memoryTokens.worldInfo && memoryTokens.worldInfo !== ""
			? [worldInfo.prefix,memoryTokens.worldInfo,worldInfo.suffix].join("")
			: "";
		if (assembled == "" || endpointAPI == API_OPENAI_COMPAT || endpointAPI == API_DEEPSEEK){
			setMemoryTokens((prevMemoryTokens: MemoryTokensData) => ({ ...prevMemoryTokens, "tokensWI": 0 }));
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
						...(endpointAPI == API_OPENAI_COMPAT || endpointAPI == API_LLAMA_CPP || endpointAPI == API_DEEPSEEK ? { endpointAPIKey } : {}),
						content,
						signal: ac.signal,
						...(isMiyapadEndpoint ? { proxyEndpoint: sessionStorage.proxyEndpoint } : {})
					})
				);
				setMemoryTokens((prevMemoryTokens: MemoryTokensData) => ({
					...prevMemoryTokens,
					"tokensWI": tokenCount - 1 
				}));
			} catch (e: unknown) {
				if (!isAbortError(e)){
					reportError(e);
					setMemoryTokens((prevMemoryTokens: MemoryTokensData) => ({ ...prevMemoryTokens, "tokensWI": 0 }));
				}
			}
		}, 500);

		ac.signal.addEventListener('abort', () => clearTimeout(to));
		return () => ac.abort();
	},[modalState["context"],worldInfo.prefix,memoryTokens.worldInfo,worldInfo.suffix,cancel,endpoint,endpointAPI,endpointAPIKey,isMiyapadEndpoint,sessionStorage,useServerTokenization,templateReplacements])

	return { handleauthorNoteTokensChange, handleMemoryTokensChange };
}
