import { html } from 'htm/react';
import { useState, useEffect } from 'react';
import { Modal } from '../Modal';
import { Checkbox } from '../controls/Checkbox';

export function InstructModal({ isOpen, closeModal, predict, cancel, modalState, templates, selectedTemplate, lastError, ...props }: any) {
	const [prompt, setPrompt] = useState("");
	const [includeContext, setIncludeContext] = useState(true);
	const [result, setResult] = useState("");

	const finish = (replace: any) => {
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

	function replacePlaceholders(string: any, placeholders: any) {
		// give placeholders as json object
		// { "placeholder":"replacement" }
		return string.replace(/\{[^}]+\}/g, function (placeholder: any) {
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
			'{selectedText}': modalState.selectedText.trim(),
		});

		if (includeContext) {
			instructPrompt = 
				modalState.instructContext + 
				prefix +
				"Wait a moment, I want to ask you something." +
				suffix +
				"Understood." +
				instructPrompt;
		}

		predict(instructPrompt, 1, (chunk: any) => {
			setResult((r) => r + chunk.content);
			return true;
		});
    };

	
	useEffect(() => {
		function onKeyDown(e: any) {
			const { altKey, ctrlKey, shiftKey, key, defaultPrevented } = e;
			if (defaultPrevented || !isOpen)
				return;
			switch (`${altKey}:${ctrlKey}:${shiftKey}:${key}`) {
				case 'false:false:true:Enter':
				case 'false:true:false:Enter':
					handlePredictInModal();
					break;
				case 'false:false:false:Escape':
				if (cancel) cancel();
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
	}, [predict, cancel]);

    return html`
        <${Modal} isOpen=${isOpen} onClose=${closeModal}
            title="Instruct"
            description="Instruct the language model without directly modifying the existing prompt text.\\nYou can incorporate any selected text by using the placeholder '{selectedText}' in your prompt.">
            ${isOpen && html`
                <div className="vbox instruct-modal-container">
                    <textarea
                        label="Prompt"
						autoFocus
						style=${{height: "200px"}}
                        value=${prompt}
                        onChange=${(e: any) => setPrompt(e.target.value)}
                        placeholder="Enter your prompt here..."
						className="wi-textarea"
						readOnly=${!!cancel}/>

					<${Checkbox} label="Include Context"
						value=${includeContext}
						onValueChange=${(v: any) => setIncludeContext(v)}/>

                    <div className="vbox">
						${!cancel && html`
							<button
								onClick=${handlePredictInModal}>
								Predict
							</button>`}
						${cancel && html`
							<button
								onClick=${() => cancel()}
								className=${cancel && !props.sessionEndpointConnecting ? (props.predictStartTokens === props.tokens ? 'processing' : 'completing') : ''}>
								Cancel
							</button>`}
						${!!lastError && html`
							<span className="error-text">${lastError}</span>`}
                    </div>

					<textarea
						label="Result"
						style=${{height: "200px"}}
						value=${result}
						onChange=${(e: any) => setResult(e.target.value)}
						readOnly=${!!cancel}
						className="wi-textarea"/>

					<button
						onClick=${() => finish(false)}
						disabled=${!!cancel}>
						Insert At Cursor
					</button>

					<button
						onClick=${() => finish(true)}
						disabled=${!modalState.selectedText || !!cancel}>
						Replace Selected
					</button>
                </div>
            `}
        </${Modal}>
    `;
}
