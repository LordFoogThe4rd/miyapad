import { html } from 'htm/react';
import { I18nProvider } from './i18n';
import { SettingsProvider, useSettings } from './contexts/SettingsContext';
import { GenerationProvider } from './contexts/GenerationContext';
import { AppLayout } from './AppLayout';
import type { SessionStorage } from './storage/SessionStorage';
import type { TemplateStorage } from './storage/TemplateStorage';
import type { ThemeStorage } from './storage/ThemeStorage';
import type { ConnectionStorage } from './storage/ConnectionStorage';
import type { SamplerPresetStorage } from './storage/SamplerPresetStorage';

interface AppProps {
  sessionStorage: SessionStorage;
  templateStorage: TemplateStorage;
  themeStorage: ThemeStorage;
  connectionStorage: ConnectionStorage;
  samplerPresetStorage: SamplerPresetStorage;
  useSessionState: <T>(name: string, initialState: T) => [T, React.Dispatch<React.SetStateAction<T>>];
  useDBTemplates: (initialState: Record<string, InstructTemplate>) => [Record<string, InstructTemplate>, React.Dispatch<React.SetStateAction<Record<string, InstructTemplate>>>];
  useDBThemes: (initialState: Record<string, ThemeData>) => [Record<string, ThemeData>, React.Dispatch<React.SetStateAction<Record<string, ThemeData>>>];
  useDBConnections: (initialState: Record<string, ConnectionData>) => [Record<string, ConnectionData>, React.Dispatch<React.SetStateAction<Record<string, ConnectionData>>>];
  useDBSamplerPresets: (initialState: Record<string, SamplerPresetData>) => [Record<string, SamplerPresetData>, React.Dispatch<React.SetStateAction<Record<string, SamplerPresetData>>>];
  isMiyapadEndpoint: boolean;
}

export function App({ sessionStorage, templateStorage, themeStorage, connectionStorage, samplerPresetStorage, useSessionState, useDBTemplates, useDBThemes, useDBConnections, useDBSamplerPresets, isMiyapadEndpoint }: AppProps) {
	return html`
		<${SettingsProvider}
			sessionStorage=${sessionStorage}
			templateStorage=${templateStorage}
			themeStorage=${themeStorage}
			connectionStorage=${connectionStorage}
			samplerPresetStorage=${samplerPresetStorage}
			useSessionState=${useSessionState}
			useDBTemplates=${useDBTemplates}
			useDBThemes=${useDBThemes}
			useDBConnections=${useDBConnections}
			useDBSamplerPresets=${useDBSamplerPresets}
			isMiyapadEndpoint=${isMiyapadEndpoint}
		>
			<${LocalizedApp} useSessionState=${useSessionState} />
		</${SettingsProvider}>
	`;
}

function LocalizedApp({ useSessionState }: { useSessionState: AppProps['useSessionState'] }) {
	const { locale } = useSettings();
	return html`
		<${I18nProvider} locale=${locale}>
			<${GenerationProvider} useSessionState=${useSessionState}>
				<${AppLayout} />
			</${GenerationProvider}>
		</${I18nProvider}>
	`;
}
