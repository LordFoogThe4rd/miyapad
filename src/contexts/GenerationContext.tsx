import { html } from 'htm/react';
import { createContext, useContext, useState, useRef, useCallback, type ReactNode, type Dispatch, type SetStateAction } from 'react';
import { defaultPresets } from '../defaults/presets';
import type { GenerationState, InstructModalState, ProbsDelayTimerValue } from '../types/contexts';
import type { EditorAdapter } from '../editor/EditorAdapter';

export const GenerationContext = createContext<GenerationState | null>(null);

export function GenerationProvider({ children, useSessionState }: { children: ReactNode; useSessionState: <T>(name: string, initialState: T) => [T, Dispatch<SetStateAction<T>>] }) {
	const promptEditorView = useRef<EditorAdapter>(null);
	const [promptEditorVersion, setPromptEditorVersion] = useState(0);
	const undoStack = useRef<(number | PromptChunk[])[]>([]);
	const redoStack = useRef<PromptChunk[][]>([]);
	const probsDelayTimer = useRef<ProbsDelayTimerValue | undefined>(undefined);
	const keyState = useRef<Record<string, boolean>>({});
	const sessionReconnectTimer = useRef<number | undefined>(undefined);
	const useScrollSmoothing = useRef(true);
	const hordeTaskId = useRef<string | undefined>(undefined);
	const lastEditMsRef = useRef(0);

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
	const [modalState, setModalState] = useState<Record<string, boolean>>({});
	const [contextMenuState, setContextMenuState] = useState({ visible: false, x: 0, y: 0 });
	const [instructModalState, setInstructModalState] = useState<InstructModalState>({});
	const [hordeQueuePos, setHordeQueuePos] = useState(undefined);
	const [hordeProcessing, setHordeProcessing] = useState(false);
	const [ttsAvailable, setTTSAvailable] = useState(true);
	
	const toggleModal = (modalKey: string) => {
		setShowProbs(false);
		setModalState((prevState) => ({
			...prevState,
			[modalKey]: !prevState[modalKey],
		}));
	};

	const closeModal = (modalKey: string) => {
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

	const replaceEditorText = useCallback((newText: string) => {
		const adapter = promptEditorView.current;
		if (!adapter) return;
		adapter.replaceText(newText);
	}, []);

	const state = {
		promptEditorView, promptEditorVersion, setPromptEditorVersion, replaceEditorText, undoStack, redoStack, probsDelayTimer, keyState, sessionReconnectTimer,
		useScrollSmoothing, hordeTaskId, lastEditMsRef,
		promptChunks, setPromptChunks, currentPromptChunk, setCurrentPromptChunk, undoHovered, setUndoHovered,
		showProbs, setShowProbs, cancel, setCancel, sessionEndpointConnecting, setSessionEndpointConnecting,
		sessionEndpointError, setSessionEndpointError, rejectedAPIKey, setRejectedAPIKey, openaiModels, setOpenaiModels,
		tokens, setTokens, tokensPerSec, setTokensPerSec, predictStartTokens, setPredictStartTokens, lastError, setLastError,
		savedScrollTop, setSavedScrollTop, modalState, setModalState, contextMenuState, setContextMenuState,
		instructModalState, setInstructModalState, hordeQueuePos, setHordeQueuePos, hordeProcessing, setHordeProcessing,
		ttsAvailable, setTTSAvailable,
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
