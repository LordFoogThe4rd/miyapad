import { html } from 'htm/react';
import { createContext, useContext, useState, useEffect } from 'react';
import { usePersistentState } from '../hooks/usePersistentState.js';
import { defaultPresets } from '../defaults/presets.js';
import { defaultThemes } from '../defaults/themes.js';

export const SettingsContext = createContext(null);

export function SettingsProvider({ children, sessionStorage, templateStorage, themeStorage, useSessionState, useDBTemplates, useDBThemes, isMikupadEndpoint }) {
	const [templates, setTemplates] = useDBTemplates(defaultPresets.instructTemplates);
	const [templateReplacements, setTemplateReplacements] = useState(false);
	const [templatesImport, setTemplatesImport] = useState(false);
	const [selectedTemplate, setSelectedTemplate] = useSessionState('template', "Mistral");
	const [chatMode, setChatMode] = useSessionState('chatMode', false);
	const [templateList, setTemplateList] = useState([]);

	useEffect(() => {
		setTemplateList(Object.keys(templates).sort((a, b) => a.localeCompare(b)).map(name => ({
			name: name,
			nameNew: name,
			value: name,
			nameBack: name,
			affixes: templates[name]
		})));
	}, [templates]);
	const [fontSizeMultiplier, setFontSizeMultiplier] = usePersistentState('fontSizeMult', 1.0);
	const [spellCheck, setSpellCheck] = usePersistentState('spellCheck', false);
	const [attachSidebar, setAttachSidebar] = usePersistentState('attachSidebar', false);
	const [showProbsMode, setShowProbsMode] = usePersistentState('showProbsMode', 0);
	const [hideChatTemplates, setHideChatTemplates] = useSessionState('hideChatTemplates', false);
	const [systemPromptModeText, setSystemPromptModeText] = useSessionState('systemPromptModeText', "");
	const [editorFont, setEditorFont] = usePersistentState('editorFont', 'Default');
	const [uiFont, setUIFont] = usePersistentState('uiFont', 'Default');
	const [__highlightGenTokens, __1] = usePersistentState('highlightGenTokens', true); // obsolete!
	const [tokenHighlightMode, setTokenHighlightMode] = usePersistentState('tokenHighlightMode', __highlightGenTokens ? 0 : -1);
	const [__colorizePerplexity, __2] = usePersistentState('colorizePerplexity', false); // obsolete!
	const [tokenColorMode, setTokenColorMode] = usePersistentState('tokenColorMode', __colorizePerplexity ? 2 : 0);
	const [preserveCursorPosition, setPreserveCursorPosition] = usePersistentState('preserveCursorPosition', true);
	const [promptAreaWidth, setPromptAreaWidth] = usePersistentState('promptAreaWidth', undefined);
	const [__theme, __3] = usePersistentState('theme', 0); // obsolete!
	const [showAPIKey, setShowAPIKey] = useState(false);
	const [endpoint, setEndpoint] = useSessionState('endpoint', defaultPresets.endpoint);
	const [endpointAPI, setEndpointAPI] = useSessionState('endpointAPI', defaultPresets.endpointAPI);
	const [endpointAPIKey, setEndpointAPIKey] = useSessionState('endpointAPIKey', defaultPresets.endpointAPIKey);
	const [endpointModel, setEndpointModel] = useSessionState('endpointModel', defaultPresets.endpointModel);
	const [seed, setSeed] = useSessionState('seed', defaultPresets.seed);
	const [maxPredictTokens, setMaxPredictTokens] = useSessionState('maxPredictTokens', defaultPresets.maxPredictTokens);
	const [temperature, setTemperature] = useSessionState('temperature', defaultPresets.temperature);
	const [dynaTempRange, setDynaTempRange] = useSessionState('dynaTempRange', defaultPresets.dynaTempRange);
	const [dynaTempExp, setDynaTempExp] = useSessionState('dynaTempExp', defaultPresets.dynaTempExp);
	const [repeatPenalty, setRepeatPenalty] = useSessionState('repeatPenalty', defaultPresets.repeatPenalty);
	const [repeatLastN, setRepeatLastN] = useSessionState('repeatLastN', defaultPresets.repeatLastN);
	const [penalizeNl, setPenalizeNl] = useSessionState('penalizeNl', defaultPresets.penalizeNl);
	const [presencePenalty, setPresencePenalty] = useSessionState('presencePenalty', defaultPresets.presencePenalty);
	const [frequencyPenalty, setFrequencyPenalty] = useSessionState('frequencyPenalty', defaultPresets.frequencyPenalty);
	const [topK, setTopK] = useSessionState('topK', defaultPresets.topK);
	const [topP, setTopP] = useSessionState('topP', defaultPresets.topP);
	const [typicalP, setTypicalP] = useSessionState('typicalP', defaultPresets.typicalP);
	const [minP, setMinP] = useSessionState('minP', defaultPresets.minP);
	const [tfsZ, setTfsZ] = useSessionState('tfsZ', defaultPresets.tfsZ);
	const [mirostat, setMirostat] = useSessionState('mirostat', defaultPresets.mirostat);
	const [mirostatTau, setMirostatTau] = useSessionState('mirostatTau', defaultPresets.mirostatTau);
	const [mirostatEta, setMirostatEta] = useSessionState('mirostatEta', defaultPresets.mirostatEta);
	const [xtcThreshold, setXtcThreshold] = useSessionState('xtcThreshold', defaultPresets.xtcThreshold);
	const [xtcProbability, setXtcProbability] = useSessionState('xtcProbability', defaultPresets.xtcProbability);
	const [dryMultiplier, setDryMultiplier] = useSessionState('dryMultiplier', defaultPresets.dryMultiplier);
	const [dryBase, setDryBase] = useSessionState('dryBase', defaultPresets.dryBase);
	const [dryAllowedLength, setDryAllowedLength] = useSessionState('dryAllowedLength', defaultPresets.dryAllowedLength);
	const [dryPenaltyRange, setDryPenaltyRange] = useSessionState('dryPenaltyRange', defaultPresets.dryPenaltyRange);
	const [drySequenceBreakers, setDrySequenceBreakers] = useSessionState('drySequenceBreakers', defaultPresets.drySequenceBreakers);
	const [drySequenceBreakersError, setDrySequenceBreakersError] = useState(undefined);
	const [bannedTokens, setBannedTokens] = useSessionState('bannedTokens', defaultPresets.bannedTokens);
	const [bannedTokensError, setBannedTokensError] = useState(undefined);
	const [ignoreEos, setIgnoreEos] = useSessionState('ignoreEos', defaultPresets.ignoreEos);
	const [openaiPresets, setOpenaiPresets] = useSessionState('openaiPresets', defaultPresets.openaiPresets);
	const [stoppingStrings, setStoppingStrings] = useSessionState('stoppingStrings', defaultPresets.stoppingStrings);
	const [stoppingStringsError, setStoppingStringsError] = useState(undefined);
	const [useBasicStoppingMode, setUseBasicStoppingMode] = useSessionState('useBasicStoppingMode', stoppingStrings != '[]' ? false : defaultPresets.useBasicStoppingMode);
	const [basicStoppingModeType, setBasicStoppingModeType] = useSessionState('basicStoppingModeType', defaultPresets.basicStoppingModeType);
	const [logitBias, setLogitBias] = useSessionState('logitBias', defaultPresets.logitBias);
	const [logitBiasParam, setLogitBiasParam] = useState({});
	const [contextLength, setContextLength] = useSessionState('contextLength', defaultPresets.contextLength);
	const [memoryTokens, setMemoryTokens] = useSessionState('memoryTokens', defaultPresets.memoryTokens);
	const [authorNoteTokens, setAuthorNoteTokens] = useSessionState('authorNoteTokens', defaultPresets.authorNoteTokens);
	const [authorNoteDepth, setAuthorNoteDepth] = useSessionState('authorNoteDepth', defaultPresets.authorNoteDepth);
	const [worldInfo, setWorldInfo] = useSessionState('worldInfo', defaultPresets.worldInfo);
	const [sillyTarvernWorldInfoJSON, setSillyTarvernWorldInfoJSON] = useState(null);
	const [enabledSamplers, setEnabledSamplers] = useSessionState('enabledSamplers', defaultPresets.enabledSamplers);
	const [grammar, setGrammar] = useSessionState('grammar', defaultPresets.grammar);
	const [useChatAPI, setUseChatAPI] = useSessionState('chatAPI', defaultPresets.chatAPI);
	const [useTokenStreaming, setUseTokenStreaming] = useSessionState('tokenStreaming', defaultPresets.tokenStreaming);
	const [disableLogprobs, setDisableLogprobs] = useSessionState('disableLogprobs', defaultPresets.disableLogprobs);
	const [postSamplingProbs, setPostSamplingProbs] = useSessionState('postSamplingProbs', true);
	const [showPromptPreview, setShowPromptPreview] = useSessionState('promptPreview', defaultPresets.promptPreview);
	const [promptPreviewTokens, setPromptPreviewTokens] = useSessionState('promptPreviewTokens', defaultPresets.promptPreviewTokens);
    const [currentThemeName, setCurrentThemeName] = usePersistentState('themeName', (() => {
		switch (__theme) {
		case 1: return "Serif Dark";
		case 2: return "Monospace Dark";
		case 3: return "NockoffAI";
		case 4: return "E-Reader";
		default: return "Serif Light";
		}
	})());
    const [allThemes, setAllThemes] = useDBThemes(defaultThemes);
	const [showMarkdownPreview, setShowMarkdownPreview] = usePersistentState('showMarkdownPreview', false);
	const [ttsEnabled, setTTSEnabled] = usePersistentState('ttsEnabled', false);
	const [ttsVoiceId, setTTSVoiceId] = usePersistentState('ttsVoiceId', 0);
	const [ttsPitch, setTTSPitch] = usePersistentState('ttsPitch', 1);
	const [ttsRate, setTTSRate] = usePersistentState('ttsRate', 1);
	const [ttsVolume, setTTSVolume] = usePersistentState('ttsVolume', 1);
	const [ttsSpeakInputs, setTTSSpeakInputs] = usePersistentState('ttsSpeakInputs', true);
	const [ttsMaxUserInput, setTTSMaxUserInput] = usePersistentState('ttsMaxUserInput', 50);

	const [useServerTokenization, setUseServerTokenization] = usePersistentState('useServerTokenization', false);
const [tokenizerModel, setTokenizerModel] = usePersistentState('tokenizerModel', null);

const [screenshotIncludeSessionName, setScreenshotIncludeSessionName] = usePersistentState('screenshotIncludeSessionName', true);
	const [screenshotIncludeDate, setScreenshotIncludeDate] = usePersistentState('screenshotIncludeDate', true);
	const [screenshotBackgroundUrl, setScreenshotBackgroundUrl] = usePersistentState('screenshotBackgroundUrl', '');
	const [screenshotBackgroundColor, setScreenshotBackgroundColor] = usePersistentState('screenshotBackgroundColor', '#121212');
	const [screenshotStoryFont, setScreenshotStoryFont] = usePersistentState('screenshotStoryFont', 'Open Sans');
	const [screenshotGeneralFont, setScreenshotGeneralFont] = usePersistentState('screenshotGeneralFont', 'Open Sans');
	const [screenshotFontWeight, setScreenshotFontWeight] = usePersistentState('screenshotFontWeight', '400');
	const [screenshotFontSize, setScreenshotFontSize] = usePersistentState('screenshotFontSize', 18);
	const [screenshotLineHeight, setScreenshotLineHeight] = usePersistentState('screenshotLineHeight', 28);
	const [screenshotFontColor, setScreenshotFontColor] = usePersistentState('screenshotFontColor', '#c0c0c0');
	const [screenshotAiTextColor, setScreenshotAiTextColor] = usePersistentState('screenshotAiTextColor', '#eac055');
	const [screenshotModelAvatarUrl, setScreenshotModelAvatarUrl] = usePersistentState('screenshotModelAvatarUrl', '');

	const state = {
		sessionStorage, templateStorage, themeStorage, useSessionState, useDBTemplates, useDBThemes, isMikupadEndpoint,
		templates, setTemplates, templateReplacements, setTemplateReplacements, templatesImport, setTemplatesImport,
		selectedTemplate, setSelectedTemplate, chatMode, setChatMode, templateList, setTemplateList,
		fontSizeMultiplier, setFontSizeMultiplier, spellCheck, setSpellCheck, attachSidebar, setAttachSidebar,
		showProbsMode, setShowProbsMode, hideChatTemplates, setHideChatTemplates, systemPromptModeText, setSystemPromptModeText,
		editorFont, setEditorFont, uiFont, setUIFont,
		tokenHighlightMode, setTokenHighlightMode, tokenColorMode, setTokenColorMode,
		preserveCursorPosition, setPreserveCursorPosition, promptAreaWidth, setPromptAreaWidth, showAPIKey, setShowAPIKey,
		endpoint, setEndpoint, endpointAPI, setEndpointAPI, endpointAPIKey, setEndpointAPIKey, endpointModel, setEndpointModel,
		seed, setSeed, maxPredictTokens, setMaxPredictTokens, temperature, setTemperature, dynaTempRange, setDynaTempRange,
		dynaTempExp, setDynaTempExp, repeatPenalty, setRepeatPenalty, repeatLastN, setRepeatLastN, penalizeNl, setPenalizeNl,
		presencePenalty, setPresencePenalty, frequencyPenalty, setFrequencyPenalty, topK, setTopK, topP, setTopP, typicalP, setTypicalP,
		minP, setMinP, tfsZ, setTfsZ, mirostat, setMirostat, mirostatTau, setMirostatTau, mirostatEta, setMirostatEta,
		xtcThreshold, setXtcThreshold, xtcProbability, setXtcProbability, dryMultiplier, setDryMultiplier, dryBase, setDryBase,
		dryAllowedLength, setDryAllowedLength, dryPenaltyRange, setDryPenaltyRange, drySequenceBreakers, setDrySequenceBreakers,
		drySequenceBreakersError, setDrySequenceBreakersError, bannedTokens, setBannedTokens, bannedTokensError, setBannedTokensError,
		ignoreEos, setIgnoreEos, openaiPresets, setOpenaiPresets, stoppingStrings, setStoppingStrings, stoppingStringsError, setStoppingStringsError,
		useBasicStoppingMode, setUseBasicStoppingMode, basicStoppingModeType, setBasicStoppingModeType, logitBias, setLogitBias,
		logitBiasParam, setLogitBiasParam, contextLength, setContextLength, memoryTokens, setMemoryTokens, authorNoteTokens, setAuthorNoteTokens,
		authorNoteDepth, setAuthorNoteDepth, worldInfo, setWorldInfo, sillyTarvernWorldInfoJSON, setSillyTarvernWorldInfoJSON,
		enabledSamplers, setEnabledSamplers, grammar, setGrammar, useChatAPI, setUseChatAPI, useTokenStreaming, setUseTokenStreaming,
		disableLogprobs, setDisableLogprobs, postSamplingProbs, setPostSamplingProbs, showPromptPreview, setShowPromptPreview,
		promptPreviewTokens, setPromptPreviewTokens, currentThemeName, setCurrentThemeName, allThemes, setAllThemes,
		showMarkdownPreview, setShowMarkdownPreview, ttsEnabled, setTTSEnabled, ttsVoiceId, setTTSVoiceId, ttsPitch, setTTSPitch,
		ttsRate, setTTSRate, ttsVolume, setTTSVolume, ttsSpeakInputs, setTTSSpeakInputs, ttsMaxUserInput, setTTSMaxUserInput,
		useServerTokenization, setUseServerTokenization, tokenizerModel, setTokenizerModel,
		screenshotIncludeSessionName, setScreenshotIncludeSessionName, screenshotIncludeDate, setScreenshotIncludeDate,
		screenshotBackgroundUrl, setScreenshotBackgroundUrl, screenshotBackgroundColor, setScreenshotBackgroundColor,
		screenshotStoryFont, setScreenshotStoryFont, screenshotGeneralFont, setScreenshotGeneralFont,
		screenshotFontWeight, setScreenshotFontWeight, screenshotFontSize, setScreenshotFontSize,
		screenshotLineHeight, setScreenshotLineHeight, screenshotFontColor, setScreenshotFontColor,
		screenshotAiTextColor, setScreenshotAiTextColor, screenshotModelAvatarUrl, setScreenshotModelAvatarUrl
	};

	return html`
		<${SettingsContext.Provider} value=${state}>
			${children}
		</${SettingsContext.Provider}>
	`;
}

export const useSettings = () => useContext(SettingsContext);
