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
	memoryTokenCount: number;
	worldInfoTokenCount: number;
	authorNoteTokenCount: number;
	handleMemoryTokensChange: <K extends keyof MemoryTokensData>(key: K, value: MemoryTokensData[K]) => void;
	finalPromptText: string;
	/** The prompt as it would be sent, with the prompt hooks run, chat conversion included. */
	previewWithPlugins: () => Promise<string>;
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

export function ContextModal({ isOpen, closeModal, tokens, memoryTokens, memoryTokenCount, worldInfoTokenCount, authorNoteTokenCount, handleMemoryTokensChange, finalPromptText, previewWithPlugins, defaultPresets, cancel, apiConfig }: ContextModalProps) {
	const t = useT();
	const { sessionStorage, endpoint, endpointAPI, endpointAPIKey, isMiyapadEndpoint, useServerTokenization } = apiConfig;
	const [contextPlayground, setContextPlayground] = useState(finalPromptText);
	const [playgroundTokens, setPlaygroundTokens] = useState(tokens);
	const [previewing, setPreviewing] = useState(false);
	const prevIsOpen = useRef(isOpen);
	/** The text the preview produced, so Reset returns to it instead of silently undoing it. */
	const previewed = useRef<string | null>(null);
	/** Set when the user types, so a preview that lands later doesn't overwrite what they wrote. */
	const edited = useRef(false);
	/** Bumped on every open and every close, so a preview that lands later is dropped. */
	const openId = useRef(0);
	useEffect(() => {
		if (isOpen && !prevIsOpen.current) {
			setContextPlayground(finalPromptText);
			setPlaygroundTokens(tokens);
		}
		prevIsOpen.current = isOpen;
	}, [isOpen, finalPromptText, tokens]);
	useEffect(() => {
		if (!isOpen) return;
		const id = ++openId.current;
		edited.current = false;
		previewed.current = null;
		setPreviewing(true);
		previewWithPlugins().then(
			text => {
				if (openId.current !== id || edited.current) return;
				previewed.current = text;
				setContextPlayground(text);
				setPreviewing(false);
			},
			e => {
				if (openId.current !== id) return;
				console.error('[plugins] The prompt hook preview failed:', e);
				setPreviewing(false);
			}
		);
		return () => { openId.current++; };
	}, [isOpen]);
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
						<td>${memoryTokenCount}</td>
						<td>${worldInfoTokenCount}</td>
						<td>${authorNoteTokenCount}</td>
						<td>${Math.max(0, playgroundTokens - memoryTokenCount - worldInfoTokenCount - authorNoteTokenCount)}</td>
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
					value=${memoryTokens.contextOrder}
					onInput=${(e: InputEvent) => handleMemoryTokensChange("contextOrder", (e.target as HTMLTextAreaElement).value)}
					className="expanded-text-area-settings"
					id="advanced-context-order-settings"/>
			</${CollapsibleGroup}>
			<textarea
				value=${contextPlayground}
				onInput=${(e: InputEvent) => { edited.current = true; setContextPlayground((e.target as HTMLTextAreaElement).value); }}
				className="expanded-text-area-settings"
				id="context-area-settings" />
			<div className="hbox" style=${{ justifyContent: 'flex-end', marginTop: '8px' }}>
				<div style=${{ display: 'flex', alignItems: 'center', gap: '8px' }}>
					${previewing && html`<small className="context-previewing">${t('context.previewing')}</small>`}
					<button onClick=${() => setContextPlayground(previewed.current ?? finalPromptText)}>
						${t('context.resetContext')}
					</button>
				</div>
			</div>
		</${Modal}>`;
}
