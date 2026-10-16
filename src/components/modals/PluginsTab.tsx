import { html } from 'htm/react';
import { useEffect, useState } from 'react';
import { useT } from '../../i18n';
import { APP_VERSION } from '../../version';
import { checkVersion, parseHeader, type PluginStartInfo } from '../../plugins';
import type { PluginStorage } from '../../storage/PluginStorage';

interface PluginsTabProps {
	pluginStorage: PluginStorage;
	pluginStart: PluginStartInfo;
	/** Preferences opened by itself because plugins were switched off at startup. */
	showStartupNotice: boolean;
	isMiyapadEndpoint: boolean;
	handleExportDB: () => void;
}

interface BackupStatus {
	enabled: boolean;
	intervalMinutes: number | null;
	lastBackupAt: number | null;
}

type Control = 'toggle' | 'delete';

const formatTime = (ms: number) => {
	const date = new Date(ms);
	return date.toDateString() === new Date().toDateString()
		? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
		: date.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
};

/**
 * Calls PluginStorage directly instead of going through useStorageState, so each change hands
 * back its save and Reload can wait for it. The list shown here is the tab's own copy.
 */
export function PluginsTab({ pluginStorage, pluginStart, showStartupNotice, isMiyapadEndpoint, handleExportDB }: PluginsTabProps) {
	const t = useT();
	const [plugins, setPlugins] = useState(pluginStorage.plugins);
	const [busy, setBusy] = useState<Record<string, Control>>({});
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [importing, setImporting] = useState(false);
	const [reloading, setReloading] = useState(false);
	const [backup, setBackup] = useState<BackupStatus | 'error' | null>(null);

	useEffect(() => {
		if (!isMiyapadEndpoint) return;
		fetch('/version')
			.then(res => res.json())
			.then(data => setBackup(data.backup ?? 'error'))
			.catch(() => setBackup('error'));
	}, [isMiyapadEndpoint]);

	const range = ({ min, max }: { min?: string; max?: string }) =>
		min !== undefined && max !== undefined ? t('plugins.rangeBoth', { min, max })
		: min !== undefined ? t('plugins.rangeMin', { min })
		: max !== undefined ? t('plugins.rangeMax', { max })
		: t('plugins.rangeNone');

	/** Copies the row from storage, which only holds what was saved, so a failed save puts the row back. */
	const syncRow = (name: string) => setPlugins(p => {
		const { [name]: _, ...rest } = p;
		return Object.hasOwn(pluginStorage.plugins, name) ? { ...rest, [name]: pluginStorage.plugins[name] } : rest;
	});

	const run = async (name: string, control: Control, save: () => Promise<void>, shown?: PluginRecord) => {
		setBusy(b => ({ ...b, [name]: control }));
		setErrors(({ [name]: _, ...rest }) => rest);
		if (shown) setPlugins(p => ({ ...p, [name]: shown }));
		try {
			await save();
		} catch (e) {
			setErrors(errs => ({ ...errs, [name]: t('plugins.saveFailed', { error: String(e) }) }));
		} finally {
			setBusy(({ [name]: _, ...rest }) => rest);
			syncRow(name);
		}
	};

	const toggle = (name: string) => {
		if (busy[name]) return;
		const plugin = plugins[name];
		if (plugin.enabled) {
			run(name, 'toggle', () => pluginStorage.setEnabled(name, false), { ...plugin, enabled: false });
			return;
		}
		const fit = checkVersion(plugin);
		if (fit === 'fits') {
			run(name, 'toggle', () => pluginStorage.setEnabled(name, true), { ...plugin, enabled: true });
			return;
		}
		const question = fit === 'mismatched'
			? t('plugins.switchOnMismatched', { name, range: range(plugin), version: APP_VERSION })
			: t('plugins.switchOnUndeclared', { name });
		if (!confirm(question)) return;
		run(name, 'toggle', () => pluginStorage.setEnabled(name, true, APP_VERSION), { ...plugin, enabled: true, allowedVersion: APP_VERSION });
	};

	const remove = (name: string) => {
		if (busy[name] || !confirm(t('plugins.deleteConfirm', { name }))) return;
		run(name, 'delete', () => pluginStorage.remove(name));
	};

	const importPlugin = () => {
		if (importing) return;
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.js';
		input.onchange = async () => {
			const file = input.files?.[0];
			if (!file) return;
			const name = file.name.replace(/\.js$/i, '');
			if (!name) return alert(t('plugins.emptyName'));
			const code = await file.text();
			const header = parseHeader(code);
			if (header.bad !== undefined) {
				return alert(header.bad.kind === 'version'
					? t('plugins.badVersion', { version: header.bad.value })
					: t('plugins.badTimeout', { timeout: header.bad.value }));
			}
			const resolved = pluginStorage.resolveName(name);
			if (Object.hasOwn(pluginStorage.plugins, resolved) && !confirm(t('plugins.replaceConfirm', { name: resolved }))) return;
			const fit = checkVersion(header);
			const question = [
				t('plugins.importConfirm', { name: resolved }),
				t('plugins.warning'),
				...(fit === 'mismatched' ? [t('plugins.importMismatched', { range: range(header), version: APP_VERSION })] : []),
				...(fit === 'undeclared' ? [t('plugins.importUndeclared')] : []),
			].join('\n\n');
			if (!confirm(question)) return;
			setImporting(true);
			try {
				await pluginStorage.importPlugin(resolved, code, header);
				setErrors(({ [resolved]: _, ...rest }) => rest);
				syncRow(resolved);
			} catch (e) {
				alert(t('plugins.importFailed', { error: String(e) }));
			} finally {
				setImporting(false);
			}
		};
		input.click();
	};

	const reload = async () => {
		if (reloading) return;
		setReloading(true);
		await pluginStorage.pending;
		const url = new URL(window.location.href);
		url.searchParams.delete('safe');
		history.replaceState(history.state, '', url);
		window.location.reload();
	};

	const backupText = backup === null ? ''
		: backup === 'error' ? t('plugins.backupError')
		: !backup.enabled ? t('plugins.backupOff')
		: backup.lastBackupAt === null ? t('plugins.backupNone')
		: t('plugins.backupLast', { time: formatTime(backup.lastBackupAt), minutes: backup.intervalMinutes ?? '' });

	const names = Object.keys(plugins).sort();

	return html`
		<div className="plugins-tab">
			<div className="plugins-warning" role="note">${t('plugins.warning')}</div>
			<div className="plugins-backup">
				${isMiyapadEndpoint
					? html`<span>${backupText}</span>`
					: html`<button onClick=${handleExportDB}>${t('plugins.backupDownload')}</button>`}
			</div>
			${showStartupNotice && pluginStart.switchedOff.length > 0 && html`
				<div className="plugins-notice" role="status">
					<p>${t('plugins.switchedOff', { version: APP_VERSION })}</p>
					<p>${pluginStart.switchedOff.map(name => {
						const plugin = plugins[name] ?? {};
						return checkVersion(plugin) === 'mismatched'
							? t('plugins.switchedOffMismatched', { name, range: range(plugin) })
							: t('plugins.switchedOffUndeclared', { name });
					}).join(', ')}.</p>
					<p>${t('plugins.switchedOffHint')}</p>
				</div>
			`}
			${pluginStart.safeMode && html`<div className="plugins-notice" role="status">${t('plugins.safeMode')}</div>`}
			<button className=${importing ? 'processing' : ''} onClick=${importPlugin}>${t('plugins.import')}</button>
			${names.length === 0
				? html`<p className="plugins-empty">${t('plugins.empty')}</p>`
				: html`<ul className="plugins-list">
					${names.map(name => {
						const plugin = plugins[name];
						const fit = checkVersion(plugin);
						const loadError = pluginStart.errors[name];
						return html`
							<li className="plugins-row" key=${name}>
								<div className="plugins-row-main">
									<span className="plugins-name">${name}</span>
									<span className="plugins-range">
										${range(plugin)}
										${fit !== 'fits' && html`<span className="plugins-mark" role="img"
											title=${fit === 'mismatched' ? t('plugins.markMismatched', { version: APP_VERSION }) : t('plugins.markUndeclared')}
											aria-label=${fit === 'mismatched' ? t('plugins.markMismatched', { version: APP_VERSION }) : t('plugins.markUndeclared')}>⚠</span>`}
									</span>
									<button aria-pressed=${plugin.enabled} aria-label=${t('plugins.run', { name })}
										className=${busy[name] === 'toggle' ? 'processing' : ''}
										disabled=${busy[name] === 'delete'}
										onClick=${() => toggle(name)}>
										${plugin.enabled ? t('plugins.on') : t('plugins.off')}
									</button>
									<button className=${busy[name] === 'delete' ? 'processing' : ''}
										disabled=${busy[name] === 'toggle'}
										onClick=${() => remove(name)}>
										${t('plugins.delete')}
									</button>
								</div>
								${loadError && html`<div className="plugins-error">${t('plugins.loadError', { error: loadError })}</div>`}
								${pluginStart.timedOut.includes(name) && html`<div className="plugins-error">${t('plugins.timedOut')}</div>`}
								${pluginStart.skipped.includes(name) && html`<div className="plugins-error">${t('plugins.skipped')}</div>`}
								${errors[name] && html`<div className="plugins-error" role="alert">${errors[name]}</div>`}
							</li>`;
					})}
				</ul>`}
			<div className="plugins-footer">
				<span>${t('plugins.reloadNote')}</span>
				<button className=${reloading ? 'processing' : ''} onClick=${reload}>${t('plugins.reload')}</button>
			</div>
		</div>`;
}
