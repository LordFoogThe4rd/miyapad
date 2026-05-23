import { html } from 'htm/react';
import { useState, useEffect, useMemo } from 'react';
import { Modal } from '../Modal.js';
import { InputBox } from '../controls/InputBox.js';
import { API_LLAMA_CPP, API_KOBOLD_CPP, API_AI_HORDE, API_OPENAI_COMPAT } from '../../constants.js';
import { getTokens, serverTokenize } from '../../api/index.js';

export function LogitBiasModal({ isOpen, closeModal, biasState, apiConfig, cancel }) {
	const { logitBias, setLogitBias, logitBiasParam, setLogitBiasParam, setRejectedAPIKey } = biasState;
	const { sessionStorage, endpoint, endpointAPI, endpointAPIKey, isMikupadEndpoint, useServerTokenization } = apiConfig;
	const [lastBiasError, setLastBiasError] = useState(undefined);
	const [logitBiasTemp, setLogitBiasTemp] = useState([]);
	const [logitBiasSorted, setLogitBiasSorted] = useState([]);
	const [logitBiasInput, setLogitBiasInput] = useState({power:"0",string:""});

	const handleLogitBiasInput = (key,value) => {
		setLogitBiasInput((prevLogitBiasInput) => {
			return {
				...prevLogitBiasInput,
				[key]: value
			}
		});
	};

	const logitBiasAdd = async (biasPower="",biasString="",origValue="") => {
		setLastBiasError(undefined);
		// abort if no input or power is NaN
		if(!biasString) {
			return;
		}
		if (isNaN(+biasPower) || biasPower == "") { 
			setLastBiasError("Error: Bias must be a number");
			return;
		}
		biasPower = Number(biasPower);

		const modBias = logitBias.bias;

		// delete entry if power 0 or empty
		if (biasPower == 0) {	
			if (!logitBias.bias[biasString]) {
				setLastBiasError("Error: Bias 0 = no Bias");
				return;
			}
			console.log("delete",biasString);
			setLogitBias((prevLogitBias) => {
				delete modBias[biasString];
				return { 
					...prevLogitBias,
					bias: {
						...modBias
					}
				};
			})
			return;
		}
		// if overwriting the string value of an entry, delete the original one
		if (origValue && origValue != biasString) {
			delete modBias[origValue];
		}

		const ac = new AbortController();
		try {
			// if the string is a comma separated list of numbers wrapped in /
			var tokens;
			const isTokenIds = biasString.match(/^(?<!\\)\/(\s*\d+\s*,?\s*)+(?<!\\)\/$/g);
			if ( isTokenIds != null ) {
				// split by "," and use it as token ids directly
				tokens = {
					ids: isTokenIds[0].replaceAll("/","").split(",").map( item => Number(item.trim()) ),
					str: ""
				};
			}
			// else process like normal
			else {
				// KNOWN ISSUE: some models automatically prepend a space to any tokenization 
				// input. to work around this, I'm prepending the input with a "!==", then 
				// slicing the output array by the number of tokens of "!==".
				// This could cause issues when trying to bias a token starting with ? where
				// ? is any character that forms a single token together with " !==", like 
				// this: " !==?" I've chosen "!==" because it seems to be a very conserved
				// token between models.
				//
				// Now granted, I have not found any strings where this is actually an issue in 
				// the tokenizers of the models I use, but this is still a huge hackjob of a 
				// workaround. If anyone can think of a better solution, please let me know.
			const useServerTk = useServerTokenization && isMikupadEndpoint && sessionStorage?.sessionEndpoint;
			const serverEp = sessionStorage?.sessionEndpoint;
			tokens = await (useServerTk
				? serverTokenize({ sessionEndpoint: serverEp, content: `!==${biasString}`.replace(/\\n/g,'\n'), signal: ac.signal })
				: getTokens({
					endpoint,
					endpointAPI,
					...(endpointAPI == API_OPENAI_COMPAT || endpointAPI == API_LLAMA_CPP ? { endpointAPIKey } : {}),
					content: `!==${biasString}`.replace(/\\n/g,'\n'),
					signal: ac.signal,
					...(isMikupadEndpoint ? { proxyEndpoint: sessionStorage.proxyEndpoint } : {})
				})
			);
			if (tokens.length === 0) {
				setLastBiasError("Error: Tokenizer endpoint unavailable.");
				return;
			}
			const logitBiasWorkaround = await (useServerTk
				? serverTokenize({ sessionEndpoint: serverEp, content: `!==`, signal: ac.signal })
				: getTokens({
					endpoint,
					endpointAPI,
					...(endpointAPI == API_OPENAI_COMPAT || endpointAPI == API_LLAMA_CPP ? { endpointAPIKey } : {}),
					content: `!==`,
					signal: ac.signal,
					...(isMikupadEndpoint ? { proxyEndpoint: sessionStorage.proxyEndpoint } : {})
				})
			);
				// Remove however many tokens !== is tokenized as for the workaround
				tokens.ids = tokens.ids.slice(logitBiasWorkaround.ids.length);
				if ( Array.isArray(tokens.str) ) {
					tokens.str = tokens.str.slice(logitBiasWorkaround.ids.length);
				}
			}

			console.log("Biasing tokens [",tokens.ids.join(", "),"]",
				Array.isArray(tokens.str) ? "'"+tokens.str.join("|")+"'"
					: "'"+biasString+"'",
				"by power",biasPower)
			await setLogitBias((prevLogitBias) => ({
				...prevLogitBias,
				bias: {
					...modBias,
					[biasString]: { // removed Number() here
						ids: [ ...tokens.ids ],
						strings: [ ...tokens.str ],
						power: biasPower
					}
				}
			}));
		}
		catch(e) {
			if (e.name !== 'AbortError') {
				reportError(e);
				const errStr = e.toString();
				if ((endpointAPI == API_OPENAI_COMPAT || endpointAPI == API_LLAMA_CPP) && errStr.includes("401")) {
					setLastBiasError("Error: Rejected API Key");
					setRejectedAPIKey(true);
				} else if (endpointAPI == API_OPENAI_COMPAT && errStr.includes("429")) {
					setLastBiasError("Error: Insufficient Quota");
				} else {
					setLastBiasError(errStr);
				}
			}
			return;
		}
	};

	const clamp = (num, min = -Infinity, max = Infinity) => {
		return Math.min(Math.max(num, min), max);
	};

	const llamaCppSetLogitBiasParams = () => {
		const param = [];
		Object.keys(logitBias.bias).forEach(entry => {
			// set banned tokens to false, else divide power by 10 to remain within
			// reasonable range
			const power = logitBias.bias[entry].power < -99 ? false : Number(logitBias.bias[entry].power) / 10;
			logitBias.bias[entry].ids.forEach(id => {
				param.push( [ Number(id), power ] );
			});
		});
		setLogitBiasParam(param);
	};
	const koboldCppSetLogitBiasParams = () => {
		const param = {};
		Object.keys(logitBias.bias).forEach(entry => {
			// -100 to 100
			const clampedPower = clamp(Number(logitBias.bias[entry].power),-100,100);
			logitBias.bias[entry].ids.forEach(id => {
				param[Number(id)] = clampedPower;
			});
		});
		setLogitBiasParam(param);
	};
	const openaiSetLogitBiasParams = () => {
		const param = {};
		Object.keys(logitBias.bias).forEach(entry => {
			// -100 to 100
			const clampedPower = Number(clamp(Number(logitBias.bias[entry].power),-100,100).toFixed(1));
			logitBias.bias[entry].ids.forEach(id => {
				param[String(id)] = clampedPower;
			});
		});
		setLogitBiasParam(param);
	};

	useMemo(() => {
		// set the parameters sent to the model in the format expected by the endpoint
		switch (endpointAPI) {
			case API_LLAMA_CPP:
				llamaCppSetLogitBiasParams();
				break;
			case API_KOBOLD_CPP:
			case API_AI_HORDE:
				koboldCppSetLogitBiasParams();
				break;
			case API_OPENAI_COMPAT:
				openaiSetLogitBiasParams();
				break;
		}
	}, [logitBias, endpointAPI]);


	useEffect(() => {
		const tempArray = logitBiasSorted.map((string, index) =>  ({
			value: string,
			valueBack: string,
			strings: logitBias.bias[string].strings,
			tokens: logitBias.bias[string].ids,
			power: logitBias.bias[string].power
		}));
		setLogitBiasTemp({
			positive: tempArray.filter(item => item.power > 0),
			negative: tempArray.filter(item => item.power < 0)
		});
	},[logitBiasSorted,isOpen]);


	const handleBiasTempChange = (posneg, key, index, value) => {
		setLogitBiasTemp((prevLogitBiasTemp) => {
			const rest = { ...prevLogitBiasTemp };
			const updatedTemp = [ ...prevLogitBiasTemp[posneg] ];

			updatedTemp[index] = {
				...updatedTemp[index],
				[key]: value,
			};
			return {
				...rest,
				[posneg]: updatedTemp
			};
		});
	};

	useMemo(() => {
		const biasListToSort = Object.entries(logitBias.bias);
		const sortPowerString = (a, b) => {
			const powerDiff = parseInt(b[1].power) - parseInt(a[1].power);
			if (powerDiff !== 0) {
				// If powers are different, sort by power
				return powerDiff;
			} else {
				// If powers are the same, sort alphabetically by string value
				return a[0].localeCompare(b[0]);
			}
		};

		const biasListSorted = biasListToSort.sort(sortPowerString);
		const resultArray = biasListSorted.map(([key]) => key);

		setLogitBiasSorted(resultArray);
	}, [logitBias]);

	return html`
		<${Modal} isOpen=${isOpen} onClose=${closeModal}
			title="Logit Bias"
			description="Make certain tokens more or less likely to be generated. Recommended ranges are 100 to -100, with -100 being a total ban of the token.
			Note: Multi-token strings will apply the bias globally to all constituent tokens, not as a sequence-aware phrase bias.
			You can bias IDs directly in a comma separated list, wrapped in '/'. Example: /382,1449,1802/

			Different models might tokenize words differently. Always Re-Tokenize your biases when switching models by pressing the '+' button again for every entry.">
			${isOpen 
				&& html`
					<div className="hbox-flex logitBiasContainer">
						<div class="small-inputBox">
							<${InputBox} label="Bias" className="logitBiasPower-container"
								type="enumber"  max=100 min=-100 step=1
								readOnly=${!!cancel}
								onValueChange=${(value) => { handleLogitBiasInput("power",value)} }
								value=${logitBiasInput.power} 
								id="logitBiasPower"/>
						</div>
						<${InputBox} label="Token" type="text"
							tooltip="Currently, only the first token of multi-token strings will be biased."
							readOnly=${!!cancel}
							value=${logitBiasInput.string}
							placeholder="String or /ID,.../"
							onValueChange=${() => {} }
							onInput=${(e) => {handleLogitBiasInput("string",e.target.value)} }
							/>
						<button disabled=${!!cancel} class="hbox-button" onClick=${() => logitBiasAdd(logitBiasInput.power,logitBiasInput.string)}>
							+
						</button>
					</div>
					${!!lastBiasError && html`
						<div style=${{margin:"8px auto"}} className="error-text">${lastBiasError}</div>`}
				<hr style=${{width:"95%",margin:"8px auto"}} />
				<div class="lb-modal-biasList" >
					${Object.keys(logitBiasTemp).map((key) => {
						return html`
							<div class="overflow-container lb-modal-grid-column" id="lb-modal-${key}">
								${logitBiasTemp[key].map((bias, index) => {
									return html`
										<div class="lb-modal-entry lb-modal-grid-row" key=${index}>
											<${InputBox} label="Bias" class="lb-modal-power"
												type="enumber" max=100 min=-100 step=1
												id="lb-modal-power-${index}"
												readOnly=${!!cancel}
												onValueChange=${(value) => {handleBiasTempChange(key,"power", index, value)} }
												value=${bias.power}/>

											<${InputBox} label="Token" type="text"
												tooltip="Currently, only the first token of multi-token strings will be biased."
												readOnly=${!!cancel}
												value=${bias.value}
												placeholder="String or /ID,.../"
												onValueChange=${() => {} }
												onInput=${(e) => handleBiasTempChange(key,"value", index, e.target.value) }
												/>
											<div class="lb-modal-tokenized">
												${endpointAPI == API_LLAMA_CPP && bias.strings != ""
													? "["+bias.strings.join("|")+"] "
													: "["+bias.tokens+"]" } 

											</div>
											<button
												disabled=${!!cancel}
												class="hbox-button lb-modal-button lb-modal-button-add"
												onClick=${() => logitBiasAdd(bias.power, bias.value, bias.valueBack)}>
												+
											</button>
											<button
												disabled=${!!cancel}
												class="hbox-button lb-modal-button lb-modal-button-remove"
												onClick=${() => logitBiasAdd("0", bias.valueBack, bias.valueBack)}
												>
												-
											</button>
											<hr/>
										</div>`})}
							</div>`})}
				</div>`}
			</${Modal}>`;
}
