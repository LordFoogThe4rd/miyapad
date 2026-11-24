import { html } from 'htm/react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useT } from '../../i18n';
import { APP_VERSION } from '../../version';
import {
	checkRequirements,
	checkVersion,
	clearPluginRuntimeError,
	comparePlugins,
	fetchPluginCode,
	fetchPluginFromUrl,
	getPluginRuntimeErrors,
	isArchiveUrl,
	parseHeader,
	pluginNameFromUrl,
	subscribePluginRuntimeErrors,
	type PluginStartInfo,
} from '../../plugins';
import { parsePluginArchive, PluginArchiveError } from '../../plugins/archive';
import { extractChangelogSection } from '../../plugins/changelog';
import { isHttpUrl, legacyManifest, SUPPORTED_PLUGIN_API } from '../../plugins/manifest';
import { PluginIdMismatchError, type PluginImportInput, type PluginStorage } from '../../storage/PluginStorage';
import { Switch } from '../controls/Switch';

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

type Control = 'toggle' | 'delete' | 'update';

const formatTime = (ms: number) => {
	const date = new Date(ms);
	return date.toDateString() === new Date().toDateString()
		? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
		: date.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
};

async function readFileBytes(file: File): Promise<Uint8Array> {
	if (typeof file.arrayBuffer === 'function') {
		return new Uint8Array(await file.arrayBuffer());
	}
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
		reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
		reader.readAsArrayBuffer(file);
	});
}

/**
 * Calls PluginStorage directly instead of going through useStorageState, so each change hands
 * back its save and Reload can wait for it. The list shown here is the tab's own copy.
 */
