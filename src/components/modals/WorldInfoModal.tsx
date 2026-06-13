import { html } from 'htm/react';
import { Modal } from '../Modal';
import { InputBox } from '../controls/InputBox';
import { CollapsibleGroup } from '../controls/CollapsibleGroup';
import { SVG_ArrowUp, SVG_ArrowDown } from '../icons/index';
import { importSillyTavernWorldInfo } from '../../worldinfo';

export function WorldInfoModal({ isOpen, closeModal, worldInfo, setWorldInfo, cancel, toggleModal, setSillyTarvernWorldInfoJSON }: any) {
	const handleWorldInfoNew = () => {
		setWorldInfo((prevWorldInfo: any) => {
			return {
				...prevWorldInfo,
				entries: [ { "displayName":"New Entry","text":"","keys":[], "search":"" },...prevWorldInfo.entries ],
			};
		});
	};
	const handleWorldInfoMove = (index: any,move: any) => {
		const modEntries = worldInfo.entries;
		if (index+move < 0 || index+move > modEntries.length-1 ) {
			return;
		}
		modEntries.splice(index+move, 0, modEntries.splice(index, 1)[0]);
		setWorldInfo((prevWorldInfo: any) => {
			return {
				...prevWorldInfo,
				entries: [ ...modEntries ],
			};
		});
	};
	const handleWorldInfoDel = (index: any) => {
		if (!window.confirm("Are you sure you want to delete the world info entry #" + (index + 1) + ": "+ worldInfo.entries[index].displayName + "?\nThis action cannot be undone."))
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
			alert("Index " + index + " out of range!");
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
					alert("The JSON data could not be parsed. Please check that it is valid JSON.");
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
			title="World Info"
			description="Additional information that is added when specific keywords are found in context.
			World info will be added at the top of your memory, in the order specified here.

			Each entry will begin on a newline. Keys will be interpreted as case-insensitive regular expressions. Search Range specifies how many tokens back into the context will be searched for activation keys. Search range 0 to disable an entry.">
			<div id="modal-wi-global">
				<button id="button-wi-import" disabled=${!!cancel} onClick=${handleWorldInfoImport}>Import entries</button>
				<button id="button-wi-export" disabled=${!!cancel} onClick=${handleWorldInfoExport}>Export entries</button>
				<br/>
				<${CollapsibleGroup} label="Prefix/Suffix" stateLabel="Prefix/Suffix-WI">
					The prefix and suffix will be added at the beginning or end of all your active World Info entries respectively.
					<br />
					<div className="hbox">
						<${InputBox} label="Prefix" type="text" placeholder="\\n"
							readOnly=${!!cancel} value=${worldInfo.prefix} onValueChange=${(value: any) => handleWorldInfoAffixChange("prefix", value)}/>
						<${InputBox} label="Suffix" type="text" placeholder="\\n"
							readOnly=${!!cancel} value=${worldInfo.suffix} onValueChange=${(value: any) => handleWorldInfoAffixChange("suffix", value)}/>
					</div>
				</${CollapsibleGroup}>
				<button id="button-wi-new" disabled=${!!cancel} onClick=${handleWorldInfoNew}>New Entry</button>
			</div>
			<div className="modal-wi-content overflow-container">
				${!Array.isArray(worldInfo.entries) ? null : worldInfo.entries.map((entry: any, index: any) => html`
					<div class="wi-entry" key=${index}>
						<div class="wi-entry-controls">
							<div class="wi-entry-filler" />
							<div class="wi-entry-name">
								<${InputBox}
								label="Entry #${index+1}"
								type="text"
								readOnly=${!!cancel}
								placeholder="Name of this entry"
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
										label="Comma Separated RegEx Keys"
										type="text"
										readOnly=${!!cancel}
										value=${entry.keys.join(',')}
										placeholder="Required to activate entry"
										onValueChange=${(value: any) => handleWorldInfoChange("keys",index,value)}
										/>
									<${InputBox}
										label="Search Range (0 = disabled)"
										tooltip="Currently not accurate to the token count, it will be used as an estimate."

										type="text"
										readOnly=${!!cancel}
										inputmode="numeric"
										value=${entry.search}
										placeholder="2048"
										onValueChange=${(value: any) => handleWorldInfoChange("search",index,value)}
										/>
								</div>
								<label class="TextArea">
									Text
									<textarea
										readOnly=${!!cancel}
										placeholder="Information to be inserted into context when key is found"
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
