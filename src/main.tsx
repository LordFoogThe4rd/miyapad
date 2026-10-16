import { html } from 'htm/react';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from 'react-error-boundary';
import './polyfills';
import './styles.css';
import { IndexedDBAdapter } from './storage/IndexedDBAdapter';
import { ServerDBAdapter } from './storage/ServerDBAdapter';
import { SessionStorage } from './storage/SessionStorage';
import { TemplateStorage } from './storage/TemplateStorage';
import { ThemeStorage } from './storage/ThemeStorage';
import { ConnectionStorage } from './storage/ConnectionStorage';
import { SamplerPresetStorage } from './storage/SamplerPresetStorage';
import { PluginStorage } from './storage/PluginStorage';
import { PluginData } from './storage/PluginData';
import { pluginHooksFor, startPlugins } from './plugins';
import * as api from './api/index';
import { APP_VERSION } from './version';
import { useSessionState } from './hooks/useSessionState';
import { useStorageState } from './hooks/useStorageState';
import { CrashScreenFallback } from './components/CrashScreenFallback';
import { PluginsLoadingScreen } from './components/PluginsLoadingScreen';
import { App } from './App';
import en from './i18n/en.json';

async function main() {
	let dbAdapter: IndexedDBAdapter | ServerDBAdapter = new IndexedDBAdapter();
	let isMiyapadEndpoint = false;

	if (window.location.protocol != 'file:' && window.location.pathname == '/') {
		let serverAdapter = new ServerDBAdapter(window.location.protocol + '//' + window.location.host);
		try {
			await serverAdapter.init();
			dbAdapter = serverAdapter;
			isMiyapadEndpoint = true;
		} catch (e) {
			reportError(e);
		}
	}
	
	if (!isMiyapadEndpoint) {
		// Initialize IndexedDBAdapter
		await dbAdapter.init();
	}

	const sessionStorage = new SessionStorage(dbAdapter);
	await sessionStorage.init();

	const templateStorage = new TemplateStorage(dbAdapter);
	await templateStorage.init();

    const themeStorage = new ThemeStorage(dbAdapter);
    await themeStorage.init();

    const connectionStorage = new ConnectionStorage(dbAdapter);
    await connectionStorage.init();

    const samplerPresetStorage = new SamplerPresetStorage(dbAdapter);
    await samplerPresetStorage.init();

	const pluginData = new PluginData(dbAdapter);
	const pluginStorage = new PluginStorage(dbAdapter, pluginData);
	await pluginStorage.init();

	const rootEl = document.getElementById('root');
	if (!rootEl) throw new Error(en['main.rootNotFound']);
	// One root: the loading screen and the app are two renders of it.
	const root = createRoot(rootEl);

	let skipResolve!: () => void;
	const skip = new Promise<void>(resolve => { skipResolve = resolve; });
	let progress: { name: string; index: number; total: number } | undefined;
	// The loading screen is only drawn once startup has taken longer than the grace period.
	let splashShown = false;
	const renderSplash = () => root.render(html`
		<${ErrorBoundary} FallbackComponent=${CrashScreenFallback}>
			<${PluginsLoadingScreen}
				name=${progress?.name}
				index=${progress?.index}
				total=${progress?.total}
				onSkip=${skipResolve}/>
		</${ErrorBoundary}>`);

	// No stable API: plugins get the real objects, and any release can change them.
	const started = startPlugins(pluginStorage, new URLSearchParams(window.location.search).has('safe'), name => ({
		name,
		version: APP_VERSION,
		sessionStorage, templateStorage, themeStorage, connectionStorage, samplerPresetStorage,
		api, React, html,
		hooks: pluginHooksFor(pluginStorage.plugins[name]),
		storage: pluginData.storageFor(name),
	}), {
		skip,
		onProgress: (name, index, total) => {
			progress = { name, index, total };
			if (splashShown) renderSplash();
		},
	});

	const settled = await Promise.race([
		started.then(pluginStart => ({ done: true as const, pluginStart })),
		new Promise<{ done: false }>(resolve => setTimeout(resolve, 300, { done: false })),
	]);
	if (!settled.done) {
		splashShown = true;
		renderSplash();
	}
	const pluginStart = settled.done ? settled.pluginStart : await started;

	const boundUseSessionState = <T,>(name: string, initialState: T) => useSessionState(sessionStorage, name, initialState);

	root.render(html`
		<${ErrorBoundary} FallbackComponent=${CrashScreenFallback}>
			<${App}
				sessionStorage=${sessionStorage}
				templateStorage=${templateStorage}
				themeStorage=${themeStorage}
				connectionStorage=${connectionStorage}
				samplerPresetStorage=${samplerPresetStorage}
				pluginStorage=${pluginStorage}
				pluginStart=${pluginStart}
				useSessionState=${boundUseSessionState}
				useDBTemplates=${(initialState: Record<string, InstructTemplate>) => useStorageState(templateStorage, initialState)}
				useDBThemes=${(initialState: Record<string, ThemeData>) => useStorageState(themeStorage, initialState)}
				useDBConnections=${(initialState: Record<string, ConnectionData>) => useStorageState(connectionStorage, initialState)}
				useDBSamplerPresets=${(initialState: Record<string, SamplerPresetData>) => useStorageState(samplerPresetStorage, initialState)}
				isMiyapadEndpoint=${isMiyapadEndpoint}/>
		</${ErrorBoundary}>`);
}

main();
