import { html } from 'htm/react';
import { createContext, useContext, useState, useRef, type ReactNode, type Dispatch, type SetStateAction } from 'react';
import { defaultPresets } from '../defaults/presets';
import type { GenerationState } from '../types/contexts';

export const GenerationContext = createContext<GenerationState | null>(null);

export function GenerationProvider({ children, useSessionState }: { children: ReactNode; useSessionState: <T>(name: string, initialState: T) => [T, Dispatch<SetStateAction<T>>] }) {
	const promptArea = useRef<HTMLTextAreaElement>(null);
	const promptOverlay = useRef<HTMLDivElement>(null);
	const undoStack = useRef<number[]>([]);
	const redoStack = useRef<any[][]>([]);
	const probsDelayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const keyState = useRef<Record<string, boolean>>({});
	const sessionReconnectTimer = useRef<number | undefined>(undefined);
	const useScrollSmoothing = useRef(true);
	const hordeTaskId = useRef<string | undefined>(undefined);
	const promptPreviewElement = useRef<HTMLSpanElement>(null);
	const markdownPreviewRef = useRef<HTMLDivElement>(null);
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
	const [modalState, setModalState] = useState<Record<string, any>>({});
	const [contextMenuState, setContextMenuState] = useState({ visible: false, x: 0, y: 0 });
	const [instructModalState, setInstructModalState] = useState({});
	const [hordeQueuePos, setHordeQueuePos] = useState(undefined);
	const [hordeProcessing, setHordeProcessing] = useState(false);
	const [promptPreviewChunks, setPromptPreviewChunks] = useState([]);
	const [promptPreviewReroll, setPromptPreviewReroll] = useState(0);
	const [ttsAvailable, setTTSAvailable] = useState(true);
	
	const toggleModal = (modalKey: any) => {
		setShowProbs(false);
		setModalState((prevState) => ({
			...prevState,
			[modalKey]: !prevState[modalKey],
		}));
	};

	const closeModal = (modalKey: any) => {
		setModalState((prevState) => ({
			...prevState,
			[modalKey]: false,
		}));
	};
	
	const ttsNewText = useRef("");
	const ttsLastChunk = useRef("");
	const ttsQueue = useRef<string[]>([]);
	const ttsVoices = useRef<SpeechSynthesisVoice[]>([]);
	const ttsPaused = useRef(false);

	const activeGenId = useRef(0);
	const abortControllerRef = useRef<AbortController | null>(null);

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

export const useGeneration = () => {
  const ctx = useContext(GenerationContext);
  if (!ctx) throw new Error('useGeneration must be used within a GenerationProvider');
  return ctx;
};
