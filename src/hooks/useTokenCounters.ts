import { useEffect } from 'react';
import { useSettings } from '../contexts/SettingsContext';
import { useGeneration } from '../contexts/GenerationContext';
import { usePromptBuilder } from './usePromptBuilder';
import { getTokenCount, serverTokenCount } from '../api/index';
import { API_OPENAI_COMPAT, API_LLAMA_CPP, API_DEEPSEEK } from '../constants';
import { isAbortError } from '../utils/errors';

/** Everything a counter needs to reach a tokenizer, gathered once by the caller. */
interface TokenCountConfig {
	endpoint: string;
	endpointAPI: number;
	endpointAPIKey?: string;
	isMiyapadEndpoint: boolean;
	useServerTokenization: boolean;
	sessionStorage: SessionStorageLike;
	templateReplacements: Record<string, string>;
	replacePlaceholders: (text: string, replacements: Record<string, string>) => string;
}

interface SessionStorageLike {
	sessionEndpoint?: string;
	proxyEndpoint?: string;
}

/** `prefix + text + suffix`, or the empty string when there is no text to count. */
function assemble(prefix: string | undefined, text: string | undefined, suffix: string | undefined): string {
	return text ? [prefix, text, suffix].join('') : '';
}

/**
 * Debounced token count for one assembled block of prompt text, reported
 * through `apply`. The author note, memory and world info counters differ only
 * in what they assemble and where the result is stored, so they share this.
 *
 * `apply` and `replacePlaceholders` are deliberately absent from the dependency
 * list: both are rebuilt on every render, and depending on them would restart
 * the debounce continuously. Neither closes over anything but stable setters.
 */
function useDebouncedTokenCount(assembled: string, apply: (tokens: number) => void, config: TokenCountConfig) {
	const { endpoint, endpointAPI, endpointAPIKey, isMiyapadEndpoint, useServerTokenization, sessionStorage, templateReplacements, replacePlaceholders } = config;

	useEffect(() => {
		// The OpenAI-compatible and DeepSeek APIs expose no tokenizer to count with.
		if (assembled === '' || endpointAPI === API_OPENAI_COMPAT || endpointAPI === API_DEEPSEEK) {
			apply(0);
			return;
		}

		const ac = new AbortController();
		const to = setTimeout(async () => {
			try {
				const content = replacePlaceholders(assembled, templateReplacements);
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
				apply(tokenCount - 1); // - 1 for BOS, matching llamaCppTokenCount.
			} catch (e: unknown) {
				if (!isAbortError(e)) {
					reportError(e);
					apply(0);
				}
			}
		}, 500);

		ac.signal.addEventListener('abort', () => clearTimeout(to));
		return () => ac.abort();
	}, [assembled, endpoint, endpointAPI, endpointAPIKey, isMiyapadEndpoint, sessionStorage, useServerTokenization, templateReplacements]);
}

export function useTokenCounters() {
	const { endpoint, endpointAPI, endpointAPIKey, sessionStorage, isMiyapadEndpoint, useServerTokenization, contextLength, authorNoteTokens, setAuthorNoteTokens, memoryTokens, setMemoryTokens, worldInfo } = useSettings();
	const { cancel, modalState } = useGeneration();
	const { templateReplacements, replacePlaceholders } = usePromptBuilder();

	const config: TokenCountConfig = { endpoint, endpointAPI, endpointAPIKey, isMiyapadEndpoint, useServerTokenization, sessionStorage, templateReplacements, replacePlaceholders };

	function handleauthorNoteTokensChange<K extends keyof AuthorNoteData>(key: K, value: AuthorNoteData[K]) {
		setAuthorNoteTokens((prevauthorNoteTokens: AuthorNoteData) => ({ ...prevauthorNoteTokens, [key]: value }));
	}

	function handleMemoryTokensChange<K extends keyof MemoryTokensData>(key: K, value: MemoryTokensData[K]) {
		setMemoryTokens((prevMemoryTokens: MemoryTokensData) => ({ ...prevMemoryTokens, [key]: value }));
	}

	useDebouncedTokenCount(
		assemble(authorNoteTokens.prefix, authorNoteTokens.text, authorNoteTokens.suffix),
		tokens => setAuthorNoteTokens((prev: AuthorNoteData) => ({ ...prev, tokens })),
		config,
	);

	useDebouncedTokenCount(
		assemble(memoryTokens.prefix, memoryTokens.text, memoryTokens.suffix),
		tokens => setMemoryTokens((prev: MemoryTokensData) => ({ ...prev, tokens })),
		config,
	);

	useDebouncedTokenCount(
		assemble(worldInfo.prefix, memoryTokens.worldInfo, worldInfo.suffix),
		tokensWI => setMemoryTokens((prev: MemoryTokensData) => ({ ...prev, tokensWI })),
		config,
	);

	return { handleauthorNoteTokensChange, handleMemoryTokensChange };
}
