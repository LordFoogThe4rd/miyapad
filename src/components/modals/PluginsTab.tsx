import { html } from 'htm/react';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useT } from '../../i18n';
import { APP_VERSION } from '../../version';
import {
	checkRequirements,
	checkVersion,
	clearPluginRuntimeError,
	comparePlugins,
	fetchPluginFromUrl,
	getPluginRuntimeErrors,
	subscribePluginRuntimeErrors,
	type PluginStartInfo,
} from '../../plugins';
import { parsePluginArchive, PluginArchiveError, type ParsedPluginArchive } from '../../plugins/archive';
import { extractChangelogSection } from '../../plugins/changelog';
import { isHttpUrl, SUPPORTED_PLUGIN_API } from '../../plugins/manifest';
import { describePluginSource, PluginSourceError, resolvePluginSource } from '../../plugins/sources';
import { usePersistentState } from '../../hooks/usePersistentState';
import { PluginIdMismatchError, type PluginImportInput, type PluginStorage } from '../../storage/PluginStorage';
import { InputBox } from '../controls/InputBox';
import { Switch } from '../controls/Switch';
import { SVG_HideKey, SVG_ShowKey } from '../icons/index';

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

type RowUpdateCheck =
	| { state: 'checking' }
	| { state: 'up-to-date' }
	| { state: 'available'; change: string }
	| { state: 'error'; detail: string };

