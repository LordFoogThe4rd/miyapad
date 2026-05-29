import { html } from 'htm/react';
import { useEffect, useState } from 'react';
import { useSettings } from '../contexts/SettingsContext.js';
import { useGeneration } from '../contexts/GenerationContext.js';
import { useTokenCounters } from '../hooks/useTokenCounters.js';
import { usePromptBuilder } from '../hooks/usePromptBuilder.js';
import { useTTS } from '../hooks/useTTS.js';
import { exportText } from '../api/common.js';
import { defaultPresets } from '../defaults/presets.js';
import { PreferencesModal } from './modals/PreferencesModal.js';
import { MemoryModal } from './modals/MemoryModal.js';
import { AuthorNoteModal } from './modals/AuthorNoteModal.js';
import { ContextModal } from './modals/ContextModal.js';
import { WorldInfoModal } from './modals/WorldInfoModal.js';
import { WorldInfoSelectImportBehaviorModal } from './modals/WorldInfoSelectImportBehaviorModal.js';
import { LogitBiasModal } from './modals/LogitBiasModal.js';
import { InstructTemplatesModal } from './modals/InstructTemplatesModal.js';
import { GrammarModal } from './modals/GrammarModal.js';
import { InstructModal } from './modals/InstructModal.js';
import { ThemeManagerModal } from './modals/ThemeManagerModal.js';
import { AIHordeSettingsModal } from './modals/AIHordeSettingsModal.js';
import { CompressionInfoModal } from './modals/CompressionInfoModal.js';
import { SessionsModal } from './modals/SessionsModal.js';
import { EditorContextMenu } from './EditorContextMenu.js';

