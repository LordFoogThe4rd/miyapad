import { html } from 'htm/react';
import { useEffect, useState } from 'react';
import { useSettings } from '../contexts/SettingsContext';
import { useGeneration } from '../contexts/GenerationContext';
import { useTokenCounters } from '../hooks/useTokenCounters';
import { usePromptBuilder } from '../hooks/usePromptBuilder';
import { useTTS } from '../hooks/useTTS';
import { useGenerationLogic } from '../hooks/useGenerationLogic';
import { exportText } from '../api/common';
import { defaultPresets } from '../defaults/presets';
import { useT } from '../i18n';
import { PreferencesModal } from './modals/PreferencesModal';
import { MemoryModal } from './modals/MemoryModal';
import { AuthorNoteModal } from './modals/AuthorNoteModal';
import { ContextModal } from './modals/ContextModal';
import { WorldInfoModal } from './modals/WorldInfoModal';
import { WorldInfoSelectImportBehaviorModal } from './modals/WorldInfoSelectImportBehaviorModal';
import { LogitBiasModal } from './modals/LogitBiasModal';
import { InstructTemplatesModal } from './modals/InstructTemplatesModal';
import { GrammarModal } from './modals/GrammarModal';
import { InstructModal } from './modals/InstructModal';
import { ThemeManagerModal } from './modals/ThemeManagerModal';
import { AIHordeSettingsModal } from './modals/AIHordeSettingsModal';
import { CompressionInfoModal } from './modals/CompressionInfoModal';
import { ConnectionManagerModal } from './modals/ConnectionManagerModal';
import { SessionsModal } from './modals/SessionsModal';
import { AboutModal } from './modals/AboutModal';
import { QuickSwitcher } from './QuickSwitcher';
import { EditorContextMenu } from './EditorContextMenu';
import type { ModalsProps } from '../types/components';

