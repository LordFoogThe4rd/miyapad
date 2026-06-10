import { html } from 'htm/react';
import { SettingsProvider } from './contexts/SettingsContext.js';
import { GenerationProvider } from './contexts/GenerationContext.js';
import { AppLayout } from './AppLayout.js';

export function App({ sessionStorage, templateStorage, themeStorage, connectionStorage, useSessionState, useDBTemplates, useDBThemes, useDBConnections, isMiyapadEndpoint }) {
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
