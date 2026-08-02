import { useEffect, useEffectEvent } from 'react';
import { useGeneration } from '../contexts/GenerationContext';
import { useTTS } from './useTTS';
import { useGenerationLogic } from './useGenerationLogic';

export function useKeyboardShortcuts() {
	const { modalState, keyState, promptChunks, setPromptChunks, tokens, setTokens, cancel, toggleModal } = useGeneration();
	const { predict, undoAndPredict, undo, redo } = useGenerationLogic();
	const { ttsStop } = useTTS();

	const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
		const { altKey, ctrlKey, metaKey, shiftKey, key, defaultPrevented } = e;
		if (defaultPrevented)
			return;
		if (Object.values(modalState).some((s) => s))
			return;
		keyState.current[key] = true;
		let preventDefaultAction = true;
		switch (`${altKey}:${ctrlKey}:${metaKey}:${shiftKey}:${key}`) {
		case 'false:false:false:true:Enter':
		case 'false:true:false:false:Enter':
				predict();
				break;
			case 'false:false:false:false:Escape':
				if (cancel) {
					cancel();
				}
				break;
			case 'false:true:false:false:ArrowRight': {
				preventDefaultAction = false;
				break;
			}
			case 'false:true:false:false:r':
			case 'false:false:false:true:r':
				undoAndPredict();
				break;
		case 'false:true:false:false:z':
		case 'false:false:false:true:z':
			if (cancel) cancel();
			if (!undo()) return;
			break;
		case 'false:true:false:true:Z':
		case 'false:true:false:false:y':
		case 'false:false:false:true:y':
			if (cancel) cancel();
			if (!redo()) return;
			break;
			case 'false:true:false:false:e':
			case 'false:false:false:true:e':
				ttsStop();
				break;
			case 'false:true:false:false:f':
			case 'false:false:false:true:f':
				toggleModal("searchAndReplace");
				break;
			case 'false:false:true:false:p':
			case 'false:true:false:false:p':
				toggleModal("quickSwitcher");
				break;
			
			default:
				return;
		}

		if (preventDefaultAction)
			e.preventDefault();
	});

	const onKeyUp = useEffectEvent((e: KeyboardEvent) => {
		const { key, defaultPrevented } = e;
		if (defaultPrevented)
			return;
		keyState.current[key] = false;
	});

	useEffect(() => {
		window.addEventListener('keydown', onKeyDown);
		window.addEventListener('keyup', onKeyUp);
		return () => {
			window.removeEventListener('keydown', onKeyDown);
			window.removeEventListener('keyup', onKeyUp)
		};
	}, []);
}
