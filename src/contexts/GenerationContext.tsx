import { html } from 'htm/react';
import { createContext, useContext, useState, useRef } from 'react';
import { defaultPresets } from '../defaults/presets';

export const GenerationContext = createContext(null);

export function GenerationProvider({ children, useSessionState }) {
	const promptArea = useRef();
	const promptOverlay = useRef();
	const undoStack = useRef([]);
	const redoStack = useRef([]);
	const probsDelayTimer = useRef();
	const keyState = useRef({});
	const sessionReconnectTimer = useRef();
	const useScrollSmoothing = useRef(true);
	const hordeTaskId = useRef();
	const promptPreviewElement = useRef();
	const markdownPreviewRef = useRef(null);
	const isSyncingScroll = useRef(false);

	const [promptChunks, setPromptChunks] = useSessionState('prompt', defaultPresets.prompt);
	const [currentPromptChunk, setCurrentPromptChunk] = useState(undefined);
	const [undoHovered, setUndoHovered] = useState(false);
	const [showProbs, setShowProbs] = useState(true);
	const [cancel, setCancel] = useState(null);
	const [sessionEndpointConnecting, setSessionEndpointConnecting] = useState(false);
	const [sessionEndpointError, setSessionEndpointError] = useState(undefined);
	const [rejectedAPIKey, setRejectedAPIKey] = useState(false);
	const [openaiModels, setOpenaiModels] = useState([]);
	const [tokens, setTokens] = useState(0);
	const [tokensPerSec, setTokensPerSec] = useState(0.0);
	const [predictStartTokens, setPredictStartTokens] = useState(0);
	const [lastError, setLastError] = useState(undefined);
	const [savedScrollTop, setSavedScrollTop] = useSessionState('scrollTop', defaultPresets.scrollTop);
	const [modalState, setModalState] = useState({});
	const [contextMenuState, setContextMenuState] = useState({ visible: false, x: 0, y: 0 });
	const [instructModalState, setInstructModalState] = useState({});
	const [hordeQueuePos, setHordeQueuePos] = useState(undefined);
	const [hordeProcessing, setHordeProcessing] = useState(false);
	const [promptPreviewChunks, setPromptPreviewChunks] = useState([]);
	const [promptPreviewReroll, setPromptPreviewReroll] = useState(0);
	const [ttsAvailable, setTTSAvailable] = useState(true);
	
	const toggleModal = (modalKey) => {
		setShowProbs(false);
		setModalState((prevState) => ({
			...prevState,
			[modalKey]: !prevState[modalKey],
		}));
	};

	const closeModal = (modalKey) => {
		setModalState((prevState) => ({
			...prevState,
			[modalKey]: false,
		}));
	};
	
	const ttsNewText = useRef("");
	const ttsLastChunk = useRef("");
	const ttsQueue = useRef([]);
	const ttsVoices = useRef([]);
	const ttsPaused = useRef(false);

	const activeGenId = useRef(0);
	const abortControllerRef = useRef(null);

	const [triggerPredict, setTriggerPredict] = useState(false);
	const [restartedPredict, setRestartedPredict] = useState(false);

	const state = {
		promptArea, promptOverlay, undoStack, redoStack, probsDelayTimer, keyState, sessionReconnectTimer,
		useScrollSmoothing, hordeTaskId, promptPreviewElement, markdownPreviewRef, isSyncingScroll,
		promptChunks, setPromptChunks, currentPromptChunk, setCurrentPromptChunk, undoHovered, setUndoHovered,
		showProbs, setShowProbs, cancel, setCancel, sessionEndpointConnecting, setSessionEndpointConnecting,
		sessionEndpointError, setSessionEndpointError, rejectedAPIKey, setRejectedAPIKey, openaiModels, setOpenaiModels,
		tokens, setTokens, tokensPerSec, setTokensPerSec, predictStartTokens, setPredictStartTokens, lastError, setLastError,
		savedScrollTop, setSavedScrollTop, modalState, setModalState, contextMenuState, setContextMenuState,
		instructModalState, setInstructModalState, hordeQueuePos, setHordeQueuePos, hordeProcessing, setHordeProcessing,
		promptPreviewChunks, setPromptPreviewChunks, promptPreviewReroll, setPromptPreviewReroll, ttsAvailable, setTTSAvailable,
		ttsNewText, ttsLastChunk, ttsQueue, ttsVoices, ttsPaused, activeGenId, abortControllerRef, triggerPredict, setTriggerPredict, restartedPredict, setRestartedPredict,
		toggleModal, closeModal
	};

	return html`
		<${GenerationContext.Provider} value=${state}>
			${children}
		</${GenerationContext.Provider}>
	`;
}

export const useGeneration = () => useContext(GenerationContext);