const UPDATE_CHECK_CONCURRENCY = 4;

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
	const [updateChecks, setUpdateChecks] = useState<Record<string, RowUpdateCheck>>({});
	const [checkingUpdates, setCheckingUpdates] = useState(false);
	const [importing, setImporting] = useState<'file' | 'url' | null>(null);
	const [reloading, setReloading] = useState(false);
	const [backup, setBackup] = useState<BackupStatus | 'error' | null>(null);
	const [githubToken, setGithubToken] = usePersistentState('githubToken', '');
	const [showToken, setShowToken] = useState(false);
	const runtimeErrors = useSyncExternalStore(subscribePluginRuntimeErrors, getPluginRuntimeErrors);

	const unmountedRef = useRef(false);
	const batchRunRef = useRef(0);
	const rowMutationRef = useRef<Record<string, number>>({});
	const inflightRef = useRef(new Map<string, { url: string; promise: Promise<ParsedPluginArchive> }>());

	useEffect(() => {
		unmountedRef.current = false;
		return () => {
			unmountedRef.current = true;
			batchRunRef.current += 1;
		};
	}, []);

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

	const formatArchiveError = useCallback((err: PluginArchiveError): string => {
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
	}, [t]);

	const formatSourceError = (err: PluginSourceError): string => {
		switch (err.kind) {
			case 'bad-url':
				return t('plugins.urlBadName');
			case 'invalid-github-url':
				return t('plugins.urlBadGithub');
			case 'commit-without-path':
				return t('plugins.urlCommitNeedsPath');
			case 'missing-repo-path':
				return t('plugins.urlRepoNeedsPath');
			case 'github-auth-failed':
				return t('plugins.urlAuthFailed');
			case 'github-rate-limit':
				return t('plugins.urlRateLimited');
			case 'release-not-found':
				return t('plugins.urlReleaseNotFound');
			case 'no-release-asset':
				return t('plugins.urlNoAsset');
			case 'github-api-error':
				return t('plugins.fetchFailed', { error: err.message });
		}
	};

	const formatSourceLabel = (sourceOrUrl: string): string => {
		const info = describePluginSource(sourceOrUrl);
		switch (info.mode) {
			case 'github-latest':
				return t('plugins.sourceLatest', { repo: info.repo });
			case 'github-tag':
				return t('plugins.sourceRelease', { repo: info.repo, tag: info.tag });
			case 'github-branch':
				return t('plugins.sourceBranch', { repo: info.repo, branch: info.branch });
			case 'github-commit':
				return t('plugins.sourceCommit', { repo: info.repo, sha: info.shortSha });
			case 'direct':
				return t('plugins.fromUrl', { url: info.url });
		}
	};

	const describeVersionChange = useCallback((fromVersion: string, toVersion: string): string => {
		if (!fromVersion && !toVersion) return t('plugins.updateNoVersion');
		if (fromVersion !== toVersion) return t('plugins.updateVersionChange', { from: fromVersion, to: toVersion });
		return t('plugins.updateSameVersion', { version: toVersion });
	}, [t]);

	const bumpRowMutation = (id: string) => {
		rowMutationRef.current[id] = (rowMutationRef.current[id] ?? 0) + 1;
	};

	const fetchArchiveFor = useCallback((id: string, url: string): Promise<ParsedPluginArchive> => {
		const existing = inflightRef.current.get(id);
		if (existing && existing.url === url) return existing.promise;
		const promise = fetchPluginFromUrl(url, isMiyapadEndpoint).finally(() => {
			if (inflightRef.current.get(id)?.promise === promise) {
				inflightRef.current.delete(id);
			}
		});
		inflightRef.current.set(id, { url, promise });
		return promise;
	}, [isMiyapadEndpoint]);

	const checkAllUpdates = useCallback(async () => {
		const currentPlugins = pluginStorage.plugins;
		const targets = Object.keys(currentPlugins)
			.sort((a, b) => comparePlugins(currentPlugins, a, b))
			.filter(id => Boolean(currentPlugins[id]?.url));
		if (targets.length === 0) return;

		const runId = ++batchRunRef.current;
		setCheckingUpdates(true);
		setUpdateChecks(prev => {
			const next = { ...prev };
			for (const id of targets) next[id] = { state: 'checking' };
			return next;
		});

		let cursor = 0;
		const worker = async () => {
			while (cursor < targets.length) {
				if (unmountedRef.current || batchRunRef.current !== runId) return;
				const id = targets[cursor++];
				const initial = pluginStorage.plugins[id];
				const url = initial?.url;
				if (!url) continue;
				const mutationBefore = rowMutationRef.current[id] ?? 0;

				try {
					const archive = await fetchArchiveFor(id, url);
					if (unmountedRef.current || batchRunRef.current !== runId) return;
					if ((rowMutationRef.current[id] ?? 0) !== mutationBefore) continue;
					const latest = pluginStorage.plugins[id];
					if (!latest) continue;

					if (archive.manifest.id !== id) {
						setUpdateChecks(prev => ({ ...prev, [id]: { state: 'error', detail: t('plugins.differentPlugin') } }));
					} else if (archive.code === latest.code && archive.manifest.version === latest.manifest.version) {
						setUpdateChecks(prev => ({ ...prev, [id]: { state: 'up-to-date' } }));
					} else {
						const change = describeVersionChange(latest.manifest.version, archive.manifest.version);
						setUpdateChecks(prev => ({ ...prev, [id]: { state: 'available', change } }));
					}
				} catch (e) {
					if (unmountedRef.current || batchRunRef.current !== runId) return;
					if ((rowMutationRef.current[id] ?? 0) !== mutationBefore) continue;
					const detail = e instanceof PluginArchiveError ? formatArchiveError(e) : e instanceof Error ? e.message : String(e);
					setUpdateChecks(prev => ({ ...prev, [id]: { state: 'error', detail } }));
				}
			}
		};

		await Promise.all(Array.from({ length: Math.min(UPDATE_CHECK_CONCURRENCY, targets.length) }, worker));
		if (!unmountedRef.current && batchRunRef.current === runId) {
			setCheckingUpdates(false);
		}
	}, [describeVersionChange, fetchArchiveFor, formatArchiveError, pluginStorage, t]);

	useEffect(() => {
		void checkAllUpdates();
	}, [checkAllUpdates]);

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
		bumpRowMutation(id);
		run(id, 'delete', async () => {
			await pluginStorage.remove(id);
			clearPluginRuntimeError(id);
			setUpdateChecks(({ [id]: _, ...rest }) => rest);
		});
	};

	/** Shared by file and URL imports: replace check, warning, compatibility notices, save. */
	const install = async (input: PluginImportInput) => {
		const id = input.manifest.id;
		const existing = pluginStorage.plugins[id];
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
			bumpRowMutation(id);
			await pluginStorage.importPlugin(input);
			clearPluginRuntimeError(id);
			setErrors(({ [id]: _, ...rest }) => rest);
			setUpdateChecks(prev => {
				if (input.url) return { ...prev, [id]: { state: 'up-to-date' } };
				const { [id]: _, ...rest } = prev;
				return rest;
			});
			syncRow(id);
		} catch (e) {
			alert(t('plugins.importFailed', { error: String(e) }));
		}
	};

	const importFile = () => {
		if (importing) return;
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.miyaplugin';
		input.onchange = async () => {
			const file = input.files?.[0];
			if (!file) return;
			setImporting('file');
			try {
				const archive = parsePluginArchive(await readFileBytes(file));
				await install({ code: archive.code, manifest: archive.manifest, changelog: archive.changelog });
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
		const rawUrl = prompt(t('plugins.urlPrompt'))?.trim();
		if (!rawUrl) return;
		if (!isHttpUrl(rawUrl)) {
			return alert(t('plugins.urlBadName'));
		}
		setImporting('url');
		try {
			const resolved = await resolvePluginSource(rawUrl, { token: githubToken });
			const archive = await fetchPluginFromUrl(resolved.url, isMiyapadEndpoint);
			await install({
				code: archive.code,
				manifest: archive.manifest,
				changelog: archive.changelog,
				url: resolved.url,
				source: resolved.source,
			});
		} catch (e) {
			if (e instanceof PluginSourceError) alert(formatSourceError(e));
			else if (e instanceof PluginArchiveError) alert(formatArchiveError(e));
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
			const archive = await fetchArchiveFor(id, url);
			if (archive.manifest.id !== id) {
				bumpRowMutation(id);
				setUpdateChecks(prev => ({ ...prev, [id]: { state: 'error', detail: t('plugins.differentPlugin') } }));
				setErrors(errs => ({ ...errs, [id]: t('plugins.differentPlugin') }));
				return;
			}
			if (archive.code === latest.code && archive.manifest.version === latest.manifest.version) {
				bumpRowMutation(id);
				setUpdateChecks(prev => ({ ...prev, [id]: { state: 'up-to-date' } }));
				alert(t('plugins.upToDate', { name: latest.manifest.name }));
				return;
			}
			const versionLine = describeVersionChange(latest.manifest.version, archive.manifest.version);
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
			if (!confirm(question)) {
				bumpRowMutation(id);
				setUpdateChecks(prev => ({ ...prev, [id]: { state: 'available', change: versionLine } }));
				return;
			}
			bumpRowMutation(id);
			await pluginStorage.updatePlugin(id, {
				code: archive.code,
				manifest: archive.manifest,
				changelog: archive.changelog,
			});
			setUpdateChecks(prev => ({ ...prev, [id]: { state: 'up-to-date' } }));
			clearPluginRuntimeError(id);
		} catch (e) {
			bumpRowMutation(id);
			if (e instanceof PluginArchiveError) {
				const msg = formatArchiveError(e);
				setUpdateChecks(prev => ({ ...prev, [id]: { state: 'error', detail: msg } }));
				setErrors(errs => ({ ...errs, [id]: msg }));
			} else if (e instanceof PluginIdMismatchError) {
				const msg = t('plugins.differentPlugin');
				setUpdateChecks(prev => ({ ...prev, [id]: { state: 'error', detail: msg } }));
				setErrors(errs => ({ ...errs, [id]: msg }));
			} else {
				const detail = e instanceof Error ? e.message : String(e);
				setUpdateChecks(prev => ({ ...prev, [id]: { state: 'error', detail } }));
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
	const hasUrlPlugins = ids.some(id => Boolean(plugins[id].url));
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
				${hasUrlPlugins && html`<button className=${checkingUpdates ? 'processing' : ''} disabled=${checkingUpdates} onClick=${checkAllUpdates}>${t('plugins.checkUpdates')}</button>`}
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
						const check = plugin.url ? updateChecks[id] : undefined;
						return html`
							<li className="plugins-row" key=${id}>
								<div className="plugins-row-main">
									<span className="plugins-name">${manifest.name}</span>
									<span className="plugins-version">${manifest.version}</span>
									<span className="plugins-range">
										${range(manifest)}
										${manifest.requires?.includes('server') && html` · <span className="plugins-requires">${t('plugins.requiresServer')}</span>`}
										${fit !== 'fits' && html`<span className="plugins-mark" role="img"
											title=${fit === 'mismatched' ? t('plugins.markMismatched', { version: APP_VERSION }) : t('plugins.markUndeclared')}
											aria-label=${fit === 'mismatched' ? t('plugins.markMismatched', { version: APP_VERSION }) : t('plugins.markUndeclared')}>⚠</span>`}
										${missingServer && html`<span className="plugins-mark" role="img"
											title=${t('plugins.markRequiresServer')}
											aria-label=${t('plugins.markRequiresServer')}>⚠</span>`}
									</span>
									${check && html`
										<span className=${`plugins-update-state is-${check.state}`}
											title=${check.state === 'error' ? check.detail : undefined}>
											${check.state === 'checking' ? t('plugins.statusChecking')
												: check.state === 'up-to-date' ? t('plugins.statusUpToDate')
												: check.state === 'available' ? t('plugins.statusUpdateAvailable', { change: check.change })
												: t('plugins.statusCheckFailed')}
										</span>
									`}
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
								${displayUrl && html`<div className="plugins-url" title=${displayUrl}>${formatSourceLabel(displayUrl)}</div>`}
								${manifest.api > SUPPORTED_PLUGIN_API && html`<div className="plugins-error">${t('plugins.apiNewer', { api: manifest.api, supported: SUPPORTED_PLUGIN_API })}</div>`}
								${loadError && html`<div className="plugins-error">${t('plugins.loadError', { error: loadError })}</div>`}
								${runtimeError && html`<div className="plugins-error">${t('plugins.hookError', { error: runtimeError })}</div>`}
								${pluginStart.timedOut.includes(id) && html`<div className="plugins-error">${t('plugins.timedOut')}</div>`}
								${pluginStart.skipped.includes(id) && html`<div className="plugins-error">${t('plugins.skipped')}</div>`}
								${errors[id] && html`<div className="plugins-error" role="alert">${errors[id]}</div>`}
							</li>`;
					})}
				</ul>`}
			<div className="plugins-github-token">
				<${InputBox}
					label=${t('plugins.githubToken')}
					tooltip=${t('plugins.githubTokenTooltip')}
					type=${showToken ? 'text' : 'password'}
					autoComplete="off"
					spellCheck=${false}
					placeholder=${t('plugins.githubTokenPlaceholder')}
					value=${githubToken}
					onValueChange=${(v: string | number) => setGithubToken(String(v))}>
					<button
						type="button"
						className="eye-button"
						title=${showToken ? t('connection.hide') : t('connection.show')}
						aria-label=${showToken ? t('connection.hide') : t('connection.show')}
						onClick=${() => setShowToken(s => !s)}>
						${!showToken ? html`<${SVG_ShowKey}/>` : html`<${SVG_HideKey}/>`}
					</button>
				</${InputBox}>
			</div>
			<div className="plugins-footer">
				<span>${t('plugins.reloadNote')}</span>
				<button className=${reloading ? 'processing' : ''} onClick=${reload}>${t('plugins.reload')}</button>
			</div>
		</div>`;
}
