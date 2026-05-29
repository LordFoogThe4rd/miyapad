import { html } from 'htm/react';
import { SettingsProvider } from './contexts/SettingsContext.js';
import { GenerationProvider } from './contexts/GenerationContext.js';
import { AppLayout } from './AppLayout.js';

export function App({ sessionStorage, templateStorage, themeStorage, useSessionState, useDBTemplates, useDBThemes, isMiyapadEndpoint }) {
	return html`
		<${SettingsProvider}
			sessionStorage=${sessionStorage}
			templateStorage=${templateStorage}
			themeStorage=${themeStorage}
			useSessionState=${useSessionState}
			useDBTemplates=${useDBTemplates}
			useDBThemes=${useDBThemes}
			isMiyapadEndpoint=${isMiyapadEndpoint}
		>
			<${GenerationProvider} useSessionState=${useSessionState}>
				<${AppLayout} />
			</${GenerationProvider}>
		</${SettingsProvider}>
	`;
}
