import { html } from 'htm/react';
import { Fragment, useState, useEffect, useMemo } from 'react';
import { Modal } from '../Modal';
import { InputBox } from '../controls/InputBox';
import { API_LLAMA_CPP, API_OPENAI_COMPAT, API_DEEPSEEK } from '../../constants';
import { getTokens, serverTokenize } from '../../api/index';
import { useT } from '../../i18n';
import { SVG_Regen } from '../icons';

type TokenizeResult = { ids: number[]; str: string | string[] };

type BiasItem = {
  value: string;
  valueBack: string;
  strings: string[];
  tokens: number[];
  power: number;
};
type BiasTempState = { positive: BiasItem[]; negative: BiasItem[]; [key: string]: BiasItem[] };

// ponytail: logit bias list import/export to be added as a separate feature
export function LogitBiasModal({ isOpen, closeModal, biasState, apiConfig, cancel }: any) {
	const t = useT();
	const { logitBias, setLogitBias, setRejectedAPIKey } = biasState;
	const { sessionStorage, endpoint, endpointAPI, endpointAPIKey, isMiyapadEndpoint, useServerTokenization } = apiConfig;
	const [lastBiasError, setLastBiasError] = useState<string | undefined>(undefined);
	const [logitBiasTemp, setLogitBiasTemp] = useState<BiasTempState>({ positive: [], negative: [] });
	const [logitBiasSorted, setLogitBiasSorted] = useState<string[]>([]);
	const [logitBiasInput, setLogitBiasInput] = useState({power:"0",string:""});

	const handleLogitBiasInput = (key: any, value: any) => {
		setLogitBiasInput((prevLogitBiasInput) => {
			return {
				...prevLogitBiasInput,
				[key]: value
			}
		});
	};

	const logitBiasAdd = async (biasPower: any = "", biasString: any = "", origValue: any = "") => {
		setLastBiasError(undefined);
		// abort if no input or power is NaN
		if(!biasString) {
			return;
		}
		if (isNaN(+biasPower) || biasPower == "") { 
			setLastBiasError(t('logitBias.errorBiasMustBeNumber'));
			return;
		}
		const biasPowerNum = Number(biasPower);

		const modBias = { ...logitBias.bias };

		// delete entry if power 0 or empty
		if (biasPowerNum == 0) {	
			if (!logitBias.bias[biasString]) {
				setLastBiasError(t('logitBias.errorBiasZero'));
				return;
			}
			console.log("delete",biasString);
			setLogitBias((prevLogitBias: any) => {
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
			let tokens: TokenizeResult;
			const isTokenIds = biasString.match(/^(?<!\\)\/\s*\d+(\s*,\s*\d+)*\s*(?<!\\)\/$/g);
			if ( isTokenIds != null ) {
				// split by "," and use it as token ids directly
				tokens = {
					ids: isTokenIds[0].replaceAll("/","").split(",").map( (item: any) => Number(item.trim()) ),
					str: ""
				};
			}
			// else process like normal
			else {
			const useServerTk = useServerTokenization && isMiyapadEndpoint && sessionStorage?.sessionEndpoint;
			const serverEp = sessionStorage?.sessionEndpoint;
			const tokenResult = await (useServerTk
				? serverTokenize({ sessionEndpoint: serverEp, content: `!==${biasString}`.replace(/\\n/g,'\n'), signal: ac.signal })
				: getTokens({
					endpoint,
					endpointAPI,
					...(endpointAPI == API_OPENAI_COMPAT || endpointAPI == API_LLAMA_CPP || endpointAPI == API_DEEPSEEK ? { endpointAPIKey } : {}),
					content: `!==${biasString}`.replace(/\\n/g,'\n'),
					signal: ac.signal,
					...(isMiyapadEndpoint ? { proxyEndpoint: sessionStorage.proxyEndpoint } : {})
				})
			) as TokenizeResult | [];
			if (Array.isArray(tokenResult)) {
				setLastBiasError(t('logitBias.errorTokenizerUnavailable'));
				return;
			}
			tokens = tokenResult;
			const logitBiasWorkaround = (await (useServerTk
				? serverTokenize({ sessionEndpoint: serverEp, content: `!==`, signal: ac.signal })
				: getTokens({
					endpoint,
					endpointAPI,
					...(endpointAPI == API_OPENAI_COMPAT || endpointAPI == API_LLAMA_CPP || endpointAPI == API_DEEPSEEK ? { endpointAPIKey } : {}),
					content: `!==`,
					signal: ac.signal,
					...(isMiyapadEndpoint ? { proxyEndpoint: sessionStorage.proxyEndpoint } : {})
				})
			)) as TokenizeResult;
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
			await setLogitBias((prevLogitBias: any) => ({
				...prevLogitBias,
				bias: {
					...modBias,
					[biasString]: { // removed Number() here
						ids: [ ...tokens.ids ],
						strings: Array.isArray(tokens.str) ? [ ...tokens.str ] : [ tokens.str ],
						power: biasPowerNum
					}
				}
			}));
		}
		catch(e: unknown) {
			if ((e as Error).name !== 'AbortError') {
				reportError(e);
				const errStr = String(e);
				if ((endpointAPI == API_OPENAI_COMPAT || endpointAPI == API_LLAMA_CPP || endpointAPI == API_DEEPSEEK) && errStr.includes("401")) {
					setLastBiasError(t('logitBias.errorRejectedApiKey'));
					setRejectedAPIKey(true);
				} else if ((endpointAPI == API_OPENAI_COMPAT || endpointAPI == API_DEEPSEEK) && errStr.includes("429")) {
					setLastBiasError(t('logitBias.errorInsufficientQuota'));
				} else {
					setLastBiasError(errStr);
				}
			}
			return;
		}
	};

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


	const handleBiasTempChange = (posneg: any, key: any, index: any, value: any) => {
		setLogitBiasTemp((prevLogitBiasTemp: any) => {
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
		const sortPowerString = (a: any, b: any) => {
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
			title=${t('logitBias.title')}
			description=${t('logitBias.description')}>
			${isOpen 
				&& html`<${Fragment}>
					<div className="hbox-flex logitBiasContainer">
						<div className="small-inputBox">
							<${InputBox} label=${t('logitBias.bias')} className="logitBiasPower-container"
								type="enumber"  max=100 min=-100 step=1
								readOnly=${!!cancel}
								onValueChange=${(value: any) => { handleLogitBiasInput("power",value)} }
								value=${logitBiasInput.power} 
								id="logitBiasPower"/>
						</div>
						<${InputBox} label=${t('logitBias.token')} type="text"
							tooltip=${t('logitBias.tokenTooltip')}
							readOnly=${!!cancel}
							value=${logitBiasInput.string}
							placeholder=${t('logitBias.tokenPlaceholder')}
							onValueChange=${() => {} }
							onInput=${(e: any) => {handleLogitBiasInput("string",e.target.value)} }
							/>
						<button disabled=${!!cancel} className="hbox-button" onClick=${() => logitBiasAdd(logitBiasInput.power,logitBiasInput.string)}>
							+
						</button>
					</div>
					${!!lastBiasError && html`
						<div style=${{margin:"8px auto"}} className="error-text">${lastBiasError}</div>`}
				<hr style=${{width:"95%",margin:"8px auto"}} />
				<div className="lb-modal-biasList" >
					${Object.keys(logitBiasTemp).map((key: any) => {
						return html`
							<div className="overflow-container lb-modal-grid-column" key=${key} id="lb-modal-${key}">
								${logitBiasTemp[key].map((bias: any, index: any) => {
									return html`
										<div className="lb-modal-entry lb-modal-grid-row" key=${index}>
											<${InputBox} label=${t('logitBias.bias')} className="lb-modal-power"
												type="enumber" max=100 min=-100 step=1
												id="lb-modal-power-${index}"
												readOnly=${!!cancel}
												onValueChange=${(value: any) => {handleBiasTempChange(key,"power", index, value)} }
												value=${bias.power}/>

											<${InputBox} label=${t('logitBias.token')} type="text"
												tooltip=${t('logitBias.tokenTooltip')}
												readOnly=${!!cancel}
												value=${bias.value}
												placeholder=${t('logitBias.tokenPlaceholder')}
												onValueChange=${() => {} }
												onInput=${(e: any) => handleBiasTempChange(key,"value", index, e.target.value) }
												/>
											<div className="lb-modal-tokenized">
												${(endpointAPI == API_LLAMA_CPP || endpointAPI == API_DEEPSEEK) && bias.strings != ""
													? "["+bias.strings.join("|")+"] "
													: "["+bias.tokens+"]" } 

											</div>
											<button
												disabled=${!!cancel}
												className="hbox-button lb-modal-button lb-modal-button-add"
												onClick=${() => logitBiasAdd(bias.power, bias.value, bias.valueBack)}>
												<${SVG_Regen}/>
											</button>
											<button
												disabled=${!!cancel}
												className="hbox-button lb-modal-button lb-modal-button-remove"
												onClick=${() => logitBiasAdd("0", bias.valueBack, bias.valueBack)}
												>
												-
											</button>
											<hr/>
										</div>`})}
							</div>`})}
				</div><//>`}
			</${Modal}>`;
}
