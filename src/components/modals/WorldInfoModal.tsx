import { html } from 'htm/react';
import { Modal } from '../Modal';
import { InputBox } from '../controls/InputBox';
import { CollapsibleGroup } from '../controls/CollapsibleGroup';
import { SVG_ArrowUp, SVG_ArrowDown } from '../icons/index';
import { importSillyTavernWorldInfo } from '../../worldinfo';
import { useT } from '../../i18n';

export function WorldInfoModal({ isOpen, closeModal, worldInfo, setWorldInfo, cancel, toggleModal, setSillyTarvernWorldInfoJSON }: any) {
	const t = useT();
	const handleWorldInfoNew = () => {
		setWorldInfo((prevWorldInfo: any) => {
			return {
				...prevWorldInfo,
				entries: [ { "displayName": t('worldInfo.entryDefaultName'), "text":"","keys":[], "search":"" },...prevWorldInfo.entries ],
			};
		});
	};
	const handleWorldInfoMove = (index: any,move: any) => {
		if (index+move < 0 || index+move > worldInfo.entries.length-1 ) {
			return;
		}
		const modEntries = [ ...worldInfo.entries ];
		modEntries.splice(index+move, 0, modEntries.splice(index, 1)[0]);
		setWorldInfo((prevWorldInfo: any) => {
			return {
				...prevWorldInfo,
				entries: modEntries,
			};
		});
	};
	const handleWorldInfoDel = (index: any) => {
		if (!window.confirm(t('worldInfo.confirmDeleteEntry', { index: index + 1, name: worldInfo.entries[index].displayName })))
			return;
		if (index > -1 && index < worldInfo.entries.length) {
			setWorldInfo((prevWorldInfo: any) => {
				console.warn(`Deleting world info entry #${(index + 1)}:`,prevWorldInfo.entries[index])
				return {
					...prevWorldInfo,
					entries: 		prevWorldInfo.entries.filter((_: any, i: any) => i !== index),
				};
			});
		}
		else {
			alert(t('worldInfo.indexOutOfRange', { index }));
		}
	};
	const handleWorldInfoChange = (key: any,index: any,value: any) => {
		setWorldInfo((prevWorldInfo: any) => {
			const updatedEntries = [...prevWorldInfo.entries];
			const updatedEntry = key == "keys"
				? { ...updatedEntries[index], [key]: value.split(/(?<!\\), ?/) } //.map(item => item.trim())
				: { ...updatedEntries[index], [key]: value };
			updatedEntries[index] = updatedEntry;

			return {
				...prevWorldInfo,
				entries: updatedEntries,
			};
		});
	};
	const handleWorldInfoAffixChange = (key: any, value: any) => {
		setWorldInfo((prevWorldInfo: any) => ({
			...prevWorldInfo,
			[key]: value,
		}));
	};

	const handleWorldInfoImport = () => {
		const inputElement = document.createElement("input");
		inputElement.type = "file";
		inputElement.onchange = () => {
			const file = inputElement.files?.[0];
			if (!file)
				return;

			const reader = new FileReader();
			
			reader.onload = (e: any) => {
				try {
					const contents = (e.target as FileReader).result as string;
					const json = JSON.parse(contents);

					if (Object.values(worldInfo.entries)?.length) {
						setSillyTarvernWorldInfoJSON(json);
						toggleModal("wiImportMode");
						return;
					} else {
						importSillyTavernWorldInfo(json, setWorldInfo, "append");
					}
				} catch (e: unknown) {
					alert(t('worldInfo.importParseError'));
					console.error(e);
				}
			};
			reader.readAsText(file);
		}
		inputElement.click();
	};

	const handleWorldInfoExport = () => {
		const exportedObject: any = { "entries": {} };

		worldInfo.entries.forEach((entry: any, entryIndex: any) => {
			exportedObject.entries[entryIndex] = {
				"uid": entryIndex,
				"key": [...entry.keys],
				"keysecondary": [],
				"comment": entry.displayName,
				"content": entry.text,
				"constant": false,
				"vectorized": false,
				"selective": true,
				"selectiveLogic": 0,
				"addMemo": true,
				"order": 100,
				"position": 0,
				"disable": false,
				"excludeRecursion": false,
				"preventRecursion": false,
				"delayUntilRecursion": false,
				"probability": 100,
				"useProbability": true,
				"depth": 4,
				"group": "",
				"groupOverride": false,
				"groupWeight": 100,
				"scanDepth": entry.search || null,
				"caseSensitive": null,
				"matchWholeWords": null,
				"useGroupScoring": null,
				"automationId": "",
				"role": null,
				"sticky": 0,
				"cooldown": 0,
				"delay": 0,
				"displayIndex": 0
			};
		});

		const blob = new Blob([JSON.stringify(exportedObject)], { type: "application/json" });
		const anchor = document.createElement("a");

		const now = new Date();
		anchor.download = `MiyaPad-WorldInfo-${now.getFullYear()}-${(""+(now.getMonth() + 1)).padStart(2, "0")}-${(""+now.getDate()).padStart(2, "0")}.json`;
		anchor.href = (window.webkitURL || window.URL).createObjectURL(blob);
		anchor.dataset.downloadurl = ["application/json", anchor.download, anchor.href].join(":");
		anchor.click();
	};

	return html`
		<${Modal} isOpen=${isOpen} onClose=${closeModal}
			title=${t('worldInfo.title')}
			description=${t('worldInfo.description')}>
			<div id="modal-wi-global">
				<button id="button-wi-import" disabled=${!!cancel} onClick=${handleWorldInfoImport}>${t('worldInfo.importEntries')}</button>
				<button id="button-wi-export" disabled=${!!cancel} onClick=${handleWorldInfoExport}>${t('worldInfo.exportEntries')}</button>
				<br/>
				<${CollapsibleGroup} label=${t('worldInfo.prefixSuffix')} stateLabel="Prefix/Suffix-WI">
					${t('worldInfo.prefixSuffixDescription')}
					<br />
					<div className="hbox">
						<${InputBox} label=${t('worldInfo.prefix')} type="text" placeholder="\\n"
							readOnly=${!!cancel} value=${worldInfo.prefix} onValueChange=${(value: any) => handleWorldInfoAffixChange("prefix", value)}/>
						<${InputBox} label=${t('worldInfo.suffix')} type="text" placeholder="\\n"
							readOnly=${!!cancel} value=${worldInfo.suffix} onValueChange=${(value: any) => handleWorldInfoAffixChange("suffix", value)}/>
					</div>
				</${CollapsibleGroup}>
				<button id="button-wi-new" disabled=${!!cancel} onClick=${handleWorldInfoNew}>${t('worldInfo.newEntry')}</button>
			</div>
			<div className="modal-wi-content overflow-container">
				${!Array.isArray(worldInfo.entries) ? null : worldInfo.entries.map((entry: any, index: any) => html`
					<div class="wi-entry" key=${index}>
						<div class="wi-entry-controls">
							<div class="wi-entry-filler" />
							<div class="wi-entry-name">
								<${InputBox}
								label=${`${t('worldInfo.entryLabel')}${index+1}`}
								type="text"
								readOnly=${!!cancel}
								placeholder=${t('worldInfo.entryNamePlaceholder')}
								value=${entry.displayName}
								onValueChange=${(value: any) => handleWorldInfoChange("displayName",index,value)}
								/>
							</div>
							<div class="wi-entry-buttons">
								<div class="wi-entry-buttons-container">
									<button disabled=${!!cancel} onClick=${() => handleWorldInfoMove(index,-1)}>
										<${SVG_ArrowUp}/>
									</button>
									<button disabled=${!!cancel} onClick=${() => handleWorldInfoDel(index)}>
										✕
									</button>
									<button disabled=${!!cancel} onClick=${() => handleWorldInfoMove(index,1)}>
										<${SVG_ArrowDown}/>
									</button>
								</div>
							</div>
							<div class="wi-entry-text">
								<div class="hbox">
									<${InputBox}
										label=${t('worldInfo.regexKeys')}
										type="text"
										readOnly=${!!cancel}
										value=${entry.keys.join(',')}
										placeholder=${t('worldInfo.regexKeysPlaceholder')}
										onValueChange=${(value: any) => handleWorldInfoChange("keys",index,value)}
										/>
									<${InputBox}
										label=${t('worldInfo.searchRange')}
										tooltip=${t('worldInfo.searchRangeTooltip')}

										type="text"
										readOnly=${!!cancel}
										inputmode="numeric"
										value=${entry.search}
										placeholder="2048"
										onValueChange=${(value: any) => handleWorldInfoChange("search",index,value)}
										/>
								</div>
								<label class="TextArea">
									${t('worldInfo.text')}
									<textarea
										readOnly=${!!cancel}
										placeholder=${t('worldInfo.textPlaceholder')}
										value=${entry.text ? entry.text : ""}
										defaultValue=${entry.text ? entry.text : ""}
										onInput=${(e: any) => handleWorldInfoChange("text",index, e.target.value)}
										class="wi-textarea" />
								</label>
							</div>
						</div>
					</div>`)}
			</div>
		</${Modal}>`;
}
