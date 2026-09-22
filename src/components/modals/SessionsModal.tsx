import { html } from 'htm/react';
import { Fragment, useState, useEffect, useMemo, type ChangeEvent, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { Modal } from '../Modal';
import { InputBox } from '../controls/InputBox';
import { SelectBox } from '../controls/SelectBox';
import { SVG_ArrowDown, SVG_Close, SVG_Confirm, SVG_Cancel, SVG_Folder, SVG_Rename, SVG_Trash, SVG_Star, SVG_StarOutline } from '../icons/index';
import { exportText } from '../../api/common';
import { useT } from '../../i18n';
import { folderName, type SessionStorage } from '../../storage/SessionStorage';
import { EditorContextMenu } from '../EditorContextMenu';
import type { ContextMenuItem } from '../../types/components';

interface SessionsModalProps {
  isOpen: boolean;
  closeModal: () => void;
  sessionStorage: SessionStorage;
  cancel: (() => void) | null;
  openHistory: () => void;
  openStatistics: () => void;
}

type TagGroup = Array<{ pattern: string; negate: boolean; regex: RegExp | null }>;
type SessionEntry = [string, SessionData];

/** A top-level row of the list: a folder with its sessions, or a session in no folder. */
interface ListItem { folder?: string; entries: SessionEntry[] }

const COLLAPSED_KEY = 'miyapad-sessions-collapsedFolders';

function loadCollapsed(): Set<string> {
	try {
		const raw: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]');
		return new Set(Array.isArray(raw) ? raw.filter((f): f is string => typeof f === 'string') : []);
	} catch {
		return new Set();
	}
}

/** Puts each folder where its first session sorts to, with its sessions in their sorted order. */
function groupByFolder(entries: SessionEntry[]): ListItem[] {
	const items: ListItem[] = [];
	const folders = new Map<string, ListItem>();
	for (const entry of entries) {
		const folder = entry[1].folder;
		let item = folder ? folders.get(folder) : undefined;
		if (!item) {
			items.push(item = { folder, entries: [] });
			if (folder) folders.set(folder, item);
		}
		item.entries.push(entry);
	}
	return items;
}

function compileTagRegex(pattern: string) {
	if (!pattern.includes('*')) return null;
	const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
	return new RegExp('^' + escaped + '$', 'i');
}

function parseTagFilter(input: string): TagGroup[] | null {
	if (!input.trim()) return null;
	const tokens = input.trim().split(/\s+/);
	const groups: TagGroup[] = [[]];
	let i = 0;
	while (i < tokens.length) {
		const t = tokens[i];
		if (t === 'AND') {
			i++;
		} else if (t === 'OR') {
			if (groups[groups.length - 1].length > 0) groups.push([]);
			i++;
		} else if (t === 'NOT') {
			if (i + 1 < tokens.length) {
				groups[groups.length - 1].push({ pattern: tokens[i + 1], negate: true, regex: compileTagRegex(tokens[i + 1]) });
				i += 2;
			} else {
				i++;
			}
		} else {
			groups[groups.length - 1].push({ pattern: t, negate: false, regex: compileTagRegex(t) });
			i++;
		}
	}
	return groups.filter((g) => g.length > 0);
}

function tagMatches(tag: string, pattern: string, regex: RegExp | null) {
	if (regex) return regex.test(tag);
	return tag.toLowerCase() === pattern.toLowerCase();
}

function sessionMatches(session: SessionData, groups: TagGroup[] | null) {
	if (!groups) return true;
	if (groups.length === 0) return true;
	return groups.some((group: TagGroup) =>
		group.every(({ pattern, negate, regex }) => {
			const match = (session.tags || []).some((tag: string) => tagMatches(tag, pattern, regex));
			return negate ? !match : match;
		})
	);
}

