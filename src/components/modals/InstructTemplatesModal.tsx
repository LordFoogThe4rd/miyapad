import { html } from 'htm/react';
import { useState, useEffect } from 'react';
import { useT } from '../../i18n';
import { Modal } from '../Modal';
import { InputBox } from '../controls/InputBox';
import { Checkbox } from '../controls/Checkbox';
import { SelectBox } from '../controls/SelectBox';
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
	const t = useT();
	const [addDeleteTemplate, setAddDeleteTemplate] = useState(false);
	const [templateDuplicate, setTemplateDuplicate] = useState<string | false>(false);
	const [newTemplateName, setNewTemplateName] = useState<string | undefined>(undefined);

	function getArrObjByName(array: TemplateListItem[], name: string, getIndex: true): number;
	function getArrObjByName(array: TemplateListItem[], name: string, getIndex?: false): TemplateListItem;
	function getArrObjByName(array: TemplateListItem[], name: string, getIndex = false): TemplateListItem | number {
		const index = array.findIndex(obj => obj.name === name);
		if (index < 0) {
			if (getIndex) return 0;
			return array[0];
		}
		if (getIndex)
			return index;
		return array[index];
	}

	function handleInstructTemplateChange(templateName: string, key: keyof InstructTemplate | "name", value: string | undefined, back="") {
		if (key == "name")
			setNewTemplateName(value);

		setTemplateList((prevState: TemplateListItem[]) => {
			const newState = [
				...prevState
			];
			const index = newState.findIndex(obj => obj.name === templateName);
			if (index < 0) return prevState;
			if (key == "name") { 
				newState[index] = {
					...newState[index],
					'nameNew': value ?? ''
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
		await setTemplateDuplicate(reselectTemplate + t('instructTemplates.duplicateSuffix'))
		setTemplates((prevState: any) => {
			var newState = {
				...prevState
			}
			newState[reselectTemplate + t('instructTemplates.duplicateSuffix')] = {
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
		if (!window.confirm(t('instructTemplates.confirmDelete')))
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
			if (!window.confirm(t('instructTemplates.confirmImportDefaults')))
				return;
			try {
				await templateStorage.performFullSave(defaultPresets.instructTemplates, true)
				window.location.reload()
			} catch {
				alert(t('instructTemplates.saveDefaultsFailed'));
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
					alert(t('instructTemplates.importFailed'));
				}
			}
			reader.readAsText(file);
		}
		onFileLoad = async (text: string) => {
			try {
				await templateStorage.performFullSave(JSON.parse(text), true)
				window.location.reload()
			} catch {
				alert(t('instructTemplates.importFailed'));
			}
		};
		document.body.appendChild(fileInput);
		fileInput.click();
		document.body.removeChild(fileInput);
	};

	return html`
		<${Modal} isOpen=${isOpen} onClose=${closeModal}
			title=${t('instructTemplates.instructTemplates')}
			description=${t('instructTemplates.description')}>
			<div id="advancedContextPlaceholders">
				<table border="1" frame="void" rules="all">
					<thead>
					<tr>
						<th></th>
						<th>${t('instructTemplates.prefix')}</th>
						<th>${t('instructTemplates.suffix')}</th>
					</tr>
					</thead>
					<tbody>
					<tr>
						<th>${t('instructTemplates.systemPrompt')}</th>
						<td>{sys}</td>
						<td>{/sys}</td>
					</tr>
					<tr>
						<th>${t('instructTemplates.instructions')}</th>
						<td>{inst}</td>
						<td>{/inst}</td>
					</tr>
					</tbody>
				</table>
			</div>
			<hr/>
			<div class="instructTemplatesImportExport">
				<button
					title=${t('instructTemplates.importTitle')}
					disabled=${!!cancel}
					onClick=${() => importTemplates()}>
					${t('instructTemplates.importButton')}
				</button>
				<button
					title=${t('instructTemplates.exportTitle')}
					disabled=${!!cancel}
					onClick=${() => exportTemplates()}>
					${t('instructTemplates.exportButton')}
				</button>
				<button
					title=${t('instructTemplates.reAddDefaultsTitle')}
					disabled=${!!cancel}
					onClick=${() => importTemplates(true)}>
					${t('instructTemplates.reAddDefaultsButton')}
				</button>
				<button
					title=${t('instructTemplates.applyChatTitle')}
					disabled=${!!cancel}
					class="hbox-button"
					onClick=${() => applyChatTemplate()}>
					${t('instructTemplates.applyButton')}
				</button>
			</div>
			<div className="buttons instructTemplateSidebar">
				<${SelectBox}
					id="instructTemplatesModalSelect"
					label=${t('instructTemplates.instructTemplate')}
					template=${true}
					disabled=${!!cancel}
					value=${newTemplateName ?? selectedTemplate}
					onValueChange=${setSelectedTemplate}
					options=${templateList}/>
				<button
					title=${t('instructTemplates.duplicateTitle')}
					disabled=${!!cancel}
					class="hbox-button"
					onClick=${() => handleInstructTemplateDuplicate()}>
					${t('instructTemplates.duplicateButton')}
				</button>
				<button
					title=${t('instructTemplates.addTitle')}
					disabled=${!!cancel}
					class="hbox-button"
					onClick=${() => handleInstructTemplateAdd()}>
					${t('instructTemplates.newButton')}
				</button>
				<button
					title=${t('instructTemplates.deleteTitle')}
					disabled=${!!cancel}
					class="hbox-button"
					onClick=${() => handleInstructTemplateDelete(selectedTemplate)}>
					${t('instructTemplates.deleteButton')}
				</button>
			</div>
			<hr/>
			<div class="instructtemplatesmodal-edits">
				<${InputBox} label=${t('instructTemplates.nameLabel')}
						placeholder=${t('instructTemplates.namePlaceholder')}
						id="instructtemplatesmodal-name"
						className=""
						tooltip=""
						readOnly=${!!cancel}
						value=${getArrObjByName(templateList,selectedTemplate)?.nameNew || ""}
						onInput=${(e: any) => handleInstructTemplateChange(selectedTemplate,"name",e.target.value,getArrObjByName(templateList,selectedTemplate)?.nameBack)}
						onValueChange=${() => {}}/>

				<div className="hbox">
					<${InputBox} label=${t('instructTemplates.instructPrefixLabel')}
						placeholder="[INST]"
						className=""
						tooltip=""
						readOnly=${!!cancel}
						value=${getArrObjByName(templateList,selectedTemplate)?.affixes?.instPre || ""}
						onInput=${(e: any) => handleInstructTemplateChange(selectedTemplate,"instPre",e.target.value)}
						onValueChange=${() => {}}/>

					<${InputBox} label=${t('instructTemplates.instructSuffixLabel')}
						placeholder="[/INST]"
						className=""
						tooltip=""
						readOnly=${!!cancel}
						value=${getArrObjByName(templateList,selectedTemplate)?.affixes?.instSuf || ""}
						onInput=${(e: any) => handleInstructTemplateChange(selectedTemplate,"instSuf",e.target.value)}
						onValueChange=${() => {}}/>
				</div>

				<div className="hbox">
					<${InputBox} label=${t('instructTemplates.systemPrefixLabel')}
						placeholder="<<SYS>>\\n"
						className=""
						tooltip=""
						readOnly=${!!cancel}
						value=${getArrObjByName(templateList,selectedTemplate)?.affixes?.sysPre || ""}
						onInput=${(e: any) => handleInstructTemplateChange(selectedTemplate,"sysPre",e.target.value)}
						onValueChange=${() => {}}/>

					<${InputBox} label=${t('instructTemplates.systemSuffixLabel')}
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
						<${Checkbox} label=${t('instructTemplates.supportsFim')}
								value=${getArrObjByName(templateList,selectedTemplate)?.affixes?.fimTemplate !== undefined}
								onValueChange=${(value: any) => handleInstructTemplateChange(selectedTemplate,"fimTemplate", value ? '' : undefined)}/>
						${getArrObjByName(templateList,selectedTemplate)?.affixes?.fimTemplate !== undefined && html`
								<${InputBox} label=${t('instructTemplates.fimTemplateLabel')}
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
								<div>${t('instructTemplates.fimHelpPre')}<b>{fill}</b>${t('instructTemplates.fimHelpPost')}</div>
								<div><b>{prefix}</b>${t('instructTemplates.fimPrefixHelp1')}<b>{suffix}</b>${t('instructTemplates.fimPrefixHelp2')}</div>`
							: html`
								<div>${t('instructTemplates.noFimTemplate')}</div>
								<div>${t('instructTemplates.noFimHelpPre')}<b>{predict}</b>${t('instructTemplates.noFimHelpPost')}</div>`}
					</div>
				</div>
			</div>


		</${Modal}>`;
}
