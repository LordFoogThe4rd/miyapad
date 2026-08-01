import { html } from 'htm/react';
import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useSettings } from '../contexts/SettingsContext';
import { useGeneration } from '../contexts/GenerationContext';
import { useT } from '../i18n';
import { API_LLAMA_CPP, API_KOBOLD_CPP, API_OPENAI_COMPAT, API_AI_HORDE, API_DEEPSEEK } from '../constants';
import { InputBox } from './controls/InputBox';
import { SelectBox } from './controls/SelectBox';
import { Checkbox } from './controls/Checkbox';
import { InputSlider } from './controls/InputSlider';
import { CollapsibleGroup } from './controls/CollapsibleGroup';
import {
  SVG_Settings, SVG_ShowKey, SVG_HideKey, SVG_SysPrompt, SVG_instTemplate,
  SVG_ChatMode, SVG_CompletionMode, SVG_Regen, SVG_Undo, SVG_Redo, SVG_MobileSidebar
} from './icons/index';
import { useTokenCounters } from '../hooks/useTokenCounters';
import { useInsertTemplate } from '../hooks/useInsertTemplate';
import { useGenerationLogic } from '../hooks/useGenerationLogic';
import type { SidebarProps } from '../types/components';

export function Sidebar({ sidebarRef, toggleModal, currentThemeName, setCurrentThemeName, allThemes, showAPIKey, setShowAPIKey }: SidebarProps) {
	const {
		endpoint, setEndpoint, endpointAPI, setEndpointAPI, endpointAPIKey, setEndpointAPIKey,
		endpointModel, setEndpointModel, maxPredictTokens, setMaxPredictTokens, temperature, setTemperature,
		dynaTempRange, setDynaTempRange, dynaTempExp, setDynaTempExp, repeatPenalty, setRepeatPenalty,
		repeatLastN, setRepeatLastN, penalizeNl, setPenalizeNl, presencePenalty, setPresencePenalty,
		frequencyPenalty, setFrequencyPenalty, topK, setTopK, topP, setTopP, typicalP, setTypicalP,
		minP, setMinP, tfsZ, setTfsZ, mirostat, setMirostat, mirostatTau, setMirostatTau,
		mirostatEta, setMirostatEta, xtcThreshold, setXtcThreshold, xtcProbability, setXtcProbability,
		dryMultiplier, setDryMultiplier, dryBase, setDryBase, dryAllowedLength, setDryAllowedLength,
		dryPenaltyRange, setDryPenaltyRange, drySequenceBreakers, setDrySequenceBreakers,
		bannedTokens, setBannedTokens, ignoreEos, setIgnoreEos, openaiPresets, setOpenaiPresets,
		stoppingStrings, setStoppingStrings, useBasicStoppingMode, setUseBasicStoppingMode,
		basicStoppingModeType, setBasicStoppingModeType, enabledSamplers, setEnabledSamplers,
		useChatAPI, setUseChatAPI, useTokenStreaming, setUseTokenStreaming, disableLogprobs, setDisableLogprobs,
		postSamplingProbs, setPostSamplingProbs, templates, selectedTemplate, setSelectedTemplate,
		isMiyapadEndpoint, sessionStorage, chatMode, setChatMode, seed, setSeed, contextLength, setContextLength,
		memoryTokens, authorNoteTokens, authorNoteDepth, templateList, tokenHighlightMode,
		connections, setConnections, selectedConnectionId, setSelectedConnectionId,
		stoppingStringsError, drySequenceBreakersError, bannedTokensError,
		samplerPresets, setSamplerPresets, selectedSamplerPresetId, setSelectedSamplerPresetId,
		grammar, setGrammar, logitBias, setLogitBias
	} = useSettings();

	const {
		cancel, openaiModels, hordeQueuePos, hordeProcessing, tokens, tokensPerSec, undoStack, redoStack,
		undoHovered, setUndoHovered, lastError, sessionEndpointConnecting, predictStartTokens,
		modalState, promptEditorView,
		rejectedAPIKey
	} = useGeneration();

	const { predict, undo, redo, undoAndPredict } = useGenerationLogic();
	const { handleauthorNoteTokensChange, handleMemoryTokensChange } = useTokenCounters();
	const t = useT();

	const toggleSampler = (name: string) => (v: boolean) =>
		setEnabledSamplers(v
			? (es: string[]) => es.includes(name) ? es : [...es, name]
			: (es: string[]) => es.filter((s: string) => s !== name));

	const [extensionLoaded, setExtensionLoaded] = useState(false);
	const [configData, setConfigData] = useState<Record<string, unknown> | null>(null);
	const [zstdLevel, setZstdLevel] = useState(3);
	const [zstdRatio, setZstdRatio] = useState(100);
	const [showCustomMaintenance, setShowCustomMaintenance] = useState(false);
	const [maintenanceDuration, setMaintenanceDuration] = useState('');
	const [maintenanceDbLoad, setMaintenanceDbLoad] = useState(0.5);
	const [maintDuration, setMaintDuration] = useState(5);
	const [maintDbLoad, setMaintDbLoad] = useState(0.5);
	const [maintMode, setMaintMode] = useState('shutdown');
	const [maintInterval, setMaintInterval] = useState(60);
	const [walEnabled, setWalEnabled] = useState(false);

	const maintConfigRef = useRef({ duration: 5, dbLoad: 0.5, mode: 'shutdown', interval: 60, walEnabled: false });
	const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const saveMaintConfigToServer = (update: Record<string, unknown>) => {
		Object.assign(maintConfigRef.current, update);
		if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
		saveTimerRef.current = setTimeout(async () => {
			try {
				const res = await fetch('/maintenance_config', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(maintConfigRef.current)
				});
				if (!res.ok) console.error('Failed to save maintenance config:', await res.text());
			} catch (e: unknown) {
				console.error('Failed to save maintenance config:', e);
			}
		}, 500);
	};

	useEffect(() => {
		if (!isMiyapadEndpoint) return;
		const checkVersion = async () => {
			try {
				const res = await fetch('/version');
				const data = await res.json();
				if (data.features?.zstd_compression) {
					setExtensionLoaded(true);
					const configRes = await fetch('/zstd_get_configs');
					const configJson = await configRes.json();
					if (configJson.ok) {
						setConfigData(Object.keys(configJson.configs ?? {}).length > 0 ? configJson.configs : null);
					}
					const maintRes = await fetch('/maintenance_config');
					if (maintRes.ok) {
						const maintJson = await maintRes.json();
						setMaintDuration(maintJson.duration);
						setMaintDbLoad(maintJson.dbLoad);
						setMaintMode(maintJson.mode);
						setMaintInterval(maintJson.interval);
						setWalEnabled(maintJson.walEnabled);
						maintConfigRef.current = { ...maintJson };
					}
				}
			} catch (e: unknown) {}
		};
		checkVersion();
	}, [isMiyapadEndpoint]);

	function switchEndpointAPI(value: number) {
		let url;
		try {
			url = new URL(endpoint);
		} catch {
			return;
		}
		switch (value) {
			case API_LLAMA_CPP:
				setUseChatAPI(false);
				if (url.protocol != 'http:' && url.protocol != 'https:')
					url.protocol = "http:";
				url.port = "8080";
				break;
			case API_KOBOLD_CPP:
				setUseChatAPI(false);
				if (url.protocol != 'http:' && url.protocol != 'https:')
					url.protocol = "http:";
				url.port = "5001";
				break;
			case API_DEEPSEEK:
				url = new URL("https://api.deepseek.com");
				url.pathname = "";
				break;
			case API_OPENAI_COMPAT:
				if (url.protocol != 'http:' && url.protocol != 'https:')
					url.protocol = "http:";
				break;
			case API_AI_HORDE:
				setUseChatAPI(false);
				break;
		}
		setEndpoint(url.toString());
		setEndpointAPI(value);
	}

	const { insertTemplate } = useInsertTemplate();

	const handleApplyConnection = (conn: ConnectionData) => {
		setEndpointAPI(conn.api);
		if (conn.api !== API_AI_HORDE) {
			setEndpoint(conn.endpoint);
		}
		setEndpointAPIKey(conn.key || "");
		setEndpointModel(conn.model || "");
		if (conn.api === API_LLAMA_CPP) {
			setPostSamplingProbs(conn.postSamplingProbs ?? true);
		}
		if (conn.api === API_OPENAI_COMPAT || conn.api === API_DEEPSEEK) {
			setOpenaiPresets(conn.strict ?? false);
			setUseChatAPI(conn.chatAPI ?? false);
		}
	};

	useEffect(() => {
		if (selectedConnectionId !== 'custom' && connections[selectedConnectionId]) {
			handleApplyConnection(connections[selectedConnectionId]);
		}
	}, [selectedConnectionId]);

	const handleApplySamplerPreset = (preset: SamplerPresetData) => {
		setSeed(preset.seed);
		setMaxPredictTokens(preset.maxPredictTokens);
		setTemperature(preset.temperature);
		setDynaTempRange(preset.dynaTempRange);
		setDynaTempExp(preset.dynaTempExp);
		setRepeatPenalty(preset.repeatPenalty);
		setRepeatLastN(preset.repeatLastN);
		setPenalizeNl(preset.penalizeNl);
		setPresencePenalty(preset.presencePenalty);
		setFrequencyPenalty(preset.frequencyPenalty);
		setTopK(preset.topK);
		setTopP(preset.topP);
		setTypicalP(preset.typicalP);
		setMinP(preset.minP);
		setTfsZ(preset.tfsZ);
		setMirostat(preset.mirostat);
		setMirostatTau(preset.mirostatTau);
		setMirostatEta(preset.mirostatEta);
		setXtcThreshold(preset.xtcThreshold);
		setXtcProbability(preset.xtcProbability);
		setDryMultiplier(preset.dryMultiplier);
		setDryBase(preset.dryBase);
		setDryAllowedLength(preset.dryAllowedLength);
		setDryPenaltyRange(preset.dryPenaltyRange);
		setDrySequenceBreakers(preset.drySequenceBreakers);
		setBannedTokens(preset.bannedTokens);
		setIgnoreEos(preset.ignoreEos);
		setEnabledSamplers(preset.enabledSamplers);
		setGrammar(preset.grammar);
	};

	useEffect(() => {
		if (selectedSamplerPresetId === 'custom') return;
		const preset = samplerPresets[selectedSamplerPresetId];
		if (!preset || !preset.enabled) {
			setSelectedSamplerPresetId('custom');
			return;
		}
		handleApplySamplerPreset(preset);
	}, [selectedSamplerPresetId, samplerPresets]);

	const handleSaveCurrentPreset = () => {
		let counter = 1;
		let newName = t('samplerPreset.newPresetPrefix') + counter;
		const existingNames = (Object.values(samplerPresets) as SamplerPresetData[]).map(p => p.name);
		while (existingNames.includes(newName)) {
			counter++;
			newName = t('samplerPreset.newPresetPrefix') + counter;
		}
		const newId = crypto.randomUUID();
		const newPreset: SamplerPresetData = {
			id: newId,
			name: newName,
			enabled: true,
			seed,
			maxPredictTokens,
			temperature,
			dynaTempRange,
			dynaTempExp,
			repeatPenalty,
			repeatLastN,
			penalizeNl,
			presencePenalty,
			frequencyPenalty,
			topK,
			topP,
			typicalP,
			minP,
			tfsZ,
			mirostat,
			mirostatTau,
			mirostatEta,
			xtcThreshold,
			xtcProbability,
			dryMultiplier,
			dryBase,
			dryAllowedLength,
			dryPenaltyRange,
			drySequenceBreakers,
			bannedTokens,
			ignoreEos,
			enabledSamplers,
			grammar,
		};
		setSamplerPresets(prev => ({ ...prev, [newId]: newPreset }));
		setSelectedSamplerPresetId(newId);
	};

	function isMixedContent() {
		const isHttps = window.location.protocol === 'https:';
		let url;
		try {
			url = new URL(endpointAPI !== API_AI_HORDE ? endpoint : 'https://aihorde.net/api');
		} catch {
			return false;
		}
		return isHttps && (url.protocol !== 'https:' && url.protocol !== 'wss:');
	}

	return html`
		<div id="sidebar" ref=${sidebarRef} style=${{ 'max-height': ''}}>
			<div className="buttons instructTemplateSidebar theme-selector">
				<${SelectBox}
					label=${t('sidebar.theme')}
					value=${currentThemeName}
					onValueChange=${setCurrentThemeName}
					options=${() => [
						{ name: t('sidebar.serifLight'), value: 'Serif Light' },
						...Object.keys(allThemes).sort((a, b) => (allThemes[a]?.order ?? 0) - (allThemes[b]?.order ?? 0)).map(name => ({ name, value: name }))
					]}/>
				<button
					title=${t('sidebar.manageThemes')}
					disabled=${!!cancel}
					className="symbol-button"
					onClick=${() => toggleModal("themes")}>
					<${SVG_Settings} style=${{ 'width':'.95em','transform':'translate(-50%, -45%)' }}/>
				</button>
			</div>
			<div className="horz-separator"/>
			<button
				disabled=${!!cancel}
				onClick=${() => toggleModal("sessions")}>
				${t('sidebar.manageSessions')}
			</button>
			<${CollapsibleGroup} label=${t('sidebar.parameters')} expanded>
				<div className="buttons instructTemplateSidebar">
					<${SelectBox}
						label=${t('sidebar.connectionPreset')}
						value=${selectedConnectionId}
						options=${() => [
							{ name: t('sidebar.customInlineEdit'), value: 'custom' },
							...(Object.entries(connections) as [string, ConnectionData][])
							   .filter(([_, c]) => c.enabled)
							   .map(([id, c]) => ({ name: c.name, value: id }))
						]}
						onValueChange=${(val: string) => {
							if (val !== 'custom' && connections[val]) {
								handleApplyConnection(connections[val]);
							}
							setSelectedConnectionId(val);
						}}
					/>
					<button
						onClick=${() => toggleModal("connections")}
						title=${t('sidebar.manageConnections')}
						className="symbol-button"
						style=${{ padding: 0 }}>
						<${SVG_Settings} style=${{ 'width':'.95em','transform':'translate(-50%, -45%)' }}/>
					</button>
				</div>
				${(selectedConnectionId === 'custom') && html`
				<${InputBox} label=${t('sidebar.server')}
					className=${isMixedContent() ? 'mixed-content' : ''}
					tooltip=${isMixedContent() ? t('sidebar.mixedContentWarning') : ''}
					readOnly=${!!cancel || endpointAPI == API_AI_HORDE || endpointAPI == API_DEEPSEEK}
					value=${endpointAPI == API_AI_HORDE ? 'https://aihorde.net/api' : endpointAPI == API_DEEPSEEK ? 'https://api.deepseek.com' : endpoint}
					onValueChange=${setEndpoint}/>
				<${SelectBox}
					label=${t('sidebar.api')}
					disabled=${!!cancel}
					value=${endpointAPI}
					onValueChange=${switchEndpointAPI}
					options=${[
						{ name: t('sidebar.api.llamaCpp'), value: API_LLAMA_CPP },
						{ name: t('sidebar.api.koboldCpp'), value: API_KOBOLD_CPP },
						{ name: t('sidebar.api.openaiCompatible'), value: API_OPENAI_COMPAT },
						{ name: t('sidebar.api.aiHorde'), value: API_AI_HORDE },
						{ name: t('sidebar.api.deepseek'), value: API_DEEPSEEK },
					]}/>
				${(endpointAPI != API_AI_HORDE) && html`
					<div className="hbox-flex" style=${{"flex-wrap": "unset"}}>
						<${InputBox} label=${t('sidebar.apiKey')} type=${!showAPIKey ? "password" : "text"}
							className=${rejectedAPIKey ? 'rejected' : ''}
							tooltip=${rejectedAPIKey ? t('sidebar.apiKeyRejected') : ''}
							tooltipSize="short"
							readOnly=${!!cancel}
							value=${endpointAPIKey}
							onValueChange=${setEndpointAPIKey}/>
						<button title=${!showAPIKey ? t('sidebar.showApiKey') : t('sidebar.hideApiKey')}
							className="eye-button"
							disabled=${!!cancel}
							onClick=${() => setShowAPIKey(!showAPIKey)}>
							${!showAPIKey ? html`<${SVG_ShowKey}/>` : html`<${SVG_HideKey}/>`}
						</button>
					</div>`}
			${(endpointAPI == API_OPENAI_COMPAT || endpointAPI == API_DEEPSEEK) && html`
				<${InputBox} label=${t('sidebar.model')}
					datalist=${openaiModels.map((model: string | { id: string }) => (typeof model === 'string' ? model : model.id))}
					readOnly=${!!cancel}
					value=${endpointModel}
					onValueChange=${setEndpointModel}/>`}
				${endpointAPI == API_AI_HORDE && html`
					<div className="vbox" style=${{gap: '4px'}}>
						<${InputBox} label=${t('sidebar.selectedModels')}
							readOnly=${true}
							value=${endpointModel || t('sidebar.any')}
							placeholder=${t('sidebar.any')}
						/>
						<button onClick=${() => toggleModal("horde")}>${t('sidebar.configureAiHorde')}</button>
					</div>`}
				${endpointAPI != API_AI_HORDE && html`
					${endpointAPI == API_LLAMA_CPP && html`
						<${Checkbox} label=${t('sidebar.postSamplingProbs')}
							title=${t('sidebar.postSamplingProbsTooltip')}
							disabled=${!!cancel} value=${postSamplingProbs} onValueChange=${setPostSamplingProbs}/>`}
					${(endpointAPI == API_OPENAI_COMPAT || endpointAPI == API_DEEPSEEK) && html`
						<${Checkbox} label=${t('sidebar.strictApi')}
							title=${t('sidebar.strictApiTooltip')}
							disabled=${!!cancel} value=${openaiPresets} onValueChange=${setOpenaiPresets}/>
						<${Checkbox} label=${t('sidebar.chatCompletionsApi')}
							title=${t('sidebar.chatCompletionsApiTooltip')}
							disabled=${!!cancel} value=${useChatAPI} onValueChange=${setUseChatAPI}/>`}
				`}
			`}
				${endpointAPI != API_AI_HORDE && html`
					<${Checkbox} label=${t('sidebar.tokenStreaming')}
						disabled=${!!cancel} value=${useTokenStreaming} onValueChange=${setUseTokenStreaming}/>
					<${Checkbox} label=${t('sidebar.disableLogprobs')}
						title=${t('sidebar.disableLogprobsTooltip')}
						disabled=${!!cancel} value=${disableLogprobs} onValueChange=${setDisableLogprobs}/>
				`}
				<div className="buttons instructTemplateSidebar">
					<${SelectBox}
						label=${t('sidebar.instructTemplate')}
						template=${true}
						disabled=${!!cancel}
						value=${selectedTemplate}
						onValueChange=${setSelectedTemplate}
						options=${templateList}/>
					<button
						title=${t('sidebar.editInstructTemplates')}
						disabled=${!!cancel}
						className="symbol-button"
						onClick=${() => toggleModal("instructTemplates")}>
						<${SVG_Settings} style=${{ 'width':'.95em','transform':'translate(-50%, -45%)' }}/>
					</button>
					<button
						title=${t('sidebar.insertSystemPromptTemplate')}
						disabled=${!!cancel}
						className="symbol-button"
						onClick=${() => insertTemplate("sys")}>
						<${SVG_SysPrompt} style=${{ 'width':'.9em' }}/>
					</button>
					<button
						title=${t('sidebar.insertInstructTemplate')}
						disabled=${!!cancel}
						className="symbol-button"
						onClick=${() => insertTemplate("inst")}>
						<${SVG_instTemplate} style=${{ 'height':'1.05em','transform':'translate(-50%, -60%)' }}/>
					</button>
					<button
						title=${chatMode ? t('sidebar.toggleChatModeOff') : t('sidebar.toggleChatModeOn')}
						disabled=${!!cancel || useChatAPI}
						className="symbol-button"
						onClick=${() => setChatMode((prevState: boolean) => !prevState)}>
						${ (chatMode || useChatAPI) ? 
							html`<${SVG_ChatMode} style=${{ 'width':'.9em' }} />` :
							html`<${SVG_CompletionMode} style=${{ 'width':'1.05em' }} />`
						}
					</button>
				</div>
				<${InputBox} label=${t('sidebar.seed')} type="text" inputmode="numeric"
					readOnly=${!!cancel} value=${seed} onValueChange=${setSeed}/>
				<${InputBox} tooltip=${t('sidebar.maxContextLengthTooltip')} label=${t('sidebar.maxContextLength')} type="text" inputmode="numeric"
					readOnly=${!!cancel} value=${contextLength} onValueChange=${setContextLength}/>
				<${InputBox} label=${endpointAPI === API_AI_HORDE ? t('sidebar.maxPredictTokensLimited512') : endpointAPI !== API_LLAMA_CPP ? t('sidebar.maxPredictTokensLimited1024') : t('sidebar.maxPredictTokensInfinite')} type="text" inputmode="numeric"
					readOnly=${!!cancel} value=${maxPredictTokens} onValueChange=${setMaxPredictTokens}/>
				<div className="hbox-flex" style=${{ "flex-wrap": "unset", "align-items": "flex-end" }}>
					<div style=${{ "flex": "1" }}>
						${useBasicStoppingMode ? html`
							<${SelectBox}
								label=${t('sidebar.stoppingMode')}
								disabled=${!!cancel}
								value=${basicStoppingModeType}
								onValueChange=${setBasicStoppingModeType}
								options=${[
									{ name: t('sidebar.stoppingMode.maxTokens'), value: 'max_tokens' },
									{ name: t('sidebar.stoppingMode.newLine'), value: 'new_line' },
									{ name: t('sidebar.stoppingMode.fill'), value: 'fill_suffix' },
								]}/>
						` : html`
							<${InputBox} label=${t('sidebar.stoppingStrings')} type="text" pattern="^\\[.*?\\]$"
								className=${stoppingStringsError ? 'rejected' : ''}
								tooltip=${stoppingStringsError ? stoppingStringsError : ''}
								readOnly=${!!cancel}
								value=${stoppingStrings}
								onValueChange=${setStoppingStrings}/>
						`}
					</div>
					<button
						title=${useBasicStoppingMode ? t('sidebar.switchToAdvancedMode') : t('sidebar.switchToBasicMode')}
						disabled=${!!cancel}
						onClick=${() => setUseBasicStoppingMode((prev: boolean) => !prev)}>
						${useBasicStoppingMode ? "A" : "B"}
					</button>
				</div>
			</${CollapsibleGroup} >
			<${CollapsibleGroup} label=${t('sidebar.sampling')} expanded menu=${(closeMenu: () => void) => html`
					<div className="buttons instructTemplateSidebar" style=${{marginBottom: '4px'}}>
						<${SelectBox}
							label=${t('sidebar.samplerPreset')}
							value=${selectedSamplerPresetId}
							options=${() => {
								const result = [{ name: t('sidebar.customInlineEdit'), value: 'custom' }];
								for (const [id, p] of Object.entries(samplerPresets) as [string, SamplerPresetData][]) {
									if (p.enabled) result.push({ name: p.name, value: id });
								}
								return result;
							}}
							onValueChange=${(val: string) => {
								if (val !== 'custom' && samplerPresets[val])
									handleApplySamplerPreset(samplerPresets[val]);
								setSelectedSamplerPresetId(val);
							}}
						/>
						<button onClick=${handleSaveCurrentPreset}
							title=${t('sidebar.saveCurrentPreset')}
							className="symbol-button"
							style=${{width: 'auto', padding: '0 6px'}}>${t('sidebar.save')}</button>
						<button onClick=${() => { closeMenu(); toggleModal("samplerPresets"); }}
							title=${t('sidebar.manageSamplerPresets')} className="symbol-button" style=${{ padding: 0 }}>
							<${SVG_Settings} style=${{ 'width':'.95em','transform':'translate(-50%, -45%)' }}/>
						</button>
						<div className="horz-separator"/>
					</div>
					<${Checkbox} label=${t('sidebar.temperature')}
						disabled=${!!cancel}
						value=${enabledSamplers.includes('temperature')}
						onValueChange=${toggleSampler('temperature')}/>
					<${Checkbox} label=${t('sidebar.dynamicTemperature')}
						disabled=${!!cancel}
						value=${enabledSamplers.includes('dynatemp')}
						onValueChange=${toggleSampler('dynatemp')}/>
					<${Checkbox} label=${t('sidebar.repetitionPenalty')}
						disabled=${!!cancel}
						value=${enabledSamplers.includes('rep_pen')}
						onValueChange=${toggleSampler('rep_pen')}/>
					<${Checkbox} label=${t('sidebar.presencePenalty')}
						disabled=${!!cancel}
						value=${enabledSamplers.includes('pres_pen')}
						onValueChange=${toggleSampler('pres_pen')}/>
					<${Checkbox} label=${t('sidebar.frequencyPenalty')}
						disabled=${!!cancel}
						value=${enabledSamplers.includes('freq_pen')}
						onValueChange=${toggleSampler('freq_pen')}/>
					<${Checkbox} label=${t('sidebar.mirostat')}
						disabled=${!!cancel}
						value=${enabledSamplers.includes('mirostat')}
						onValueChange=${toggleSampler('mirostat')}/>
					<${Checkbox} label=${t('sidebar.xtc')}
						disabled=${!!cancel}
						value=${enabledSamplers.includes('xtc')}
						onValueChange=${toggleSampler('xtc')}/>
					<${Checkbox} label=${t('sidebar.dry')}
						disabled=${!!cancel}
						value=${enabledSamplers.includes('dry')}
						onValueChange=${toggleSampler('dry')}/>
					<${Checkbox} label=${t('sidebar.topK')}
						disabled=${!!cancel}
						value=${enabledSamplers.includes('top_k')}
						onValueChange=${toggleSampler('top_k')}/>
					<${Checkbox} label=${t('sidebar.topP')}
						disabled=${!!cancel}
						value=${enabledSamplers.includes('top_p')}
						onValueChange=${toggleSampler('top_p')}/>
					<${Checkbox} label=${t('sidebar.minP')}
						disabled=${!!cancel}
						value=${enabledSamplers.includes('min_p')}
						onValueChange=${toggleSampler('min_p')}/>
					<${Checkbox} label=${t('sidebar.typicalP')}
						disabled=${!!cancel}
						value=${enabledSamplers.includes('typical_p')}
						onValueChange=${toggleSampler('typical_p')}/>
					<${Checkbox} label=${t('sidebar.tfsZ')}
						disabled=${!!cancel}
						value=${enabledSamplers.includes('tfs_z')}
						onValueChange=${toggleSampler('tfs_z')}/>
					<${Checkbox} label=${t('sidebar.bannedStrings')}
						disabled=${!!cancel}
						value=${enabledSamplers.includes('ban_tokens')}
						onValueChange=${toggleSampler('ban_tokens')}/>
				`}>
				<${InputSlider} label=${t('sidebar.temperature')} type="number" step="0.01" max="5"
					hidden=${!enabledSamplers.includes('temperature')}
					readOnly=${!!cancel} value=${temperature} onValueChange=${setTemperature}/>
				${(!openaiPresets || (endpointAPI != API_OPENAI_COMPAT && endpointAPI != API_DEEPSEEK)) && html`
					${enabledSamplers.includes('dynatemp') && html`
						<div className="hbox">
							<${InputSlider} label=${t('sidebar.dynaTempRange')} type="number" step="0.01"
								readOnly=${!!cancel} value=${dynaTempRange} onValueChange=${setDynaTempRange}/>
							${(endpointAPI != API_KOBOLD_CPP && endpointAPI != API_AI_HORDE) && html`
								<${InputSlider} label=${t('sidebar.dynaTempExp')} type="number" step="0.01"
									readOnly=${!!cancel} value=${dynaTempExp} onValueChange=${setDynaTempExp}/>`}
						</div>`}
					${enabledSamplers.includes('rep_pen') && html`
						<div className="hbox">
							<${InputSlider} label=${t('sidebar.repeatPenalty')} type="number" step="0.01" min="1" max="3"
								readOnly=${!!cancel} value=${repeatPenalty} onValueChange=${setRepeatPenalty}/>
							<${InputSlider} label=${t('sidebar.repPenRange')} type="number" step="1" max=${contextLength}
								readOnly=${!!cancel} value=${repeatLastN} onValueChange=${setRepeatLastN}/>
						</div>
						<${Checkbox} label=${t('sidebar.penalizeNl')}
							disabled=${!!cancel} value=${penalizeNl} onValueChange=${setPenalizeNl}/>`}
					`}
				${(enabledSamplers.includes('pres_pen') || enabledSamplers.includes('freq_pen')) && html`
					<div className="hbox">
						<${InputSlider} label=${t('sidebar.presPenalty')} type="number" step="0.01" min="-2" max="2"
							hidden=${!enabledSamplers.includes('pres_pen')}
							readOnly=${!!cancel} value=${presencePenalty} onValueChange=${setPresencePenalty}/>
						<${InputSlider} label=${t('sidebar.freqPenalty')} type="number" step="0.01" min="-2" max="2"
							hidden=${!enabledSamplers.includes('freq_pen')}
							readOnly=${!!cancel} value=${frequencyPenalty} onValueChange=${setFrequencyPenalty}/>
					</div>`}
				${temperature <= 0 ? null : html`
					${(!openaiPresets || (endpointAPI != API_OPENAI_COMPAT && endpointAPI != API_DEEPSEEK)) && html`
						<${SelectBox}
							label=${t('sidebar.mirostat')}
							disabled=${!!cancel}
							hidden=${!enabledSamplers.includes('mirostat')}
							value=${mirostat}
							onValueChange=${setMirostat}
							options=${[
								{ name: t('sidebar.mirostatOff'), value: 0 },
								{ name: t('sidebar.mirostatV1'), value: 1 },
								{ name: t('sidebar.mirostatV20'), value: 2 },
							]}/>`}
					${(enabledSamplers.includes('mirostat') && mirostat && (!openaiPresets || (endpointAPI != API_OPENAI_COMPAT && endpointAPI != API_DEEPSEEK))) ? html`
						<div className="hbox">
							<${InputSlider} label=${t('sidebar.mirostatTau')} type="number" step="0.01" max="20"
								readOnly=${!!cancel} value=${mirostatTau} onValueChange=${setMirostatTau}/>
							<${InputSlider} label=${t('sidebar.mirostatEta')} type="number" step="0.01" max="1"
								readOnly=${!!cancel} value=${mirostatEta} onValueChange=${setMirostatEta}/>
						</div>
					` : html`
						${(!openaiPresets || (endpointAPI != API_OPENAI_COMPAT && endpointAPI != API_DEEPSEEK)) && html`
							${enabledSamplers.includes('xtc') && html`
								<div className="hbox">
									<${InputSlider} label=${t('sidebar.xtcThreshold')} type="number" step="0.01" max="0.5"
										readOnly=${!!cancel} value=${xtcThreshold} onValueChange=${setXtcThreshold}/>
									<${InputSlider} label=${t('sidebar.xtcProbability')} type="number" step="0.01" max="1"
										readOnly=${!!cancel} value=${xtcProbability} onValueChange=${setXtcProbability}/>
								</div>`}
							${enabledSamplers.includes('dry') && html`
								<div className="hbox">
									<${InputSlider} label=${t('sidebar.dryMultiplier')} type="number" step="0.01" max="5"
										readOnly=${!!cancel} value=${dryMultiplier} onValueChange=${setDryMultiplier}/>
									<${InputSlider} label=${html`<br/>${t('sidebar.dryBase')}`} type="number" step="0.01" min="1" max="4"
										readOnly=${!!cancel} value=${dryBase} onValueChange=${setDryBase}/>
									<${InputSlider} label=${t('sidebar.allowedLength')} type="number" step="1" max="20"
										readOnly=${!!cancel} value=${dryAllowedLength} onValueChange=${setDryAllowedLength}/>
									<${InputSlider} label=${t('sidebar.penaltyRange')} type="number" step="1" max=${contextLength}
										readOnly=${!!cancel} value=${dryPenaltyRange} onValueChange=${setDryPenaltyRange}/>
								</div>
								<${InputBox} label=${t('sidebar.drySequenceBreakers')} type="text" pattern="^\\[.*?\\]$"
									className=${drySequenceBreakersError ? 'rejected' : ''}
									tooltip=${drySequenceBreakersError ? drySequenceBreakersError : ''}
									readOnly=${!!cancel}
									value=${drySequenceBreakers}
									onValueChange=${setDrySequenceBreakers}/>`}
						`}
					`}
				`}
				${(!openaiPresets || (endpointAPI != API_OPENAI_COMPAT && endpointAPI != API_DEEPSEEK)) && html`
					${(enabledSamplers.includes('top_k') || enabledSamplers.includes('top_p') || enabledSamplers.includes('min_p')) && html`
						<div className="hbox">
							${(!openaiPresets || (endpointAPI != API_OPENAI_COMPAT && endpointAPI != API_DEEPSEEK)) && html`
								<${InputSlider} label=${t('sidebar.topK')} type="number" step="1" max="200"
									hidden=${!enabledSamplers.includes('top_k')}
									readOnly=${!!cancel} value=${topK} onValueChange=${setTopK}/>`}
							<${InputSlider} label=${t('sidebar.topP')} type="number" step="0.01" max="1"
								hidden=${!enabledSamplers.includes('top_p')}
								readOnly=${!!cancel} value=${topP} onValueChange=${setTopP}/>
							${(!openaiPresets || (endpointAPI != API_OPENAI_COMPAT && endpointAPI != API_DEEPSEEK)) && html`
								<${InputSlider} label=${t('sidebar.minP')} type="number" step="0.01" max="1"
									hidden=${!enabledSamplers.includes('min_p')}
									readOnly=${!!cancel} value=${minP} onValueChange=${setMinP}/>`}
						</div>`}
					${((enabledSamplers.includes('typical_p') || enabledSamplers.includes('tfs_z')) && (!openaiPresets || (endpointAPI != API_OPENAI_COMPAT && endpointAPI != API_DEEPSEEK))) && html`
						<div className="hbox">
							<${InputSlider} label=${t('sidebar.typicalP')} type="number" step="0.01" max="1"
								hidden=${!enabledSamplers.includes('typical_p')}
								readOnly=${!!cancel} value=${typicalP} onValueChange=${setTypicalP}/>
							<${InputSlider} label=${t('sidebar.tfsZ')} type="number" step="0.01" max="1"
								hidden=${!enabledSamplers.includes('tfs_z')}
								readOnly=${!!cancel} value=${tfsZ} onValueChange=${setTfsZ}/>
						</div>`}
				`}
				${(!openaiPresets || (endpointAPI != API_OPENAI_COMPAT && endpointAPI != API_DEEPSEEK)) && html`
					${enabledSamplers.includes('ban_tokens') && html`
						<${InputBox} label=${t('sidebar.bannedStringsJson')} type="text" pattern="^\\[.*?\\]$"
							className=${bannedTokensError ? 'rejected' : ''}
							tooltip=${bannedTokensError ? bannedTokensError : ''}
							readOnly=${!!cancel}
							value=${bannedTokens}
							onValueChange=${setBannedTokens}/>`}
					<button
						disabled=${!!cancel}
						onClick=${() => toggleModal("grammar")}>
						${t('sidebar.grammar')}
					</button>`}
				<button
					disabled=${!!cancel}
					onClick=${() => toggleModal("bias")}>
					${t('sidebar.logitBias')}
				</button>
				${(!openaiPresets || (endpointAPI != API_OPENAI_COMPAT && endpointAPI != API_DEEPSEEK)) && html`
					<${Checkbox} label=${t('sidebar.ignoreEos')}
						disabled=${!!cancel} value=${ignoreEos} onValueChange=${setIgnoreEos}/>`}
			</${CollapsibleGroup}>
			<${CollapsibleGroup} label=${t('sidebar.persistentContext')}>
				<label className="TextArea">
					<div>${t('sidebar.memory')} ${(memoryTokens.tokens ?? 0) > 0 ? html`<small>(${memoryTokens.tokens} ${t('sidebar.tokens')})</small>` : ""}</div>
					<textarea
						readOnly=${!!cancel}
						placeholder=${t('sidebar.memoryPlaceholder')}
						defaultValue=${memoryTokens.text}
						value=${memoryTokens.text}
						onInput=${(e: FormEvent<HTMLTextAreaElement>) => handleMemoryTokensChange("text", e.currentTarget.value)}
						id="memory-area"/>
					<button
						className="textAreaSettings"
						disabled=${!!cancel}
						onClick=${() => toggleModal("memory")}>
						<${SVG_Settings}/>
					</button>
				</label>
				<label className="TextArea">
					<div>${t('sidebar.authorsNote')} ${(authorNoteTokens.tokens ?? 0) > 0 ? html`<small>(${authorNoteTokens.tokens} ${t('sidebar.tokens')})</small>` : ""}</div>
					<textarea
						readOnly=${!!cancel}
						placeholder=${t('sidebar.authorsNotePlaceholder', { depth: authorNoteDepth })}
						defaultValue=${authorNoteTokens.text}
						value=${authorNoteTokens.text}
						onInput=${(e: FormEvent<HTMLTextAreaElement>) => handleauthorNoteTokensChange("text", e.currentTarget.value)}
						id="an-area"/>
					<button
						className="textAreaSettings"
						disabled=${!!cancel}
						onClick=${() => toggleModal("an")}>
						<${SVG_Settings}/>
					</button>
				</label>
				<button
					id="viewWorldInfo"
					disabled=${!!cancel}
					onClick=${() => toggleModal("wi")}>
					${t('sidebar.showWorldInfo')}
				</button>
				<button
					id="viewContext"
					disabled=${!!cancel}
					onClick=${() => toggleModal("context")}>
					${t('sidebar.showContext')}
				</button>
			</${CollapsibleGroup}>
			${extensionLoaded && html`<${CollapsibleGroup} label=${t('sidebar.databaseTools')}>
				<div className="hbox">
					<button
						disabled=${!!cancel}
						onClick=${async () => {
							if (confirm(t('sidebar.vacuumConfirm'))) {
								await fetch('/vacuum', { method: 'GET' });
							}
						}						}>
						${t('sidebar.vacuum')}
					</button>
					<button
						disabled=${!!cancel}
						onClick=${() => toggleModal("compression")}>
						${t('sidebar.showConfigs')}
					</button>
				</div>
				<div className="horz-separator"></div>
				<div className="hbox">
					<${InputBox} label=${t('sidebar.durationSec')} type="number"
						readOnly=${!!cancel}
						value=${maintDuration}
						onValueChange=${(v: number) => {
							setMaintDuration(v);
							saveMaintConfigToServer({ duration: v });
						}}
						placeholder=${t('sidebar.infinite')}/>
					<${InputSlider} label=${t('sidebar.dbLoad')} type="number" step="0.1" max="1"
						readOnly=${!!cancel} value=${maintDbLoad} onValueChange=${(v: number) => {
							setMaintDbLoad(v);
							saveMaintConfigToServer({ dbLoad: v });
						}}/>
				</div>
				<${SelectBox}
					label=${t('sidebar.maintenanceMode')}
					value=${maintMode}
					onValueChange=${(v: string) => {
						setMaintMode(v);
						saveMaintConfigToServer({ mode: v });
					}}
					options=${[
						{ name: t('sidebar.maintenanceMode.interval'), value: 'interval' },
						{ name: t('sidebar.maintenanceMode.startup'), value: 'startup' },
						{ name: t('sidebar.maintenanceMode.shutdown'), value: 'shutdown' },
					]}/>
				${maintMode === 'interval' && html`
					<${InputBox} label=${t('sidebar.intervalMin')} type="number" inputmode="numeric"
						readOnly=${!!cancel} value=${maintInterval} onValueChange=${(v: number) => {
							setMaintInterval(v);
							saveMaintConfigToServer({ interval: v });
						}}/>`}
				<${Checkbox} label=${t('sidebar.enableWalMode')}
					disabled=${!!cancel} value=${walEnabled} onValueChange=${(v: boolean) => {
						setWalEnabled(v);
						saveMaintConfigToServer({ walEnabled: v });
					}}/>
				<div className="horz-separator"></div>
				<div className="hbox">
					<${InputSlider} label=${t('sidebar.compressionLevel')} type="number" step="1" min="1" max="22"
						readOnly=${!!cancel} value=${zstdLevel} onValueChange=${setZstdLevel}/>
					<${InputSlider} label=${t('sidebar.samplesRatio')} type="number" step="1" min="1" max="100"
						readOnly=${!!cancel} value=${zstdRatio} onValueChange=${setZstdRatio}/>
					${!configData ? html`
						<button
							disabled=${!!cancel}
							onClick=${async () => {
								const res = await fetch('/zstd_enable_transparent', {
									method: 'POST',
									headers: { 'Content-Type': 'application/json' },
									body: JSON.stringify({
										table: 'sessions',
										compression_level: zstdLevel,
										train_dict_samples_ratio: zstdRatio
									})
								});
								if (res.ok) setConfigData({});
							}}>
							${t('sidebar.enable')}
						</button>
					` : html`
						<button
							disabled=${!!cancel}
							onClick=${async () => {
								await fetch('/zstd_update_transparent', {
									method: 'POST',
									headers: { 'Content-Type': 'application/json' },
									body: JSON.stringify({
										compression_level: zstdLevel,
										train_dict_samples_ratio: zstdRatio
									})
								});
							}}>
							${t('sidebar.update')}
						</button>
					`}
				</div>
				<div className="horz-separator"></div>
				<div className="hbox">
					<button
						disabled=${!!cancel}
						onClick=${async () => {
							await fetch('/zstd_incremental_maintenance', {
								method: 'POST',
								headers: { 'Content-Type': 'application/json' },
								body: JSON.stringify({ duration: null, db_load: 1.0 })
							});
						}}>
						${t('sidebar.fullMaintenance')}
					</button>
					<button
						disabled=${!!cancel}
						onClick=${async () => {
							await fetch('/zstd_incremental_maintenance', {
								method: 'POST',
								headers: { 'Content-Type': 'application/json' },
								body: JSON.stringify({ duration: 0, db_load: 1.0 })
							});
						}}>
						${t('sidebar.singleItem')}
					</button>
					<button
						disabled=${!!cancel}
						onClick=${() => setShowCustomMaintenance(!showCustomMaintenance)}>
						${t('sidebar.custom')}
					</button>
				</div>
				${showCustomMaintenance && html`
					<div className="hbox">
						<${InputBox} label=${t('sidebar.durationSec')} type="number"
							readOnly=${!!cancel}
							value=${maintenanceDuration}
							onValueChange=${setMaintenanceDuration}
							placeholder=${t('sidebar.optional')}/>
						<${InputSlider} label=${t('sidebar.dbLoad')} type="number" step="0.1" max="1"
							readOnly=${!!cancel} value=${maintenanceDbLoad} onValueChange=${setMaintenanceDbLoad}/>
						<button
							disabled=${!!cancel}
							onClick=${async () => {
								await fetch('/zstd_incremental_maintenance', {
									method: 'POST',
									headers: { 'Content-Type': 'application/json' },
									body: JSON.stringify({
										duration: maintenanceDuration ? parseFloat(maintenanceDuration) : null,
										db_load: maintenanceDbLoad
									})
								});
							}}>
							${t('sidebar.run')}
						</button>
					</div>
				`}
			</${CollapsibleGroup}>`}
			${!!tokens && html`
				<${InputBox} label=${t('sidebar.tokens')} value="${tokens}${tokensPerSec ? ` (${tokensPerSec.toFixed(2)} T/s)` : ``}" readOnly/>`}
			${!!hordeQueuePos && html`
				<${InputBox} label=${t('sidebar.queuePosition')} value=${hordeQueuePos} readOnly/>`}
			<div className="buttons">
				<button
					title=${t('sidebar.runPrediction')}
					className=${cancel && !sessionEndpointConnecting ? ((predictStartTokens === tokens && (endpointAPI != API_AI_HORDE || !hordeProcessing)) ? 'processing' : 'completing') : ''}
					disabled=${!!cancel || stoppingStringsError || drySequenceBreakersError || bannedTokensError}
					onClick=${() => predict()}>
					${t('sidebar.predict')}
				</button>
				<button
					title=${t('sidebar.cancelPrediction')}
					disabled=${!cancel || sessionEndpointConnecting}
					onClick=${() => cancel?.()}>
					${t('sidebar.cancel')}
				</button>
				<div className="shorts">
					<button
						title=${t('sidebar.regenerate')}
						disabled=${!undoStack?.current?.length}
						onClick=${() => undoAndPredict()}
						onMouseEnter=${() => setUndoHovered(true)}
						onMouseLeave=${() => setUndoHovered(false)}>
						<${SVG_Regen}/>
					</button>
				</div>
				<div className="shorts">
					<button
						title=${t('sidebar.undo')}
						disabled=${!!cancel || !undoStack?.current?.length}
						onClick=${() => undo()}
						onMouseEnter=${() => setUndoHovered(true)}
						onMouseLeave=${() => setUndoHovered(false)}>
						<${SVG_Undo}/>
					</button>
					<button
						title=${t('sidebar.redo')}
						disabled=${!!cancel || !redoStack?.current?.length}
						onClick=${() => redo()}>
						<${SVG_Redo}/>
					</button>
				</div>
				<button
					id="button-settings"
					onClick=${() => {
						toggleModal("settings");
						if (modalState.settings) {
							document.getElementsByClassName("theme-selector")[0].classList.remove("visible");
							document.getElementsByClassName("horz-separator")[0].classList.remove("visible");
							for (const collapseGroup of document.getElementsByClassName("collapsible-group"))
								collapseGroup.classList.remove("visible");
						} else {
							document.getElementsByClassName("theme-selector")[0].classList.add("visible");
							document.getElementsByClassName("horz-separator")[0].classList.add("visible");
							for (const collapseGroup of document.getElementsByClassName("collapsible-group"))
								collapseGroup.classList.add("visible");
						}
					}}>
					<${SVG_MobileSidebar}/>
				</button>
			</div>
			<button
				title=${t('sidebar.about')}
				onClick=${() => toggleModal("about")}>
				${t('sidebar.about')}
			</button>
			${!!lastError && html`
				<span className="error-text">${lastError}</span>`}
		</div>
	`;
}
