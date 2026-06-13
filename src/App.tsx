import { html } from 'htm/react';
import { SettingsProvider } from './contexts/SettingsContext';
import { GenerationProvider } from './contexts/GenerationContext';
import { AppLayout } from './AppLayout';
import type { SessionStorage } from './storage/SessionStorage';
import type { TemplateStorage } from './storage/TemplateStorage';
import type { ThemeStorage } from './storage/ThemeStorage';
import type { ConnectionStorage } from './storage/ConnectionStorage';

interface AppProps {
  sessionStorage: SessionStorage;
  templateStorage: TemplateStorage;
  themeStorage: ThemeStorage;
  connectionStorage: ConnectionStorage;
  useSessionState: <T>(name: string, initialState: T) => [T, React.Dispatch<React.SetStateAction<T>>];
  useDBTemplates: (initialState: unknown) => [Record<string, InstructTemplate>, React.Dispatch<React.SetStateAction<Record<string, InstructTemplate>>>];
  useDBThemes: (initialState: unknown) => [Record<string, ThemeData>, React.Dispatch<React.SetStateAction<Record<string, ThemeData>>>];
  useDBConnections: (initialState: unknown) => [Record<string, ConnectionData>, React.Dispatch<React.SetStateAction<Record<string, ConnectionData>>>];
  isMiyapadEndpoint: boolean;
}

export function App({ sessionStorage, templateStorage, themeStorage, connectionStorage, useSessionState, useDBTemplates, useDBThemes, useDBConnections, isMiyapadEndpoint }: AppProps) {
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
