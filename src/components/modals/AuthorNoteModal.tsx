import { html } from 'htm/react';
import { useT } from '../../i18n';
import { Modal } from '../Modal';
import { InputBox } from '../controls/InputBox';

export function AuthorNoteModal({ isOpen, closeModal, authorNoteTokens, handleauthorNoteTokensChange, authorNoteDepth, setAuthorNoteDepth, cancel }: any) {
	const t = useT();
	const handleAuthorNoteDepthChange = (value: any) => {
		setAuthorNoteDepth(!isNaN(+value) && value >= 0 ? value : 0);
	};

	return html`
		<${Modal} isOpen=${isOpen} onClose=${closeModal}
			title=${t('authorNote.title')}
			description=${t('authorNote.description')}>
				<div className="hbox">
					<${InputBox} label=${t('authorNote.prefix')} type="text" placeholder=${t('authorNote.prefixPlaceholder')}
						readOnly=${!!cancel} value=${authorNoteTokens.prefix} onValueChange=${(value: any) => handleauthorNoteTokensChange("prefix", value)}/>
					<${InputBox} label=${t('authorNote.suffix')} type="text" placeholder=${t('authorNote.suffixPlaceholder')}
						readOnly=${!!cancel} value=${authorNoteTokens.suffix} onValueChange=${(value: any) => handleauthorNoteTokensChange("suffix", value)}/>
					<${InputBox} label=${t('authorNote.depth')} type="number" step="1"
						readOnly=${!!cancel} value=${authorNoteDepth} onValueChange=${handleAuthorNoteDepthChange}/>
				</div>
				<div class="relative">
					<textarea
						readOnly=${!!cancel}
						placeholder=${t('authorNote.placeholder', { depth: authorNoteDepth })}
						defaultValue=${authorNoteTokens.text}
						value=${authorNoteTokens.text}
						onInput=${(e: any) => handleauthorNoteTokensChange("text", e.target.value) }
						class="expanded-text-area-settings"
						id="expanded-an-settings"/>
					<div class="token-counter">
						${authorNoteTokens.tokens}
					</div>
				</div>
			</${Modal}>`;
}
