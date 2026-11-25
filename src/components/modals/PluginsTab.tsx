import { html } from 'htm/react';
import { Fragment, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useT } from '../../i18n';
import { APP_VERSION } from '../../version';
import {
	checkRequirements,
	checkVersion,
	clearPluginRuntimeError,
	comparePlugins,
	fetchPluginFromUrl,
	getPluginRuntimeErrors,
	getPluginUiSnapshot,
	subscribePluginRuntimeErrors,
	subscribePluginUi,
	type PluginStartInfo,
} from '../../plugins';
import { parsePluginArchive, PluginArchiveError, type ParsedPluginArchive } from '../../plugins/archive';
import { extractChangelogSection } from '../../plugins/changelog';
import { isHttpUrl, SUPPORTED_PLUGIN_API } from '../../plugins/manifest';
import { describePluginSource, PluginSourceError, resolvePluginSource } from '../../plugins/sources';
import { usePersistentState } from '../../hooks/usePersistentState';
import { PluginIdMismatchError, type PluginImportInput, type PluginStorage } from '../../storage/PluginStorage';
import { Modal } from '../Modal';
import { PluginErrorBoundary } from '../PluginErrorBoundary';
import { Checkbox } from '../controls/Checkbox';
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

type Control = 'toggle' | 'delete' | 'update' | 'clear';

type RowUpdateCheck =
	| { state: 'checking' }
	| { state: 'up-to-date' }
	| { state: 'available'; change: string }
	| { state: 'error'; detail: string };

const UPDATE_CHECK_CONCURRENCY = 4;

const IconGear = () => html`
	<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
		<circle cx="12" cy="12" r="3"/>
		<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
	</svg>`;

const IconMore = () => html`
	<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
		<circle cx="12" cy="5" r="2"/>
		<circle cx="12" cy="12" r="2"/>
		<circle cx="12" cy="19" r="2"/>
	</svg>`;

const IconRefresh = () => html`
	<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
		<path d="M21 12a9 9 0 1 1-2.64-6.36"/>
		<polyline points="21 3 21 9 15 9"/>
	</svg>`;

const IconTrash = () => html`
	<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
		<polyline points="3 6 5 6 21 6"/>
		<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
		<path d="M10 11v6"/>
		<path d="M14 11v6"/>
		<path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
	</svg>`;

