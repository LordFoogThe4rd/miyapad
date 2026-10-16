import { html } from 'htm/react';
import { useT } from '../i18n';

interface PluginsLoadingScreenProps {
	/** The plugin being started, and where it is in the queue, from `onProgress`. */
	name?: string;
	index?: number;
	total?: number;
	onSkip: () => void;
}

/** Drawn by `main()` when startup hasn't finished after a moment, so a slow plugin is visible and can be skipped. */
export function PluginsLoadingScreen({ name, index, total, onSkip }: PluginsLoadingScreenProps) {
	const t = useT();
	return html`
		<div id="plugins-loading" role="status">
			<p>${t('plugins.loading')}</p>
			${name !== undefined && index !== undefined && total !== undefined
				&& html`<p className="plugins-loading-plugin">${t('plugins.loadingPlugin', { name, index, total })}</p>`}
			<button onClick=${onSkip}>${t('plugins.skip')}</button>
		</div>`;
}
