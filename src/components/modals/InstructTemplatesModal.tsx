import { html } from 'htm/react';
import { useState, useEffect } from 'react';
import { Modal } from '../Modal';
import { InputBox } from '../controls/InputBox';
import { Checkbox } from '../controls/Checkbox';
import { SelectBoxTemplate } from '../controls/SelectBox';
import { exportText } from '../../api/common';
import { defaultPresets } from '../../defaults/presets';
import type { TemplateStorage } from '../../storage/TemplateStorage';

interface InstructTemplatesModalProps {
  isOpen: boolean;
  closeModal: () => void;
  templateList: TemplateListItem[];
  setTemplateList: React.Dispatch<React.SetStateAction<TemplateListItem[]>>;
  selectedTemplate: string;
  setSelectedTemplate: React.Dispatch<React.SetStateAction<string>>;
  templatesImport: boolean;
  templates: Record<string, InstructTemplate>;
  setTemplates: React.Dispatch<React.SetStateAction<Record<string, InstructTemplate>>>;
  templateStorage: TemplateStorage;
  cancel: (() => void) | null;
  applyChatTemplate: () => void;
}

export function InstructTemplatesModal({ isOpen, closeModal, templateStorage, selectedTemplate, setSelectedTemplate, templateList, setTemplateList, templates, templatesImport, setTemplates, cancel, applyChatTemplate }: InstructTemplatesModalProps) {
	const [addDeleteTemplate, setAddDeleteTemplate] = useState(false);
	const [templateDuplicate, setTemplateDuplicate] = useState<string | false>(false);
	const [newTemplateName, setNewTemplateName] = useState<string | undefined>(undefined);

	function getArrObjByName(array: TemplateListItem[], name: string, getIndex: true): number;
	function getArrObjByName(array: TemplateListItem[], name: string, getIndex?: false): TemplateListItem | undefined;
	function getArrObjByName(array: TemplateListItem[], name: string, getIndex = false): TemplateListItem | undefined | number {
		const index = array.findIndex(obj => obj.name === name)
		if (getIndex)
			return index
		return array[index];
	}

	function handleInstructTemplateChange(templateName: any, key: any, value: any, back="") {
		if (key == "name")
			setNewTemplateName(value);

		setTemplateList((prevState: any) => {
			const newState = [
				...prevState
			];
			const tempIndex = newState.findIndex(obj => obj.name === templateName);
			const index = tempIndex < 0 ? 0 : tempIndex;
			if (key == "name") { 
				newState[index] = {
					...newState[index],
					'nameNew': value
				}
			} else {
				newState[index] = {
					...newState[index],
					affixes: {
						...newState[index].affixes,
						[key]: value
					}
				}
			}
			return newState;
		});
	}

	async function handleInstructTemplateAdd(): Promise<any> {
		await updateTemplateDB()
		setTemplates((prevState: any) => {
			var newState = {
				...prevState
			}
			newState[""] = {
				"sysPre": "",
				"sysSuf": "",
				"instPre": "",
				"instSuf": "",
				"fimTemplate": undefined,
			}
			return { ...newState }
		})
		setAddDeleteTemplate(true)
	}
	async function handleInstructTemplateDuplicate(): Promise<any> {
		const index = templateList.findIndex((obj: any) => obj.name === selectedTemplate)
		const reselectTemplate = templateList[index == -1 ? 0 : index]?.nameNew
		await updateTemplateDB()
		await setTemplateDuplicate(reselectTemplate + " (Duplicate)")
		setTemplates((prevState: any) => {
			var newState = {
				...prevState
			}
			newState[reselectTemplate + " (Duplicate)"] = {
				"sysPre": templates[selectedTemplate]?.sysPre,
				"sysSuf": templates[selectedTemplate]?.sysSuf,
				"instPre": templates[selectedTemplate]?.instPre,
				"instSuf": templates[selectedTemplate]?.instSuf,
				"fimTemplate": templates[selectedTemplate]?.fimTemplate,
			}
			return { ...newState }
		})
	}

	async function handleInstructTemplateDelete(name: any) {
		if (Object.keys(templates).length < 2)
			return
		if (!window.confirm("Are you sure you want to delete this template? This action can't be undone."))
			return;

		console.warn("Deleting Template",name,":",templates[name])
		setTemplates((prevState: any) => {
			var newState = {
				...prevState
			}
			delete newState[name]
			return { ...newState }
		})
		setAddDeleteTemplate(true)
	}

	useEffect(() => {
		const index = templateList.findIndex((obj: any) => obj.name === selectedTemplate)
		const reselectTemplate = templateList[index == -1 ? 0 : index]?.nameNew
		const list = []
		let i = 0;
		for (const key in templates) {
			list.push({
				name: key,
				nameNew:key,
				value: key,
				nameBack: key,
				affixes: templates[key]
			})
		}
		list.sort((a: any, b: any) => {
			var nameA = a.name.toLowerCase();
			var nameB = b.name.toLowerCase();
			return (nameA < nameB) ? -1 : (nameA > nameB) ? 1 : 0;
		});
		setTemplateList(list)
		if (reselectTemplate)
			setSelectedTemplate(reselectTemplate)
		if (templateDuplicate) {
			setSelectedTemplate(templateDuplicate)
			setTemplateDuplicate(false)
		}
	}, [templates,selectedTemplate,templatesImport]);

	useEffect(() => {
		if (!addDeleteTemplate)
			return
		setSelectedTemplate("")
		setAddDeleteTemplate(false)
	}, [addDeleteTemplate]);

	const updateTemplateDB = async () => {
		setNewTemplateName(undefined);
		setTemplates((prevState: any) => {
			var newState = {
				...prevState
			}
			for (let i=0;i<templateList.length;i++) {
				const template = templateList[i]
				const name = template.nameNew
				const nameBack = template.nameBack

				if (name === undefined || nameBack === undefined)
					continue
				
				// if template has been renamed, delete old entry, make sure to reselect 
				// current entry after
				if (name != nameBack) {
					newState[name] = prevState[nameBack]
					delete newState[nameBack]
				}

				newState[name] = {
					"sysPre": template.affixes?.sysPre,
					"sysSuf": template.affixes?.sysSuf,
					"instPre": template.affixes?.instPre,
					"instSuf": template.affixes?.instSuf,
					"fimTemplate": template.affixes?.fimTemplate,
				}
			}
			return { ...newState }
		})
	}
	useEffect(() => {
		updateTemplateDB()
	}, [isOpen, selectedTemplate]);

	const exportTemplates = () => {
		exportText(`instruct_templates.json`, JSON.stringify(templates));
	};
		const importTemplates = async (importDefaults: any = false) => {
		if (importDefaults) {
			if (!window.confirm("This will add all default templates, and overwrite any changes you made to the default templates. This action cannot be undone. Do you wish to continue?"))
				return;
			try {
				await templateStorage.performFullSave(defaultPresets.instructTemplates, true)
				window.location.reload()
			} catch {
				alert('Failed to save default templates to database.');
			}
			return
		}
		let onFileLoad: ((text: string) => Promise<void>) | null = null;
		const fileInput = document.createElement("input");
		fileInput.type = 'file';
		fileInput.style.display = 'none';
		fileInput.onchange = (e: any) => {
			const file = (e.target as HTMLInputElement).files?.[0];
			if (!file)
				return;
			const reader = new FileReader();
			reader.onload = async (e: ProgressEvent<FileReader>) => {
				const contents = e.target?.result as string;
				try {
					await onFileLoad?.(contents);
				} catch {
					alert('Failed to import templates. Check that the file is valid JSON.');
				}
			}
			reader.readAsText(file);
		}
		onFileLoad = async (text: string) => {
			try {
				await templateStorage.performFullSave(JSON.parse(text), true)
				window.location.reload()
			} catch {
				alert('Failed to import templates. Check that the file is valid JSON.');
			}
		};
		document.body.appendChild(fileInput);
		fileInput.click();
		document.body.removeChild(fileInput);
	};

	return (getArrObjByName(templateList,selectedTemplate) ?? templateList[0]) && html`
		<${Modal} isOpen=${isOpen} onClose=${closeModal}
			title="Instruct Templates"
			description="Use placeholders to insert the selected prompt template formats when sending your prompt to the model.
			Placeholders are listed below. You can insert newlines with '\\n'.
			When Chat Mode is active, the 'Instruct Suffix' field of the current template will be added at the end of your prompt, before it is processed by the model. Similarly, the 'Instruct Prefix' field will be added at the end of the model's response.">
			<div id="advancedContextPlaceholders">
				<table border="1" frame="void" rules="all">
					<thead>
					<tr>
						<th></th>
						<th>Prefix</th>
						<th>Suffix</th>
					</tr>
					</thead>
					<tbody>
					<tr>
						<th>System Prompt</th>
						<td>{sys}</td>
						<td>{/sys}</td>
					</tr>
					<tr>
						<th>Instructions</th>
						<td>{inst}</td>
						<td>{/inst}</td>
					</tr>
					</tbody>
				</table>
			</div>
			<hr/>
			<div class="instructTemplatesImportExport">
				<button
					title="Import Instruct Templates"
					disabled=${!!cancel}
					onClick=${() => importTemplates()}>
					Import
				</button>
				<button
					title="Export Instruct Templates"
					disabled=${!!cancel}
					onClick=${() => exportTemplates()}>
					Export
				</button>
				<button
					title="Re-Add Default Instruct Templates"
					disabled=${!!cancel}
					onClick=${() => importTemplates(true)}>
					Re-Add Defaults
				</button>
				<button
					title="Apply Chat Template to Editor"
					disabled=${!!cancel}
					class="hbox-button"
					onClick=${() => applyChatTemplate()}>
					Apply
				</button>
			</div>
			<div className="buttons instructTemplateSidebar">
				<${SelectBoxTemplate}
					id="instructTemplatesModalSelect"
					label="Instruct Template"
					disabled=${!!cancel}
					value=${newTemplateName ?? selectedTemplate}
					onValueChange=${setSelectedTemplate}
					options=${templateList}/>
				<button
					title="Duplicate Currently Selected Instruct Template"
					disabled=${!!cancel}
					class="hbox-button"
					onClick=${() => handleInstructTemplateDuplicate()}>
					Duplicate
				</button>
				<button
					title="Add Instruct Template"
					disabled=${!!cancel}
					class="hbox-button"
					onClick=${() => handleInstructTemplateAdd()}>
					New
				</button>
				<button
					title="Delete Selected Instruct Template"
					disabled=${!!cancel}
					class="hbox-button"
					onClick=${() => handleInstructTemplateDelete(selectedTemplate)}>
					Delete
				</button>
			</div>
			<hr/>
			<div class="instructtemplatesmodal-edits">
				<${InputBox} label="Name"
						placeholder="Name of This Template"
						id="instructtemplatesmodal-name"
						className=""
						tooltip=""
						readOnly=${!!cancel}
						value=${getArrObjByName(templateList,selectedTemplate)?.nameNew || ""}
						onInput=${(e: any) => handleInstructTemplateChange(selectedTemplate,"name",e.target.value,getArrObjByName(templateList,selectedTemplate)?.nameBack)}
						onValueChange=${() => {}}/>

				<div className="hbox">
					<${InputBox} label="Instruct Prefix {inst}"
						placeholder="[INST]"
						className=""
						tooltip=""
						readOnly=${!!cancel}
						value=${getArrObjByName(templateList,selectedTemplate)?.affixes?.instPre || ""}
						onInput=${(e: any) => handleInstructTemplateChange(selectedTemplate,"instPre",e.target.value)}
						onValueChange=${() => {}}/>

					<${InputBox} label="Instruct Suffix {/inst}"
						placeholder="[/INST]"
						className=""
						tooltip=""
						readOnly=${!!cancel}
						value=${getArrObjByName(templateList,selectedTemplate)?.affixes?.instSuf || ""}
						onInput=${(e: any) => handleInstructTemplateChange(selectedTemplate,"instSuf",e.target.value)}
						onValueChange=${() => {}}/>
				</div>

				<div className="hbox">
					<${InputBox} label="System Prompt Prefix {sys}"
						placeholder="<<SYS>>\\n"
						className=""
						tooltip=""
						readOnly=${!!cancel}
						value=${getArrObjByName(templateList,selectedTemplate)?.affixes?.sysPre || ""}
						onInput=${(e: any) => handleInstructTemplateChange(selectedTemplate,"sysPre",e.target.value)}
						onValueChange=${() => {}}/>

					<${InputBox} label="System Prompt Suffix {/sys}"
						placeholder="<</SYS>>\\n\\n"
						className=""
						tooltip=""
						readOnly=${!!cancel}
						value=${getArrObjByName(templateList,selectedTemplate)?.affixes?.sysSuf || ""}
						onInput=${(e: any) => handleInstructTemplateChange(selectedTemplate,"sysSuf",e.target.value)}
						onValueChange=${() => {}}/>
				</div>

				<div className="hbox">
					<div className="vbox">
						<${Checkbox} label="Supports Fill-In-The-Middle"
								value=${getArrObjByName(templateList,selectedTemplate)?.affixes?.fimTemplate !== undefined}
								onValueChange=${(value: any) => handleInstructTemplateChange(selectedTemplate,"fimTemplate", value ? '' : undefined)}/>
						${getArrObjByName(templateList,selectedTemplate)?.affixes?.fimTemplate !== undefined && html`
								<${InputBox} label="Fill-In-The-Middle Template"
								placeholder="[SUFFIX]{suffix}[PREFIX]{prefix}"
								className=""
								tooltip=""
								readOnly=${!!cancel}
								value=${getArrObjByName(templateList,selectedTemplate)?.affixes?.fimTemplate || ""}
								onInput=${(e: any) => handleInstructTemplateChange(selectedTemplate,"fimTemplate",e.target.value)}
								onValueChange=${() => {}}/>`}
					</div>
					<div id="advancedContextPlaceholders">
						${getArrObjByName(templateList,selectedTemplate)?.affixes?.fimTemplate !== undefined
							? html`
								<div>Use the <b>{fill}</b> placeholder to seamlessly apply the Fill-In-The-Middle template and start the prediction from that point.</div>
								<div><b>{prefix}</b> represents the text before the placeholder, and <b>{suffix}</b> represents the text after it.</div>`
							: html`
								<div>This template doesn't have a Fill-In-The-Middle template.</div>
								<div>You can use the <b>{predict}</b> placeholder to start the prediction from that point, but the model won't be aware of the text after the placeholder.</div>`}
					</div>
				</div>
			</div>


		</${Modal}>`;
}
