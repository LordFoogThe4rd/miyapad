import { html } from 'htm/react';
import { SettingsProvider } from './contexts/SettingsContext';
import { GenerationProvider } from './contexts/GenerationContext';
import { AppLayout } from './AppLayout';

export function App({ sessionStorage, templateStorage, themeStorage, connectionStorage, useSessionState, useDBTemplates, useDBThemes, useDBConnections, isMiyapadEndpoint }: {
	sessionStorage: any;
	templateStorage: any;
	themeStorage: any;
	connectionStorage: any;
	useSessionState: any;
	useDBTemplates: any;
	useDBThemes: any;
	useDBConnections: any;
	isMiyapadEndpoint: boolean;
}) {
	return html`
		<${SettingsProvider}
			sessionStorage=${sessionStorage}
			templateStorage=${templateStorage}
			themeStorage=${themeStorage}
			connectionStorage=${connectionStorage}
			useSessionState=${useSessionState}
			useDBTemplates=${useDBTemplates}
			useDBThemes=${useDBThemes}
			useDBConnections=${useDBConnections}
			isMiyapadEndpoint=${isMiyapadEndpoint}
		>
			<${GenerationProvider} useSessionState=${useSessionState}>
				<${AppLayout} />
			</${GenerationProvider}>
		</${SettingsProvider}>
	`;
}
