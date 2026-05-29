import { html } from 'htm/react';
import { useState, useEffect, useCallback } from 'react';
import { Modal } from '../Modal.js';
import { Checkbox } from '../controls/Checkbox.js';
import { InputBox } from '../controls/InputBox.js';
import { InputSlider } from '../controls/InputSlider.js';
import { SelectBox } from '../controls/SelectBox.js';
import { getServerTokenizers, loadServerTokenizer } from '../../api/index.js';

const tabStyle = (active) => ({
	flex: 1,
	padding: '0.5em 1em',
	borderBottom: active ? '2px solid var(--color-base-70)' : '2px solid transparent',
	background: 'none',
	color: 'var(--color-light)',
	cursor: 'pointer',
	fontSize: 'inherit',
	fontWeight: active ? '600' : '400',
	transition: 'color 0.15s, border-color 0.2s'
});

export function PreferencesModal({ isOpen, closeModal, settings }) {
	const [activeTab, setActiveTab] = useState('editor');

	const {
		fontSizeMultiplier, setFontSizeMultiplier,
		spellCheck, setSpellCheck,
		attachSidebar, setAttachSidebar,
		preserveCursorPosition, setPreserveCursorPosition,
		tokenHighlightMode, setTokenHighlightMode,
		tokenColorMode, setTokenColorMode,
		showProbsMode, setShowProbsMode,
		ttsEnabled, setTTSEnabled,
		ttsVoiceId, setTTSVoiceId,
		ttsPitch, setTTSPitch,
		ttsRate, setTTSRate,
		ttsVolume, setTTSVolume,
		ttsSpeakInputs, setTTSSpeakInputs,
		ttsMaxUserInput, setTTSMaxUserInput,
		isMiyapadEndpoint, cancel, listTTSVoices, ttsStop, ttsAvailable, handleExportDB, handleImportDB, exportPrompt,
		useServerTokenization, setUseServerTokenization, tokenizerModel, setTokenizerModel,
		sessionStorage,
		screenshotIncludeSessionName, setScreenshotIncludeSessionName,
		screenshotIncludeDate, setScreenshotIncludeDate,
		screenshotBackgroundUrl, setScreenshotBackgroundUrl,
		screenshotBackgroundColor, setScreenshotBackgroundColor,
		screenshotStoryFont, setScreenshotStoryFont,
		screenshotGeneralFont, setScreenshotGeneralFont,
		screenshotFontWeight, setScreenshotFontWeight,
		screenshotFontSize, setScreenshotFontSize,
		screenshotLineHeight, setScreenshotLineHeight,
		screenshotFontColor, setScreenshotFontColor,
		screenshotAiTextColor, setScreenshotAiTextColor,
		screenshotModelAvatarUrl, setScreenshotModelAvatarUrl
	} = settings;

	const [tokenizerList, setTokenizerList] = useState([]);
	const [tokenizerStatus, setTokenizerStatus] = useState('');

	const refreshTokenizers = useCallback(async () => {
		if (!isMiyapadEndpoint || !sessionStorage?.sessionEndpoint) return;
		try {
			const data = await getServerTokenizers({ sessionEndpoint: sessionStorage.sessionEndpoint });
			setTokenizerList(data.tokenizers || []);
			if (data.loaded) {
				setTokenizerStatus(`Loaded: ${data.loaded}`);
			}
		} catch (e) {
			setTokenizerList([]);
			setTokenizerStatus('Failed to fetch tokenizers');
		}
	}, [isMiyapadEndpoint, sessionStorage]);

	useEffect(() => {
		if (activeTab === 'server' && isMiyapadEndpoint) {
			refreshTokenizers();
		}
	}, [activeTab, isMiyapadEndpoint, refreshTokenizers]);

	const handleTokenizerChange = useCallback(async (model) => {
		setTokenizerModel(model);
		if (!model) {
			setTokenizerStatus('No tokenizer selected');
			return;
		}
		setTokenizerStatus('Loading...');
		try {
			await loadServerTokenizer({ sessionEndpoint: sessionStorage.sessionEndpoint, model });
			setTokenizerStatus(`Loaded: ${model}`);
		} catch (e) {
			setTokenizerStatus(`Error: ${e.message}`);
		}
	}, [sessionStorage, setTokenizerModel]);

	return html`
		<${Modal} isOpen=${isOpen} onClose=${closeModal}
			title="Preferences"
			style=${{ 'max-width': '35em' }}>
			<div className="vbox">
				<div className="hbox" style=${{ gap: 0 }}>
					<button style=${tabStyle(activeTab === 'editor')}
						onClick=${() => setActiveTab('editor')}>
						Editor
					</button>
					<button style=${tabStyle(activeTab === 'screenshot')}
						onClick=${() => setActiveTab('screenshot')}>
						Screenshot
					</button>
					${isMiyapadEndpoint && html`
						<button style=${tabStyle(activeTab === 'server')}
							onClick=${() => setActiveTab('server')}>
							Server
						</button>
					`}
				</div>

				${activeTab === 'editor' && html`
					<div className="vbox" style=${{ gap: '2px', marginTop: '8px' }}>
						<${InputSlider} label="Font size multiplier" min="0.5" max="5" step="0.01" strict="1"
							value=${fontSizeMultiplier} onValueChange=${setFontSizeMultiplier}/>
						<${Checkbox} label="Enable spell checking"
							value=${spellCheck} onValueChange=${setSpellCheck}/>
						<${Checkbox} label="Attach sidebar"
							value=${attachSidebar} onValueChange=${setAttachSidebar}/>
						<${Checkbox} label="Preserve cursor position after prediction (disabled in Chat Mode)"
							value=${preserveCursorPosition} onValueChange=${setPreserveCursorPosition}/>
						<${SelectBox}
							label="Token highlight"
							value=${tokenHighlightMode}
							onValueChange=${setTokenHighlightMode}
							options=${[
								{ name: 'Show on editor hover', value: 0 },
								{ name: 'Show on token hover', value: 1 },
								{ name: 'Hide', value: -1 },
							]}/>
						${tokenHighlightMode !== -1 && html`
							<${SelectBox}
								label="Token highlight color"
								value=${tokenColorMode}
								onValueChange=${setTokenColorMode}
								options=${[
									{ name: 'Default', value: 0 },
									{ name: 'Color by probability', value: 1 },
									{ name: 'Color by perplexity', value: 2 },
								]}/>
							<${SelectBox}
								label="Token probability display"
								value=${showProbsMode}
								onValueChange=${setShowProbsMode}
								options=${[
									{ name: 'Show on hover', value: 0 },
									{ name: 'Show on hover while holding CTRL', value: 1 },
									{ name: 'Hide', value: -1 },
								]}/>`}
						<div className="vbox" style=${{ marginTop: '10px', gap: '8px' }}>
							${!isMiyapadEndpoint && html`
								<div className="hbox" style=${{ gap: '8px' }}>
									<button style=${{ flex: 1 }} onClick=${handleExportDB}>Export Full DB</button>
									<button style=${{ flex: 1 }} onClick=${handleImportDB}>Import Full DB</button>
								</div>
							`}
							<button style=${{ width: '100%' }} onClick=${exportPrompt}>
								Export prompt to plaintext
							</button>
						</div>
						<${Checkbox} label="Enable Text-to-Speech"
							disabled=${!!cancel || !ttsAvailable}
							title=${!ttsAvailable ? 'TTS is not available in your browser' : ''}
							value=${ttsEnabled} onValueChange=${setTTSEnabled}/>
						${ttsEnabled && html`
							<div className="hbox-flex" style=${{ "flex-wrap": "unset" }}>
								<${SelectBox}
									id="voices"
									label="Voice"
									disabled=${!!cancel}
									value=${ttsVoiceId}
									onValueChange=${setTTSVoiceId}
									options=${listTTSVoices}/>
								<button title="Stop TTS (Ctrl + E)" className="symbol-button" disabled=${!speechSynthesis.speaking} onClick=${() => ttsStop()}>
									<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="var(--color-light)" fillRule="evenodd" style=${{ width: '.95em', height: '.95em' }}>
										<path d="M3 4a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4z"/>
									</svg>
								</button>
							</div>
							<${Checkbox} label="Speak User Inputs"
								disabled=${!!cancel} value=${ttsSpeakInputs} onValueChange=${setTTSSpeakInputs}/>
							<${InputSlider} label="Max User Input Length" type="number" step="1" min="1" max="400"
								disabled=${!ttsSpeakInputs} readonly=${!!cancel} value=${ttsMaxUserInput} onValueChange=${setTTSMaxUserInput}/>
							<div className="hbox">
								<${InputSlider} label="TTS Pitch" type="number" step="0.1" max="2"
									readOnly=${!!cancel} value=${ttsPitch} onValueChange=${setTTSPitch}/>
								<${InputSlider} label="TTS Rate" type="number" step="0.1" max="10"
									readOnly=${!!cancel} value=${ttsRate} onValueChange=${setTTSRate}/>
								<${InputSlider} label="TTS Volume" type="number" step="0.1" max="2"
									readOnly=${!!cancel} value=${ttsVolume} onValueChange=${setTTSVolume}/>
							</div>
						`}
					</div>
				`}

				${activeTab === 'screenshot' && html`
					<div className="vbox" style=${{ gap: '2px', marginTop: '8px' }}>
						<div className="hbox" style=${{ gap: '1em' }}>
							<${Checkbox} label="Include Session Name"
								value=${screenshotIncludeSessionName}
								onValueChange=${setScreenshotIncludeSessionName}/>
							<${Checkbox} label="Include Date"
								value=${screenshotIncludeDate}
								onValueChange=${setScreenshotIncludeDate}/>
						</div>
						<${InputBox} label="Background Image URL"
							value=${screenshotBackgroundUrl}
							onValueChange=${setScreenshotBackgroundUrl}/>
						<${InputBox} label="Background Color" type="color"
							value=${screenshotBackgroundColor}
							onValueChange=${setScreenshotBackgroundColor}/>
						<${InputBox} label="Story Text Font"
							value=${screenshotStoryFont}
							onValueChange=${setScreenshotStoryFont}/>
						<${InputBox} label="General Text Font"
							value=${screenshotGeneralFont}
							onValueChange=${setScreenshotGeneralFont}/>
						<div className="hbox" style=${{ gap: '1em' }}>
							<${InputBox} label="Font Weight"
								type="number"
								value=${screenshotFontWeight}
								onValueChange=${setScreenshotFontWeight}/>
							<${InputBox} label="Font Size (px)"
								type="number"
								value=${screenshotFontSize}
								onValueChange=${setScreenshotFontSize}/>
							<${InputBox} label="Line Height (px)"
								type="number"
								value=${screenshotLineHeight}
								onValueChange=${setScreenshotLineHeight}/>
						</div>
						<div className="hbox" style=${{ gap: '1em' }}>
							<${InputBox} label="General Text Color" type="color"
								value=${screenshotFontColor}
								onValueChange=${setScreenshotFontColor}/>
							<${InputBox} label="AI Text Color" type="color"
								value=${screenshotAiTextColor}
								onValueChange=${setScreenshotAiTextColor}/>
						</div>
						<${InputBox} label="Model Avatar URL (square preferred)"
							value=${screenshotModelAvatarUrl}
							onValueChange=${setScreenshotModelAvatarUrl}/>
					</div>
				`}

				${activeTab === 'server' && html`
					<div className="vbox" style=${{ gap: '2px', marginTop: '8px' }}>
						<${Checkbox} label="Use server-side tokenization"
							value=${useServerTokenization}
							onValueChange=${setUseServerTokenization}/>
						${useServerTokenization && html`
							<div className="hbox" style=${{ gap: '8px', alignItems: 'center' }}>
								<${SelectBox}
									label="Tokenizer model"
									value=${tokenizerModel || ''}
									onValueChange=${handleTokenizerChange}
									options=${[
										{ name: '(none)', value: '' },
										...tokenizerList.map(t => ({ name: t, value: t }))
									]}/>
								<button className="symbol-button" title="Refresh list"
									onClick=${refreshTokenizers}>
									<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="var(--color-light)" style=${{ width: '.95em', height: '.95em' }}>
										<path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
									</svg>
								</button>
							</div>
							<div style=${{ fontSize: '0.85em', color: 'var(--color-base-60)', padding: '4px 0' }}>
								${tokenizerStatus || 'No tokenizer loaded'}
							</div>
							<div style=${{ fontSize: '0.8em', color: 'var(--color-text-hint)', marginTop: '4px' }}>
								Place a tokenizer.json file in server/tokenizers/${'<model-name>'}/ on the Miyapad server.
							</div>
						`}
					</div>
				`}
			</div>
		</${Modal}>`;
}