const IconDelete = () => html`
	<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
		<line x1="18" y1="6" x2="6" y2="18"/>
		<line x1="6" y1="6" x2="18" y2="18"/>
	</svg>`;

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
	const [openInlineSettings, setOpenInlineSettings] = useState<Record<string, boolean>>({});
	const [modalSettingsId, setModalSettingsId] = useState<string | null>(null);
	const [clearedLoadErrors, setClearedLoadErrors] = useState<Record<string, boolean>>({});
	const [reloadRequired, setReloadRequired] = useState(false);
	const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
	const [deleteAlsoData, setDeleteAlsoData] = useState(true);
	const [openMenuId, setOpenMenuId] = useState<string | null>(null);
	const runtimeErrors = useSyncExternalStore(subscribePluginRuntimeErrors, getPluginRuntimeErrors);
	const { settings: pluginSettings } = useSyncExternalStore(subscribePluginUi, getPluginUiSnapshot);

	const unmountedRef = useRef(false);
	const batchRunRef = useRef(0);
	const rowMutationRef = useRef<Record<string, number>>({});
	const inflightRef = useRef(new Map<string, { url: string; promise: Promise<ParsedPluginArchive> }>());
	const openMenuRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!openMenuId) return;
		const onMouseDown = (e: MouseEvent) => {
			if (openMenuRef.current && !openMenuRef.current.contains(e.target as Node)) {
				setOpenMenuId(null);
			}
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.stopPropagation();
				setOpenMenuId(null);
			}
		};
		document.addEventListener('mousedown', onMouseDown);
		document.addEventListener('keydown', onKeyDown, true);
		return () => {
			document.removeEventListener('mousedown', onMouseDown);
			document.removeEventListener('keydown', onKeyDown, true);
		};
	}, [openMenuId]);

	useEffect(() => {
		unmountedRef.current = false;
		const unsub = pluginStorage.subscribe?.(() => {
			setPlugins(pluginStorage.plugins);
		});
		return () => {
			unmountedRef.current = true;
			batchRunRef.current += 1;
			unsub?.();
		};
	}, [pluginStorage]);

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
			setOpenInlineSettings(({ [id]: _, ...rest }) => rest);
			if (modalSettingsId === id) setModalSettingsId(null);
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

	const clearData = (id: string) => {
		const plugin = plugins[id];
		if (!plugin || busy[id]) return;
		if (!confirm(t('plugins.clearDataConfirm', { name: plugin.manifest.name }))) return;
		const wasEnabled = plugin.enabled;
		run(id, 'clear', async () => {
			await pluginStorage.clearData(id);
			clearPluginRuntimeError(id);
			setClearedLoadErrors(prev => ({ ...prev, [id]: true }));
			if (wasEnabled) setReloadRequired(true);
		});
	};

	const openDeleteModal = (id: string) => {
		if (busy[id]) return;
		setDeleteAlsoData(true);
		setDeleteTargetId(id);
	};

	const confirmDelete = () => {
		const id = deleteTargetId;
		if (!id || !plugins[id] || busy[id]) {
			setDeleteTargetId(null);
			return;
		}
		const keepData = !deleteAlsoData;
		setDeleteTargetId(null);
		bumpRowMutation(id);
		run(id, 'delete', async () => {
			await pluginStorage.remove(id, { keepData });
			clearPluginRuntimeError(id);
			setClearedLoadErrors(({ [id]: _, ...rest }) => rest);
			setOpenInlineSettings(({ [id]: _, ...rest }) => rest);
			if (modalSettingsId === id) setModalSettingsId(null);
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

	const registryError = pluginStart.registryError ?? pluginStorage.registryError ?? undefined;
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
			${registryError && html`<div className="plugins-error plugins-registry-error" role="alert">${t('plugins.registryUnreadable', { error: registryError })}</div>`}
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
						const loadError = clearedLoadErrors[id] ? undefined : pluginStart.errors[id];
						const runtimeError = runtimeErrors[id];
						const displayUrl = plugin.source ?? plugin.url;
						const check = plugin.url ? updateChecks[id] : undefined;
						const rowBusy = Boolean(busy[id]);
						const settingsEntry = plugin.enabled && !pluginStart.safeMode && !loadError && !pluginStart.skipped.includes(id)
							? pluginSettings[id]
							: undefined;
						const isInlineOpen = Boolean(settingsEntry?.mode === 'inline' && openInlineSettings[id]);
						const isMenuOpen = openMenuId === id;
						const metaItems = [
							manifest.author && html`<span key="author">${t('plugins.byAuthor', { author: manifest.author })}</span>`,
							manifest.homepage && html`<a key="homepage" href=${manifest.homepage} target="_blank" rel="noopener noreferrer">${t('plugins.homepage')}</a>`,
							displayUrl && html`<span key="source" className="plugins-source" title=${displayUrl}>${formatSourceLabel(displayUrl)}</span>`,
							check && html`
								<span key="update" className=${`plugins-update-state is-${check.state}`}
									title=${check.state === 'error' ? check.detail : undefined}>
									${check.state === 'checking' ? t('plugins.statusChecking')
										: check.state === 'up-to-date' ? t('plugins.statusUpToDate')
										: check.state === 'available' ? t('plugins.statusUpdateAvailable', { change: check.change })
										: t('plugins.statusCheckFailed')}
								</span>`,
						].filter(Boolean);
						return html`
							<li className="plugins-row" key=${id}>
								<div className="plugins-row-main">
									<div className="plugins-row-title">
										<span className="plugins-name">${manifest.name}</span>
										<span className="plugins-version">${manifest.version}</span>
										${fit !== 'fits' && html`<span className="plugins-compat-mismatch" role="img"
											title=${fit === 'mismatched' ? t('plugins.markMismatched', { version: APP_VERSION }) : t('plugins.markUndeclared')}
											aria-label=${fit === 'mismatched' ? t('plugins.markMismatched', { version: APP_VERSION }) : t('plugins.markUndeclared')}>
											<span aria-hidden="true">⚠</span><span>${range(manifest)}</span>
										</span>`}
										${missingServer && html`<span className="plugins-compat-mismatch" role="img"
											title=${t('plugins.markRequiresServer')}
											aria-label=${t('plugins.markRequiresServer')}>
											<span aria-hidden="true">⚠</span><span>${t('plugins.requiresServer')}</span>
										</span>`}
									</div>
									<div className="plugins-row-actions">
										${settingsEntry && html`<button
											type="button"
											className=${`plugins-icon-btn${isInlineOpen ? ' is-active' : ''}`}
											title=${t('plugins.configure')}
											aria-label=${t('plugins.configurePlugin', { name: manifest.name })}
											aria-expanded=${settingsEntry.mode === 'inline' ? isInlineOpen : undefined}
											disabled=${rowBusy}
											onClick=${() => {
												setOpenMenuId(null);
												if (settingsEntry.mode === 'modal') {
													setModalSettingsId(id);
												} else {
													setOpenInlineSettings(prev => ({ ...prev, [id]: !prev[id] }));
												}
											}}>
											<${IconGear}/>
										</button>`}
										<div className="plugins-menu-wrap" ref=${isMenuOpen ? openMenuRef : null}>
											<button
												type="button"
												className=${`plugins-icon-btn${isMenuOpen ? ' is-active' : ''}${busy[id] && busy[id] !== 'toggle' ? ' processing' : ''}`}
												aria-label=${t('plugins.moreActions', { name: manifest.name })}
												aria-haspopup="menu"
												aria-expanded=${isMenuOpen}
												disabled=${rowBusy && busy[id] === 'toggle'}
												onClick=${() => setOpenMenuId(prev => prev === id ? null : id)}>
												<${IconMore}/>
											</button>
											${isMenuOpen && html`
												<div className="plugins-menu" role="menu">
													${plugin.url && html`<button
														type="button"
														role="menuitem"
														className=${`plugins-menu-item${busy[id] === 'update' ? ' processing' : ''}`}
														aria-label=${t('plugins.updateRun', { name: manifest.name })}
														disabled=${rowBusy && busy[id] !== 'update'}
														onClick=${() => { setOpenMenuId(null); update(id); }}>
														<${IconRefresh}/>
														<span>${check?.state === 'available' ? t('plugins.update') : t('plugins.checkForUpdates')}</span>
													</button>`}
													<button
														type="button"
														role="menuitem"
														className=${`plugins-menu-item${busy[id] === 'clear' ? ' processing' : ''}`}
														aria-label=${t('plugins.clearDataPlugin', { name: manifest.name })}
														disabled=${rowBusy && busy[id] !== 'clear'}
														onClick=${() => { setOpenMenuId(null); clearData(id); }}>
														<${IconTrash}/>
														<span>${t('plugins.clearData')}</span>
													</button>
													<div className="plugins-menu-separator" role="separator"/>
													<button
														type="button"
														role="menuitem"
														className=${`plugins-menu-item is-danger${busy[id] === 'delete' ? ' processing' : ''}`}
														aria-label=${t('plugins.deletePlugin', { name: manifest.name })}
														disabled=${rowBusy && busy[id] !== 'delete'}
														onClick=${() => { setOpenMenuId(null); openDeleteModal(id); }}>
														<${IconDelete}/>
														<span>${t('plugins.delete')}</span>
													</button>
													<div className="plugins-menu-separator" role="separator"/>
													<div className=${`plugins-menu-compat${fit !== 'fits' || missingServer ? ' is-warning' : ''}`}>
														<span className="plugins-menu-compat-label">${t('plugins.compatibility')}</span>
														<span className="plugins-menu-compat-value">
															${range(manifest)}${manifest.requires?.includes('server') ? ` · ${t('plugins.requiresServer')}` : ''}
														</span>
													</div>
												</div>
											`}
										</div>
										<${Switch}
											checked=${plugin.enabled}
											ariaLabel=${t('plugins.run', { name: manifest.name })}
											className=${busy[id] === 'toggle' ? 'processing' : undefined}
											disabled=${rowBusy && busy[id] !== 'toggle'}
											onChange=${() => toggle(id)}/>
									</div>
								</div>
								${manifest.description && html`<div className="plugins-description">${manifest.description}</div>`}
								${metaItems.length > 0 && html`
									<div className="plugins-meta">
										${metaItems.map((item, idx) => html`
											<${Fragment} key=${idx}>
												${idx > 0 && html`<span className="plugins-meta-sep" aria-hidden="true">·</span>`}
												${item}
											</${Fragment}>
										`)}
									</div>
								`}
								${manifest.api > SUPPORTED_PLUGIN_API && html`<div className="plugins-error">${t('plugins.apiNewer', { api: manifest.api, supported: SUPPORTED_PLUGIN_API })}</div>`}
								${loadError && html`<div className="plugins-error">${t('plugins.loadError', { error: loadError })}</div>`}
								${runtimeError && html`<div className="plugins-error">${t('plugins.hookError', { error: runtimeError })}</div>`}
								${pluginStart.timedOut.includes(id) && html`<div className="plugins-error">${t('plugins.timedOut')}</div>`}
								${pluginStart.skipped.includes(id) && html`<div className="plugins-error">${t('plugins.skipped')}</div>`}
								${errors[id] && html`<div className="plugins-error" role="alert">${errors[id]}</div>`}
								${isInlineOpen && settingsEntry && html`
									<div className="plugins-settings-section">
										<div className="plugins-settings-drawer">
											<${PluginErrorBoundary} id=${id}>
												<${settingsEntry.Component}/>
											</${PluginErrorBoundary}>
										</div>
									</div>
								`}
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
				<span className=${reloadRequired ? 'is-required' : undefined} role=${reloadRequired ? 'status' : undefined}>
					${reloadRequired ? t('plugins.reloadRequired') : t('plugins.reloadNote')}
				</span>
				<button className=${reloading ? 'processing' : ''} onClick=${reload}>${t('plugins.reload')}</button>
			</div>
			${deleteTargetId && plugins[deleteTargetId] && html`
				<${Modal}
					isOpen=${true}
					onClose=${() => setDeleteTargetId(null)}
					title=${t('plugins.deleteTitle', { name: plugins[deleteTargetId].manifest.name })}>
					<div className="plugins-delete-modal">
						<p>${t('plugins.deleteConfirmPrompt', { name: plugins[deleteTargetId].manifest.name })}</p>
						<${Checkbox}
							label=${t('plugins.deleteAlsoData')}
							value=${deleteAlsoData}
							onValueChange=${setDeleteAlsoData}/>
						<div className="plugins-delete-actions">
							<button type="button" onClick=${() => setDeleteTargetId(null)}>
								${t('plugins.cancel')}
							</button>
							<button type="button" onClick=${confirmDelete}>
								${t('plugins.delete')}
							</button>
						</div>
					</div>
				</${Modal}>
			`}
			${modalSettingsId && plugins[modalSettingsId]?.enabled && pluginSettings[modalSettingsId]?.mode === 'modal' && html`
				<${Modal}
					isOpen=${true}
					onClose=${() => setModalSettingsId(null)}
					title=${plugins[modalSettingsId].manifest.name}>
					<${PluginErrorBoundary} id=${modalSettingsId}>
						<${pluginSettings[modalSettingsId].Component}/>
					</${PluginErrorBoundary}>
				</${Modal}>
			`}
		</div>`;
}