export function Modals({ toggleModal, currentThemeName, setCurrentThemeName, allThemes, setAllThemes, applyChatTemplate }) {
	const { endpoint, setEndpointAPIKey, endpointAPIKey, endpointAPI, endpointModel, setEndpointModel, templates, selectedTemplate, setSelectedTemplate, templatesImport, setTemplates, templateStorage, grammar, setGrammar, isMiyapadEndpoint, sessionStorage, fontSizeMultiplier, setFontSizeMultiplier, spellCheck, setSpellCheck, attachSidebar, setAttachSidebar, preserveCursorPosition, setPreserveCursorPosition, tokenHighlightMode, setTokenHighlightMode, tokenColorMode, setTokenColorMode, showProbsMode, setShowProbsMode, ttsEnabled, setTTSEnabled, ttsVoiceId, setTTSVoiceId, ttsPitch, setTTSPitch, ttsRate, setTTSRate, ttsVolume, setTTSVolume, ttsSpeakInputs, setTTSSpeakInputs, ttsMaxUserInput, setTTSMaxUserInput, useChatAPI, setUseChatAPI, memoryTokens, authorNoteTokens, authorNoteDepth, setAuthorNoteDepth, worldInfo, setWorldInfo, sillyTarvernWorldInfoJSON, setSillyTarvernWorldInfoJSON, logitBias, setLogitBias, logitBiasParam, setLogitBiasParam, templateList, setTemplateList,
		screenshotIncludeSessionName, setScreenshotIncludeSessionName,
		screenshotIncludeDate, setScreenshotIncludeDate,
		screenshotBackgroundUrl, setScreenshotBackgroundUrl,
		screenshotBackgroundColor, setScreenshotBackgroundColor,
		screenshotStoryFont, setScreenshotStoryFont,
		screenshotGeneralFont, setScreenshotGeneralFont,
		useServerTokenization, setUseServerTokenization, tokenizerModel, setTokenizerModel,
		screenshotFontWeight, setScreenshotFontWeight,
		screenshotFontSize, setScreenshotFontSize,
		screenshotLineHeight, setScreenshotLineHeight,
		screenshotFontColor, setScreenshotFontColor,
		screenshotAiTextColor, setScreenshotAiTextColor,
		screenshotModelAvatarUrl, setScreenshotModelAvatarUrl
	} = useSettings();
	const { cancel, modalState, closeModal, instructModalState, setInstructModalState, promptArea, predict, lastError, sessionEndpointConnecting, predictStartTokens, tokens, stoppingStringsError, drySequenceBreakersError, bannedTokensError, contextMenuState, setContextMenuState, setTriggerPredict, sessionEndpointError, setRejectedAPIKey } = useGeneration();

	const { handleauthorNoteTokensChange, handleMemoryTokensChange } = useTokenCounters();
	const { finalPromptText, convertChatToJSON } = usePromptBuilder();
	const { listTTSVoices, ttsStop, ttsAvailable } = useTTS();



	const handleExportDB = async () => {
		try {
			const data = await sessionStorage.dbAdapter.exportDatabase();
			const jsonString = JSON.stringify(data, null, 2);
			exportText('miyapad_db_export.json', jsonString);
		} catch (error) {
			console.error('Failed to export database:', error);
			alert('Failed to export database. See console for details.');
		}
	};

	const handleImportDB = () => {
		if (!confirm('This will overwrite your current database and reload the page. Are you sure you want to continue?')) {
			return;
		}
		const fileInput = document.createElement('input');
		fileInput.type = 'file';
		fileInput.accept = '.json';
		fileInput.onchange = async (e) => {
			const file = e.target.files[0];
			if (!file) {
				return;
			}

			const reader = new FileReader();
			reader.onload = async (event) => {
				try {
					const data = JSON.parse(event.target.result);
					await sessionStorage.dbAdapter.importDatabase(data);
					window.location.reload();
				} catch (error) {
					console.error('Failed to import database:', error);
					alert('Failed to import database. Make sure the file is a valid export. See console for details.');
				}
			};
			reader.readAsText(file);
		};
		fileInput.click();
	};

	const exportPrompt = () => {
		exportText(`${sessionStorage.getProperty('name')}.txt`, promptArea.current.value);
	};

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

	// handle instruct modal result
	useEffect(() => {
		const result = instructModalState.result;
		if (!result)
			return;
		
		const elem = promptArea.current;
		if (!elem)
			return;

		const startPos = instructModalState.selectionStart;
		const endPos = instructModalState.selectionEnd;
		const textBefore = elem.value.substring(0, startPos) || "";
		const textAfter = elem.value.substring(endPos);
		const selectedText = elem.value.substring(startPos, endPos);

		const finalText = textBefore 
					+ (result.replace ? (result.content) : (result.content + selectedText))
					+ textAfter;

		const scrollTop = elem.scrollTop;

		elem.value = finalText;

		let newCursorPos;
		if (result.replace) {
			newCursorPos = startPos + result.content.length;
		} else {
			newCursorPos = startPos + result.content.length + selectedText.length;
		}
		elem.focus();
		elem.setSelectionRange(newCursorPos, newCursorPos);
		if (elem.onInputHandler) elem.onInputHandler({ target: elem });

		elem.scrollTop = scrollTop;
	}, [instructModalState.result]);

	return html`
		<${PreferencesModal}
			isOpen=${modalState.preferences}
			closeModal=${() => closeModal("preferences")}
			settings=${{
				fontSizeMultiplier, setFontSizeMultiplier,
				spellCheck, setSpellCheck,
				attachSidebar, setAttachSidebar,
				preserveCursorPosition, setPreserveCursorPosition,
				tokenHighlightMode, setTokenHighlightMode,
				tokenColorMode, setTokenColorMode,
				showProbsMode, setShowProbsMode,
				ttsEnabled, setTTSEnabled,
				ttsVoiceId, setTTSVoiceId,
				ttsPitch, setTTSPitch,
				ttsRate, setTTSRate,
				ttsVolume, setTTSVolume,
				ttsSpeakInputs, setTTSSpeakInputs,
				ttsMaxUserInput, setTTSMaxUserInput,
				isMiyapadEndpoint, sessionStorage, cancel, listTTSVoices, ttsStop, ttsAvailable, handleExportDB, handleImportDB, exportPrompt,
				useServerTokenization, setUseServerTokenization, tokenizerModel, setTokenizerModel,
				screenshotIncludeSessionName, setScreenshotIncludeSessionName,
				screenshotIncludeDate, setScreenshotIncludeDate,
				screenshotBackgroundUrl, setScreenshotBackgroundUrl,
				screenshotBackgroundColor, setScreenshotBackgroundColor,
				screenshotStoryFont, setScreenshotStoryFont,
				screenshotGeneralFont, setScreenshotGeneralFont,
				screenshotFontWeight, setScreenshotFontWeight,
				screenshotFontSize, setScreenshotFontSize,
				screenshotLineHeight, setScreenshotLineHeight,
				screenshotFontColor, setScreenshotFontColor,
				screenshotAiTextColor, setScreenshotAiTextColor,
				screenshotModelAvatarUrl, setScreenshotModelAvatarUrl
			}}/>

		<${MemoryModal}
			isOpen=${modalState.memory}
			closeModal=${() => closeModal("memory")}
			memoryTokens=${memoryTokens}
			handleMemoryTokensChange=${handleMemoryTokensChange}
			cancel=${cancel}/>

		<${AuthorNoteModal}
			isOpen=${modalState.an}
			closeModal=${() => closeModal("an")}
			authorNoteTokens=${authorNoteTokens}
			handleauthorNoteTokensChange=${handleauthorNoteTokensChange}
			authorNoteDepth=${authorNoteDepth}
			setAuthorNoteDepth=${setAuthorNoteDepth}
			cancel=${cancel}/>

		<${ContextModal}
			isOpen=${modalState.context}
			closeModal=${() => closeModal("context")}
			tokens=${tokens}
			memoryTokens=${memoryTokens}
			authorNoteTokens=${authorNoteTokens}
			handleMemoryTokensChange=${handleMemoryTokensChange}
			finalPromptText=${useChatAPI ? JSON.stringify(convertChatToJSON(finalPromptText, templates[selectedTemplate]), null, 4) : finalPromptText}
			defaultPresets=${defaultPresets}
			cancel=${cancel}/>

		<${WorldInfoModal}
			isOpen=${modalState.wi}
			closeModal=${() => closeModal("wi")}
			worldInfo=${worldInfo}
			setWorldInfo=${setWorldInfo}
			toggleModal=${toggleModal}
			setSillyTarvernWorldInfoJSON=${setSillyTarvernWorldInfoJSON}
			cancel=${cancel}/>

		<${WorldInfoSelectImportBehaviorModal}
			isOpen=${modalState.wiImportMode}
			closeModal=${() => closeModal("wiImportMode")}
			setWorldInfo=${setWorldInfo}
			sillyTarvernWorldInfoJSON=${sillyTarvernWorldInfoJSON}
			cancel=${cancel}/>

		<!-- TODO: The amount of parameters in this modal is a bit excessive... -->
		<${LogitBiasModal}
			isOpen=${modalState.bias}
			closeModal=${() => closeModal("bias")}
			biasState=${{ logitBias, setLogitBias, logitBiasParam, setLogitBiasParam, setRejectedAPIKey }}
			apiConfig=${{ sessionStorage, endpoint, endpointAPI, endpointAPIKey, isMiyapadEndpoint, useServerTokenization }}
			cancel=${cancel}/>

		<!-- Sorry. -->
		<${InstructTemplatesModal}
			isOpen=${modalState.instructTemplates}
			closeModal=${() => closeModal("instructTemplates")}
			templateList=${templateList}
			setTemplateList=${setTemplateList}
			selectedTemplate=${selectedTemplate}
			setSelectedTemplate=${setSelectedTemplate}
			templatesImport=${templatesImport}
			templates=${templates}
			setTemplates=${setTemplates}
			templateStorage=${templateStorage}
			cancel=${cancel}
			applyChatTemplate=${applyChatTemplate}/>

		<${GrammarModal}
			isOpen=${modalState.grammar}
			closeModal=${() => closeModal("grammar")}
			grammar=${grammar}
			setGrammar=${setGrammar}
			endpointAPI=${endpointAPI}
			cancel=${cancel}/>

		<${InstructModal}
			isOpen=${modalState.instruct}
			closeModal=${() => {
				closeModal("instruct");
				promptArea.current.focus();
				promptArea.current.setSelectionRange(instructModalState.selectionStart, instructModalState.selectionEnd);
			}}
			predict=${predict}
			cancel=${cancel}
			modalState=${instructModalState}
			templates=${templates}
			selectedTemplate=${selectedTemplate}
			lastError=${lastError}
			sessionEndpointConnecting=${sessionEndpointConnecting}
			predictStartTokens=${predictStartTokens}
			tokens=${tokens}
			stoppingStringsError=${stoppingStringsError}
			drySequenceBreakersError=${drySequenceBreakersError}
			bannedTokensError=${bannedTokensError}/>

		<${ThemeManagerModal}
			isOpen=${modalState.themes}
			closeModal=${() => closeModal("themes")}
			allThemes=${allThemes}
			setAllThemes=${setAllThemes}
			currentThemeName=${currentThemeName}
			setCurrentThemeName=${setCurrentThemeName}
			cancel=${cancel}/>

		<${AIHordeSettingsModal}
			isOpen=${modalState.horde}
			closeModal=${() => closeModal("horde")}
			endpoint=${endpoint}
			endpointAPIKey=${endpointAPIKey}
			setEndpointAPIKey=${setEndpointAPIKey}
			isMiyapadEndpoint=${isMiyapadEndpoint}
			sessionStorage=${sessionStorage}
			endpointModel=${endpointModel}
			setEndpointModel=${setEndpointModel}
			cancel=${cancel}/>

		<${CompressionInfoModal}
			isOpen=${modalState.compression}
			closeModal=${() => closeModal("compression")}/>

		<${SessionsModal}
			isOpen=${modalState.sessions}
			closeModal=${() => closeModal("sessions")}
			sessionStorage=${sessionStorage}
			cancel=${cancel}/>

		<${EditorContextMenu}
			isOpen=${contextMenuState.visible}
			closeMenu=${() => setContextMenuState({ visible: false, x: 0, y: 0 })}
			x=${contextMenuState.x}
			y=${contextMenuState.y}
			menuItems=${[
				{
					label: 'Instruct Here...',
					action: () => {
						const elem = promptArea.current;
						if (!elem)
							return;

						const startPos = elem.selectionStart;
						const endPos = elem.selectionEnd;

						setInstructModalState({
							selectionStart: startPos,
							selectionEnd: endPos,
							instructContext: elem.value.substring(0, startPos) || "",
							selectedText: elem.value.substring(startPos, endPos),
						});
						toggleModal("instruct");
					},
					disabled: false
				},
				{
					label: 'Predict Here',
					action: () => {
						const elem = promptArea.current;
						if (!elem)
							return;

						if (elem.selectionStart === elem.value.length) {
							predict();
							return;
						}

						const startPos = elem.selectionStart;
						const textBefore = elem.value.substring(0, startPos) || "";
						const textAfter = elem.value.substring(startPos);

						const finalText = textBefore 
										+ '{predict}'
										+ textAfter;

						elem.value = finalText;
						if (elem.onInputHandler) elem.onInputHandler({ target: elem });
						setTriggerPredict(true);
					},
					disabled: false
				},
				{
					label: 'Fill-In-The-Middle Here',
					action: () => {
						const elem = promptArea.current;
						if (!elem)
							return;

						const startPos = elem.selectionStart;
						const textBefore = elem.value.substring(0, startPos) || "";
						const textAfter = elem.value.substring(startPos);

						const finalText = textBefore 
										+ '{fill}'
										+ textAfter;

						elem.value = finalText;
						if (elem.onInputHandler) elem.onInputHandler({ target: elem });
						setTriggerPredict(true);
					},
					disabled: templates[selectedTemplate]?.fimTemplate === undefined || templates[selectedTemplate]?.fimTemplate.length === 0
				},
				{
					label: 'Insert...',
					subItems: [
						{ 'label': 'System Template', action: () => insertTemplate("sys"), disabled: false },
						{ 'label': 'Instruct Template', action: () => insertTemplate("inst"), disabled: false },
					],
					disabled: false
				},
			]}/>

		${sessionEndpointError && html`
			<div className="modal-overlay">
				<div id="error-bar">
					<div>
						${sessionEndpointError}
					</div>
				</div>
			</div>`}
	`;
}
