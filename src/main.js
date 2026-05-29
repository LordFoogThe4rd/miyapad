import { html } from 'htm/react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from 'react-error-boundary';
import './polyfills.js';
import './styles.css';
import { IndexedDBAdapter } from './storage/IndexedDBAdapter.js';
import { ServerDBAdapter } from './storage/ServerDBAdapter.js';
import { SessionStorage } from './storage/SessionStorage.js';
import { TemplateStorage } from './storage/TemplateStorage.js';
import { ThemeStorage } from './storage/ThemeStorage.js';
import { useSessionState } from './hooks/useSessionState.js';
import { useStorageState } from './hooks/useStorageState.js';
import { CrashScreenFallback } from './components/CrashScreenFallback.js';
import { App } from './App.js';

async function main() {
	let dbAdapter = new IndexedDBAdapter();
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

	createRoot(document.body).render(html`
		<${ErrorBoundary} FallbackComponent=${CrashScreenFallback}>
			<${App}
				sessionStorage=${sessionStorage}
				templateStorage=${templateStorage}
				themeStorage=${themeStorage}
				useSessionState=${(name, initialState) => useSessionState(sessionStorage, name, initialState)}
				useDBTemplates=${(initialState => useStorageState(templateStorage, initialState))}
				useDBThemes=${(initialState => useStorageState(themeStorage, initialState))}
				isMiyapadEndpoint=${isMiyapadEndpoint}/>
		</${ErrorBoundary}>`);
}

main();