export function PluginsTab({ pluginStorage, pluginStart, showStartupNotice, isMiyapadEndpoint, handleExportDB }: PluginsTabProps) {
	const t = useT();
	const [plugins, setPlugins] = useState(pluginStorage.plugins);
	const [busy, setBusy] = useState<Record<string, Control>>({});
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [importing, setImporting] = useState<'file' | 'url' | null>(null);
	const [reloading, setReloading] = useState(false);
	const [backup, setBackup] = useState<BackupStatus | 'error' | null>(null);
	const runtimeErrors = useSyncExternalStore(subscribePluginRuntimeErrors, getPluginRuntimeErrors);

	useEffect(() => {
		if (!isMiyapadEndpoint) return;
		fetch('/version')
			.then(res => res.json())
			.then(data => setBackup(data.backup ?? 'error'))
			.catch(() => setBackup('error'));
	}, [isMiyapadEndpoint]);

	const host = { server: isMiyapadEndpoint };

	const range = ({ minMiyapad: min, maxMiyapad: max }: Pick<PluginManifest, 'minMiyapad' | 'maxMiyapad'>) =>
		min !== undefined && max !== undefined ? t('plugins.rangeBoth', { min, max })
		: min !== undefined ? t('plugins.rangeMin', { min })
		: max !== undefined ? t('plugins.rangeMax', { max })
		: t('plugins.rangeNone');

	const formatArchiveError = (err: PluginArchiveError): string => {
		switch (err.kind) {
			case 'archive-too-large':
				return t('plugins.archiveTooLarge');
			case 'decompressed-too-large':
				return t('plugins.archiveUnzippedTooLarge');
			case 'entry-too-large':
				return t('plugins.archiveEntryTooLarge');
			case 'not-zip':
				return t('plugins.archiveNotZip');
			case 'missing-manifest':
				return t('plugins.archiveMissingManifest');
			case 'bad-manifest-json':
				return t('plugins.archiveBadJson');
			case 'invalid-manifest':
				return t('plugins.archiveBadManifest', { error: err.message });
			case 'missing-main':
				return t('plugins.archiveMissingMain');
			case 'unbundled-esm':
				return t('plugins.archiveBundleHint');
			case 'syntax-error':
				return t('plugins.archiveSyntaxError', { error: err.message });
		}
	};

	/** Copies the row from storage, which only holds what was saved, so a failed save puts the row back. */
	const syncRow = (id: string) => setPlugins(p => {
		const { [id]: _, ...rest } = p;
		return Object.hasOwn(pluginStorage.plugins, id) ? { ...rest, [id]: pluginStorage.plugins[id] } : rest;
	});

	const run = async (id: string, control: Control, save: () => Promise<void>, shown?: PluginRecord) => {
		setBusy(b => ({ ...b, [id]: control }));
		setErrors(({ [id]: _, ...rest }) => rest);
		if (shown) setPlugins(p => ({ ...p, [id]: shown }));
		try {
			await save();
		} catch (e) {
			setErrors(errs => ({ ...errs, [id]: t('plugins.saveFailed', { error: String(e) }) }));
		} finally {
			setBusy(({ [id]: _, ...rest }) => rest);
			syncRow(id);
		}
	};

	const toggle = (id: string) => {
		if (busy[id]) return;
		const plugin = plugins[id];
		const name = plugin.manifest.name;
		if (plugin.enabled) {
			run(id, 'toggle', () => pluginStorage.setEnabled(id, false), { ...plugin, enabled: false });
			return;
		}
		if (checkRequirements(plugin.manifest, host).includes('server')) {
			alert(t('plugins.switchOnRequiresServer', { name }));
			return;
		}
		const fit = checkVersion(plugin.manifest);
		if (fit === 'fits') {
			run(id, 'toggle', () => pluginStorage.setEnabled(id, true), { ...plugin, enabled: true });
			return;
		}
		const question = fit === 'mismatched'
			? t('plugins.switchOnMismatched', { name, range: range(plugin.manifest), version: APP_VERSION })
			: t('plugins.switchOnUndeclared', { name });
		if (!confirm(question)) return;
		run(id, 'toggle', () => pluginStorage.setEnabled(id, true, APP_VERSION), { ...plugin, enabled: true, allowedVersion: APP_VERSION });
	};

	const remove = (id: string) => {
		if (busy[id] || !confirm(t('plugins.deleteConfirm', { name: plugins[id].manifest.name }))) return;
		run(id, 'delete', async () => {
			await pluginStorage.remove(id);
			clearPluginRuntimeError(id);
		});
	};

	const badHeader = ({ bad }: ReturnType<typeof parseHeader>) => {
		if (bad?.kind === 'version') return alert(t('plugins.badVersion', { version: bad.value }));
		if (bad?.kind === 'timeout') return alert(t('plugins.badTimeout', { timeout: bad.value }));
	};

	/** Shared by file and URL imports: replace check, warning, compatibility notices, save. */
	const install = async (input: PluginImportInput) => {
		const resolvedId = pluginStorage.resolveId(input.manifest.id);
		const existing = pluginStorage.plugins[resolvedId];
		if (existing && !confirm(t('plugins.replaceConfirm', { name: existing.manifest.name }))) return;
		const fit = checkVersion(input.manifest);
		const missingReqs = checkRequirements(input.manifest, host);
		const displaySource = input.source ?? input.url;
		const question = [
			t('plugins.importConfirm', { name: input.manifest.name }),
			...(displaySource !== undefined ? [t('plugins.fromUrl', { url: displaySource })] : []),
			t('plugins.warning'),
			...(missingReqs.includes('server') ? [t('plugins.importRequiresServer')] : []),
			...(fit === 'mismatched' ? [t('plugins.importMismatched', { range: range(input.manifest), version: APP_VERSION })] : []),
			...(fit === 'undeclared' ? [t('plugins.importUndeclared')] : []),
		].join('\n\n');
		if (!confirm(question)) return;
		try {
			await pluginStorage.importPlugin({ ...input, manifest: { ...input.manifest, id: resolvedId } });
			clearPluginRuntimeError(resolvedId);
			setErrors(({ [resolvedId]: _, ...rest }) => rest);
			syncRow(resolvedId);
		} catch (e) {
			alert(t('plugins.importFailed', { error: String(e) }));
		}
	};

	const importFile = () => {
		if (importing) return;
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.miyaplugin,.js';
		input.onchange = async () => {
			const file = input.files?.[0];
			if (!file) return;
			setImporting('file');
			try {
				if (file.name.toLowerCase().endsWith('.js')) {
					const name = file.name.replace(/\.js$/i, '');
					if (!name) return alert(t('plugins.emptyName'));
					const code = await file.text();
					const header = parseHeader(code);
					if (header.bad !== undefined) return badHeader(header);
					const resolvedId = pluginStorage.resolveId(name);
					await install({ code, manifest: legacyManifest(resolvedId, header) });
				} else {
					const archive = parsePluginArchive(await readFileBytes(file));
					await install({ code: archive.code, manifest: archive.manifest, changelog: archive.changelog });
				}
			} catch (e) {
				if (e instanceof PluginArchiveError) alert(formatArchiveError(e));
				else alert(t('plugins.importFailed', { error: String(e) }));
			} finally {
				setImporting(null);
			}
		};
		input.click();
	};

	const importUrl = async () => {
		if (importing) return;
		const url = prompt(t('plugins.urlPrompt'))?.trim();
		if (!url) return;
		if (!isHttpUrl(url) || (!isArchiveUrl(url) && !pluginNameFromUrl(url))) {
			return alert(t('plugins.urlBadName'));
		}
		setImporting('url');
		try {
			const fetched = await fetchPluginFromUrl(url, isMiyapadEndpoint);
			if (fetched.kind === 'archive') {
				const { archive } = fetched;
				await install({ code: archive.code, manifest: archive.manifest, changelog: archive.changelog, url, source: url });
			} else {
				const name = pluginNameFromUrl(url);
				if (!name) return alert(t('plugins.urlBadName'));
				const header = parseHeader(fetched.code);
				if (header.bad !== undefined) return badHeader(header);
				const resolvedId = pluginStorage.resolveId(name);
				await install({ code: fetched.code, manifest: legacyManifest(resolvedId, header), url, source: url });
			}
		} catch (e) {
			if (e instanceof PluginArchiveError) alert(formatArchiveError(e));
			else alert(t('plugins.fetchFailed', { error: String(e) }));
		} finally {
			setImporting(null);
		}
	};

	/** Fetches a plugin from its saved address and saves it keeping its on/off state and data. */
	const update = async (id: string) => {
		const current = plugins[id];
		const url = current?.url;
		if (!current || !url || busy[id]) return;
		const displayUrl = current.source ?? url;
		setBusy(b => ({ ...b, [id]: 'update' }));
		setErrors(({ [id]: _, ...rest }) => rest);
		try {
			const latest = pluginStorage.plugins[id] ?? current;
			if (latest.manifest.version === undefined) {
				// Legacy .js plugins keep their synthetic manifest shape when updated.
				const code = await fetchPluginCode(url, isMiyapadEndpoint);
				if (code === latest.code) {
					alert(t('plugins.upToDate', { name: latest.manifest.name }));
					return;
				}
				const header = parseHeader(code);
				if (header.bad !== undefined) return badHeader(header);
				const nextManifest = legacyManifest(id, header);
				const fit = checkVersion(nextManifest);
				const question = [
					t('plugins.updateConfirm', { name: latest.manifest.name, url: displayUrl }),
					...(fit === 'mismatched' ? [t('plugins.importMismatched', { range: range(nextManifest), version: APP_VERSION })] : []),
					...(fit === 'undeclared' ? [t('plugins.importUndeclared')] : []),
				].join('\n\n');
				if (!confirm(question)) return;
				await pluginStorage.updatePlugin(id, { code, manifest: nextManifest });
				clearPluginRuntimeError(id);
				return;
			}

			const fetched = await fetchPluginFromUrl(url, isMiyapadEndpoint);
			if (fetched.kind !== 'archive') {
				throw new PluginArchiveError('not-zip', 'Not a valid .miyaplugin zip archive');
			}
			const { archive } = fetched;
			if (archive.manifest.id.toLowerCase() !== id.toLowerCase()) {
				setErrors(errs => ({ ...errs, [id]: t('plugins.differentPlugin') }));
				return;
			}
			if (archive.code === latest.code && archive.manifest.version === latest.manifest.version) {
				alert(t('plugins.upToDate', { name: latest.manifest.name }));
				return;
			}
			const versionLine = archive.manifest.version !== latest.manifest.version
				? t('plugins.updateVersionChange', { from: latest.manifest.version, to: archive.manifest.version })
				: t('plugins.updateSameVersion', { version: archive.manifest.version });
			const notes = extractChangelogSection(archive.changelog, archive.manifest.version) ?? t('plugins.changelogNone');
			const fit = checkVersion(archive.manifest);
			const missingReqs = checkRequirements(archive.manifest, host);
			const question = [
				`${t('plugins.updateConfirm', { name: archive.manifest.name, url: displayUrl })}\n(${versionLine})`,
				`${t('plugins.changelogHeading', { version: archive.manifest.version })}\n${notes}`,
				...(missingReqs.includes('server') ? [t('plugins.importRequiresServer')] : []),
				...(fit === 'mismatched' ? [t('plugins.importMismatched', { range: range(archive.manifest), version: APP_VERSION })] : []),
				...(fit === 'undeclared' ? [t('plugins.importUndeclared')] : []),
			].join('\n\n');
			if (!confirm(question)) return;
			await pluginStorage.updatePlugin(id, {
				code: archive.code,
				manifest: archive.manifest,
				changelog: archive.changelog,
			});
			clearPluginRuntimeError(id);
		} catch (e) {
			if (e instanceof PluginArchiveError) {
				setErrors(errs => ({ ...errs, [id]: formatArchiveError(e) }));
			} else if (e instanceof PluginIdMismatchError) {
				setErrors(errs => ({ ...errs, [id]: t('plugins.differentPlugin') }));
			} else {
				setErrors(errs => ({ ...errs, [id]: t('plugins.updateFailed', { error: String(e) }) }));
			}
		} finally {
			setBusy(({ [id]: _, ...rest }) => rest);
			syncRow(id);
		}
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

	const ids = Object.keys(plugins).sort((a, b) => comparePlugins(plugins, a, b));
	const allSwitchedOffForServer = pluginStart.switchedOff.length > 0 && pluginStart.switchedOff.every(id => {
		const plugin = plugins[id];
		return plugin !== undefined && checkRequirements(plugin.manifest, host).includes('server');
	});

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
					<p>${allSwitchedOffForServer ? t('plugins.switchedOffServer') : t('plugins.switchedOff', { version: APP_VERSION })}</p>
					<p>${pluginStart.switchedOff.map(id => {
						const plugin = plugins[id];
						const name = plugin?.manifest.name ?? id;
						if (plugin && checkRequirements(plugin.manifest, host).includes('server')) {
							return t('plugins.switchedOffRequiresServer', { name });
						}
						return plugin && checkVersion(plugin.manifest) === 'mismatched'
							? t('plugins.switchedOffMismatched', { name, range: range(plugin.manifest) })
							: t('plugins.switchedOffUndeclared', { name });
					}).join(', ')}.</p>
					<p>${t('plugins.switchedOffHint')}</p>
				</div>
			`}
			${pluginStart.safeMode && html`<div className="plugins-notice" role="status">${t('plugins.safeMode')}</div>`}
			<div className="plugins-import">
				<button className=${importing === 'file' ? 'processing' : ''} disabled=${importing !== null} onClick=${importFile}>${t('plugins.importFile')}</button>
				<button className=${importing === 'url' ? 'processing' : ''} disabled=${importing !== null} onClick=${importUrl}>${t('plugins.importUrl')}</button>
			</div>
			${ids.length === 0
				? html`<p className="plugins-empty">${t('plugins.empty')}</p>`
				: html`<ul className="plugins-list">
					${ids.map(id => {
						const plugin = plugins[id];
						const { manifest } = plugin;
						const fit = checkVersion(manifest);
						const missingServer = checkRequirements(manifest, host).includes('server');
						const loadError = pluginStart.errors[id];
						const runtimeError = runtimeErrors[id];
						const displayUrl = plugin.source ?? plugin.url;
						return html`
							<li className="plugins-row" key=${id}>
								<div className="plugins-row-main">
									<span className="plugins-name">${manifest.name}</span>
									${manifest.version !== undefined && html`<span className="plugins-version">${manifest.version}</span>`}
									<span className="plugins-range">
										${range(manifest)}
										${manifest.version === undefined && html` · <span className="plugins-legacy">${t('plugins.noManifest')}</span>`}
										${manifest.requires?.includes('server') && html` · <span className="plugins-requires">${t('plugins.requiresServer')}</span>`}
										${fit !== 'fits' && html`<span className="plugins-mark" role="img"
											title=${fit === 'mismatched' ? t('plugins.markMismatched', { version: APP_VERSION }) : t('plugins.markUndeclared')}
											aria-label=${fit === 'mismatched' ? t('plugins.markMismatched', { version: APP_VERSION }) : t('plugins.markUndeclared')}>⚠</span>`}
										${missingServer && html`<span className="plugins-mark" role="img"
											title=${t('plugins.markRequiresServer')}
											aria-label=${t('plugins.markRequiresServer')}>⚠</span>`}
									</span>
									<${Switch}
										checked=${plugin.enabled}
										ariaLabel=${t('plugins.run', { name: manifest.name })}
										className=${busy[id] === 'toggle' ? 'processing' : undefined}
										disabled=${busy[id] === 'delete' || busy[id] === 'update'}
										onChange=${() => toggle(id)}/>
									${plugin.url && html`<button aria-label=${t('plugins.updateRun', { name: manifest.name })}
										className=${busy[id] === 'update' ? 'processing' : ''}
										disabled=${busy[id] === 'toggle' || busy[id] === 'delete'}
										onClick=${() => update(id)}>
										${t('plugins.update')}
									</button>`}
									<button className=${busy[id] === 'delete' ? 'processing' : ''}
										disabled=${busy[id] === 'toggle' || busy[id] === 'update'}
										onClick=${() => remove(id)}>
										${t('plugins.delete')}
									</button>
								</div>
								${manifest.description && html`<div className="plugins-description">${manifest.description}</div>`}
								${(manifest.author || manifest.homepage) && html`
									<div className="plugins-meta">
										${manifest.author && html`<span>${t('plugins.byAuthor', { author: manifest.author })}</span>`}
										${manifest.homepage && html`<a href=${manifest.homepage} target="_blank" rel="noopener noreferrer">${t('plugins.homepage')}</a>`}
									</div>
								`}
								${displayUrl && html`<div className="plugins-url" title=${displayUrl}>${t('plugins.fromUrl', { url: displayUrl })}</div>`}
								${manifest.api > SUPPORTED_PLUGIN_API && html`<div className="plugins-error">${t('plugins.apiNewer', { api: manifest.api, supported: SUPPORTED_PLUGIN_API })}</div>`}
								${loadError && html`<div className="plugins-error">${t('plugins.loadError', { error: loadError })}</div>`}
								${runtimeError && html`<div className="plugins-error">${t('plugins.hookError', { error: runtimeError })}</div>`}
								${pluginStart.timedOut.includes(id) && html`<div className="plugins-error">${t('plugins.timedOut')}</div>`}
								${pluginStart.skipped.includes(id) && html`<div className="plugins-error">${t('plugins.skipped')}</div>`}
								${errors[id] && html`<div className="plugins-error" role="alert">${errors[id]}</div>`}
							</li>`;
					})}
				</ul>`}
			<div className="plugins-footer">
				<span>${t('plugins.reloadNote')}</span>
				<button className=${reloading ? 'processing' : ''} onClick=${reload}>${t('plugins.reload')}</button>
			</div>
		</div>`;
}
