import { html } from 'htm/react';
import { useT } from '../../i18n';
import { Modal } from '../Modal';
import { InputBox } from '../controls/InputBox';

export function MemoryModal({ isOpen, closeModal, memoryTokens, handleMemoryTokensChange, cancel }: any) {
	const t = useT();
	return html`
		<${Modal} isOpen=${isOpen} onClose=${closeModal}
			title=${t('memory.title')}
			description=${t('memory.description')}>
				<div className="hbox">
					<${InputBox} label=${t('memory.prefix')} type="text" placeholder=${t('memory.prefixPlaceholder')}
						readOnly=${!!cancel} value=${memoryTokens.prefix} onValueChange=${(value: any) => handleMemoryTokensChange("prefix", value)}/>
					<${InputBox} label=${t('memory.suffix')} type="text" placeholder=${t('memory.suffixPlaceholder')}
						readOnly=${!!cancel} value=${memoryTokens.suffix} onValueChange=${(value: any) => handleMemoryTokensChange("suffix", value)}/>
				</div>
				<div class="relative">
					<textarea
						readOnly=${!!cancel}
						placeholder=${t('memory.textareaPlaceholder')}
						defaultValue=${memoryTokens.text}
						value=${memoryTokens.text}
						onInput=${(e: any) => handleMemoryTokensChange("text", e.target.value) }
						class="expanded-text-area-settings"
						id="memory-area-settings"/>
					<div class="token-counter">
						${memoryTokens.tokens}
					</div>
				</div>
			</${Modal}>`;
}
