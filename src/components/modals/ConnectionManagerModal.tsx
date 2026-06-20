import { html } from 'htm/react';
import { useState, useEffect, useLayoutEffect, useRef, type FormEvent, type MouseEvent } from 'react';
import { Modal } from '../Modal';
import { InputBox } from '../controls/InputBox';
import { SelectBox } from '../controls/SelectBox';
import { Checkbox } from '../controls/Checkbox';
import { SVG_Trash, SVG_ShowKey, SVG_HideKey, SVG_Regen, SVG_CheckOn, SVG_CheckOff } from '../icons/index';
import { API_LLAMA_CPP, API_KOBOLD_CPP, API_OPENAI_COMPAT, API_AI_HORDE, API_DEEPSEEK } from '../../constants';
import { getModels } from '../../api/index';

interface ConnectionManagerModalProps {
  isOpen: boolean;
  closeModal: () => void;
  connections: Record<string, ConnectionData>;
  setConnections: React.Dispatch<React.SetStateAction<Record<string, ConnectionData>>>;
  activeConnectionId: string;
}

interface GenericConnectionSettingsProps {
  connection: ConnectionData;
  updateConnection: <K extends keyof ConnectionData>(field: K, value: ConnectionData[K]) => void;
}

interface AIHordeConnectionSettingsProps {
  connection: ConnectionData;
  updateConnection: <K extends keyof ConnectionData>(field: K, value: ConnectionData[K]) => void;
}

