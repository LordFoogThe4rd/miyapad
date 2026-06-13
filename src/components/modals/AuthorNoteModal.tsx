import { html } from 'htm/react';
import { Modal } from '../Modal';
import { InputBox } from '../controls/InputBox';

export function AuthorNoteModal({ isOpen, closeModal, authorNoteTokens, handleauthorNoteTokensChange, authorNoteDepth, setAuthorNoteDepth, cancel }) {
	const handleAuthorNoteDepthChange = (value) => {
		setAuthorNoteDepth(!isNaN(+value) && value >= 0 ? value : 0);
	};

	return html`
		<${Modal} isOpen=${isOpen} onClose=${closeModal}
			title="Author's Note"
			description="This text will be injected N newlines from the bottom of your prompt.
			Prefix and suffix will be attached at the beginning or end of your author's note respectively. \\n for newlines in pre/suffix.">
				<div className="hbox">
					<${InputBox} label="Prefix" type="text" placeholder="[INST]"
						readOnly=${!!cancel} value=${authorNoteTokens.prefix} onValueChange=${(value) => handleauthorNoteTokensChange("prefix", value)}/>
					<${InputBox} label="Suffix" type="text" placeholder="[/INST]"
						readOnly=${!!cancel} value=${authorNoteTokens.suffix} onValueChange=${(value) => handleauthorNoteTokensChange("suffix", value)}/>
					<${InputBox} label="AN Injection Depth (0-N)" type="number" step="1"
						readOnly=${!!cancel} value=${authorNoteDepth} onValueChange=${handleAuthorNoteDepthChange}/>
				</div>
				<div class="relative">
					<textarea
						readOnly=${!!cancel}
						placeholder="Anything written here will be injected ${authorNoteDepth} newlines from bottom into context."
						defaultValue=${authorNoteTokens.text}
						value=${authorNoteTokens.text}
						onInput=${(e) => handleauthorNoteTokensChange("text", e.target.value) }
						class="expanded-text-area-settings"
						id="expanded-an-settings"/>
					<div class="token-counter">
						${authorNoteTokens.tokens}
					</div>
				</div>
			</${Modal}>`;
}
