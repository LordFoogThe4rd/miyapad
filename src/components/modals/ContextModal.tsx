import { html } from 'htm/react';
import { useState, useEffect, useRef } from 'react';
import { Modal } from '../Modal';
import { CollapsibleGroup } from '../controls/CollapsibleGroup';
import { getTokenCount, serverTokenCount } from '../../api/index';
import { API_OPENAI_COMPAT, API_LLAMA_CPP, API_DEEPSEEK } from '../../constants';
import { isAbortError } from '../../utils/errors';
import { useT } from '../../i18n';
import type { SessionStorage } from '../../storage/SessionStorage';

interface ContextModalProps {
	isOpen: boolean;
	closeModal: () => void;
	tokens: number;
	memoryTokens: MemoryTokensData;
	authorNoteTokens: AuthorNoteData;
	handleMemoryTokensChange: <K extends keyof MemoryTokensData>(key: K, value: MemoryTokensData[K]) => void;
	finalPromptText: string;
	defaultPresets: DefaultPresets;
	cancel: (() => void) | null;
	apiConfig: {
		sessionStorage: SessionStorage;
		endpoint: string;
		endpointAPI: number;
		endpointAPIKey: string;
		isMiyapadEndpoint: boolean;
		useServerTokenization: boolean;
	};
}

export function ContextModal({ isOpen, closeModal, tokens, memoryTokens, authorNoteTokens, handleMemoryTokensChange, finalPromptText, defaultPresets, cancel, apiConfig }: ContextModalProps) {
	const t = useT();
	const { sessionStorage, endpoint, endpointAPI, endpointAPIKey, isMiyapadEndpoint, useServerTokenization } = apiConfig;
	const [contextPlayground, setContextPlayground] = useState(finalPromptText);
	const [playgroundTokens, setPlaygroundTokens] = useState(tokens);
	const prevIsOpen = useRef(isOpen);
	useEffect(() => {
		if (isOpen && !prevIsOpen.current) {
			setContextPlayground(finalPromptText);
			setPlaygroundTokens(tokens);
		}
		prevIsOpen.current = isOpen;
	}, [isOpen, finalPromptText, tokens]);
	useEffect(() => {
		if (!isOpen) return;
		const ac = new AbortController();
		const to = setTimeout(async () => {
			const content = contextPlayground;
			try {
				const count = await (useServerTokenization && isMiyapadEndpoint && sessionStorage?.sessionEndpoint
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
				setPlaygroundTokens(count);
			} catch (e: unknown) {
				if (!isAbortError(e)) {
					reportError(e);
					setPlaygroundTokens(0);
				}
			}
		}, 500);
		ac.signal.addEventListener('abort', () => clearTimeout(to));
		return () => ac.abort();
	}, [isOpen, contextPlayground, endpoint, endpointAPI, endpointAPIKey, isMiyapadEndpoint, useServerTokenization, sessionStorage]);
	return html`
		<${Modal} isOpen=${isOpen} onClose=${closeModal}
			title=${t('context.title')}
			description=${t('context.description')}>
			<div id="advancedContextPlaceholders">
			<table id="contextTokensTable" border="1" frame="void" rules="all">
				<thead>
					<tr>
						<th></th>
						<th>${t('context.memory')}</th>
						<th>${t('context.worldInfo')}</th>
						<th>${t('context.authorsNote')}</th>
						<th>${t('context.prompt')}</th>
						<th></th>
						<th>${t('context.total')}</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<th>${t('context.tokens')}</th>
						<td>${memoryTokens.tokens ?? 0}</td>
						<td>${memoryTokens.tokensWI ?? 0}</td>
						<td>${authorNoteTokens.tokens ?? 0}</td>
						<td>${Math.max(0, playgroundTokens - (memoryTokens.tokens ?? 0) - (memoryTokens.tokensWI ?? 0) - (authorNoteTokens.tokens ?? 0))}</td>
						<td></td>
						<td>${playgroundTokens}</td>
					</tr>
				</tbody>
			</table>
			</div>
			<${CollapsibleGroup} label=${t('context.advancedContextOrdering')}>
				<div id="context-order-desc">
					${t('context.contextOrderDesc1')}<br />
					<div id="advancedContextPlaceholders">
						<table border="1" frame="void" rules="all">
							<thead>
							<tr>
								<th></th>
								<th>${t('context.prefix')}</th>
								<th>${t('context.text')}</th>
								<th>${t('context.suffix')}</th>
							</tr>
							</thead>
							<tbody>
							<tr>
								<th>${t('context.memory')}</th>
								<td>{memPrefix}</td>
								<td>{memText}</td>
								<td>{memSuffix}</td>
							</tr>
							<tr>
								<th>${t('context.worldInfo')}</th>
								<td>{wiPrefix}</td>
								<td>{wiText}</td>
								<td>{wiSuffix}</td>
							</tr>
							<tr>
								<th>${t('context.prompt')}</th>
								<td></td>
								<td>{prompt}</td>
								<td></td>
							</tr>
							</tbody>
						</table>
					</div>
					${t('context.contextOrderDesc2')}
				</div>
				<textarea
					readOnly=${!!cancel}
					placeholder=${defaultPresets.memoryTokens.contextOrder}
					defaultValue=${memoryTokens.contextOrder}
					value=${memoryTokens.contextOrder}
					onInput=${(e: InputEvent) => handleMemoryTokensChange("contextOrder", (e.target as HTMLTextAreaElement).value)}
					class="expanded-text-area-settings"
					id="advanced-context-order-settings"/>
			</${CollapsibleGroup}>
			<textarea
				value=${contextPlayground}
				onInput=${(e: InputEvent) => setContextPlayground((e.target as HTMLTextAreaElement).value)}
				class="expanded-text-area-settings"
				id="context-area-settings" />
			<div class="hbox" style=${{ justifyContent: 'flex-end', marginTop: '8px' }}>
				<button onClick=${() => setContextPlayground(finalPromptText)}>
					${t('context.resetContext')}
				</button>
			</div>
		</${Modal}>`;
}
