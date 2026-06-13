import { html } from 'htm/react';
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
import { useSessionState } from './hooks/useSessionState';
import { useStorageState } from './hooks/useStorageState';
import { CrashScreenFallback } from './components/CrashScreenFallback';
import { App } from './App';

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

	const rootEl = document.getElementById('root');
	if (!rootEl) throw new Error('Root element not found');
	createRoot(rootEl).render(html`
		<${ErrorBoundary} FallbackComponent=${CrashScreenFallback}>
			<${App}
				sessionStorage=${sessionStorage}
				templateStorage=${templateStorage}
				themeStorage=${themeStorage}
				connectionStorage=${connectionStorage}
				useSessionState=${(name: string, initialState: any) => useSessionState(sessionStorage, name, initialState)}
				useDBTemplates=${(initialState: any) => useStorageState(templateStorage, initialState) as [Record<string, InstructTemplate>, React.Dispatch<React.SetStateAction<Record<string, InstructTemplate>>>]}
				useDBThemes=${(initialState: any) => useStorageState(themeStorage, initialState) as [Record<string, ThemeData>, React.Dispatch<React.SetStateAction<Record<string, ThemeData>>>]}
				useDBConnections=${(initialState: any) => useStorageState(connectionStorage, initialState) as [Record<string, ConnectionData>, React.Dispatch<React.SetStateAction<Record<string, ConnectionData>>>]}
				isMiyapadEndpoint=${isMiyapadEndpoint}/>
		</${ErrorBoundary}>`);
}

main();
