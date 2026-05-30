import { html } from 'htm/react';
import { useState, useEffect, useRef } from 'react';
import { Modal } from '../Modal.js';
import { CollapsibleGroup } from '../controls/CollapsibleGroup.js';
import { getTokenCount, serverTokenCount } from '../../api/index.js';
import { API_OPENAI_COMPAT, API_LLAMA_CPP } from '../../constants.js';

export function ContextModal({ isOpen, closeModal, tokens, memoryTokens, authorNoteTokens, handleMemoryTokensChange, finalPromptText, defaultPresets, cancel, apiConfig }) {
	const { sessionStorage, endpoint, endpointAPI, endpointAPIKey, isMiyapadEndpoint, useServerTokenization } = apiConfig;
	const [contextPlayground, setContextPlayground] = useState(finalPromptText);
	const [playgroundTokens, setPlaygroundTokens] = useState(tokens);
	const playgroundRef = useRef(contextPlayground);
	useEffect(() => {
		playgroundRef.current = contextPlayground;
	}, [contextPlayground]);
	useEffect(() => {
		if (isOpen) setContextPlayground(finalPromptText);
	}, [isOpen, finalPromptText]);
	useEffect(() => {
		if (isOpen) setPlaygroundTokens(tokens);
	}, [isOpen, tokens]);
	useEffect(() => {
		const ac = new AbortController();
		const to = setTimeout(async () => {
			const content = playgroundRef.current;
			try {
				const count = await (useServerTokenization && isMiyapadEndpoint && sessionStorage?.sessionEndpoint
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
				setPlaygroundTokens(count);
			} catch (e) {
				if (e.name !== 'AbortError')
					reportError(e);
			}
		}, 500);
		ac.signal.addEventListener('abort', () => clearTimeout(to));
		return () => ac.abort();
	}, [contextPlayground, endpoint, endpointAPI, useServerTokenization]);
	return html`
		<${Modal} isOpen=${isOpen} onClose=${closeModal}
			title="Context"
			description="This is the prompt being sent to your large language model.">
			<div id="advancedContextPlaceholders">
			<table id="contextTokensTable" border="1" frame="void" rules="all">
				<thead>
					<tr>
						<th></th>
						<th>Memory</th>
						<th>World Info</th>
						<th>Author's Note</th>
						<th>Prompt</th>
						<th></th>
						<th>Total</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<th>Tokens</th>
						<td>${memoryTokens.tokens}</td>
						<td>${memoryTokens.tokensWI}</td>
						<td>${authorNoteTokens.tokens}</td>
						<td>${Math.max(0, playgroundTokens - memoryTokens.tokens - memoryTokens.tokensWI - authorNoteTokens.tokens)}</td>
						<td></td>
						<td>${playgroundTokens}</td>
					</tr>
				</tbody>
			</table>
			</div>
			<${CollapsibleGroup} label="Advanced Context Ordering">
				<div id="context-order-desc">
					You can use the following placeholders to order the context according to your needs:<br />
					<div id="advancedContextPlaceholders">
						<table border="1" frame="void" rules="all">
							<thead>
							<tr>
								<th></th>
								<th>Prefix</th>
								<th>Text</th>
								<th>Suffix</th>
							</tr>
							</thead>
							<tbody>
							<tr>
								<th>Memory</th>
								<td>{memPrefix}</td>
								<td>{memText}</td>
								<td>{memSuffix}</td>
							</tr>
							<tr>
								<th>World Info</th>
								<td>{wiPrefix}</td>
								<td>{wiText}</td>
								<td>{wiSuffix}</td>
							</tr>
							<tr>
								<th>Prompt</th>
								<td></td>
								<td>{prompt}</td>
								<td></td>
							</tr>
							</tbody>
						</table>
					</div>
					Any text that is not a placeholder will be added into the context as is.
				</div>
				<textarea
					readOnly=${!!cancel}
					placeholder=${defaultPresets.memoryTokens.contextOrder}
					defaultValue=${memoryTokens.contextOrder}
					value=${memoryTokens.contextOrder}
					onInput=${(e) => handleMemoryTokensChange("contextOrder", e.target.value)}
					class="expanded-text-area-settings"
					id="advanced-context-order-settings"/>
			</${CollapsibleGroup}>
			<textarea
				value=${contextPlayground}
				onInput=${(e) => setContextPlayground(e.target.value)}
				class="expanded-text-area-settings"
				id="context-area-settings" />
			<div class="hbox" style=${{ justifyContent: 'flex-end', marginTop: '8px' }}>
				<button onClick=${() => setContextPlayground(finalPromptText)}>
					Reset Context
				</button>
			</div>
		</${Modal}>`;
}