function GenericConnectionSettings({ connection, updateConnection }: GenericConnectionSettingsProps) {
	const [showKey, setShowKey] = useState(false);
	const [isFetching, setIsFetching] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [search, setSearch] = useState("");
	const acRef = useRef<AbortController | null>(null);

	useEffect(() => {
		return () => {
			if (acRef.current) {
				acRef.current.abort();
			}
		};
	}, []);

	const fetchModels = async () => {
		setIsFetching(true);
		setError(null);
		if (acRef.current) acRef.current.abort();
		const ac = new AbortController();
		acRef.current = ac;
		try {
			const models = await getModels({
				endpoint: connection.endpoint,
				endpointAPI: connection.api,
				endpointAPIKey: connection.key,
				signal: ac.signal
			});

			if (acRef.current !== ac) return;
			if (Array.isArray(models)) {
				updateConnection('models', models);
			}
		} catch (e: unknown) {
			if (e instanceof Error && e.name === 'AbortError') return;
			console.error(e);
			if (acRef.current === ac) {
				setError(e instanceof Error ? e.message : String(e));
			}
		} finally {
			if (acRef.current === ac) {
				setIsFetching(false);
			}
		}
	};

	const filteredModels = connection.models
		? connection.models.filter((m: string) => m.toLowerCase().includes(search.toLowerCase()))
		: [];

	const iconCheck = html`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

	return html`
		<div className="connection-content-scroll">
			<${InputBox} label="Connection Name"
				value=${connection.name}
				onInput=${(e: FormEvent<HTMLInputElement>) => updateConnection('name', (e.target as HTMLInputElement).value)}
				onValueChange=${() => {}}
			/>

			<${InputBox} label="Base URL"
				value=${connection.endpoint}
				readOnly=${connection.api === API_DEEPSEEK}
				onValueChange=${(val: string) => updateConnection('endpoint', val)}
			/>

			${connection.api !== API_LLAMA_CPP && connection.api !== API_KOBOLD_CPP && html`
				<div className="hbox-flex" style=${{"flex-wrap": "unset"}}>
					<${InputBox} label="API Key" type=${showKey ? 'text' : 'password'}
						value=${connection.key}
						onValueChange=${(val: string) => updateConnection('key', val)}
					/>
					<button title=${showKey ? "Hide" : "Show"}
						className="eye-button"
						onClick=${() => setShowKey(!showKey)}>
						${!showKey ? html`<${SVG_ShowKey}/>` : html`<${SVG_HideKey}/>`}
					</button>
				</div>
			`}

			${connection.api === API_LLAMA_CPP && html`
				<${Checkbox} label="Post Sampling Probs"
					title="This returns the probabilities after applying the sampling chain. Note that disabling this will significantly reduce generation speed."
					value=${connection.postSamplingProbs ?? true}
					onValueChange=${(val: boolean) => updateConnection('postSamplingProbs', val)}
				/>
`}
${(connection.api === API_OPENAI_COMPAT || connection.api === API_DEEPSEEK) && html`
				<${Checkbox} label="Strict API"
					title="If enabled, non-standard fields won't be included in API requests."
					value=${connection.strict ?? false}
					onValueChange=${(val: boolean) => updateConnection('strict', val)}
				/>
				<${Checkbox} label="Chat Completions API"
					title="If enabled, the chat API endpoint will be used, and the prompt will be split into chat messages based on the delimiters defined in the selected instruct template."
					value=${connection.chatAPI ?? false}
					onValueChange=${(val: boolean) => updateConnection('chatAPI', val)}
				/>
			`}

			<${InputBox} label="Selected Model"
				value=${connection.model || ""}
				onInput=${(e: FormEvent<HTMLInputElement>) => updateConnection('model', (e.target as HTMLInputElement).value)}
				onValueChange=${() => {}}
			/>

			<div class="connection-models-wrapper">
				<div class="connection-models-header">
					<label style=${{'padding-left': '8px'}}>Available Models</label>
					<button className="connection-action-btn"
						style=${{padding: '0 4px', fontSize: '0.8em'}}
						onClick=${fetchModels}
						disabled=${isFetching}>
						<${SVG_Regen} style=${{width: '1em'}}/>
						${isFetching ? 'Refreshing...' : 'Refresh List'}
					</button>
				</div>

				${error && html`
					<div className="connection-error-msg">
						<b>Connection Error:</b><br/>
						${error}
					</div>
				`}

				<div className="model-search-box">
					<${InputBox}
						placeholder="Filter list..."
						value=${search}
						onInput=${(e: FormEvent<HTMLInputElement>) => setSearch((e.target as HTMLInputElement).value)}
						onValueChange=${() => {}}
					/>
				</div>

				<div className="connection-model-list">
					${(connection.models && connection.models.length > 0)
						? filteredModels.map((m: string) => html`
							<div className="connection-model-item ${connection.model === m ? 'selected' : ''}"
								onClick=${() => updateConnection('model', m)}>
								<span>${m}</span>
								${connection.model === m ? iconCheck : ''}
							</div>
						`)
						: html`<div className="connection-models-empty">
							${isFetching ? 'Fetching models...' : 'No models found. Click Refresh.'}
						</div>`}
				</div>
			</div>
		</div>
	`;
}

function AIHordeConnectionSettings({ connection, updateConnection }: AIHordeConnectionSettingsProps) {
	const [showKey, setShowKey] = useState(false);
	const [isFetching, setIsFetching] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [search, setSearch] = useState("");
	const [availableModels, setAvailableModels] = useState<AIHordeModel[]>([]);
	const acRef = useRef<AbortController | null>(null);

	useEffect(() => {
		return () => {
			if (acRef.current) {
				acRef.current.abort();
			}
		};
	}, []);

	const selectedModels = connection.model ? connection.model.split(',').map((s: string) => s.trim()).filter(Boolean) : [];

	const fetchModels = async () => {
		setIsFetching(true);
		setError(null);
		if (acRef.current) acRef.current.abort();
		const ac = new AbortController();
		acRef.current = ac;
		try {
			const res = await fetch(`https://aihorde.net/api/v2/status/models?type=text`, {
				method: 'GET',
				headers: { 'Content-Type': 'application/json' },
				signal: ac.signal,
			});

			if (!res.ok) throw new Error(`HTTP ${res.status}`);

			if (acRef.current !== ac) return;
			const modelData = (await res.json() as AIHordeModel[]).filter((model: AIHordeModel) => model.type === "text");
			modelData.sort((a: AIHordeModel, b: AIHordeModel) => b.count - a.count || a.eta - b.eta);
			setAvailableModels(modelData);
		} catch (e: unknown) {
			if (e instanceof Error && e.name === 'AbortError') return;
			console.error(e);
			if (acRef.current === ac) {
				setError(e instanceof Error ? e.message : String(e));
			}
		} finally {
			if (acRef.current === ac) {
				setIsFetching(false);
			}
		}
	};

	useEffect(() => {
		fetchModels();
	}, []);

	const toggleModel = (modelName: string) => {
		const currentSet = new Set(selectedModels);
		if (currentSet.has(modelName)) {
			currentSet.delete(modelName);
		} else {
			currentSet.add(modelName);
		}
		updateConnection('model', Array.from(currentSet).join(', '));
	};

	const filteredModels = availableModels.filter((m: AIHordeModel) => m.name.toLowerCase().includes(search.toLowerCase()));

	return html`
		<div className="connection-content-scroll">
			<${InputBox} label="Connection Name"
				value=${connection.name}
				onInput=${(e: FormEvent<HTMLInputElement>) => updateConnection('name', (e.target as HTMLInputElement).value)}
				onValueChange=${() => {}}
			/>

			<div className="hbox-flex" style=${{"flex-wrap": "unset"}}>
				<${InputBox} label="AI Horde API Key" type=${showKey ? 'text' : 'password'}
					placeholder="Enter a key (or leave empty for anonymous use)"
					value=${connection.key}
					onValueChange=${(val: string) => updateConnection('key', val)}
				/>
				<button title=${showKey ? "Hide" : "Show"}
					className="eye-button"
					onClick=${() => setShowKey(!showKey)}>
					${!showKey ? html`<${SVG_ShowKey}/>` : html`<${SVG_HideKey}/>`}
				</button>
			</div>
			<div style=${{fontSize: '0.8em', marginTop: '-4px'}}>
				<a href="https://aihorde.net/register" target="_blank" rel="noopener noreferrer">Need a Key? (Register New User)</a>
			</div>

			<${InputBox} label="Selected Models"
				placeholder="Select from the list below"
				value=${connection.model || ""}
				onInput=${(e: FormEvent<HTMLInputElement>) => updateConnection('model', (e.target as HTMLInputElement).value)}
				onValueChange=${() => {}}
				readOnly
			/>

			<div class="connection-models-wrapper">
				<div class="connection-models-header">
					<label style=${{'padding-left': '8px'}}>Available Models</label>
					<button className="connection-action-btn"
						style=${{padding: '0 4px', fontSize: '0.8em'}}
						onClick=${fetchModels}
						disabled=${isFetching}>
						<${SVG_Regen} style=${{width: '1em'}}/>
						${isFetching ? 'Refreshing...' : 'Refresh List'}
					</button>
				</div>

				${error && html`
					<div className="connection-error-msg">
						<b>Connection Error:</b><br/>
						${error}
					</div>
				`}

				<div className="model-search-box">
					<${InputBox}
						placeholder="Filter models..."
						value=${search}
						onInput=${(e: FormEvent<HTMLInputElement>) => setSearch((e.target as HTMLInputElement).value)}
						onValueChange=${() => {}}
					/>
				</div>

				<div className="connection-model-list">
					${(availableModels.length > 0)
						? filteredModels.map((m: AIHordeModel) => {
							const isSelected = selectedModels.includes(m.name);
							return html`
								<div className="connection-model-item"
									style=${{flexDirection: 'column', alignItems: 'stretch', gap: '4px'}}
									onClick=${() => toggleModel(m.name)}>

									<div style=${{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
										<span style=${{fontWeight: 'bold'}}>${m.name}</span>
										<input type="checkbox" checked=${isSelected} readOnly style=${{pointerEvents: 'none'}}/>
									</div>

									<div style=${{display: 'flex', gap: '1em', fontSize: '0.85em', opacity: 0.8}}>
										<span>ETA: ${m.eta}s</span>
										<span>Queue: ${m.queued}</span>
										<span>Workers: ${m.count}</span>
									</div>
								</div>
							`
						})
						: html`<div className="connection-models-empty">
							${isFetching ? 'Fetching models...' : 'No models found. Click Refresh.'}
						</div>`}
				</div>
			</div>
		</div>
	`;
}

export function ConnectionManagerModal({ isOpen, closeModal, connections, setConnections, activeConnectionId }: ConnectionManagerModalProps) {
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [mobileShowDetails, setMobileShowDetails] = useState(false);

	useLayoutEffect(() => {
		if (isOpen) {
			if (selectedId !== 'custom' && selectedId !== activeConnectionId) {
				setSelectedId(activeConnectionId);
			} else if (!selectedId && Object.keys(connections).length > 0) {
				setSelectedId(Object.keys(connections)[0]);
			}
			setMobileShowDetails(false);
		}
	}, [isOpen]);

	const handleNewConnection = () => {
		const newId = crypto.randomUUID();

		let counter = 1;
		let newName = `New Connection #${counter}`;
		const existingNames = (Object.values(connections) as ConnectionData[]).map(c => c.name);
		while (existingNames.includes(newName)) {
			counter++;
			newName = `New Connection #${counter}`;
		}

		const newConnection = {
			id: newId,
			name: newName,
			api: API_OPENAI_COMPAT,
			endpoint: "http://127.0.0.1:8080/v1",
			key: "",
			enabled: true,
			models: [],
			model: "",
			postSamplingProbs: true,
			strict: false,
			chatAPI: false,
		};
		setConnections((prev: Record<string, ConnectionData>) => ({ ...prev, [newId]: newConnection }));
		setSelectedId(newId);
		setMobileShowDetails(true);
	};

	const handleCloneConnection = (id: string | null) => {
		if (!id) return;
		const conn = connections[id];
		if (!conn) {
			return;
		}
		const newId = crypto.randomUUID();
		const newConnection = structuredClone(conn);
		newConnection.id = newId;
		newConnection.name = `${conn.name} (Copy)`;
		setConnections((prev: Record<string, ConnectionData>) => ({ ...prev, [newId]: newConnection }));
		setSelectedId(newId);
		setMobileShowDetails(true);
	};

	const handleDeleteConnection = (id: string | null) => {
		if (!id || id === activeConnectionId) {
			return;
		}
		if (!confirm("Are you sure you want to delete this connection?")) {
			return;
		}
		setConnections((prev: Record<string, ConnectionData>) => {
			const next = { ...prev };
			delete next[id];
			return next;
		});
		if (selectedId === id) {
			setSelectedId(null);
			setMobileShowDetails(false);
		}
	};

	const handleUpdateConnection = <K extends keyof ConnectionData>(id: string | null, field: K, value: ConnectionData[K]) => {
		if (!id) return;
		setConnections((prev: Record<string, ConnectionData>) => {
			if (!(id in prev)) return prev;
			return {
				...prev,
				[id]: { ...prev[id], [field]: value }
			};
		});
	};

	const updateCurrentConnection = <K extends keyof ConnectionData>(field: K, value: ConnectionData[K]) => {
		if (!selectedId) {
			return;
		}
		handleUpdateConnection(selectedId, field, value);
	};

	const updateCurrentConnectionType = (val: number) => {
		if (!selectedId) {
			return;
		}

		const updates: Record<string, unknown> = {
			api: val,
			models: [],
			model: "",
			key: "",
			endpoint: "",
		};

		if (val === API_AI_HORDE) {
			updates.endpoint = "https://aihorde.net/api";
		} else if (val === API_LLAMA_CPP) {
			updates.endpoint = "http://127.0.0.1:8080";
		} else if (val === API_KOBOLD_CPP) {
			updates.endpoint = "http://127.0.0.1:5001/api";
		} else if (val === API_DEEPSEEK) {
			updates.endpoint = "https://api.deepseek.com";
		}

		setConnections((prev: Record<string, ConnectionData>) => {
			if (!(selectedId in prev)) return prev;
			return {
				...prev,
				[selectedId]: { ...prev[selectedId], ...updates }
			};
		});
	}

	const currentConn = selectedId ? connections[selectedId] : undefined;
	const isActiveConnection = selectedId === activeConnectionId;

	const iconBack = html`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>`;

	return html`
		<${Modal} isOpen=${isOpen} onClose=${closeModal}
			title="Connections"
			description="Manage your AI connection presets.">

			<div className="connection-modal-layout ${mobileShowDetails ? 'mobile-show-details' : ''}">
				<div className="connection-sidebar">
					<div className="connection-sidebar-header">
						<span>Your connections</span>
						<button onClick=${handleNewConnection} title="Add New">+ New</button>
					</div>
					<div className="connection-list">
						${(Object.entries(connections) as [string, ConnectionData][]).map(([id, conn]: [string, ConnectionData]) => html`
							<div key=${id}
								className="connection-item ${selectedId === id ? 'selected' : ''} ${conn.enabled ? 'enabled' : ''}"
								onClick=${() => {
									setSelectedId(id);
									setMobileShowDetails(true);
								}}>
								<div className="connection-item-details">
									<div className="connection-item-name">${conn.name}</div>
									<div className="connection-item-type">
										${conn.api === API_LLAMA_CPP ? "llama.cpp" :
  conn.api === API_KOBOLD_CPP ? "KoboldCpp" :
  conn.api === API_AI_HORDE ? "AI Horde" :
  conn.api === API_DEEPSEEK ? "DeepSeek" : "OpenAI"}
									</div>
								</div>
							</div>
						`)}
					</div>
				</div>

				<div className="connection-details">
					${currentConn ? html`
						<div className="connection-header">
							<div className="connection-header-title">
								<div className="connection-back-btn" onClick=${() => setMobileShowDetails(false)}>
									${iconBack}
								</div>
								${currentConn.name}
							</div>
							<div className="connection-actions">
								<div className="connection-action-btn"
									style=${isActiveConnection ? { opacity: '0.5', cursor: 'not-allowed' } : {}}
									title=${isActiveConnection ? "Cannot disable the currently active connection" : "Toggle status"}
									onClick=${() => {
										if (isActiveConnection) return;
										handleUpdateConnection(selectedId, 'enabled', !currentConn.enabled);
									}}>
									${currentConn.enabled ? html`<${SVG_CheckOn}/>` : html`<${SVG_CheckOff}/>`}
									<span style=${{fontSize:'0.9em'}}>
										${currentConn.enabled ? "Enabled" : "Disabled"}
									</span>
								</div>

								<button className="connection-action-btn" onClick=${() => handleCloneConnection(selectedId)} title="Clone">
									<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg> Clone
								</button>

								<button className="connection-action-btn"
									style=${isActiveConnection ? { opacity: '0.5', cursor: 'not-allowed' } : {}}
									title=${isActiveConnection ? "Cannot delete the currently active connection" : "Delete"}
									onClick=${() => handleDeleteConnection(selectedId)}>
									<${SVG_Trash}/> Delete
								</button>
							</div>
						</div>

						<div style=${{padding: "12px 16px 0 16px"}}>
							<${SelectBox}
								label="API Type"
								value=${currentConn.api}
								onValueChange=${updateCurrentConnectionType}
options=${[
	{ name: 'OpenAI Compatible', value: API_OPENAI_COMPAT },
	{ name: 'KoboldCpp', value: API_KOBOLD_CPP },
	{ name: 'llama.cpp', value: API_LLAMA_CPP },
	{ name: 'AI Horde', value: API_AI_HORDE },
	{ name: 'DeepSeek', value: API_DEEPSEEK },
]}/>
						</div>

						${currentConn.api === API_AI_HORDE
							? html`<${AIHordeConnectionSettings}
									key=${currentConn.id}
									connection=${currentConn}
									updateConnection=${updateCurrentConnection}
								/>`
							: html`<${GenericConnectionSettings}
									key=${currentConn.id}
									connection=${currentConn}
									updateConnection=${updateCurrentConnection}
								/>`
						}
					` : html`
						<div className="connection-models-empty">
							Select a connection to edit or create a new one.
						</div>
					`}
				</div>
			</div>
		</${Modal}>
	`;
}
