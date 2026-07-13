import { html } from 'htm/react';
import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { Modal } from '../Modal';
import { Checkbox } from '../controls/Checkbox';
import { InputBox } from '../controls/InputBox';
import { InputSlider } from '../controls/InputSlider';
import { SelectBox } from '../controls/SelectBox';
import { getServerTokenizers, loadServerTokenizer } from '../../api/index';
import { useT } from '../../i18n';
import { AVAILABLE_LOCALES } from '../../i18n/locales';

const localeName = (code: string) => {
	try {
		const name = new Intl.DisplayNames([code], { type: 'language' });
		return name.of(code) ?? code;
	} catch {
		return code;
	}
};

const tabStyle = (active: any) => ({
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

export function PreferencesModal({ isOpen, closeModal, settings }: any) {
	const t = useT();
	const [activeTab, setActiveTab] = useState('general');
	const contentRef = useRef<HTMLDivElement | null>(null);
	const prevHeightRef = useRef<number | null>(null);

	// Capture the outgoing tab's height synchronously before React commits the new tab's DOM
	const switchTab = (tab: any) => {
		if (tab === activeTab) return;
		const el = contentRef.current;
		if (el) {
			prevHeightRef.current = el.offsetHeight;
		}
		setActiveTab(tab);
	};

	// After React commits the new tab content, animate from old height to new height
	useLayoutEffect(() => {
		const el = contentRef.current;
		if (!el) return;

		const prevHeight = prevHeightRef.current;
		// On first mount (no previous height), let content render at natural size — no animation
		if (prevHeight == null) return;
		prevHeightRef.current = null;

		const newHeight = el.scrollHeight;
		// Clip overflow only during the transition
		el.style.overflow = 'hidden';
		// Pin to old height so the transition has a starting point
		el.style.height = prevHeight + 'px';
		// Force layout so the browser registers the starting value
		void el.offsetHeight;
		// Set target height to trigger CSS transition
		el.style.height = newHeight + 'px';

		const onEnd = (e: any) => {
			if (e.target !== el) return;
			// Release to auto so the container can adapt if content changes internally
			el.style.height = '';
			el.style.overflow = '';
		};
		el.addEventListener('transitionend', onEnd);
		return () => el.removeEventListener('transitionend', onEnd);
	}, [activeTab]);

	const {
		locale, setLocale,
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

	const [tokenizerList, setTokenizerList] = useState<string[]>([]);
	const [tokenizerStatus, setTokenizerStatus] = useState('');

	const refreshTokenizers = useCallback(async () => {
		if (!isMiyapadEndpoint || !sessionStorage?.sessionEndpoint) return;
		try {
			const data = await getServerTokenizers({ sessionEndpoint: sessionStorage.sessionEndpoint });
			setTokenizerList(data.tokenizers || []);
			if (data.loaded) {
				setTokenizerStatus(`${t('preferences.loadedStatus')}: ${data.loaded}`);
			}
		} catch (e: unknown) {
			setTokenizerList([]);
			setTokenizerStatus(t('preferences.failedToFetchTokenizers'));
		}
	}, [isMiyapadEndpoint, sessionStorage, t]);

	useEffect(() => {
		if (activeTab === 'server' && isMiyapadEndpoint) {
			refreshTokenizers();
		}
	}, [activeTab, isMiyapadEndpoint, refreshTokenizers]);

	const handleTokenizerChange = useCallback(async (model: any) => {
		setTokenizerModel(model);
		if (!model) {
			setTokenizerStatus(t('preferences.noTokenizerSelected'));
			return;
		}
		setTokenizerStatus(t('preferences.loading'));
		try {
			await loadServerTokenizer({ sessionEndpoint: sessionStorage.sessionEndpoint, model });
			setTokenizerStatus(`${t('preferences.loadedStatus')}: ${model}`);
		} catch (e: unknown) {
			setTokenizerStatus(`${t('preferences.error')}: ${(e as Error).message}`);
		}
	}, [sessionStorage, setTokenizerModel, t]);

	return html`
		<${Modal} isOpen=${isOpen} onClose=${closeModal}
			title=${t('preferences.title')}
			style=${{ 'max-width': '35em' }}>
			<div className="vbox">
				<div className="hbox" style=${{ gap: 0 }}>
					<button style=${tabStyle(activeTab === 'general')}
						onClick=${() => switchTab('general')}>
						${t('preferences.tabGeneral')}
					</button>
					<button style=${tabStyle(activeTab === 'editor')}
						onClick=${() => switchTab('editor')}>
						${t('preferences.tabEditor')}
					</button>
					<button style=${tabStyle(activeTab === 'screenshot')}
						onClick=${() => switchTab('screenshot')}>
						${t('preferences.tabScreenshot')}
					</button>
					${isMiyapadEndpoint && html`
						<button style=${tabStyle(activeTab === 'server')}
							onClick=${() => switchTab('server')}>
							${t('preferences.tabServer')}
						</button>
					`}
				</div>

				<div ref=${contentRef} style=${{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '8px', transition: 'height 0.2s ease-in-out', minWidth: 0 }}>
					${activeTab === 'general' && html`
						<div style=${{ animation: 'fadeIn 0.2s ease-out', minWidth: 0, width: '100%', overflow: 'hidden' }}>
							<${SelectBox}
								label=${t('preferences.language')}
								value=${locale}
								onValueChange=${setLocale}
								options=${AVAILABLE_LOCALES.map(code => ({ name: localeName(code), value: code }))}/>
						</div>
					`}

					${activeTab === 'editor' && html`
						<div style=${{ animation: 'fadeIn 0.2s ease-out', minWidth: 0, width: '100%', overflow: 'hidden' }}>
							<${InputSlider} label=${t('preferences.fontSizeMultiplier')} min="0.5" max="5" step="0.01" strict="1"
								value=${fontSizeMultiplier} onValueChange=${setFontSizeMultiplier}/>
							<${Checkbox} label=${t('preferences.enableSpellChecking')}
								value=${spellCheck} onValueChange=${setSpellCheck}/>
							<br/>
							<${Checkbox} label=${t('preferences.attachSidebar')}
								value=${attachSidebar} onValueChange=${setAttachSidebar}/>
							<br/>
							<${Checkbox} label=${t('preferences.preserveCursorPosition')}
								value=${preserveCursorPosition} onValueChange=${setPreserveCursorPosition}/>
							<${SelectBox}
								label=${t('preferences.tokenHighlight')}
								value=${tokenHighlightMode}
								onValueChange=${setTokenHighlightMode}
								options=${[
									{ name: t('preferences.tokenHighlightShowEditor'), value: 0 },
									{ name: t('preferences.tokenHighlightShowToken'), value: 1 },
									{ name: t('preferences.hide'), value: -1 },
								]}/>
							${tokenHighlightMode !== -1 && html`
								<${SelectBox}
									label=${t('preferences.tokenHighlightColor')}
									value=${tokenColorMode}
									onValueChange=${setTokenColorMode}
									options=${[
										{ name: t('preferences.defaultLabel'), value: 0 },
										{ name: t('preferences.colorByProbability'), value: 1 },
										{ name: t('preferences.colorByPerplexity'), value: 2 },
									]}/>
								<${SelectBox}
									label=${t('preferences.tokenProbabilityDisplay')}
									value=${showProbsMode}
									onValueChange=${setShowProbsMode}
									options=${[
										{ name: t('preferences.showOnHover'), value: 0 },
										{ name: t('preferences.showOnHoverCtrl'), value: 1 },
										{ name: t('preferences.hide'), value: -1 },
									]}/>`}
							<div className="vbox" style=${{ marginTop: '10px', gap: '8px' }}>
								${!isMiyapadEndpoint && html`
									<div className="hbox" style=${{ gap: '8px' }}>
										<button style=${{ flex: 1 }} onClick=${handleExportDB}>${t('preferences.exportFullDB')}</button>
										<button style=${{ flex: 1 }} onClick=${handleImportDB}>${t('preferences.importFullDB')}</button>
									</div>
								`}
								<button style=${{ width: '100%' }} onClick=${exportPrompt}>
									${t('preferences.exportPromptToPlaintext')}
								</button>
							</div>
							<${Checkbox} label=${t('preferences.enableTTS')}
								disabled=${!!cancel || !ttsAvailable}
								title=${!ttsAvailable ? t('preferences.ttsNotAvailable') : ''}
								value=${ttsEnabled} onValueChange=${setTTSEnabled}/>
							${ttsEnabled && html`
								<div className="hbox-flex" style=${{ "flex-wrap": "unset" }}>
									<${SelectBox}
										id="voices"
										label=${t('preferences.voice')}
										disabled=${!!cancel}
										value=${ttsVoiceId}
										onValueChange=${setTTSVoiceId}
										options=${listTTSVoices}/>
									<button title=${t('preferences.stopTTSCtrlE')} className="symbol-button" disabled=${!speechSynthesis.speaking} onClick=${() => ttsStop()}>
										<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="var(--color-light)" fillRule="evenodd" style=${{ width: '.95em', height: '.95em' }}>
											<path d="M3 4a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4z"/>
										</svg>
									</button>
								</div>
								<${Checkbox} label=${t('preferences.speakUserInputs')}
									disabled=${!!cancel} value=${ttsSpeakInputs} onValueChange=${setTTSSpeakInputs}/>
								<${InputSlider} label=${t('preferences.maxUserInputLength')} type="number" step="1" min="1" max="400"
									disabled=${!ttsSpeakInputs} readonly=${!!cancel} value=${ttsMaxUserInput} onValueChange=${setTTSMaxUserInput}/>
								<div className="hbox">
									<${InputSlider} label=${t('preferences.ttsPitch')} type="number" step="0.1" max="2"
										readOnly=${!!cancel} value=${ttsPitch} onValueChange=${setTTSPitch}/>
									<${InputSlider} label=${t('preferences.ttsRate')} type="number" step="0.1" max="10"
										readOnly=${!!cancel} value=${ttsRate} onValueChange=${setTTSRate}/>
									<${InputSlider} label=${t('preferences.ttsVolume')} type="number" step="0.1" max="2"
										readOnly=${!!cancel} value=${ttsVolume} onValueChange=${setTTSVolume}/>
								</div>
							`}
						</div>
					`}

					${activeTab === 'screenshot' && html`
						<div style=${{ animation: 'fadeIn 0.2s ease-out', minWidth: 0, width: '100%', overflow: 'hidden' }}>
							<div className="hbox" style=${{ gap: '1em' }}>
								<${Checkbox} label=${t('preferences.includeSessionName')}
									value=${screenshotIncludeSessionName}
									onValueChange=${setScreenshotIncludeSessionName}/>
								<${Checkbox} label=${t('preferences.includeDate')}
									value=${screenshotIncludeDate}
									onValueChange=${setScreenshotIncludeDate}/>
							</div>
							<${InputBox} label=${t('preferences.backgroundImageUrl')}
								value=${screenshotBackgroundUrl}
								onValueChange=${setScreenshotBackgroundUrl}/>
							<${InputBox} label=${t('preferences.backgroundColor')} type="color"
								value=${screenshotBackgroundColor}
								onValueChange=${setScreenshotBackgroundColor}/>
							<${InputBox} label=${t('preferences.storyTextFont')}
								value=${screenshotStoryFont}
								onValueChange=${setScreenshotStoryFont}/>
							<${InputBox} label=${t('preferences.generalTextFont')}
								value=${screenshotGeneralFont}
								onValueChange=${setScreenshotGeneralFont}/>
							<div className="hbox" style=${{ gap: '1em' }}>
								<${InputBox} label=${t('preferences.fontWeight')}
									type="number"
									value=${screenshotFontWeight}
									onValueChange=${setScreenshotFontWeight}/>
								<${InputBox} label=${t('preferences.fontSizePx')}
									type="number"
									value=${screenshotFontSize}
									onValueChange=${setScreenshotFontSize}/>
								<${InputBox} label=${t('preferences.lineHeightPx')}
									type="number"
									value=${screenshotLineHeight}
									onValueChange=${setScreenshotLineHeight}/>
							</div>
							<div className="hbox" style=${{ gap: '1em' }}>
								<${InputBox} label=${t('preferences.generalTextColor')} type="color"
									value=${screenshotFontColor}
									onValueChange=${setScreenshotFontColor}/>
								<${InputBox} label=${t('preferences.aiTextColor')} type="color"
									value=${screenshotAiTextColor}
									onValueChange=${setScreenshotAiTextColor}/>
							</div>
							<${InputBox} label=${t('preferences.modelAvatarUrl')}
								value=${screenshotModelAvatarUrl}
								onValueChange=${setScreenshotModelAvatarUrl}/>
						</div>
					`}

					${activeTab === 'server' && html`
						<div style=${{ animation: 'fadeIn 0.2s ease-out', minWidth: 0, width: '100%', overflow: 'hidden' }}>
							<${Checkbox} label=${t('preferences.useServerTokenization')}
								value=${useServerTokenization}
								onValueChange=${setUseServerTokenization}/>
							${useServerTokenization && html`
								<div className="hbox" style=${{ gap: '8px', alignItems: 'center' }}>
									<${SelectBox}
										label=${t('preferences.tokenizerModel')}
										value=${tokenizerModel || ''}
										onValueChange=${handleTokenizerChange}
										options=${[
											{ name: t('preferences.none'), value: '' },
											...tokenizerList.map((tVal: string) => ({ name: tVal, value: tVal }))
										]}/>
									<button className="symbol-button" title=${t('preferences.refreshList')}
										onClick=${refreshTokenizers}>
										<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="var(--color-light)" style=${{ width: '.95em', height: '.95em' }}>
											<path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
										</svg>
									</button>
								</div>
								<div style=${{ fontSize: '0.85em', color: 'var(--color-base-60)', padding: '4px 0' }}>
									${tokenizerStatus || t('preferences.noTokenizerLoaded')}
								</div>
								<div style=${{ fontSize: '0.8em', color: 'var(--color-text-hint)', marginTop: '4px' }}>
									${t('preferences.tokenizerInstructions')}
								</div>
							`}
						</div>
					`}
				</div>
			</div>
		</${Modal}>`;
}
