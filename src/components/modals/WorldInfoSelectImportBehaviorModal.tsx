import { html } from 'htm/react';
import { Modal } from '../Modal';
import { importSillyTavernWorldInfo } from '../../worldinfo';
import { useT } from '../../i18n';

export function WorldInfoSelectImportBehaviorModal({ isOpen, closeModal, setWorldInfo, cancel, sillyTarvernWorldInfoJSON }: any) {
	const t = useT();
	const handleImportReplace = () => {
		importSillyTavernWorldInfo(sillyTarvernWorldInfoJSON, setWorldInfo, "replace");
		closeModal();
	};

	const handleImportAppend = () => {
		importSillyTavernWorldInfo(sillyTarvernWorldInfoJSON, setWorldInfo, "append");
		closeModal();
	};

	return html`<${Modal} isOpen=${isOpen} onClose=${closeModal}
		id="modal-wi-importbehavior"
		title=${t('worldInfoImport.title')}
		description=${t('worldInfoImport.description')} >
		<div id="modal-wi-global">
			<button id="button-wi-importbehavior-replace" disabled=${!!cancel} onClick=${handleImportReplace}>${t('worldInfoImport.deleteAndImport')}</button>
			<button id="button-wi-importbehavior-append" disabled=${!!cancel} onClick=${handleImportAppend}>${t('worldInfoImport.appendToExisting')}</button>
		</div>
	</${Modal}>`;
}
