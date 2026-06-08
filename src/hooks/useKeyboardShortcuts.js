import { useEffect } from 'react';
import { useSettings } from '../contexts/SettingsContext.js';
import { useGeneration } from '../contexts/GenerationContext.js';
import { useTTS } from './useTTS.js';
import { useGenerationLogic } from './useGenerationLogic.js';

export function useKeyboardShortcuts() {
	const { showPromptPreview } = useSettings();
	const { modalState, keyState, promptChunks, setPromptChunks, promptPreviewChunks, setPromptPreviewChunks, setPromptPreviewReroll, tokens, setTokens, cancel, toggleModal } = useGeneration();
	const { predict, undoAndPredict, undo, redo } = useGenerationLogic();
	const { ttsStop } = useTTS();

	useEffect(() => {
		function onKeyDown(e) {
			const { altKey, ctrlKey, metaKey, shiftKey, key, defaultPrevented } = e;
			if (defaultPrevented)
				return;
			if (Object.values(modalState).some((s) => s))
				return;
			let preventDefaultAction = true;
		switch (`${altKey}:${ctrlKey}:${metaKey}:${shiftKey}:${key}`) {
			case 'false:false:false:true:Enter':
			case 'false:true:false:false:Enter':
					predict();
					break;
				case 'false:false:false:false:Escape':
					if (cancel) {
						cancel();
					} else if (showPromptPreview && promptPreviewChunks.length !== 0) {
						setPromptPreviewChunks([]); // Discard current preview so that a new one is generated.
						setPromptPreviewReroll((r) => r + 1);
					}
					break;
				case 'false:false:false:false:Tab':
					if (!showPromptPreview || promptPreviewChunks.length === 0)
						break;

					setPromptChunks(p => [
						...p,
						...promptPreviewChunks
					]);
					setTokens(t => t + promptPreviewChunks.length);
					setPromptPreviewChunks([]);
					break;
				case 'false:true:false:false:ArrowRight':
					if (!showPromptPreview || promptPreviewChunks.length === 0)
					{
						preventDefaultAction = false;
						break;
					}

					let newPromptChunks = [ ...promptChunks ];
					let newPromptPreviewChunks = [ ...promptPreviewChunks ];
					let newTokens = tokens;

					do {
						newPromptChunks = newPromptChunks.concat(newPromptPreviewChunks.splice(0, 1));
					} while (
						newPromptPreviewChunks.length > 0 &&
						newPromptPreviewChunks[0].content[0] != " " &&
						(
							newPromptChunks.length == 0 ||
							(
								newPromptChunks.length > 0 &&
								newPromptChunks[newPromptChunks.length - 1].content[newPromptChunks[newPromptChunks.length - 1].content.length - 1] != " "
							)
						)
					)
					
					setPromptChunks(newPromptChunks);
					setPromptPreviewChunks(newPromptPreviewChunks);
					setTokens(newTokens);
					break;
				case 'false:true:false:false:r':
				case 'false:false:false:true:r':
					undoAndPredict();
					break;
				case 'false:true:false:false:z':
				case 'false:false:false:true:z':
					if (showPromptPreview) setPromptPreviewChunks([]);
					if (cancel || !undo()) return;
					break;
				case 'false:true:false:true:Z':
				case 'false:true:false:false:y':
				case 'false:false:false:true:y':
					if (showPromptPreview) setPromptPreviewChunks([]);
					if (cancel || !redo()) return;
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
					keyState.current = e;
					return;
			}

			if (preventDefaultAction)
				e.preventDefault();
		}
		function onKeyUp(e) {
			const { altKey, ctrlKey, shiftKey, key, defaultPrevented } = e;
			if (defaultPrevented)
				return;
			keyState.current = e;
		}

		window.addEventListener('keydown', onKeyDown);
		window.addEventListener('keyup', onKeyUp);
		return () => {
			window.removeEventListener('keydown', onKeyDown);
			window.removeEventListener('keyup', onKeyUp)
		};
	}, [predict, cancel]);
}
