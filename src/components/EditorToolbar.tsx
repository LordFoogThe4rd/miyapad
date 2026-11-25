import { html } from 'htm/react';
import { useSyncExternalStore } from 'react';
import { useT } from '../i18n';
import {
	getPluginUiSnapshot,
	recordPluginRuntimeError,
	subscribePluginUi,
	type PluginToolbarEntry,
} from '../plugins';
import { PluginErrorBoundary } from './PluginErrorBoundary';
import { SVG_Camera, SVG_SearchAndReplace, SVG_Settings, SVG_SplitView } from './icons/index';

export interface EditorToolbarProps {
	layout: 'rail' | 'top';
	sessionTitle?: string;
	editorMode: 'source' | 'wysiwyg';
	onOpenPreferences: () => void;
	onOpenSearch: () => void;
	onToggleMarkdown: () => void;
	onTakeScreenshot: () => void;
}

interface PluginToolbarGroup {
	id: string;
	order: number;
	items: PluginToolbarEntry[];
}

function PluginToolbarButton({ item }: { item: PluginToolbarEntry }) {
	const isActive = typeof item.active === 'function' ? Boolean(item.active()) : Boolean(item.active);
	const isDisabled = typeof item.disabled === 'function' ? Boolean(item.disabled()) : Boolean(item.disabled);
	const label = `${item.name}: ${item.title}`;
	const iconNode = typeof item.icon === 'function' ? html`<${item.icon}/>` : item.icon;

	const handleClick = () => {
		try {
			item.onClick();
		} catch (e) {
			recordPluginRuntimeError(item.id, String(e));
			console.error(`[plugins] "${item.id}": toolbar action failed:`, e);
		}
	};

	return html`
		<button
			type="button"
			className=${`editor-toolbar-btn${isActive ? ' is-active' : ''}`}
			title=${label}
			aria-label=${label}
			aria-pressed=${item.active !== undefined ? isActive : undefined}
			disabled=${isDisabled}
			onClick=${handleClick}>
			${iconNode}
		</button>`;
}

export function EditorToolbar({
	layout,
	sessionTitle,
	editorMode,
	onOpenPreferences,
	onOpenSearch,
	onToggleMarkdown,
	onTakeScreenshot,
}: EditorToolbarProps) {
	const t = useT();
	const { toolbar } = useSyncExternalStore(subscribePluginUi, getPluginUiSnapshot);

	// Group plugin toolbar entries by plugin id, sorted by (manifest.order, id).
	const byPlugin = new Map<string, PluginToolbarGroup>();
	for (const entry of toolbar) {
		const existing = byPlugin.get(entry.id);
		if (existing) {
			existing.items.push(entry);
		} else {
			byPlugin.set(entry.id, { id: entry.id, order: entry.order, items: [entry] });
		}
	}
	const sortedPlugins = [...byPlugin.values()].sort((a, b) => {
		const orderDiff = a.order - b.order;
		if (orderDiff !== 0) return orderDiff;
		return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
	});

	const pooledSingle: PluginToolbarEntry[] = [];
	const multiGroups: PluginToolbarGroup[] = [];
	for (const group of sortedPlugins) {
		if (group.items.length === 1) {
			pooledSingle.push(group.items[0]);
		} else {
			multiGroups.push(group);
		}
	}

	const titleText = sessionTitle || t('toolbar.untitledSession');

	return html`
		<div
			className=${`editor-toolbar is-${layout}`}
			role="toolbar"
			aria-label=${t('toolbar.label')}
			aria-orientation=${layout === 'rail' ? 'vertical' : 'horizontal'}>
			${layout === 'top' && html`<div className="editor-toolbar-title" title=${titleText}>${titleText}</div>`}
			<div className="editor-toolbar-groups">
				<div className="editor-toolbar-group" data-group="builtin">
					<button
						type="button"
						className="editor-toolbar-btn"
						title=${t('prompt.preferences')}
						aria-label=${t('prompt.preferences')}
						onClick=${onOpenPreferences}>
						<${SVG_Settings}/>
					</button>
					<button
						type="button"
						className="editor-toolbar-btn"
						title=${t('prompt.searchAndReplace')}
						aria-label=${t('prompt.searchAndReplace')}
						onClick=${onOpenSearch}>
						<${SVG_SearchAndReplace}/>
					</button>
					<button
						type="button"
						className=${`editor-toolbar-btn${editorMode === 'wysiwyg' ? ' is-active' : ''}`}
						title=${t('prompt.toggleMarkdownMode')}
						aria-label=${t('prompt.toggleMarkdownMode')}
						aria-pressed=${editorMode === 'wysiwyg'}
						onClick=${onToggleMarkdown}>
						<${SVG_SplitView}/>
					</button>
					<button
						type="button"
						className="editor-toolbar-btn"
						title=${t('prompt.takeScreenshot')}
						aria-label=${t('prompt.takeScreenshot')}
						onClick=${onTakeScreenshot}>
						<${SVG_Camera}/>
					</button>
				</div>
				${pooledSingle.length > 0 && html`
					<div className="editor-toolbar-group" data-group="plugins-pooled">
						${pooledSingle.map((item, idx) => html`
							<${PluginErrorBoundary} key=${`${item.id}:${idx}`} id=${item.id} compact>
								<${PluginToolbarButton} item=${item}/>
							</${PluginErrorBoundary}>`)}
					</div>`}
				${multiGroups.map(group => html`
					<div className="editor-toolbar-group" key=${group.id} data-group=${`plugin-${group.id}`}>
						${group.items.map((item, idx) => html`
							<${PluginErrorBoundary} key=${`${item.id}:${idx}`} id=${item.id} compact>
								<${PluginToolbarButton} item=${item}/>
							</${PluginErrorBoundary}>`)}
					</div>`)}
			</div>
		</div>`;
}