export function Modals({ toggleModal, currentThemeName, setCurrentThemeName, allThemes, setAllThemes, applyChatTemplate }: ModalsProps) {
	const t = useT();
	const { endpoint, setEndpointAPIKey, endpointAPIKey, endpointAPI, endpointModel, setEndpointModel, templates, selectedTemplate, setSelectedTemplate, templatesImport, setTemplates, templateStorage, grammar, setGrammar, isMiyapadEndpoint, sessionStorage, locale, setLocale, fontSizeMultiplier, setFontSizeMultiplier, spellCheck, setSpellCheck, attachSidebar, setAttachSidebar, preserveCursorPosition, setPreserveCursorPosition, tokenHighlightMode, setTokenHighlightMode, tokenColorMode, setTokenColorMode, showProbsMode, setShowProbsMode, ttsEnabled, setTTSEnabled, ttsVoiceId, setTTSVoiceId, ttsPitch, setTTSPitch, ttsRate, setTTSRate, ttsVolume, setTTSVolume, ttsSpeakInputs, setTTSSpeakInputs, ttsMaxUserInput, setTTSMaxUserInput, useChatAPI, setUseChatAPI, memoryTokens, authorNoteTokens, authorNoteDepth, setAuthorNoteDepth, worldInfo, setWorldInfo, sillyTarvernWorldInfoJSON, setSillyTarvernWorldInfoJSON, logitBias, setLogitBias, logitBiasParam, setLogitBiasParam, templateList, setTemplateList,
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
		screenshotModelAvatarUrl, setScreenshotModelAvatarUrl,
		connections, setConnections, selectedConnectionId,
		stoppingStringsError, drySequenceBreakersError, bannedTokensError
	} = useSettings();
	const { cancel, modalState, closeModal, instructModalState, setInstructModalState, promptArea, lastError, sessionEndpointConnecting, predictStartTokens, tokens, contextMenuState, setContextMenuState, setTriggerPredict, sessionEndpointError, setRejectedAPIKey } = useGeneration();

	const { handleauthorNoteTokensChange, handleMemoryTokensChange } = useTokenCounters();
	const { finalPromptText, convertChatToJSON } = usePromptBuilder();
	const { listTTSVoices, ttsStop } = useTTS();
	const { ttsAvailable } = useGeneration();
	const { predict } = useGenerationLogic();



	const handleExportDB = async () => {
		try {
			const data = await sessionStorage.dbAdapter.exportDatabase();
			const jsonString = JSON.stringify(data, null, 2);
			exportText('miyapad_db_export.json', jsonString);
		} catch (error) {
			console.error('Failed to export database:', error);
			alert(t('modals.exportDbError'));
		}
	};

	const handleImportDB = () => {
		if (!confirm(t('modals.importDbConfirm'))) {
			return;
		}
		const fileInput = document.createElement('input');
		fileInput.type = 'file';
		fileInput.accept = '.json';
		fileInput.onchange = async () => {
			const file = fileInput.files?.[0];
			if (!file) {
				return;
			}

			const reader = new FileReader();
			reader.onload = async () => {
				try {
					const data = JSON.parse(reader.result as string);
					await sessionStorage.dbAdapter.importDatabase(data);
					window.location.reload();
				} catch (error) {
					console.error('Failed to import database:', error);
					alert(t('modals.importDbError'));
				}
			};
			reader.readAsText(file);
		};
		fileInput.click();
	};

	const exportPrompt = () => {
		const elem = promptArea.current;
		if (!elem) return;
		exportText(`${sessionStorage.getProperty('name')}.txt`, elem.value);
	};

	const insertTemplate = (sysInst: "sys" | "inst") => {
		let [prefix,suffix] = sysInst === "sys"
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
		if (elem.onInputHandler) elem.onInputHandler({ currentTarget: elem });

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

		const startPos = instructModalState.selectionStart ?? 0;
		const endPos = instructModalState.selectionEnd ?? 0;
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
		if (elem.onInputHandler) elem.onInputHandler({ currentTarget: elem });

		elem.scrollTop = scrollTop;
	}, [instructModalState.result]);

	return html`
		<${PreferencesModal}
			isOpen=${modalState.preferences}
			closeModal=${() => closeModal("preferences")}
			settings=${{
				locale, setLocale,
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
			cancel=${cancel}
			apiConfig=${{ sessionStorage, endpoint, endpointAPI, endpointAPIKey, isMiyapadEndpoint, useServerTokenization }}/>

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
				const elem = promptArea.current;
				if (elem) {
					elem.focus();
					elem.setSelectionRange(instructModalState.selectionStart ?? 0, instructModalState.selectionEnd ?? 0);
				}
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

		<${ConnectionManagerModal}
			isOpen=${modalState.connections}
			closeModal=${() => closeModal("connections")}
			connections=${connections}
			setConnections=${setConnections}
			activeConnectionId=${selectedConnectionId}/>

		<${SessionsModal}
			isOpen=${modalState.sessions}
			closeModal=${() => closeModal("sessions")}
			sessionStorage=${sessionStorage}
			cancel=${cancel}/>

		<${AboutModal}
			isOpen=${modalState.about}
			closeModal=${() => closeModal("about")}
			isMiyapadEndpoint=${isMiyapadEndpoint}/>

		<${QuickSwitcher}
			isOpen=${modalState.quickSwitcher}
			closeModal=${() => closeModal("quickSwitcher")}
			sessionStorage=${sessionStorage}
			cancel=${cancel}/>

		<${EditorContextMenu}
			isOpen=${contextMenuState.visible}
			closeMenu=${() => setContextMenuState({ visible: false, x: 0, y: 0 })}
			x=${contextMenuState.x}
			y=${contextMenuState.y}
			menuItems=${[
				{
					label: t('modals.instructHere'),
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
					label: t('modals.predictHere'),
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
						if (elem.onInputHandler) elem.onInputHandler({ currentTarget: elem });
						setTriggerPredict(true);
					},
					disabled: false
				},
				{
					label: t('modals.fillInTheMiddleHere'),
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
						if (elem.onInputHandler) elem.onInputHandler({ currentTarget: elem });
						setTriggerPredict(true);
					},
					disabled: templates[selectedTemplate]?.fimTemplate === undefined || templates[selectedTemplate]?.fimTemplate.length === 0
				},
				{
					label: t('modals.insert'),
					subItems: [
						{ 'label': t('modals.systemTemplate'), action: () => insertTemplate("sys"), disabled: false },
						{ 'label': t('modals.instructTemplate'), action: () => insertTemplate("inst"), disabled: false },
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
