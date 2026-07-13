import { html } from 'htm/react';
import { useState, useEffect, useRef } from 'react';
import { useT } from '../../i18n';
import { Modal } from '../Modal';
import { Checkbox } from '../controls/Checkbox';
import type { InstructModalState } from '../../types/contexts';

interface InstructModalProps {
  isOpen: boolean;
  closeModal: () => void;
  predict: (prompt: string, n?: number, callback?: (chunk: CompletionChunk) => boolean) => void;
  cancel: (() => void) | null;
  modalState: InstructModalState;
  templates: Record<string, InstructTemplate>;
  selectedTemplate: string;
  lastError: string | undefined;
  sessionEndpointConnecting: boolean;
  predictStartTokens: number;
  tokens: number;
}

export function InstructModal({ isOpen, closeModal, predict, cancel, modalState, templates, selectedTemplate, lastError, sessionEndpointConnecting, predictStartTokens, tokens }: InstructModalProps) {
	const t = useT();
	const [prompt, setPrompt] = useState("");
	const [includeContext, setIncludeContext] = useState(true);
	const [result, setResult] = useState("");

	const finish = (replace: boolean) => {
		modalState.result = {
			content: result,
			replace: replace
		};
		closeModal();
	};

	if (cancel) {
		const prevCloseModel = closeModal;
		closeModal = () => {
			cancel();
			prevCloseModel();
		};
	}

	function replacePlaceholders(string: string, placeholders: Record<string, string>) {
		return string.replace(/\{[^}]+\}/g, function (placeholder: string) {
			return placeholders.hasOwnProperty(placeholder)
				? placeholders[placeholder]
				: placeholder;
		}).replace(/\\n/g, '\n')
	};
    const handlePredictInModal = () => {
		setResult("");

		let [prefix,suffix] = [templates[selectedTemplate]?.instPre || "", templates[selectedTemplate]?.instSuf || ""];
		if (!(prefix || suffix))
			return;

		prefix = prefix.replace(/\\n/g,'\n');
		suffix = suffix.replace(/\\n/g,'\n');

		let instructPrompt =
			prefix +
			prompt +
			suffix;

		instructPrompt = replacePlaceholders(instructPrompt, {
			'{selectedText}': modalState.selectedText?.trim() ?? '',
		});

		if (includeContext) {
			instructPrompt = 
				(modalState.instructContext ?? '') + 
				prefix +
				"Wait a moment, I want to ask you something." +
				suffix +
				"Understood." +
				instructPrompt;
		}

		predict(instructPrompt, 1, (chunk: CompletionChunk) => {
			setResult((r) => r + chunk.content);
			return true;
		});
    };

	
	const isOpenRef = useRef(isOpen);
	isOpenRef.current = isOpen;
	const cancelRef = useRef(cancel);
	cancelRef.current = cancel;
	const handlePredictRef = useRef(handlePredictInModal);
	handlePredictRef.current = handlePredictInModal;

	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			const { altKey, ctrlKey, shiftKey, key, defaultPrevented } = e;
			if (defaultPrevented || !isOpenRef.current)
				return;
			switch (`${altKey}:${ctrlKey}:${shiftKey}:${key}`) {
				case 'false:false:true:Enter':
				case 'false:true:false:Enter':
					handlePredictRef.current();
					break;
				case 'false:false:false:Escape':
				if (cancelRef.current) cancelRef.current();
				break;
				default:
					return;
			}
			e.preventDefault();
		}

		window.addEventListener('keydown', onKeyDown);
		return () => {
			window.removeEventListener('keydown', onKeyDown);
		};
	}, []);

    return html`
        <${Modal} isOpen=${isOpen} onClose=${closeModal}
            title=${t('instruct.title')}
            description=${t('instruct.description')}>
            ${isOpen && html`
                <div className="vbox instruct-modal-container">
                    <textarea
                        label=${t('instruct.prompt')}
						autoFocus
						style=${{height: "200px"}}
                        value=${prompt}
                        onChange=${(e: Event) => setPrompt((e.target as HTMLTextAreaElement).value)}
                        placeholder=${t('instruct.placeholder')}
						className="wi-textarea"
						readOnly=${!!cancel}/>

					<${Checkbox} label=${t('instruct.includeContext')}
						value=${includeContext}
						onValueChange=${(v: boolean) => setIncludeContext(v)}/>

                    <div className="vbox">
						${!cancel && html`
							<button
								onClick=${handlePredictInModal}>
								${t('instruct.predict')}
							</button>`}
						${cancel && html`
							<button
								onClick=${() => cancel()}
								className=${cancel !== null && !sessionEndpointConnecting ? (predictStartTokens === tokens ? 'processing' : 'completing') : ''}>
								${t('instruct.cancel')}
							</button>`}
						${!!lastError && html`
							<span className="error-text">${lastError}</span>`}
                    </div>

					<textarea
						label=${t('instruct.result')}
						style=${{height: "200px"}}
						value=${result}
						onChange=${(e: Event) => setResult((e.target as HTMLTextAreaElement).value)}
						readOnly=${!!cancel}
						className="wi-textarea"/>

					<button
						onClick=${() => finish(false)}
						disabled=${!!cancel}>
						${t('instruct.insertAtCursor')}
					</button>

					<button
						onClick=${() => finish(true)}
						disabled=${!modalState.selectedText || !!cancel}>
						${t('instruct.replaceSelected')}
					</button>
                </div>
            `}
        </${Modal}>
    `;
}
