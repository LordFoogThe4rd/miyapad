import { useSettings } from '../contexts/SettingsContext';
import { useGeneration } from '../contexts/GenerationContext';

export function useInsertTemplate() {
	const { templates, selectedTemplate } = useSettings();
	const { promptEditorView } = useGeneration();

	const insertTemplate = (sysInst: "sys" | "inst") => {
		let [prefix,suffix] = sysInst === "sys"
			? [templates[selectedTemplate]?.sysPre  || "", templates[selectedTemplate]?.sysSuf  || ""]
			: [templates[selectedTemplate]?.instPre || "", templates[selectedTemplate]?.instSuf || ""];
		if (!(prefix || suffix))
			return;

		prefix = prefix.replace(/\\n/g,'\n');
		suffix = suffix.replace(/\\n/g,'\n');

		const adapter = promptEditorView.current;
		if (!adapter)
			return;

		const { from: startPos, to: endPos } = adapter.getSelection();
		const currentText = adapter.getText();
		const textBefore = currentText.substring(0, startPos) || "";
		const textAfter = (sysInst !== "sys" && endPos !== currentText.length ? "{predict}" : "") + currentText.substring(endPos);
		const selectedText = currentText.substring(startPos, endPos);

		const finalText = textBefore 
						+ prefix
						+ selectedText 
						+ suffix
						+ textAfter;

		adapter.replaceText(finalText);

		let newCursorPos;
		if (selectedText.length === 0) {
			newCursorPos = startPos + prefix.length;
		} else {
			newCursorPos = startPos 
				+ prefix.length
				+ selectedText.length 
				+ suffix.length;
		}
		adapter.focus();
		adapter.setSelection(newCursorPos, newCursorPos);
	};

	return { insertTemplate };
}
