import { html } from 'htm/react';
import { Modal } from '../Modal';
import { InputBox } from '../controls/InputBox';

export function MemoryModal({ isOpen, closeModal, memoryTokens, handleMemoryTokensChange, cancel }) {
	return html`
		<${Modal} isOpen=${isOpen} onClose=${closeModal}
			title="Memory"
			description="This text will be added at the very top of your context.
			Prefix and suffix will be attached at the beginning or end of your memory respectively. \\n for newlines in pre/suffix.">
				<div className="hbox">
					<${InputBox} label="Prefix" type="text" placeholder="[INST]"
						readOnly=${!!cancel} value=${memoryTokens.prefix} onValueChange=${(value) => handleMemoryTokensChange("prefix", value)}/>
					<${InputBox} label="Suffix" type="text" placeholder="[/INST]"
						readOnly=${!!cancel} value=${memoryTokens.suffix} onValueChange=${(value) => handleMemoryTokensChange("suffix", value)}/>
				</div>
				<div class="relative">
					<textarea
						readOnly=${!!cancel}
						placeholder="Anything written here will be injected at the head of the prompt. Tokens here DO count towards the Context Limit."
						defaultValue=${memoryTokens.text}
						value=${memoryTokens.text}
						onInput=${(e) => handleMemoryTokensChange("text", e.target.value) }
						class="expanded-text-area-settings"
						id="memory-area-settings"/>
					<div class="token-counter">
						${memoryTokens.tokens}
					</div>
				</div>
			</${Modal}>`;
}
