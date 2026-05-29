import { html } from 'htm/react';
import { useState, useEffect } from 'react';
import { useSettings } from '../contexts/SettingsContext.js';
import { useGeneration } from '../contexts/GenerationContext.js';
import { API_LLAMA_CPP, API_KOBOLD_CPP, API_OPENAI_COMPAT, API_AI_HORDE } from '../constants.js';
import { InputBox } from './controls/InputBox.js';
import { SelectBox, SelectBoxTemplate } from './controls/SelectBox.js';
import { Checkbox } from './controls/Checkbox.js';
import { InputSlider } from './controls/InputSlider.js';
import { CollapsibleGroup } from './controls/CollapsibleGroup.js';
import {
  SVG_Settings, SVG_ShowKey, SVG_HideKey, SVG_SysPrompt, SVG_instTemplate,
  SVG_ChatMode, SVG_CompletionMode, SVG_Regen, SVG_Undo, SVG_Redo, SVG_MobileSidebar
} from './icons/index.js';
import { useTokenCounters } from '../hooks/useTokenCounters.js';
import { useGenerationLogic } from '../hooks/useGenerationLogic.js';

export function Sidebar({ sidebarRef, toggleModal, currentThemeName, setCurrentThemeName, allThemes, showAPIKey, setShowAPIKey }) {
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
		postSamplingProbs, setPostSamplingProbs, showPromptPreview, setShowPromptPreview,
		promptPreviewTokens, setPromptPreviewTokens, templates, selectedTemplate, setSelectedTemplate,
		isMiyapadEndpoint, sessionStorage, chatMode, setChatMode, seed, setSeed, contextLength, setContextLength,
		memoryTokens, authorNoteTokens, authorNoteDepth, templateList, tokenHighlightMode
	} = useSettings();

	const {
		cancel, openaiModels, hordeQueuePos, hordeProcessing, tokens, tokensPerSec, undoStack, redoStack,
		undoHovered, setUndoHovered, lastError, sessionEndpointConnecting, predictStartTokens,
		stoppingStringsError, drySequenceBreakersError, bannedTokensError, modalState, promptArea,
		rejectedAPIKey
	} = useGeneration();

	const { predict, undo, redo, undoAndPredict } = useGenerationLogic();
	const { handleauthorNoteTokensChange, handleMemoryTokensChange } = useTokenCounters();

	const [extensionLoaded, setExtensionLoaded] = useState(false);
	const [configData, setConfigData] = useState(null);
	const [zstdLevel, setZstdLevel] = useState(3);
	const [zstdRatio, setZstdRatio] = useState(100);
	const [showCustomMaintenance, setShowCustomMaintenance] = useState(false);
	const [maintenanceDuration, setMaintenanceDuration] = useState('');
	const [maintenanceDbLoad, setMaintenanceDbLoad] = useState(0.5);

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
						setConfigData(configJson.configs);
					}
				}
			} catch (err) {}
		};
		checkVersion();
	}, [isMiyapadEndpoint]);

	function switchEndpointAPI(value) {
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
				url.port = 8080;
				break;
			case API_KOBOLD_CPP:
				setUseChatAPI(false);
				if (url.protocol != 'http:' && url.protocol != 'https:')
					url.protocol = "http:";
				url.port = 5001;
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

	const insertTemplate = (sysInst) => {
		let [prefix,suffix] = sysInst == "sys"
			? [templates[selectedTemplate]?.sysPre  || "", templates[selectedTemplate]?.sysSuf  || ""]
			: [templates[selectedTemplate]?.instPre || "", templates[selectedTemplate]?.instSuf || ""];
		if (!(prefix || suffix))
			return;

		prefix = prefix.replace(/\\n/g,'\n');
		suffix = suffix.replace(/\\n/g,'\n');

		const elem = promptArea.current;
		if (!elem)
			return;

		const startPos = elem.selectionStart;
		const endPos = elem.selectionEnd;
		const textBefore = elem.value.substring(0, startPos) || "";
		const textAfter = (sysInst !== "sys" && elem.selectionEnd !== elem.value.length ? "{predict}" : "") + elem.value.substring(endPos);
		const selectedText = elem.value.substring(startPos, endPos);

		const finalText = textBefore 
						+ prefix
						+ selectedText 
						+ suffix
						+ textAfter;

		const scrollTop = elem.scrollTop;
		
		elem.value = finalText;

		let newCursorPos;
		if (selectedText.length === 0) {
			newCursorPos = startPos + prefix.length;
		} else {
			newCursorPos = startPos 
				+ prefix.length
				+ selectedText.length 
				+ suffix.length;
		}
		elem.focus();
		elem.setSelectionRange(newCursorPos, newCursorPos);
		if (elem.onInputHandler) elem.onInputHandler({ target: elem });

		elem.scrollTop = scrollTop;
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
					label="Theme"
					value=${currentThemeName}
					onValueChange=${setCurrentThemeName}
					options=${() => [
						{ name: 'Serif Light', value: 'Serif Light' },
						...Object.keys(allThemes).sort((a, b) => (allThemes[a]?.order ?? 0) - (allThemes[b]?.order ?? 0)).map(name => ({ name, value: name }))
					]}/>
				<button
					title="Manage Themes"
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
				Manage Sessions
			</button>
			<${CollapsibleGroup} label="Parameters" expanded>
				<${InputBox} label="Server"
					className=${isMixedContent() ? 'mixed-content' : ''}
					tooltip=${isMixedContent() ? 'This URL might be blocked due to mixed content. If the prediction fails, download miyapad.html and run it locally.' : ''}
					readOnly=${!!cancel || endpointAPI == API_AI_HORDE}
					value=${endpointAPI != API_AI_HORDE ? endpoint : 'https://aihorde.net/api'}
					onValueChange=${setEndpoint}/>
				<${SelectBox}
					label="API"
					disabled=${!!cancel}
					value=${endpointAPI}
					onValueChange=${switchEndpointAPI}
					options=${[
						{ name: 'llama.cpp', value: API_LLAMA_CPP },
						{ name: 'KoboldCpp', value: API_KOBOLD_CPP },
						{ name: 'OpenAI Compatible', value: API_OPENAI_COMPAT },
						{ name: 'AI Horde', value: API_AI_HORDE },
					]}/>
				${(endpointAPI != API_AI_HORDE) && html`
					<div className="hbox-flex" style=${{"flex-wrap": "unset"}}>
						<${InputBox} label="API Key" type=${!showAPIKey ? "password" : "text"}
							className=${rejectedAPIKey ? 'rejected' : ''}
							tooltip=${rejectedAPIKey ? 'This API Key was rejected by the backend.' : ''}
							tooltipSize="short"
							readOnly=${!!cancel}
							value=${endpointAPIKey}
							onValueChange=${setEndpointAPIKey}/>
						<button title=${!showAPIKey ? "Show API Key" : "Hide API Key"}
							className="eye-button"
							disabled=${!!cancel}
							onClick=${() => setShowAPIKey(!showAPIKey)}>
							${!showAPIKey ? html`<${SVG_ShowKey}/>` : html`<${SVG_HideKey}/>`}
						</button>
					</div>`}
				${(endpointAPI == API_OPENAI_COMPAT) && html`
					<${InputBox} label="Model"
						datalist=${openaiModels.map(model => model.id || model)}
						readOnly=${!!cancel}
						value=${endpointModel}
						onValueChange=${setEndpointModel}/>`}
				${endpointAPI == API_AI_HORDE && html`
					<div className="vbox" style=${{gap: '4px'}}>
						<${InputBox} label="Selected Model(s)"
							readOnly=${true}
							value=${endpointModel || 'Any'}
							placeholder="Any"
						/>
						<button onClick=${() => toggleModal("horde")}>Configure AI Horde</button>
					</div>`}
				${endpointAPI != API_AI_HORDE && html`
					${endpointAPI == API_LLAMA_CPP && html`
						<${Checkbox} label="Post Sampling Probs"
							title="This returns the probabilities after applying the sampling chain. Note that disabling this will significantly reduce generation speed."
							disabled=${!!cancel} value=${postSamplingProbs} onValueChange=${setPostSamplingProbs}/>`}
					${endpointAPI == API_OPENAI_COMPAT && html`
						<${Checkbox} label="Strict API"
							title="If enabled, non-standard fields won't be included in API requests."
							disabled=${!!cancel} value=${openaiPresets} onValueChange=${setOpenaiPresets}/>
						<${Checkbox} label="Chat Completions API"
							title="If enabled, the chat API endpoint will be used, and the prompt will be split into chat messages based on the delimiters defined in the selected instruct template."
							disabled=${!!cancel} value=${useChatAPI} onValueChange=${setUseChatAPI}/>`}
					<${Checkbox} label="Token Streaming"
						disabled=${!!cancel} value=${useTokenStreaming} onValueChange=${setUseTokenStreaming}/>
					<${Checkbox} label="Disable Logprobs"
						title="Disables logprobs for all backends. This may improve generation speed."
						disabled=${!!cancel} value=${disableLogprobs} onValueChange=${setDisableLogprobs}/>
					<${Checkbox} label="Prediction Preview"
						disabled=${!!cancel || tokenHighlightMode === -1} value=${showPromptPreview && tokenHighlightMode !== -1} onValueChange=${setShowPromptPreview}/>
					${showPromptPreview && html`
						<${InputBox} label="Max Preview Tokens" type="text" inputmode="numeric"
							readOnly=${!!cancel} value=${promptPreviewTokens} onValueChange=${setPromptPreviewTokens}/>`}`}
				<div className="buttons instructTemplateSidebar">
					<${SelectBoxTemplate}
						label="Instruct Template"
						disabled=${!!cancel}
						value=${selectedTemplate}
						onValueChange=${setSelectedTemplate}
						options=${templateList}/>
					<button
						title="Edit Instruct Templates"
						disabled=${!!cancel}
						className="symbol-button"
						onClick=${() => toggleModal("instructTemplates")}>
						<${SVG_Settings} style=${{ 'width':'.95em','transform':'translate(-50%, -45%)' }}/>
					</button>
					<button
						title="Insert System Prompt Template"
						disabled=${!!cancel}
						className="symbol-button"
						onClick=${() => insertTemplate("sys")}>
						<${SVG_SysPrompt} style=${{ 'width':'.9em' }}/>
					</button>
					<button
						title="Insert Instruct Template"
						disabled=${!!cancel}
						className="symbol-button"
						onClick=${() => insertTemplate("inst")}>
						<${SVG_instTemplate} style=${{ 'height':'1.05em','transform':'translate(-50%, -60%)' }}/>
					</button>
					<button
						title="Toggle Chat Mode ${ chatMode ? "Off" : "On"}"
						disabled=${!!cancel || useChatAPI}
						className="symbol-button"
						onClick=${() => setChatMode((prevState) => !prevState)}>
						${ (chatMode || useChatAPI) ? 
							html`<${SVG_ChatMode} style=${{ 'width':'.9em' }} />` :
							html`<${SVG_CompletionMode} style=${{ 'width':'1.05em' }} />`
						}
					</button>
				</div>
				<${InputBox} label="Seed (-1 = random)" type="text" inputmode="numeric"
					readOnly=${!!cancel} value=${seed} onValueChange=${setSeed}/>
				<${InputBox} tooltip="Currently not accurate to the token count, it will be used as an estimate." label="Max Context Length" type="text" inputmode="numeric"
					readOnly=${!!cancel} value=${contextLength} onValueChange=${setContextLength}/>
				<${InputBox} label="Max Predict Tokens${endpointAPI != API_LLAMA_CPP ? (endpointAPI == API_AI_HORDE ? ' (-1 = 512)' : ' (-1 = 1024)') : ' (-1 = infinite)'}" type="text" inputmode="numeric"
					readOnly=${!!cancel} value=${maxPredictTokens} onValueChange=${setMaxPredictTokens}/>
				<div className="hbox-flex" style=${{ "flex-wrap": "unset", "align-items": "flex-end" }}>
					<div style=${{ "flex": "1" }}>
						${useBasicStoppingMode ? html`
							<${SelectBox}
								label="Stopping Mode"
								disabled=${!!cancel}
								value=${basicStoppingModeType}
								onValueChange=${setBasicStoppingModeType}
								options=${[
									{ name: 'Max Tokens', value: 'max_tokens' },
									{ name: 'New Line', value: 'new_line' },
									{ name: 'Fill', value: 'fill_suffix' },
								]}/>
						` : html`
							<${InputBox} label="Stopping Strings (JSON array)" type="text" pattern="^\\[.*?\\]$"
								className=${stoppingStringsError ? 'rejected' : ''}
								tooltip=${stoppingStringsError ? stoppingStringsError : ''}
								readOnly=${!!cancel}
								value=${stoppingStrings}
								onValueChange=${setStoppingStrings}/>
						`}
					</div>
					<button
						title=${useBasicStoppingMode ? "Switch to Advanced Mode" : "Switch to Basic Mode"}
						disabled=${!!cancel}
						onClick=${() => setUseBasicStoppingMode(prev => !prev)}>
						${useBasicStoppingMode ? "A" : "B"}
					</button>
				</div>
			</${CollapsibleGroup} >
			<${CollapsibleGroup} label="Sampling" expanded menu=${html`
					<${Checkbox} label="Temperature"
						disabled=${!!cancel}
						value=${enabledSamplers.includes('temperature')}
						onValueChange=${(v) => enabledSamplers.indexOf('temperature') === -1
											  ? setEnabledSamplers((es) => [...es, 'temperature'])
											  : setEnabledSamplers((es) => es.filter((s) => s !== 'temperature'))}/>
					<${Checkbox} label="Dynamic Temperature"
						disabled=${!!cancel}
						value=${enabledSamplers.includes('dynatemp')}
						onValueChange=${(v) => enabledSamplers.indexOf('dynatemp') === -1
											  ? setEnabledSamplers((es) => [...es, 'dynatemp'])
											  : setEnabledSamplers((es) => es.filter((s) => s !== 'dynatemp'))}/>
					<${Checkbox} label="Repetition Penalty"
						disabled=${!!cancel}
						value=${enabledSamplers.includes('rep_pen')}
						onValueChange=${(v) => enabledSamplers.indexOf('rep_pen') === -1
											  ? setEnabledSamplers((es) => [...es, 'rep_pen'])
											  : setEnabledSamplers((es) => es.filter((s) => s !== 'rep_pen'))}/>
					<${Checkbox} label="Presence Penalty"
						disabled=${!!cancel}
						value=${enabledSamplers.includes('pres_pen')}
						onValueChange=${(v) => enabledSamplers.indexOf('pres_pen') === -1
											  ? setEnabledSamplers((es) => [...es, 'pres_pen'])
											  : setEnabledSamplers((es) => es.filter((s) => s !== 'pres_pen'))}/>
					<${Checkbox} label="Frequence Penalty"
						disabled=${!!cancel}
						value=${enabledSamplers.includes('freq_pen')}
						onValueChange=${(v) => enabledSamplers.indexOf('freq_pen') === -1
											  ? setEnabledSamplers((es) => [...es, 'freq_pen'])
											  : setEnabledSamplers((es) => es.filter((s) => s !== 'freq_pen'))}/>
					<${Checkbox} label="Mirostat"
						disabled=${!!cancel}
						value=${enabledSamplers.includes('mirostat')}
						onValueChange=${(v) => enabledSamplers.indexOf('mirostat') === -1
											  ? setEnabledSamplers((es) => [...es, 'mirostat'])
											  : setEnabledSamplers((es) => es.filter((s) => s !== 'mirostat'))}/>
					<${Checkbox} label="XTC"
						disabled=${!!cancel}
						value=${enabledSamplers.includes('xtc')}
						onValueChange=${(v) => enabledSamplers.indexOf('xtc') === -1
											  ? setEnabledSamplers((es) => [...es, 'xtc'])
											  : setEnabledSamplers((es) => es.filter((s) => s !== 'xtc'))}/>
					<${Checkbox} label="DRY"
						disabled=${!!cancel}
						value=${enabledSamplers.includes('dry')}
						onValueChange=${(v) => enabledSamplers.indexOf('dry') === -1
											  ? setEnabledSamplers((es) => [...es, 'dry'])
											  : setEnabledSamplers((es) => es.filter((s) => s !== 'dry'))}/>
					<${Checkbox} label="Top K"
						disabled=${!!cancel}
						value=${enabledSamplers.includes('top_k')}
						onValueChange=${(v) => enabledSamplers.indexOf('top_k') === -1
											  ? setEnabledSamplers((es) => [...es, 'top_k'])
											  : setEnabledSamplers((es) => es.filter((s) => s !== 'top_k'))}/>
					<${Checkbox} label="Top P"
						disabled=${!!cancel}
						value=${enabledSamplers.includes('top_p')}
						onValueChange=${(v) => enabledSamplers.indexOf('top_p') === -1
											  ? setEnabledSamplers((es) => [...es, 'top_p'])
											  : setEnabledSamplers((es) => es.filter((s) => s !== 'top_p'))}/>
					<${Checkbox} label="Min P"
						disabled=${!!cancel}
						value=${enabledSamplers.includes('min_p')}
						onValueChange=${(v) => enabledSamplers.indexOf('min_p') === -1
											  ? setEnabledSamplers((es) => [...es, 'min_p'])
											  : setEnabledSamplers((es) => es.filter((s) => s !== 'min_p'))}/>
					<${Checkbox} label="Typical P"
						disabled=${!!cancel}
						value=${enabledSamplers.includes('typical_p')}
						onValueChange=${(v) => enabledSamplers.indexOf('typical_p') === -1
											  ? setEnabledSamplers((es) => [...es, 'typical_p'])
											  : setEnabledSamplers((es) => es.filter((s) => s !== 'typical_p'))}/>
					<${Checkbox} label="TFS z"
						disabled=${!!cancel}
						value=${enabledSamplers.includes('tfs_z')}
						onValueChange=${(v) => enabledSamplers.indexOf('tfs_z') === -1
											  ? setEnabledSamplers((es) => [...es, 'tfs_z'])
											  : setEnabledSamplers((es) => es.filter((s) => s !== 'tfs_z'))}/>
					<${Checkbox} label="Banned Strings"
						disabled=${!!cancel}
						value=${enabledSamplers.includes('ban_tokens')}
						onValueChange=${(v) => enabledSamplers.indexOf('ban_tokens') === -1
											  ? setEnabledSamplers((es) => [...es, 'ban_tokens'])
											  : setEnabledSamplers((es) => es.filter((s) => s !== 'ban_tokens'))}/>
				`}>
				<${InputSlider} label="Temperature" type="number" step="0.01" max="5"
					hidden=${!enabledSamplers.includes('temperature')}
					readOnly=${!!cancel} value=${temperature} onValueChange=${setTemperature}/>
				${(!openaiPresets || endpointAPI != API_OPENAI_COMPAT) && html`
					${enabledSamplers.includes('dynatemp') && html`
						<div className="hbox">
							<${InputSlider} label="DynaTemp Range" type="number" step="0.01"
								readOnly=${!!cancel} value=${dynaTempRange} onValueChange=${setDynaTempRange}/>
							${(endpointAPI != API_KOBOLD_CPP && endpointAPI != API_AI_HORDE) && html`
								<${InputSlider} label="DynaTemp Exp" type="number" step="0.01"
									readOnly=${!!cancel} value=${dynaTempExp} onValueChange=${setDynaTempExp}/>`}
						</div>`}
					${enabledSamplers.includes('rep_pen') && html`
						<div className="hbox">
							<${InputSlider} label="Repeat Penalty" type="number" step="0.01" min="1" max="3"
								readOnly=${!!cancel} value=${repeatPenalty} onValueChange=${setRepeatPenalty}/>
							<${InputSlider} label="Rep Pen Range" type="number" step="1" max=${contextLength}
								readOnly=${!!cancel} value=${repeatLastN} onValueChange=${setRepeatLastN}/>
						</div>
						<${Checkbox} label="Penalize NL"
							disabled=${!!cancel} value=${penalizeNl} onValueChange=${setPenalizeNl}/>`}
					`}
				${(enabledSamplers.includes('pres_pen') || enabledSamplers.includes('freq_pen')) && html`
					<div className="hbox">
						<${InputSlider} label="Pres. Penalty" type="number" step="0.01" min="-2" max="2"
							hidden=${!enabledSamplers.includes('pres_pen')}
							readOnly=${!!cancel} value=${presencePenalty} onValueChange=${setPresencePenalty}/>
						<${InputSlider} label="Freq. Penalty" type="number" step="0.01" min="-2" max="2"
							hidden=${!enabledSamplers.includes('freq_pen')}
							readOnly=${!!cancel} value=${frequencyPenalty} onValueChange=${setFrequencyPenalty}/>
					</div>`}
				${temperature <= 0 ? null : html`
					${(!openaiPresets || endpointAPI != API_OPENAI_COMPAT) && html`
						<${SelectBox}
							label="Mirostat"
							disabled=${!!cancel}
							hidden=${!enabledSamplers.includes('mirostat')}
							value=${mirostat}
							onValueChange=${setMirostat}
							options=${[
								{ name: 'Off', value: 0 },
								{ name: 'Mirostat', value: 1 },
								{ name: 'Mirostat 2.0', value: 2 },
							]}/>`}
					${(enabledSamplers.includes('mirostat') && mirostat && (!openaiPresets || endpointAPI != API_OPENAI_COMPAT)) ? html`
						<div className="hbox">
							<${InputSlider} label="Mirostat τ" type="number" step="0.01" max="20"
								readOnly=${!!cancel} value=${mirostatTau} onValueChange=${setMirostatTau}/>
							<${InputSlider} label="Mirostat η" type="number" step="0.01" max="1"
								readOnly=${!!cancel} value=${mirostatEta} onValueChange=${setMirostatEta}/>
						</div>
					` : html`
						${(!openaiPresets || endpointAPI != API_OPENAI_COMPAT) && html`
							${enabledSamplers.includes('xtc') && html`
								<div className="hbox">
									<${InputSlider} label="XTC Threshold" type="number" step="0.01" max="0.5"
										readOnly=${!!cancel} value=${xtcThreshold} onValueChange=${setXtcThreshold}/>
									<${InputSlider} label="XTC Probability" type="number" step="0.01" max="1"
										readOnly=${!!cancel} value=${xtcProbability} onValueChange=${setXtcProbability}/>
								</div>`}
							${enabledSamplers.includes('dry') && html`
								<div className="hbox">
									<${InputSlider} label="DRY Multip." type="number" step="0.01" max="5"
										readOnly=${!!cancel} value=${dryMultiplier} onValueChange=${setDryMultiplier}/>
									<${InputSlider} label=${html`<br/>Base`} type="number" step="0.01" min="1" max="4"
										readOnly=${!!cancel} value=${dryBase} onValueChange=${setDryBase}/>
									<${InputSlider} label="Allowed Length" type="number" step="1" max="20"
										readOnly=${!!cancel} value=${dryAllowedLength} onValueChange=${setDryAllowedLength}/>
									<${InputSlider} label="Penalty Range" type="number" step="1" max=${contextLength}
										readOnly=${!!cancel} value=${dryPenaltyRange} onValueChange=${setDryPenaltyRange}/>
								</div>
								<${InputBox} label="DRY Sequence Breakers (JSON array)" type="text" pattern="^\\[.*?\\]$"
									className=${drySequenceBreakersError ? 'rejected' : ''}
									tooltip=${drySequenceBreakersError ? drySequenceBreakersError : ''}
									readOnly=${!!cancel}
									value=${drySequenceBreakers}
									onValueChange=${setDrySequenceBreakers}/>`}
						`}
					`}
				`}
				${(!openaiPresets || endpointAPI != API_OPENAI_COMPAT) && html`
					${(enabledSamplers.includes('top_k') || enabledSamplers.includes('top_p') || enabledSamplers.includes('min_p')) && html`
						<div className="hbox">
							${(!openaiPresets || endpointAPI != API_OPENAI_COMPAT) && html`
								<${InputSlider} label="Top K" type="number" step="1" max="200"
									hidden=${!enabledSamplers.includes('top_k')}
									readOnly=${!!cancel} value=${topK} onValueChange=${setTopK}/>`}
							<${InputSlider} label="Top P" type="number" step="0.01" max="1"
								hidden=${!enabledSamplers.includes('top_p')}
								readOnly=${!!cancel} value=${topP} onValueChange=${setTopP}/>
							${(!openaiPresets || endpointAPI != API_OPENAI_COMPAT) && html`
								<${InputSlider} label="Min P" type="number" step="0.01" max="1"
									hidden=${!enabledSamplers.includes('min_p')}
									readOnly=${!!cancel} value=${minP} onValueChange=${setMinP}/>`}
						</div>`}
					${((enabledSamplers.includes('typical_p') || enabledSamplers.includes('tfs_z')) && (!openaiPresets || endpointAPI != API_OPENAI_COMPAT)) && html`
						<div className="hbox">
							<${InputSlider} label="Typical P" type="number" step="0.01" max="1"
								hidden=${!enabledSamplers.includes('typical_p')}
								readOnly=${!!cancel} value=${typicalP} onValueChange=${setTypicalP}/>
							<${InputSlider} label="TFS z" type="number" step="0.01" max="1"
								hidden=${!enabledSamplers.includes('tfs_z')}
								readOnly=${!!cancel} value=${tfsZ} onValueChange=${setTfsZ}/>
						</div>`}
				`}
				${(!openaiPresets || endpointAPI != API_OPENAI_COMPAT) && html`
					${enabledSamplers.includes('ban_tokens') && html`
						<${InputBox} label="Banned Strings (JSON array)" type="text" pattern="^\\[.*?\\]$"
							className=${bannedTokensError ? 'rejected' : ''}
							tooltip=${bannedTokensError ? bannedTokensError : ''}
							readOnly=${!!cancel}
							value=${bannedTokens}
							onValueChange=${setBannedTokens}/>`}
					<button
						disabled=${!!cancel}
						onClick=${() => toggleModal("grammar")}>
						Grammar
					</button>`}
				<button
					disabled=${!!cancel}
					onClick=${() => toggleModal("bias")}>
					Logit Bias
				</button>
				${(!openaiPresets || endpointAPI != API_OPENAI_COMPAT) && html`
					<${Checkbox} label="Ignore <eos>"
						disabled=${!!cancel} value=${ignoreEos} onValueChange=${setIgnoreEos}/>`}
			</${CollapsibleGroup}>
			<${CollapsibleGroup} label="Persistent Context">
				<label className="TextArea">
					<div>Memory ${memoryTokens.tokens > 0 ? html`<small>(${memoryTokens.tokens} Tokens)</small>` : ""}</div>
					<textarea
						readOnly=${!!cancel}
						placeholder="Anything written here will be injected at the head of the prompt. Tokens here DO count towards the Context Limit."
						defaultValue=${memoryTokens.text}
						value=${memoryTokens.text}
						onInput=${(e) => handleMemoryTokensChange("text", e.target.value)}
						id="memory-area"/>
					<button
						className="textAreaSettings"
						disabled=${!!cancel}
						onClick=${() => toggleModal("memory")}>
						<${SVG_Settings}/>
					</button>
				</label>
				<label className="TextArea">
					<div>Author's Note ${authorNoteTokens.tokens > 0 ? html`<small>(${authorNoteTokens.tokens} Tokens)</small>` : ""}</div>
					<textarea
						readOnly=${!!cancel}
						placeholder="Anything written here will be injected ${authorNoteDepth} newlines from bottom into context."
						defaultValue=${authorNoteTokens.text}
						value=${authorNoteTokens.text}
						onInput=${(e) => handleauthorNoteTokensChange("text", e.target.value)}
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
					Show World Info
				</button>
				<button
					id="viewContext"
					disabled=${!!cancel}
					onClick=${() => toggleModal("context")}>
					Show Context
				</button>
			</${CollapsibleGroup}>
			${extensionLoaded && html`<${CollapsibleGroup} label="Database Tools">
				<div className="hbox">
					<button
						disabled=${!!cancel}
						onClick=${async () => {
							if (confirm("Optimize database storage? This may temporarily impact performance.")) {
								await fetch('/vacuum', { method: 'GET' });
							}
						}}>
						VACUUM
					</button>
					<button
						disabled=${!!cancel}
						onClick=${() => toggleModal("compression")}>
						Show Configs
					</button>
				</div>
				<div className="hbox">
					<${InputSlider} label="Compression Level" type="number" step="1" min="1" max="22"
						readOnly=${!!cancel} value=${zstdLevel} onValueChange=${setZstdLevel}/>
					<${InputSlider} label="Samples Ratio" type="number" step="1" min="1" max="100"
						readOnly=${!!cancel} value=${zstdRatio} onValueChange=${setZstdRatio}/>
					${!configData ? html`
						<button
							disabled=${!!cancel}
							onClick=${async () => {
								await fetch('/zstd_enable_transparent', {
									method: 'POST',
									headers: { 'Content-Type': 'application/json' },
									body: JSON.stringify({
										table: 'sessions',
										compression_level: zstdLevel,
										train_dict_samples_ratio: zstdRatio
									})
								});
								setConfigData(true);
							}}>
							Enable
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
							Update
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
						Full Maintenance
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
						Single Item
					</button>
					<button
						disabled=${!!cancel}
						onClick=${() => setShowCustomMaintenance(!showCustomMaintenance)}>
						Custom
					</button>
				</div>
				${showCustomMaintenance && html`
					<div className="hbox">
						<${InputBox} label="Duration (sec)" type="number"
							readOnly=${!!cancel}
							value=${maintenanceDuration}
							onValueChange=${setMaintenanceDuration}
							placeholder="Optional"/>
						<${InputSlider} label="DB Load" type="number" step="0.1" max="1"
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
							Run
						</button>
					</div>
				`}
			</${CollapsibleGroup}>`}
			${!!tokens && html`
				<${InputBox} label="Tokens" value="${tokens}${tokensPerSec ? ` (${tokensPerSec.toFixed(2)} T/s)` : ``}" readOnly/>`}
			${!!hordeQueuePos && html`
				<${InputBox} label="Queue Position" value=${hordeQueuePos} readOnly/>`}
			<div className="buttons">
				<button
					title="Run next prediction (Ctrl + Enter)"
					className=${cancel && !sessionEndpointConnecting ? ((predictStartTokens === tokens && (endpointAPI != API_AI_HORDE || !hordeProcessing)) ? 'processing' : 'completing') : ''}
					disabled=${!!cancel || stoppingStringsError || drySequenceBreakersError || bannedTokensError}
					onClick=${() => predict()}>
					Predict
				</button>
				<button
					title="Cancel prediction (Escape)"
					disabled=${!cancel || sessionEndpointConnecting}
					onClick=${() => cancel?.()}>
					Cancel
				</button>
				<div className="shorts">
					<button
						title="Regenerate (Ctrl + R)"
						disabled=${!undoStack?.current?.length}
						onClick=${() => undoAndPredict()}
						onMouseEnter=${() => setUndoHovered(true)}
						onMouseLeave=${() => setUndoHovered(false)}>
						<${SVG_Regen}/>
					</button>
				</div>
				<div className="shorts">
					<button
						title="Undo (Ctrl + Z)"
						disabled=${!!cancel || !undoStack?.current?.length}
						onClick=${() => undo()}
						onMouseEnter=${() => setUndoHovered(true)}
						onMouseLeave=${() => setUndoHovered(false)}>
						<${SVG_Undo}/>
					</button>
					<button
						title="Redo (Ctrl + Y)"
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
			${!!lastError && html`
				<span className="error-text">${lastError}</span>`}
		</div>
	`;
}
