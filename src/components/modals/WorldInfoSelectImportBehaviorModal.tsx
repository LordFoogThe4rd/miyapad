import { html } from 'htm/react';
import { Modal } from '../Modal';
import { importSillyTavernWorldInfo } from '../../worldinfo';

export function WorldInfoSelectImportBehaviorModal({ isOpen, closeModal, setWorldInfo, cancel, sillyTarvernWorldInfoJSON }) {
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
		title="There are already world info entries present"
		description="Would you like to delete them before importing the new ones? Or would you like to add the imported entries alongside the existing ones?" >
		<div id="modal-wi-global">
			<button id="button-wi-importbehavior-replace" disabled=${!!cancel} onClick=${handleImportReplace}>Delete and import</button>
			<button id="button-wi-importbehavior-append" disabled=${!!cancel} onClick=${handleImportAppend}>Append to existing</button>
		</div>
	</${Modal}>`;
}