export function SessionsModal({ isOpen, closeModal, sessionStorage, cancel, openHistory, openStatistics }: SessionsModalProps) {
	const [version, setVersion] = useState(0);
	const [newSessionName, setNewSessionName] = useState('');
	const [renameSessionName, setRenameSessionName] = useState('');
	const [renamingId, setRenamingId] = useState<string | number | undefined>(undefined);
	const [isCreating, setIsCreating] = useState(false);
	const [searchQuery, setSearchQuery] = useState('');
	const [tagFilterQuery, setTagFilterQuery] = useState('');
	const [editingTagsId, setEditingTagsId] = useState<string | number | undefined>(undefined);
	const [editTagsValue, setEditTagsValue] = useState('');
	const [sortBy, setSortByState] = useState(() => localStorage.getItem('miyapad-sessions-sortBy') || 'modified');
	const [sortAsc, setSortAscState] = useState(() => localStorage.getItem('miyapad-sessions-sortAsc') === 'true');
	const [collapsed, setCollapsed] = useState(loadCollapsed);
	const [renamingFolder, setRenamingFolder] = useState<string | undefined>(undefined);
	const [renameFolderValue, setRenameFolderValue] = useState('');
	/** The session being dragged, and the row it would be dropped on. */
	const [dragId, setDragId] = useState<string | null>(null);
	const [dropTarget, setDropTarget] = useState<string | null>(null);
	/** Rows picked out with ctrl/shift-click; a row action applies to the whole selection. */
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [anchorId, setAnchorId] = useState<string | null>(null);
	/** The sessions whose folder is being picked, and the name typed so far. */
	const [folderEdit, setFolderEdit] = useState<{ ids: string[]; value: string } | null>(null);
	const [rowMenu, setRowMenu] = useState<{ id: string; x: number; y: number } | null>(null);

	const setSortBy = (v: string) => { setSortByState(v); localStorage.setItem('miyapad-sessions-sortBy', v); };
	const setSortAsc = (v: boolean | ((prev: boolean) => boolean)) => {
		setSortAscState((prev: boolean) => {
			const next = typeof v === 'function' ? v(prev) : v;
			localStorage.setItem('miyapad-sessions-sortAsc', String(next));
			return next;
		});
	};

	const t = useT();

	function formatDate(ts: number | null | undefined) {
		if (!ts) return t('sessions.noDate');
		const d = new Date(ts);
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
	}

	useEffect(() => {
		const incrementVersion = () => setVersion(v => v + 1);
		sessionStorage.addEventListener('change', incrementVersion);
		return () => sessionStorage.removeEventListener('change', incrementVersion);
	}, []);

	useEffect(() => {
		if (isOpen) {
			setSearchQuery('');
			setTagFilterQuery('');
			setEditingTagsId(undefined);
			setEditTagsValue('');
			setRenamingId(undefined);
			setRenamingFolder(undefined);
			setIsCreating(false);
			setSelected(new Set());
			setAnchorId(null);
			setFolderEdit(null);
			setRowMenu(null);
			setSortByState(localStorage.getItem('miyapad-sessions-sortBy') || 'modified');
			setSortAscState(localStorage.getItem('miyapad-sessions-sortAsc') === 'true');
		}
	}, [isOpen]);

	const parsedTagFilter = useMemo(() => parseTagFilter(tagFilterQuery), [tagFilterQuery]);

	const sortedSessions = useMemo(() => {
		let entries = Object.entries(sessionStorage.sessions) as [string, SessionData][];

		// Filter by search query and tags
		const q = searchQuery.trim().toLowerCase();
		entries = entries.filter(([_, s]) => {
			const nameMatch = !q || (s.name || '').toLowerCase().includes(q) || (s.folder || '').toLowerCase().includes(q);
			const tagMatch = sessionMatches(s, parsedTagFilter);
			return nameMatch && tagMatch;
		});

		// Sort comparator
		const compare = ([idA, a]: [string, SessionData], [idB, b]: [string, SessionData]) => {
			let cmp = 0;
			if (sortBy === 'name') {
				cmp = (a.name || '').localeCompare(b.name || '');
			} else if (sortBy === 'created') {
				cmp = (a.created || 0) - (b.created || 0);
			} else {
				// modified (default)
				cmp = (a.modified || 0) - (b.modified || 0);
			}
			return sortAsc ? cmp : -cmp;
		};

		// Pinned sessions always float to the top
		const pinned = entries.filter(([_, s]) => s.pinned);
		const unpinned = entries.filter(([_, s]) => !s.pinned);
		pinned.sort(compare);
		unpinned.sort(compare);

		return [...pinned, ...unpinned];
	}, [version, searchQuery, parsedTagFilter, sortBy, sortAsc, sessionStorage.sessions]);

	const listItems = useMemo(() => groupByFolder(sortedSessions), [sortedSessions]);
	// A filter shows what matched inside collapsed folders too.
	const filtering = !!searchQuery.trim() || !!parsedTagFilter;

	/** Every folder that exists, for the picker's suggestions. */
	const folderNames = useMemo(() => [...new Set(Object.values(sessionStorage.sessions)
		.map(s => s.folder).filter((f): f is string => !!f))].sort((a, b) => a.localeCompare(b)),
		[version, sessionStorage.sessions]);

	/** An existing folder's spelling wins, so "Drafts" and "drafts" never become two folders. */
	const resolveFolder = (raw: string, except?: string) => {
		const name = folderName(raw);
		return folderNames.find(f => f !== except && f.toLowerCase() === name?.toLowerCase()) ?? name;
	};

	/** The selection, minus anything deleted since it was picked. */
	const selectedIds = useMemo(() => [...selected].filter(id => sessionStorage.sessions[id]),
		[selected, version, sessionStorage.sessions]);

	/** Top to bottom as the list shows them, for shift-click ranges. */
	const visibleIds = useMemo(() => listItems.flatMap(({ folder, entries }) =>
		folder && !filtering && collapsed.has(folder) ? [] : entries.map(([id]) => id)),
		[listItems, collapsed, filtering]);

	const targetIds = (sessionId: string) => selected.has(sessionId) && selectedIds.length > 1 ? selectedIds : [sessionId];

	const setFolderCollapsed = (folder: string, value: boolean) => {
		const next = new Set(collapsed);
		if (value) next.add(folder);
		else next.delete(folder);
		localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
		setCollapsed(next);
	};

	/** Every session in a folder, including those the filters hide. */
	const folderIds = (folder: string) =>
		Object.keys(sessionStorage.sessions).filter(id => sessionStorage.sessions[id].folder === folder);

	/** Puts sessions in a new folder and opens its name for editing. */
	const createFolder = async (ids: string[]) => {
		const taken = new Set(Object.values(sessionStorage.sessions).map(s => s.folder));
		const base = t('sessions.newFolder');
		let name = base;
		for (let n = 2; taken.has(name); n++) name = `${base} ${n}`;
		setFolderCollapsed(name, false);
		setRenameFolderValue(name);
		setRenamingFolder(name);
		await sessionStorage.setFolder(ids, name);
	};

	const renameFolder = async () => {
		const from = renamingFolder;
		const to = resolveFolder(renameFolderValue, from);
		setRenamingFolder(undefined);
		// Renaming onto another folder's name merges the two.
		if (from !== undefined && to && to !== from) await sessionStorage.setFolder(folderIds(from), to);
	};

	const removeFolder = async (folder: string) => {
		setFolderCollapsed(folder, false);
		await sessionStorage.setFolder(folderIds(folder), undefined);
	};

	/** The keyboard and touch way in or out of a folder, and the only one that suggests names. */
	const commitFolder = async () => {
		if (!folderEdit) return;
		const { ids, value } = folderEdit;
		setFolderEdit(null);
		await sessionStorage.setFolder(ids, resolveFolder(value));
	};

	const draggedIds = dragId === null ? [] : targetIds(dragId);
	const draggedFolder = dragId !== null ? sessionStorage.sessions[dragId]?.folder : undefined;

	const startDrag = (e: DragEvent, sessionId: string) => {
		e.dataTransfer.effectAllowed = 'move';
		e.dataTransfer.setData('text/plain', sessionId);
		// Chrome ends a drag whose dragstart changes the page, and the drop zone this shows would.
		setTimeout(() => setDragId(sessionId));
	};

	const endDrag = () => {
		setDragId(null);
		setDropTarget(null);
	};

	/** Makes a row a drop target for the dragged sessions, which `onDrop` receives. */
	const dropHandlers = (target: string, onDrop: (draggedIds: string[]) => void) => ({
		onDragOver: (e: DragEvent) => {
			if (dragId === null) return;
			e.preventDefault();
			setDropTarget(target);
		},
		onDragLeave: (e: DragEvent) => {
			if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget(cur => cur === target ? null : cur);
		},
		onDrop: (e: DragEvent) => {
			e.preventDefault();
			const ids = draggedIds;
			endDrag();
			if (ids.length) onDrop(ids);
		},
	});

	const draggedFromFolder = draggedIds.some(id => sessionStorage.sessions[id]?.folder);

	const switchSession = async (sessionId: string | number) => {
		if (sessionStorage.selectedSession != sessionId) {
			cancel?.();
			await sessionStorage.switchSession(sessionId);
		}
		closeModal();
	};

	/** Ctrl-click picks rows out, shift-click extends the run; a plain click opens the session. */
	const rowClick = (e: MouseEvent, sessionId: string) => {
		if (e.ctrlKey || e.metaKey) {
			const next = new Set(selected);
			if (!next.delete(sessionId)) next.add(sessionId);
			setSelected(next);
			setAnchorId(sessionId);
		} else if (e.shiftKey) {
			const from = visibleIds.indexOf(anchorId ?? sessionId);
			const to = visibleIds.indexOf(sessionId);
			if (from >= 0 && to >= 0) setSelected(new Set(visibleIds.slice(Math.min(from, to), Math.max(from, to) + 1)));
		} else {
			switchSession(sessionId);
		}
	};

	/** History and statistics read the open session, so the row's is opened first. */
	const openForSession = async (sessionId: string, open: () => void) => {
		if (String(sessionStorage.selectedSession) !== sessionId) {
			cancel?.();
			await sessionStorage.switchSession(sessionId);
		}
		open();
	};

	const startRenameSession = (sessionId: string | number, name: string) => {
		setRenameSessionName(name);
		setRenamingId(sessionId);
	};

	const renameSession = async (sessionId: string | number | undefined) => {
		if (sessionId == null || !renameSessionName) return;
		await sessionStorage.renameSession(sessionId, renameSessionName);
		setRenamingId(undefined);
	};

	const startCreateSession = () => {
		setNewSessionName(`${t('sessions.defaultNamePrefix')}${(sessionStorage.nextId ?? 0) + 1}`);
		setIsCreating(true);
	};

	const createSession = async () => {
		if (newSessionName) {
			const newId = await sessionStorage.createSession(newSessionName);
			await sessionStorage.switchSession(newId);
			setIsCreating(false);
		}
	};

	const importSession = () => {
		const fileInput = document.createElement("input");
		fileInput.type = 'file';
		fileInput.multiple = true;
		fileInput.style.display = 'none';
		fileInput.onchange = async (e: Event) => {
			const files = (e.target as HTMLInputElement).files;
			if (!files || files.length === 0)
				return;

			const sortedFiles = Array.from(files ?? []).sort((a: File, b: File) => a.lastModified - b.lastModified);
			let lastNewId = null;

			for (const file of sortedFiles) {
				try {
					const text = await new Promise<string>((resolve, reject) => {
						const reader = new FileReader();
						reader.onload = () => resolve(reader.result as string);
						reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
						reader.readAsText(file);
					});
					lastNewId = await sessionStorage.createSessionFromObject(JSON.parse(text), false);
				} catch (err) {
					console.warn(`Skipped malformed import file "${file.name}":`, err);
				}
			}
			if (lastNewId !== null) {
				await sessionStorage.switchSession(lastNewId);
			}
		};
		document.body.appendChild(fileInput);
		fileInput.click();
		document.body.removeChild(fileInput);
	};

	/** Only the open session is held in full; the rest are read back from the database. */
	const loadRecord = async (sessionId: string): Promise<Record<string, unknown>> => {
		if (String(sessionStorage.selectedSession) === sessionId) return { ...sessionStorage.sessions[sessionId] };
		const db = await sessionStorage.openDatabase();
		return (await sessionStorage.loadFromDatabase(db, sessionId)) as Record<string, unknown>;
	};

	/** The stored shape: every property as its own JSON string. */
	const stringifyAll = (record: Record<string, unknown>) => {
		for (const [key, value] of Object.entries(record)) record[key] = JSON.stringify(value);
		return record as Record<string, string>;
	};

	const exportSession = async (sessionId: string) => {
		const record = await loadRecord(sessionId);
		delete record.endpoint;
		delete record.endpointAPIKey;
		// Read before stringifying, which would wrap the filename in quotes.
		const name = record.name;
		exportText(`${name}.json`, JSON.stringify(stringifyAll(record)));
	};

	const exportAll = async () => {
		if (confirm(t('sessions.exportAllWarning'))) {
			for (const sessionId of Object.keys(sessionStorage.sessions)) await exportSession(sessionId);
		}
	};

	const cloneSession = async (sessionId: string) => {
		const newId = await sessionStorage.createSessionFromObject(stringifyAll(await loadRecord(sessionId)), true);
		await sessionStorage.switchSession(newId);
	};

	function handleKeyDown(sessionId: string | number | undefined, e: KeyboardEvent<HTMLInputElement>) {
		if (e.key === 'Enter') {
			if (isCreating)
				createSession();
			else if (renamingId !== undefined)
				renameSession(sessionId);
		} else if (e.key === 'Escape') {
			e.stopPropagation();
			if (isCreating)
				setIsCreating(false);
			else if (renamingId !== undefined)
				setRenamingId(undefined);
		}
	}

	const disabled = !!cancel;
	const noSession = sessionStorage.selectedSession == null;

	/** What a row can do beyond its buttons: the actions that used to sit in the toolbar. */
	const rowMenuItems = (sessionId: string): ContextMenuItem[] => [
		{
			label: selected.has(sessionId) ? t('sessions.deselect') : t('sessions.select'),
			disabled: false,
			action: () => {
				const next = new Set(selected);
				if (!next.delete(sessionId)) next.add(sessionId);
				setSelected(next);
				setAnchorId(sessionId);
			},
		},
		{ label: t('sessions.export'), disabled, action: () => exportSession(sessionId) },
		{ label: t('sessions.clone'), disabled, action: () => cloneSession(sessionId) },
		// History is one session's, and a multi-selection does not say which.
		{ label: t('sessions.history'), disabled: disabled || selectedIds.length > 1, action: () => openForSession(sessionId, openHistory) },
		{ label: t('sessions.statistics'), disabled, action: () => openForSession(sessionId, openStatistics) },
	];

	const renderSession = ([sessionId, session]: SessionEntry) => html`
		<tr key=${sessionId}
			className="sessions-modal-row ${String(sessionStorage.selectedSession) === sessionId ? 'selected' : ''} ${selected.has(sessionId) ? 'picked' : ''} ${session.folder ? 'sessions-modal-row-in-folder' : ''} ${dropTarget === sessionId ? 'drop-target' : ''} ${draggedIds.includes(sessionId) ? 'dragging' : ''}"
			draggable=${renamingId != sessionId && editingTagsId !== sessionId}
			onDragStart=${(e: DragEvent) => startDrag(e, sessionId)}
			onDragEnd=${endDrag}
			...${draggedIds.includes(sessionId) || (session.folder && session.folder === draggedFolder) ? {} : dropHandlers(sessionId, (ids) =>
				session.folder ? sessionStorage.setFolder(ids, session.folder) : createFolder([...new Set([sessionId, ...ids])]))}
			onClick=${(e: MouseEvent) => rowClick(e, sessionId)}
			onContextMenu=${(e: MouseEvent) => { e.preventDefault(); setRowMenu({ id: sessionId, x: e.clientX, y: e.clientY }); }}>
			<td className="sessions-col-star" onClick=${(e: MouseEvent) => e.stopPropagation()}>
				<button className="sessions-action-btn"
					title=${session.pinned ? t('sessions.unpinSession') : t('sessions.pinSession')}
					onClick=${() => sessionStorage.togglePinSession(sessionId)}>
					${session.pinned ? html`<${SVG_Star}/>` : html`<${SVG_StarOutline}/>`}
				</button>
			</td>
			<td className="sessions-col-name">
				${renamingId == sessionId ? html`
					<input
						type="text"
						className="sessions-modal-inline-input"
						value=${renameSessionName}
						onChange=${(e: ChangeEvent<HTMLInputElement>) => setRenameSessionName(e.target.value)}
						onKeyDown=${(e: KeyboardEvent<HTMLInputElement>) => handleKeyDown(sessionId, e)}
						onClick=${(e: MouseEvent) => e.stopPropagation()}
						autoFocus
					/>
				` : html`
					<div className="sessions-modal-name-wrapper">
						<span className="sessions-modal-name">${session.name}</span>
						${editingTagsId === sessionId ? html`
							<input
								type="text"
								className="sessions-modal-tag-input"
								value=${editTagsValue}
								onChange=${(e: ChangeEvent<HTMLInputElement>) => setEditTagsValue(e.target.value)}
								onKeyDown=${(e: KeyboardEvent<HTMLInputElement>) => {
									if (e.key === 'Enter') {
										sessionStorage.setTags(sessionId, editTagsValue);
										setEditingTagsId(undefined);
									} else if (e.key === 'Escape') {
										setEditingTagsId(undefined);
									}
									e.stopPropagation();
								}}
								onBlur=${() => {
									sessionStorage.setTags(sessionId, editTagsValue);
									setEditingTagsId(undefined);
								}}
								onClick=${(e: MouseEvent) => e.stopPropagation()}
								autoFocus
								title=${t('sessions.tagsHint')}/>
						` : html`
							<span className="sessions-modal-tags ${session.tags && session.tags.length > 0 ? '' : 'sessions-modal-tags-empty'}"
								onClick=${(e: MouseEvent) => {
									e.stopPropagation();
									setEditTagsValue(session.tags ? session.tags.join(', ') : '');
									setEditingTagsId(sessionId);
								}}>
								${session.tags && session.tags.length > 0 ? session.tags.join(', ') : t('sessions.addTags')}
							</span>
						`}
					</div>
				`}
			</td>
			<td className="sessions-col-modified">${formatDate(session.modified)}</td>
			<td className="sessions-col-created">${formatDate(session.created)}</td>
			<td className="sessions-col-actions" onClick=${(e: MouseEvent) => e.stopPropagation()}>
				<div className="sessions-col-actions-inner">
					${renamingId == sessionId ? html`<${Fragment}>
						<button className="sessions-action-btn" onClick=${() => renameSession(sessionId)}><${SVG_Confirm}/></button>
						<button className="sessions-action-btn" onClick=${() => setRenamingId(undefined)}><${SVG_Cancel}/></button>
					<//>` : html`<${Fragment}>
						<button className="sessions-action-btn"
							title=${t('sessions.moveToFolder')}
							onClick=${() => setFolderEdit({ ids: targetIds(sessionId), value: session.folder ?? '' })}>
							<${SVG_Folder}/>
						</button>
						<button className="sessions-action-btn" disabled=${disabled}
							onClick=${() => startRenameSession(sessionId, session.name ?? '')}>
							<${SVG_Rename}/>
						</button>
						<button className="sessions-action-btn" disabled=${disabled}
							onClick=${() => sessionStorage.deleteSessions(targetIds(sessionId))}>
							<${SVG_Trash}/>
						</button>
						<button className="sessions-action-btn sessions-more-btn"
							title=${t('sessions.moreActions')}
							onClick=${(e: MouseEvent) => setRowMenu({ id: sessionId, x: e.clientX, y: e.clientY })}>
							⋯
						</button>
					<//>`}
				</div>
			</td>
		</tr>
	`;

	const renderFolder = (folder: string, entries: SessionEntry[]) => {
		const open = filtering || !collapsed.has(folder);
		const target = `folder:${folder}`;
		return html`<${Fragment} key=${target}>
			<tr className="sessions-modal-row sessions-modal-folder-row ${dropTarget === target ? 'drop-target' : ''}"
				...${draggedFolder === folder ? {} : dropHandlers(target, (ids) => sessionStorage.setFolder(ids, folder))}
				onClick=${() => filtering || setFolderCollapsed(folder, open)}>
				<td className="sessions-col-star">
					<button className="sessions-action-btn sessions-folder-toggle ${open ? 'open' : ''}"
						aria-expanded=${open}
						title=${open ? t('sessions.collapseFolder') : t('sessions.expandFolder')}>
						<${SVG_ArrowDown}/>
					</button>
				</td>
				<td className="sessions-col-name">
					${renamingFolder === folder ? html`
						<input
							type="text"
							className="sessions-modal-inline-input"
							value=${renameFolderValue}
							onChange=${(e: ChangeEvent<HTMLInputElement>) => setRenameFolderValue(e.target.value)}
							onKeyDown=${(e: KeyboardEvent<HTMLInputElement>) => {
								if (e.key === 'Enter') {
									renameFolder();
								} else if (e.key === 'Escape') {
									e.stopPropagation();
									setRenamingFolder(undefined);
								}
							}}
							onFocus=${(e: ChangeEvent<HTMLInputElement>) => e.target.select()}
							onClick=${(e: MouseEvent) => e.stopPropagation()}
							autoFocus
						/>
					` : html`
						<span className="sessions-modal-name sessions-folder-name">
							${folder} <span className="sessions-folder-count">${entries.length}</span>
						</span>
					`}
				</td>
				<td className="sessions-col-modified"></td>
				<td className="sessions-col-created"></td>
				<td className="sessions-col-actions" onClick=${(e: MouseEvent) => e.stopPropagation()}>
					<div className="sessions-col-actions-inner">
						${renamingFolder === folder ? html`<${Fragment}>
							<button className="sessions-action-btn" onClick=${renameFolder}><${SVG_Confirm}/></button>
							<button className="sessions-action-btn" onClick=${() => setRenamingFolder(undefined)}><${SVG_Cancel}/></button>
						<//>` : html`<${Fragment}>
							<button className="sessions-action-btn" title=${t('sessions.renameFolder')}
								onClick=${() => { setRenameFolderValue(folder); setRenamingFolder(folder); }}>
								<${SVG_Rename}/>
							</button>
							<button className="sessions-action-btn" title=${t('sessions.removeFolder')}
								onClick=${() => removeFolder(folder)}>
								<${SVG_Close}/>
							</button>
						<//>`}
					</div>
				</td>
			</tr>
			${open && entries.map(renderSession)}
		<//>`;
	};

	return html`
		<${Modal} isOpen=${isOpen} onClose=${closeModal}
			title=${t('sessions.title')}
			description="">
			<div className="sessions-modal-toolbar">
				<div className="sessions-modal-toolbar-row">
					<${InputBox} label=${t('sessions.search')}
						value=${searchQuery}
						onValueChange=${setSearchQuery}
						placeholder=${t('sessions.searchPlaceholder')}/>
					<${InputBox} label=${t('sessions.tags')}
						value=${tagFilterQuery}
						onValueChange=${setTagFilterQuery}
						placeholder=${t('sessions.tagsPlaceholder')}
						tooltip=${t('sessions.tagsTooltip')}/>
					<${SelectBox}
						label=${t('sessions.sortBy')}
						value=${sortBy}
						onValueChange=${setSortBy}
						options=${[
							{ name: t('sessions.sortLastModified'), value: 'modified' },
							{ name: t('sessions.sortCreated'), value: 'created' },
							{ name: t('sessions.sortName'), value: 'name' },
						]}/>
					<button
						className="sessions-modal-sort-btn"
						title=${sortAsc ? t('sessions.sortAscending') : t('sessions.sortDescending')}
						onClick=${() => setSortAsc((v: boolean) => !v)}
						style=${{ transform: sortAsc ? 'rotate(0deg)' : 'rotate(180deg)' }}>
						↑
					</button>
				</div>
				<div className="sessions-modal-toolbar-row">
					<button disabled=${disabled} onClick=${startCreateSession}>${t('sessions.create')}</button>
					<button disabled=${disabled} onClick=${importSession}>${t('sessions.import')}</button>
					<button disabled=${disabled} onClick=${exportAll}>${t('sessions.exportAll')}</button>
					<button disabled=${disabled || noSession} onClick=${openStatistics}>${t('sessions.statistics')}</button>
				</div>
			</div>
			${folderEdit && html`
				<div className="sessions-modal-bar">
					<label htmlFor="sessions-folder-input">${t('sessions.moveToFolder')}</label>
					<input
						id="sessions-folder-input"
						type="text"
						list="sessions-folder-names"
						className="sessions-modal-inline-input"
						placeholder=${t('sessions.folderPlaceholder')}
						value=${folderEdit.value}
						onChange=${(e: ChangeEvent<HTMLInputElement>) => setFolderEdit({ ...folderEdit, value: e.target.value })}
						onKeyDown=${(e: KeyboardEvent<HTMLInputElement>) => {
							if (e.key === 'Enter') commitFolder();
							else if (e.key === 'Escape') { e.stopPropagation(); setFolderEdit(null); }
						}}
						autoFocus/>
					<datalist id="sessions-folder-names">
						${folderNames.map(f => html`<option key=${f} value=${f}/>`)}
					</datalist>
					<button className="sessions-action-btn" onClick=${commitFolder}><${SVG_Confirm}/></button>
					<button className="sessions-action-btn" onClick=${() => setFolderEdit(null)}><${SVG_Cancel}/></button>
				</div>
			`}
			${selectedIds.length > 0 && html`
				<div className="sessions-modal-bar">
					<span>${`${selectedIds.length} ${t('sessions.selected')}`}</span>
					<button onClick=${() => setFolderEdit({ ids: selectedIds, value: '' })}>${t('sessions.moveToFolder')}</button>
					<button disabled=${disabled} onClick=${() => sessionStorage.deleteSessions(selectedIds)}>${t('sessions.delete')}</button>
					<button onClick=${() => setSelected(new Set())}>${t('sessions.clearSelection')}</button>
				</div>
			`}
			${draggedFromFolder && html`
				<div className="sessions-modal-dropzone ${dropTarget === 'root' ? 'drop-target' : ''}"
					...${dropHandlers('root', (ids) => sessionStorage.setFolder(ids, undefined))}>
					${t('sessions.dropToUngroup')}
				</div>
			`}
			<div className="sessions-modal-list overflow-container">
				<table className="sessions-modal-table">
					<thead>
						<tr>
							<th className="sessions-col-star"></th>
							<th className="sessions-col-name">${t('sessions.name')}</th>
							<th className="sessions-col-modified">${t('sessions.modified')}</th>
							<th className="sessions-col-created">${t('sessions.created')}</th>
							<th className="sessions-col-actions">${t('sessions.actions')}</th>
						</tr>
					</thead>
					<tbody>
						${isCreating && html`
							<tr key="new" className="sessions-modal-row sessions-modal-row-new">
								<td></td>
								<td colSpan="3">
									<input
										type="text"
										className="sessions-modal-inline-input"
										value=${newSessionName}
onChange=${(e: ChangeEvent<HTMLInputElement>) => setNewSessionName(e.target.value)}
onKeyDown=${(e: KeyboardEvent<HTMLInputElement>) => handleKeyDown(undefined, e)}
onClick=${(e: MouseEvent) => e.stopPropagation()}
													autoFocus
												/>
								</td>
								<td className="sessions-col-actions">
									<div className="sessions-col-actions-inner">
										<button className="sessions-action-btn" onClick=${() => createSession()}><${SVG_Confirm}/></button>
										<button className="sessions-action-btn" onClick=${() => setIsCreating(false)}><${SVG_Cancel}/></button>
									</div>
								</td>
							</tr>
						`}
						${listItems.map(({ folder, entries }) => folder ? renderFolder(folder, entries) : renderSession(entries[0]))}
					</tbody>
				</table>
			</div>
			${rowMenu && html`
				<${EditorContextMenu}
					isOpen=${true}
					className="sessions-row-menu"
					closeMenu=${() => setRowMenu(null)}
					x=${rowMenu.x}
					y=${rowMenu.y}
					menuItems=${rowMenuItems(rowMenu.id)}/>
			`}
		</${Modal}>`;
}
