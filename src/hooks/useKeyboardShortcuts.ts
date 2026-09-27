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
		// Letters go by their lowercase form: Caps Lock flips a letter's case, and must not
		// change which shortcut it is. Shift alone never makes a letter a shortcut, or it
		// couldn't be typed as a capital.
		const name = key.length === 1 ? key.toLowerCase() : key;
		switch (`${altKey}:${ctrlKey}:${metaKey}:${shiftKey}:${name}`) {
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
				undoAndPredict();
				break;
		case 'false:true:false:false:z':
			if (cancel) cancel();
			if (!undo()) return;
			break;
		case 'false:true:false:true:z':
		case 'false:true:false:false:y':
			if (cancel) cancel();
			if (!redo()) return;
			break;
			case 'false:true:false:false:e':
				ttsStop();
				break;
			case 'false:true:false:false:f':
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
		delete keyState.current[key];
	});

	const onBlur = useEffectEvent(() => {
		for (const k in keyState.current)
			delete keyState.current[k];
	});

	useEffect(() => {
		window.addEventListener('keydown', onKeyDown);
		window.addEventListener('keyup', onKeyUp);
		window.addEventListener('blur', onBlur);
		return () => {
			window.removeEventListener('keydown', onKeyDown);
			window.removeEventListener('keyup', onKeyUp);
			window.removeEventListener('blur', onBlur);
		};
	}, []);
}
