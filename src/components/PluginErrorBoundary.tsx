import { html } from 'htm/react';
import type { ReactNode } from 'react';
import { ErrorBoundary, type FallbackProps } from 'react-error-boundary';
import { useT } from '../i18n';
import { recordPluginRuntimeError } from '../plugins';

export interface PluginErrorBoundaryProps {
	id: string;
	compact?: boolean;
	children?: ReactNode;
}

function PluginErrorFallback({ id, compact, error }: FallbackProps & { id: string; compact?: boolean }) {
	const t = useT();
	const message = t('plugins.uiError', { id });
	const detail = error instanceof Error ? error.message : String(error);
	if (compact) {
		return html`<span className="plugin-error-fallback is-compact" role="alert" title=${`${message} (${detail})`} aria-label=${message}>⚠</span>`;
	}
	return html`<div className="plugin-error-fallback" role="alert" title=${detail}>${message}</div>`;
}

/**
 * Isolates a single plugin UI slot so a render error stays local instead of tripping CrashScreenFallback.
 */
export function PluginErrorBoundary({ id, compact, children }: PluginErrorBoundaryProps) {
	return html`
		<${ErrorBoundary}
			fallbackRender=${(props: FallbackProps) => html`<${PluginErrorFallback} ...${props} id=${id} compact=${compact}/>`}
			onError=${(error: Error) => {
				recordPluginRuntimeError(id, String(error));
				console.error(`[plugins] "${id}": UI render error:`, error);
			}}>
			${children}
		</${ErrorBoundary}>`;
}
