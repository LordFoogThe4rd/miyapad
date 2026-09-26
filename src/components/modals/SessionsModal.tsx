import { html } from 'htm/react';
import { Fragment, useState, useEffect, useMemo, useRef, type ChangeEvent, type DragEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { Modal } from '../Modal';
import { InputBox } from '../controls/InputBox';
import { SelectBox } from '../controls/SelectBox';
import { SVG_ArrowDown, SVG_Confirm, SVG_Cancel, SVG_Document, SVG_Folder, SVG_Trash, SVG_Star, SVG_StarOutline, SVG_Undo } from '../icons/index';
import { exportText } from '../../api/common';
import { formatRelativeTime } from '../../utils/time';
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
type SessionsView = 'list' | 'icons';

/** A top-level row of the list: a folder with its sessions, or a session in no folder. */
interface ListItem { folder?: string; entries: SessionEntry[] }

const COLLAPSED_KEY = 'miyapad-sessions-collapsedFolders';
const VIEW_KEY = 'miyapad-sessions-view';
const PANE_WIDTH_KEY = 'miyapad-sessions-paneWidth';
/** Letters typed on the list less than this far apart are one type-ahead search. */
const TYPE_AHEAD_MS = 500;
/** A folder's key where a session's id would go: in the drop targets, the pane and the icon view. */
const FOLDER_KEY = 'folder:';
/** How much of the end of a session's text the pane shows. */
const PREVIEW_CHARS = 300;
/** Stepping through the list faster than this reads no text from the database on the way. */
const PREVIEW_DELAY_MS = 150;

const isFolderKey = (key: string) => key.startsWith(FOLDER_KEY);
const folderOfKey = (key: string) => key.slice(FOLDER_KEY.length);

/** The end of a session's text; the pane's CSS collapses its line breaks. */
function promptTail(prompt: unknown) {
	const text = Array.isArray(prompt) ? (prompt as PromptChunk[]).map(c => c.content).join('') : '';
	return text.length > PREVIEW_CHARS ? `…${text.slice(-PREVIEW_CHARS)}` : text;
}

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

/**
 * A datalist matches against the whole value, so each suggestion starts with what is typed
 * up to the last comma: "wip, ar" is offered "wip, archived". Tags already typed are left out.
 */
export function tagSuggestions(value: string, tags: string[]): string[] {
	const cut = value.lastIndexOf(',') + 1;
	const prefix = value.slice(0, cut) + value.slice(cut).match(/^\s*/)![0];
	const typed = new Set(value.slice(0, cut).split(',').map(tag => tag.trim().toLowerCase()));
	return tags.filter(tag => !typed.has(tag)).map(tag => prefix + tag);
}

/**
 * The next row whose name starts with the typed text, wrapping round. One letter, or the same
 * letter pressed again and again, searches from below the row at `at` for names starting with
 * that letter, so repeating it steps through the matches.
 */
export function typeAheadMatch(ids: string[], nameOf: (id: string) => string, at: number, text: string): string | undefined {
	const oneLetter = [...text].every(c => c === text[0]);
	const query = oneLetter ? text.slice(0, 1) : text;
	const start = oneLetter ? at + 1 : at;
	return [...ids.slice(start), ...ids.slice(0, start)].find(id => nameOf(id).toLowerCase().startsWith(query));
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
	const [showTrash, setShowTrash] = useState(false);
	const [view, setViewState] = useState<SessionsView>(() => localStorage.getItem(VIEW_KEY) === 'icons' ? 'icons' : 'list');
	/** What the pane shows: a session's id or a folder's key. Unset, or gone, it shows the open session. */
	const [previewKey, setPreviewKey] = useState<string | null>(null);
	/** The folder the icon view is inside. */
	const [openFolder, setOpenFolder] = useState<string | undefined>(undefined);
	/** The text of a session that is not open, read from the database; null when that failed. */
	const [loadedText, setLoadedText] = useState<{ id: string; text: string | null } | null>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const typeAhead = useRef({ text: '', at: 0 });
	/** Whether the item being clicked was already in the pane before the press focused it. */
	const previewedOnPress = useRef(false);
	/** An item to focus once the icon view has gone into or out of a folder. */
	const focusAfterRender = useRef<string | null>(null);

	/** In pixels; unset, the CSS default. */
	const [paneWidth, setPaneWidthState] = useState(() => Number(localStorage.getItem(PANE_WIDTH_KEY)) || null);

	const setView = (v: SessionsView) => { setViewState(v); localStorage.setItem(VIEW_KEY, v); };

	/** The CSS keeps the pane and the list within bounds, so a width dragged past them is stored as it is. */
	const setPaneWidth = (px: number) => {
		const width = Math.round(px);
		setPaneWidthState(width);
		localStorage.setItem(PANE_WIDTH_KEY, String(width));
	};

	/** The pane runs from the divider to the right edge, so its width follows the pointer. */
	const dragDivider = (e: PointerEvent<HTMLElement>) => {
		e.preventDefault();
		const divider = e.currentTarget;
		// Measured from where the divider was grabbed, so it doesn't jump under the pointer.
		const edge = divider.parentElement!.getBoundingClientRect().right - (divider.getBoundingClientRect().right - e.clientX);
		const move = (ev: globalThis.PointerEvent) => setPaneWidth(edge - ev.clientX);
		divider.setPointerCapture(e.pointerId);
		divider.addEventListener('pointermove', move);
		divider.addEventListener('lostpointercapture', () => divider.removeEventListener('pointermove', move), { once: true });
	};

	/** Left widens the pane, as it moves the divider left. Steps from the width shown, which the CSS may have clamped. */
	const dividerKeyDown = (e: KeyboardEvent<HTMLElement>) => {
		const step = e.key === 'ArrowLeft' ? 16 : e.key === 'ArrowRight' ? -16 : 0;
		const pane = e.currentTarget.nextElementSibling;
		if (!step || !(pane instanceof HTMLElement)) return;
		e.preventDefault();
		setPaneWidth(pane.offsetWidth + step);
	};

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

	function formatRelative(ts: number | null | undefined) {
		return ts ? formatRelativeTime(ts) : t('sessions.noDate');
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
			setShowTrash(false);
			setPreviewKey(null);
			setOpenFolder(undefined);
			typeAhead.current = { text: '', at: 0 };
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
				// Numeric, or the default `MiyaPad #10` sorts before `MiyaPad #2`.
				cmp = (a.name || '').localeCompare(b.name || '', undefined, { numeric: true });
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

	/** Most recently trashed first. */
	const trashEntries = useMemo(() => (Object.entries(sessionStorage.trash) as SessionEntry[])
		.sort(([, a], [, b]) => (b.trashed ?? 0) - (a.trashed ?? 0)),
		[version, sessionStorage.trash]);

	/** Every folder that exists, for the picker's suggestions. */
	const folderNames = useMemo(() => [...new Set(Object.values(sessionStorage.sessions)
		.map(s => s.folder).filter((f): f is string => !!f))].sort((a, b) => a.localeCompare(b)),
		[version, sessionStorage.sessions]);

	/** Every tag in use, most used first, for the tag box's suggestions. */
	const tagNames = useMemo(() => {
		const counts = new Map<string, number>();
		for (const s of Object.values(sessionStorage.sessions)) {
			for (const tag of s.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
		}
		return [...counts.keys()].sort((a, b) => counts.get(b)! - counts.get(a)! || a.localeCompare(b));
	}, [version, sessionStorage.sessions]);

	/** An existing folder's spelling wins, so "Drafts" and "drafts" never become two folders. */
	const resolveFolder = (raw: string, except?: string) => {
		const name = folderName(raw);
		return folderNames.find(f => f !== except && f.toLowerCase() === name?.toLowerCase()) ?? name;
	};

	/** The selection, minus anything deleted since it was picked. */
	const selectedIds = useMemo(() => [...selected].filter(id => sessionStorage.sessions[id]),
		[selected, version, sessionStorage.sessions]);

	/** Picked sessions the filters hide. The bar's actions still apply to them, so it says so. */
	const hiddenPicked = useMemo(() => {
		const shown = new Set(sortedSessions.map(([id]) => id));
		return selectedIds.filter(id => !shown.has(id)).length;
	}, [selectedIds, sortedSessions]);

	/** A filter shows every match side by side, and a folder that has since emptied is left. */
	const inFolder = view === 'icons' && !filtering && openFolder !== undefined && folderNames.includes(openFolder) ? openFolder : undefined;

	/**
	 * What the arrow keys step through, in the order shown: the list's rows, or the icon view's
	 * tiles, where a folder is a tile of its own.
	 */
	const navKeys = useMemo(() => view === 'list'
		? listItems.flatMap(({ folder, entries }) => folder && !filtering && collapsed.has(folder) ? [] : entries.map(([id]) => id))
		: filtering ? sortedSessions.map(([id]) => id)
		: inFolder !== undefined ? sortedSessions.filter(([, s]) => s.folder === inFolder).map(([id]) => id)
		: listItems.map(({ folder, entries }) => folder ? FOLDER_KEY + folder : entries[0][0]),
		[view, listItems, sortedSessions, collapsed, filtering, inFolder]);

	/** The sessions on screen, for shift-click runs and Select all. */
	const visibleIds = useMemo(() => navKeys.filter(key => !isFolderKey(key)), [navKeys]);

	const openId = String(sessionStorage.selectedSession);
	const previewId = previewKey !== null && (isFolderKey(previewKey) ? folderNames.includes(folderOfKey(previewKey)) : sessionStorage.sessions[previewKey])
		? previewKey : openId;
	const previewSession: SessionData | undefined = sessionStorage.sessions[previewId];

	// The open session's text is in memory; any other's is read when it has been in the pane a moment.
	useEffect(() => {
		if (!isOpen || !previewSession || previewId === openId) return;
		let stale = false;
		const timer = setTimeout(() => loadRecord(previewId).then(
			record => { if (!stale) setLoadedText({ id: previewId, text: promptTail(record?.prompt) }); },
			(e: unknown) => {
				console.error('Failed to read the session for the pane:', e);
				if (!stale) setLoadedText({ id: previewId, text: null });
			}), PREVIEW_DELAY_MS);
		return () => { stale = true; clearTimeout(timer); };
	}, [isOpen, previewId, openId]);

	/** Undefined while it is being read. */
	const previewText = previewId === openId ? promptTail(previewSession?.prompt)
		: loadedText?.id === previewId ? loadedText.text : undefined;

	useEffect(() => {
		if (focusAfterRender.current === null) return;
		focusItem(focusAfterRender.current);
		focusAfterRender.current = null;
	});

	/** Adds the rows on screen to the selection: like shift-click, none from collapsed folders. */
	const selectAll = () => setSelected(new Set([...selected, ...visibleIds]));

	/** The bar's Pin unpins only when every picked session is pinned, so a mixed selection ends up all pinned. */
	const allPinned = selectedIds.every(id => sessionStorage.sessions[id].pinned);

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

	/** Puts sessions in a new folder and opens its name for editing in the pane. */
	const createFolder = async (ids: string[]) => {
		const taken = new Set(Object.values(sessionStorage.sessions).map(s => s.folder));
		const base = t('sessions.newFolder');
		let name = base;
		for (let n = 2; taken.has(name); n++) name = `${base} ${n}`;
		setFolderCollapsed(name, false);
		setPreviewKey(FOLDER_KEY + name);
		startRenameFolder(name);
		await sessionStorage.setFolder(ids, name);
	};

	const startRenameFolder = (folder: string) => {
		setRenameFolderValue(folder);
		setRenamingFolder(folder);
	};

	const renameFolder = async () => {
		const from = renamingFolder;
		const to = resolveFolder(renameFolderValue, from);
		setRenamingFolder(undefined);
		// Renaming onto another folder's name merges the two.
		if (from !== undefined && to && to !== from) {
			setPreviewKey(key => key === FOLDER_KEY + from ? FOLDER_KEY + to : key);
			await sessionStorage.setFolder(folderIds(from), to);
		}
	};

	const removeFolder = async (folder: string) => {
		const ids = folderIds(folder);
		// The count matters: a filter hides some of what this is about to ungroup.
		if (!window.confirm(`${folder} (${ids.length})

${t('sessions.removeFolderConfirm')}`)) return;
		setFolderCollapsed(folder, false);
		await sessionStorage.setFolder(ids, undefined);
	};

	/** The keyboard and touch way in or out of a folder, and the only one that suggests names. */
	const commitFolder = async () => {
		if (!folderEdit) return;
		const { ids, value } = folderEdit;
		setFolderEdit(null);
		await sessionStorage.setFolder(ids, resolveFolder(value));
	};

	/** Storage only reports its errors to the console and the server banner, so say the action did not happen. */
	const trashAction = (run: Promise<void>) => run.catch((e: unknown) => {
		console.error('Trash action failed:', e);
		alert(t('sessions.trashFailed'));
	});

	const trashSessions = (ids: string[]) => trashAction(sessionStorage.trashSessions(ids));

	/** The trash can give them back, so only deleting them from there asks first. One confirmation for the lot. */
	const purgeSessions = (ids: string[]) => {
		if (window.confirm(ids.length > 1 ? t('sessions.purgeConfirmMany', { count: ids.length }) : t('sessions.purgeConfirm')))
			trashAction(sessionStorage.purgeSessions(ids));
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

	/** Picks out the sessions on screen from one item to another, as shift-click and shift-arrows do. */
	const pickRun = (fromKey: string, toKey: string) => {
		const from = navKeys.indexOf(fromKey);
		const to = navKeys.indexOf(toKey);
		if (from >= 0 && to >= 0) setSelected(new Set(navKeys.slice(Math.min(from, to), Math.max(from, to) + 1).filter(key => !isFolderKey(key))));
	};

	const focusItem = (key: string | undefined) => {
		// Not a selector: a folder's name can hold anything.
		if (key !== undefined) [...listRef.current?.querySelectorAll<HTMLElement>('[data-key]') ?? []].find(el => el.dataset.key === key)?.focus();
	};

	const enterFolder = (folder: string) => {
		focusAfterRender.current = sortedSessions.find(([, s]) => s.folder === folder)?.[0] ?? null;
		setOpenFolder(folder);
	};

	const leaveFolder = () => {
		if (inFolder !== undefined) focusAfterRender.current = FOLDER_KEY + inFolder;
		setOpenFolder(undefined);
	};

	const openItem = (key: string) => isFolderKey(key) ? enterFolder(folderOfKey(key)) : switchSession(key);

	/** Ctrl-click picks sessions out, not folders, and shift-click extends the run. A plain click shows the item in the pane, and a second one opens it. */
	const itemClick = (e: MouseEvent, key: string) => {
		if (e.ctrlKey || e.metaKey) {
			if (!isFolderKey(key)) toggleSelected(key);
		} else if (e.shiftKey) {
			pickRun(anchorId ?? key, key);
		} else if (previewedOnPress.current) {
			openItem(key);
		}
	};

	/**
	 * Keys on a focused row or tile. Enter or Space opens it. Arrows, Home and End move between the
	 * items on screen, a tile's row at a time for Up and Down, and with Shift pick out the run from
	 * the anchor, like shift-click. Backspace leaves the folder the icon view is in. Typing the start
	 * of a name jumps to the next item it matches. Keys pressed in the item's own buttons are theirs.
	 */
	const itemKeyDown = (e: KeyboardEvent, key: string) => {
		if (e.target !== e.currentTarget || e.ctrlKey || e.metaKey || e.altKey) return;
		const at = navKeys.indexOf(key);
		const grid = listRef.current?.querySelector('.sessions-grid');
		const across = grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 1;
		const moves: Record<string, number> = { ArrowDown: at + across, ArrowUp: at - across, Home: 0, End: navKeys.length - 1 };
		if (grid) Object.assign(moves, { ArrowRight: at + 1, ArrowLeft: at - 1 });
		const ahead = typeAhead.current;
		const now = Date.now();
		const recent = now - ahead.at < TYPE_AHEAD_MS;
		// A space right after a letter is part of the name being typed; on its own it opens the item.
		const typed = e.key.length === 1 && (e.key !== ' ' || recent);
		let to: string | undefined;
		if (typed) {
			ahead.text = (recent ? ahead.text : '') + e.key.toLowerCase();
			ahead.at = now;
			to = typeAheadMatch(navKeys, k => isFolderKey(k) ? folderOfKey(k) : sessionStorage.sessions[k]?.name ?? '', at, ahead.text);
		} else if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			openItem(key);
			return;
		} else if (e.key === 'Backspace' && inFolder !== undefined) {
			e.preventDefault();
			leaveFolder();
			return;
		} else if (Object.hasOwn(moves, e.key)) {
			to = navKeys[moves[e.key]];
		} else {
			return;
		}
		e.preventDefault();
		if (to === undefined) return;
		if (e.shiftKey && !typed) {
			const anchor = anchorId !== null && navKeys.includes(anchorId) ? anchorId : key;
			setAnchorId(anchor);
			pickRun(anchor, to);
		} else {
			setAnchorId(to);
		}
		focusItem(to);
	};

	/** What a row and a tile share: focusing one shows it in the pane, and clicks and keys pick or open it. */
	const itemProps = (key: string) => ({
		tabIndex: 0,
		'data-key': key,
		onMouseDown: () => { previewedOnPress.current = previewId === key; },
		onFocus: () => setPreviewKey(key),
		onClick: (e: MouseEvent) => itemClick(e, key),
		onKeyDown: (e: KeyboardEvent) => itemKeyDown(e, key),
	});

	/** A session's row or tile also drags, takes drops, has a menu, and says when it is the open one. */
	const sessionProps = (sessionId: string, session: SessionData) => ({
		...itemProps(sessionId),
		draggable: true,
		onDragStart: (e: DragEvent) => startDrag(e, sessionId),
		onDragEnd: endDrag,
		...(draggedIds.includes(sessionId) || (session.folder && session.folder === draggedFolder) ? {} : dropHandlers(sessionId, (ids) =>
			session.folder ? sessionStorage.setFolder(ids, session.folder) : createFolder([...new Set([sessionId, ...ids])]))),
		'aria-current': sessionId === openId || undefined,
		onContextMenu: (e: MouseEvent) => { e.preventDefault(); setRowMenu({ id: sessionId, x: e.clientX, y: e.clientY }); },
	});

	const itemClasses = (key: string) => [
		key === openId && 'selected',
		key === previewId && 'previewed',
		selected.has(key) && 'picked',
		dropTarget === key && 'drop-target',
		draggedIds.includes(key) && 'dragging',
	].filter(Boolean).join(' ');

	/** History and statistics read the open session, so the row's is opened first. */
	const openForSession = async (sessionId: string, open: () => void) => {
		if (String(sessionStorage.selectedSession) !== sessionId) {
			cancel?.();
			await sessionStorage.switchSession(sessionId);
		}
		open();
	};

	// Create and rename share `handleKeyDown`, which can only tell them apart if one is open at a time.
	const startRenameSession = (sessionId: string | number, name: string) => {
		setIsCreating(false);
		setRenameSessionName(name);
		setRenamingId(sessionId);
	};

	const renameSession = async (sessionId: string | number | undefined) => {
		if (sessionId == null || !renameSessionName) return;
		await sessionStorage.renameSession(sessionId, renameSessionName);
		setRenamingId(undefined);
	};

	const startCreateSession = () => {
		setRenamingId(undefined);
		setNewSessionName(`${t('sessions.defaultNamePrefix')}${(sessionStorage.nextId ?? 0) + 1}`);
		setIsCreating(true);
	};

	/**
	 * A new session rarely matches the filters, and it would vanish from the list as it's opened.
	 * The pane goes back to showing the open session, which is the new one.
	 */
	const clearFilters = () => {
		setSearchQuery('');
		setTagFilterQuery('');
		setPreviewKey(null);
	};

	const createSession = async () => {
		if (newSessionName) {
			clearFilters();
			const newId = await sessionStorage.createSession(newSessionName);
			await sessionStorage.switchSession(newId);
			setIsCreating(false);
		}
	};

	const importSession = () => {
		const fileInput = document.createElement("input");
		fileInput.type = 'file';
		fileInput.accept = '.json';
		fileInput.multiple = true;
		fileInput.style.display = 'none';
		fileInput.onchange = async (e: Event) => {
			const files = (e.target as HTMLInputElement).files;
			if (!files || files.length === 0)
				return;

			const sortedFiles = Array.from(files ?? []).sort((a: File, b: File) => a.lastModified - b.lastModified);
			let lastNewId = null;
			const skipped: string[] = [];

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
					skipped.push(file.name);
				}
			}
			if (lastNewId !== null) {
				clearFilters();
				await sessionStorage.switchSession(lastNewId);
			}
			if (skipped.length) {
				alert(t('sessions.importSkipped', { count: skipped.length, total: sortedFiles.length, files: skipped.join('\n') }));
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

	const exportSessions = async (ids: string[]) => {
		for (const sessionId of ids) await exportSession(sessionId);
	};

	const exportAll = async () => {
		if (confirm(t('sessions.exportAllWarning'))) await exportSessions(Object.keys(sessionStorage.sessions));
	};

	/** Opens the last clone made, and shows it in the pane. */
	const cloneSessions = async (ids: string[]) => {
		let newId: number | undefined;
		for (const sessionId of ids) newId = await sessionStorage.createSessionFromObject(stringifyAll(await loadRecord(sessionId)), true);
		if (newId !== undefined) {
			await sessionStorage.switchSession(newId);
			setPreviewKey(null);
		}
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
	/**
	 * Storage refuses to delete the last session, so the buttons that would say why instead.
	 * ponytail: Chrome shows no tooltip on a disabled button, so the why only appears in Firefox;
	 * `aria-disabled` and a no-op click instead of `disabled` would show it everywhere.
	 */
	const lastSession = Object.keys(sessionStorage.sessions).length <= 1;

	const toggleSelected = (sessionId: string) => {
		const next = new Set(selected);
		if (!next.delete(sessionId)) next.add(sessionId);
		setSelected(next);
		setAnchorId(sessionId);
	};

	/** The right-click menu: some of the pane's actions, without going through the pane. */
	const rowMenuItems = (sessionId: string): ContextMenuItem[] => {
		// Like the selection bar, these act on the whole selection when the row is part of it.
		const ids = targetIds(sessionId);
		const count = ids.length > 1 ? ` (${ids.length})` : '';
		return [
			{
				label: selected.has(sessionId) ? t('sessions.deselect') : t('sessions.select'),
				disabled: false,
				action: () => toggleSelected(sessionId),
			},
			{ label: t('sessions.export') + count, disabled, action: () => exportSessions(ids) },
			{ label: t('sessions.clone') + count, disabled, action: () => cloneSessions(ids) },
			// History is one session's, and a multi-selection does not say which.
			{ label: t('sessions.history'), disabled: disabled || ids.length > 1, action: () => openForSession(sessionId, openHistory) },
			{ label: t('sessions.statistics'), disabled, action: () => openForSession(sessionId, openStatistics) },
		];
	};

	const renderSession = ([sessionId, session]: SessionEntry) => html`
		<tr key=${sessionId}
			className="sessions-modal-row ${itemClasses(sessionId)} ${session.folder ? 'sessions-modal-row-in-folder' : ''}"
			...${sessionProps(sessionId, session)}>
			<td className="sessions-col-star" onClick=${(e: MouseEvent) => e.stopPropagation()}>
				<button className="sessions-action-btn"
					title=${session.pinned ? t('sessions.unpinSession') : t('sessions.pinSession')}
					onClick=${() => sessionStorage.togglePinSession(sessionId)}>
					${session.pinned ? html`<${SVG_Star}/>` : html`<${SVG_StarOutline}/>`}
				</button>
			</td>
			<td className="sessions-col-name">
				<div className="sessions-modal-name-wrapper">
					<span className="sessions-modal-name" title=${session.name}>${session.name}</span>
					<span className="sessions-modal-tags" title=${session.tags?.join(', ')}>${session.tags?.join(', ') || ' '}</span>
				</div>
			</td>
			<td className="sessions-col-modified" title=${formatDate(session.modified)}>${formatRelative(session.modified)}</td>
		</tr>
	`;

	/** A newly picked column starts at A for names, and at the newest for dates. */
	const pickSortColumn = (key: string) => {
		setSortBy(key);
		setSortAsc(key === 'name');
	};

	/** Clicking the sorted column reverses it. */
	const sortHeader = (key: string, label: string) => html`
		<button className="sessions-sort-header"
			onClick=${() => sortBy === key ? setSortAsc((v: boolean) => !v) : pickSortColumn(key)}>
			${label}${sortBy === key && html`<span className="sessions-sort-arrow">${sortAsc ? '↑' : '↓'}</span>`}
		</button>`;

	const ariaSort = (key: string) => sortBy === key ? (sortAsc ? 'ascending' : 'descending') : undefined;

	/** Clicking a folder row opens or closes it, and shows the folder in the pane. */
	const renderFolder = (folder: string, entries: SessionEntry[]) => {
		const open = filtering || !collapsed.has(folder);
		const target = FOLDER_KEY + folder;
		return html`<${Fragment} key=${target}>
			<tr className="sessions-modal-row sessions-modal-folder-row ${itemClasses(target)}"
				...${draggedFolder === folder ? {} : dropHandlers(target, (ids) => sessionStorage.setFolder(ids, folder))}
				onClick=${() => {
					setPreviewKey(target);
					if (!filtering) setFolderCollapsed(folder, open);
				}}>
				<td className="sessions-col-star">
					<button className="sessions-action-btn sessions-folder-toggle ${open ? 'open' : ''}"
						aria-expanded=${open}
						disabled=${filtering}
						title=${filtering ? t('sessions.folderOpenWhileFiltering') : open ? t('sessions.collapseFolder') : t('sessions.expandFolder')}>
						<${SVG_ArrowDown}/>
					</button>
				</td>
				<td className="sessions-col-name">
					<span className="sessions-modal-name sessions-folder-name" title=${folder}>
						${folder} <span className="sessions-folder-count">${entries.length}</span>
					</span>
				</td>
				<td className="sessions-col-modified"></td>
			</tr>
			${open && entries.map(renderSession)}
		<//>`;
	};

	const renderTile = (key: string) => {
		if (isFolderKey(key)) {
			const folder = folderOfKey(key);
			return html`
				<div key=${key} className="sessions-modal-row sessions-tile ${itemClasses(key)}"
					...${itemProps(key)}
					...${draggedFolder === folder ? {} : dropHandlers(key, (ids) => sessionStorage.setFolder(ids, folder))}>
					<span className="sessions-tile-icon"><${SVG_Folder}/></span>
					<span className="sessions-modal-name sessions-folder-name" title=${folder}>${folder}</span>
					<span className="sessions-folder-count">${folderIds(folder).length}</span>
				</div>`;
		}
		const session = sessionStorage.sessions[key];
		return html`
			<div key=${key} className="sessions-modal-row sessions-tile ${itemClasses(key)}" ...${sessionProps(key, session)}>
				<span className="sessions-tile-icon"><${SVG_Document}/></span>
				${session.pinned && html`<span className="sessions-tile-pin" title=${t('sessions.pinned')}><${SVG_Star}/></span>`}
				<span className="sessions-modal-name" title=${session.name}>${session.name}</span>
			</div>`;
	};

	/** Folders are tiles of their own, gone into with a click on an open one; a filter shows every match side by side. */
	const renderIcons = () => html`
		${inFolder !== undefined && html`
			<div className="sessions-crumbs">
				<button className="sessions-sort-header" onClick=${leaveFolder}>${t('sessions.title')}</button>
				<span aria-hidden="true">›</span>
				<span className="sessions-folder-name">${inFolder}</span>
			</div>
		`}
		<div className="sessions-grid">${navKeys.map(renderTile)}</div>
		${navKeys.length === 0 && html`<p className="sessions-modal-empty">${t('sessions.noMatches')}</p>`}
	`;

	const renderTags = (sessionId: string, session: SessionData) => editingTagsId === sessionId ? html`<${Fragment}>
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
			autoFocus
			list="sessions-tag-names"
			aria-label=${t('sessions.tags')}
			title=${t('sessions.tagsHint')}/>
		<datalist id="sessions-tag-names">
			${tagSuggestions(editTagsValue, tagNames).map(s => html`<option key=${s} value=${s}/>`)}
		</datalist>
	<//>` : html`
		<button className="sessions-pane-tags" title=${t('sessions.tagsHint')}
			onClick=${() => {
				setEditTagsValue(session.tags ? session.tags.join(', ') : '');
				setEditingTagsId(sessionId);
			}}>
			${session.tags?.length ? session.tags.map(tag => html`<span key=${tag} className="sessions-pane-tag">${tag}</span>`)
				: html`<span className="sessions-modal-tags-empty">${t('sessions.addTags')}</span>`}
		</button>
	`;

	const renderSessionPane = (sessionId: string, session: SessionData) => html`
		<div>
			${renamingId == sessionId ? html`
				<div className="sessions-pane-rename">
					<input
						type="text"
						className="sessions-modal-inline-input"
						aria-label=${t('sessions.renameSession')}
						value=${renameSessionName}
						onChange=${(e: ChangeEvent<HTMLInputElement>) => setRenameSessionName(e.target.value)}
						onKeyDown=${(e: KeyboardEvent<HTMLInputElement>) => handleKeyDown(sessionId, e)}
						autoFocus/>
					<button className="sessions-action-btn" onClick=${() => renameSession(sessionId)}><${SVG_Confirm}/></button>
					<button className="sessions-action-btn" onClick=${() => setRenamingId(undefined)}><${SVG_Cancel}/></button>
				</div>
			` : html`<div className="sessions-pane-name">${session.name}</div>`}
			${renderTags(sessionId, session)}
		</div>
		<div className="sessions-pane-text">
			${previewText === undefined ? '…'
				: previewText === null ? t('sessions.previewFailed')
				: previewText || html`<i>${t('sessions.emptySession')}</i>`}
		</div>
		<dl className="sessions-pane-meta">
			${session.folder && html`<dt>${t('sessions.folder')}</dt><dd>${session.folder}</dd>`}
			<dt>${t('statistics.modified')}</dt>
			<dd>${formatRelative(session.modified)}<br/><small>${formatDate(session.modified)}</small></dd>
			<dt>${t('statistics.created')}</dt>
			<dd>${formatDate(session.created)}</dd>
			<dt>${t('statistics.generations')}</dt>
			<dd>${(session.stats?.generations ?? 0).toLocaleString()}</dd>
			<dt>${t('statistics.tokensGenerated')}</dt>
			<dd>${(session.stats?.genTokens ?? 0).toLocaleString()}</dd>
		</dl>
		${sessionId !== openId && html`
			<button className="sessions-pane-open" onClick=${() => switchSession(sessionId)}>${t('sessions.open')}</button>
		`}
		<div className="sessions-pane-actions">
			<button onClick=${() => sessionStorage.togglePinSession(sessionId)}>${session.pinned ? t('sessions.unpin') : t('sessions.pin')}</button>
			<button disabled=${disabled} onClick=${() => startRenameSession(sessionId, session.name ?? '')}>${t('sessions.rename')}</button>
			<button onClick=${() => setFolderEdit({ ids: [sessionId], value: session.folder ?? '' })}>${t('sessions.moveToFolder')}</button>
			<button onClick=${() => toggleSelected(sessionId)}>${selected.has(sessionId) ? t('sessions.deselect') : t('sessions.select')}</button>
			<button disabled=${disabled} onClick=${() => openForSession(sessionId, openHistory)}>${t('sessions.history')}</button>
			<button disabled=${disabled} onClick=${() => openForSession(sessionId, openStatistics)}>${t('sessions.statistics')}</button>
			<button disabled=${disabled} onClick=${() => exportSessions([sessionId])}>${t('sessions.export')}</button>
			<button disabled=${disabled} onClick=${() => cloneSessions([sessionId])}>${t('sessions.clone')}</button>
			<button disabled=${disabled || lastSession}
				title=${lastSession ? t('sessions.cantDeleteLast') : t('sessions.deleteSession')}
				onClick=${() => trashSessions([sessionId])}>${t('sessions.delete')}</button>
		</div>
	`;

	const renderFolderPane = (folder: string) => html`
		${renamingFolder === folder ? html`
			<div className="sessions-pane-rename">
				<input
					type="text"
					className="sessions-modal-inline-input"
					aria-label=${t('sessions.renameFolder')}
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
					autoFocus/>
				<button className="sessions-action-btn" onClick=${renameFolder}><${SVG_Confirm}/></button>
				<button className="sessions-action-btn" onClick=${() => setRenamingFolder(undefined)}><${SVG_Cancel}/></button>
			</div>
		` : html`<div className="sessions-pane-name">${folder}</div>`}
		${view === 'icons' && !filtering && html`
			<button className="sessions-pane-open" onClick=${() => enterFolder(folder)}>${t('sessions.openFolder')}</button>
		`}
		<div className="sessions-pane-actions">
			<button onClick=${() => startRenameFolder(folder)}>${t('sessions.rename')}</button>
			<button onClick=${() => removeFolder(folder)}>${t('sessions.removeFolder')}</button>
		</div>
	`;

	/** The selection bar above the list acts on them. */
	const renderPickedPane = () => html`
		<div className="sessions-pane-name">${t('sessions.selectedCount', { count: selectedIds.length })}</div>
		<ul className="sessions-pane-picked">
			${selectedIds.map(id => html`<li key=${id}>${sessionStorage.sessions[id].name}</li>`)}
		</ul>
	`;

	/** The item clicked or focused last, or the selection when it is part of one. */
	const renderPane = () => selected.has(previewId) && selectedIds.length > 1 ? renderPickedPane()
		: isFolderKey(previewId) ? renderFolderPane(folderOfKey(previewId))
		: previewSession ? renderSessionPane(previewId, previewSession)
		: null;

	// The same Modal as the list below, so React keeps it open instead of mounting a second one.
	if (showTrash) return html`
		<${Modal} isOpen=${isOpen} onClose=${closeModal}
			title=${t('sessions.trash')}
			description="">
			<div className="sessions-modal-bar-slot">
				<div className="sessions-modal-bar">
					<button onClick=${() => setShowTrash(false)}>${t('sessions.backToSessions')}</button>
					<button disabled=${!trashEntries.length} onClick=${() => purgeSessions(trashEntries.map(([id]) => id))}>
						${t('sessions.emptyTrash')}
					</button>
				</div>
			</div>
			<div className="sessions-modal-list overflow-container">
				<table className="sessions-modal-table">
					<thead>
						<tr>
							<th className="sessions-col-name">${t('sessions.name')}</th>
							<th className="sessions-col-modified">${t('sessions.trashed')}</th>
							<th className="sessions-col-actions">${t('sessions.actions')}</th>
						</tr>
					</thead>
					<tbody>
						${trashEntries.map(([sessionId, session]) => html`
							<tr key=${sessionId} className="sessions-modal-row sessions-modal-trash-row">
								<td className="sessions-col-name">
									<span className="sessions-modal-name" title=${session.name}>${session.name}</span>
									${session.folder && html`<span className="sessions-modal-tags" title=${session.folder}>${session.folder}</span>`}
								</td>
								<td className="sessions-col-modified" title=${formatDate(session.trashed)}>${formatRelative(session.trashed)}</td>
								<td className="sessions-col-actions">
									<div className="sessions-col-actions-inner">
										<button className="sessions-action-btn" title=${t('sessions.restore')}
											onClick=${() => trashAction(sessionStorage.restoreSessions([sessionId]))}>
											<${SVG_Undo}/>
										</button>
										<button className="sessions-action-btn" title=${t('sessions.deleteForever')}
											onClick=${() => purgeSessions([sessionId])}>
											<${SVG_Trash}/>
										</button>
									</div>
								</td>
							</tr>
						`)}
						${trashEntries.length === 0 && html`
							<tr key="empty"><td colSpan="3" className="sessions-modal-empty">${t('sessions.trashEmpty')}</td></tr>
						`}
					</tbody>
				</table>
			</div>
		</${Modal}>`;

	return html`
		<${Modal} isOpen=${isOpen} onClose=${closeModal}
			title=${t('sessions.title')}
			description="">
			<div className="sessions-modal-toolbar">
				<div className="sessions-modal-toolbar-row">
					<${InputBox} label=${t('sessions.search')}
						value=${searchQuery}
						onValueChange=${setSearchQuery}
						placeholder=${t('sessions.searchPlaceholder')}
						onKeyDown=${(e: KeyboardEvent<HTMLInputElement>) => {
							// Down from the search box goes to the first match.
							if (e.key === 'ArrowDown' && navKeys.length) {
								e.preventDefault();
								focusItem(navKeys[0]);
							}
						}}
						autoFocus/>
					<${InputBox} label=${t('sessions.tags')}
						value=${tagFilterQuery}
						onValueChange=${setTagFilterQuery}
						placeholder=${t('sessions.tagsPlaceholder')}
						tooltip=${t('sessions.tagsTooltip')}/>
					<div className="sessions-modal-sort">
						<${SelectBox}
							label=${t('sessions.sortBy')}
							value=${sortBy}
							onValueChange=${pickSortColumn}
							options=${[
								{ name: t('sessions.sortLastModified'), value: 'modified' },
								{ name: t('sessions.sortCreated'), value: 'created' },
								{ name: t('sessions.sortName'), value: 'name' },
							]}/>
						<button
							className="sessions-modal-sort-btn"
							title=${sortAsc ? t('sessions.sortAscending') : t('sessions.sortDescending')}
							aria-label=${sortAsc ? t('sessions.sortAscending') : t('sessions.sortDescending')}
							onClick=${() => setSortAsc((v: boolean) => !v)}
							style=${{ transform: sortAsc ? 'rotate(0deg)' : 'rotate(180deg)' }}>
							↑
						</button>
					</div>
					<div className="sessions-modal-view" role="group" aria-label=${t('sessions.view')}>
						<button aria-pressed=${view === 'list'} onClick=${() => setView('list')}>${t('sessions.viewList')}</button>
						<button aria-pressed=${view === 'icons'} onClick=${() => setView('icons')}>${t('sessions.viewIcons')}</button>
					</div>
				</div>
				<div className="sessions-modal-toolbar-row">
					<button disabled=${disabled} onClick=${startCreateSession}>${t('sessions.create')}</button>
					<button disabled=${disabled} onClick=${importSession}>${t('sessions.import')}</button>
					<button disabled=${disabled} onClick=${exportAll}>${t('sessions.exportAll')}</button>
					<button disabled=${disabled || noSession} onClick=${openStatistics}>${t('sessions.statistics')}</button>
					<button onClick=${selectAll}>${t('sessions.selectAll')}</button>
					<button onClick=${() => setShowTrash(true)}>${t('sessions.trashCount', { count: trashEntries.length })}</button>
				</div>
			</div>
			<div className="sessions-modal-bar-slot">
			${draggedFromFolder ? html`
				<div className="sessions-modal-dropzone ${dropTarget === 'root' ? 'drop-target' : ''}"
					...${dropHandlers('root', (ids) => sessionStorage.setFolder(ids, undefined))}>
					${t('sessions.dropToUngroup')}
				</div>
			` : folderEdit ? html`
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
			` : isCreating ? html`
				<div className="sessions-modal-bar">
					<label htmlFor="sessions-new-name">${t('sessions.name')}</label>
					<input
						id="sessions-new-name"
						type="text"
						className="sessions-modal-inline-input"
						value=${newSessionName}
						onChange=${(e: ChangeEvent<HTMLInputElement>) => setNewSessionName(e.target.value)}
						onKeyDown=${(e: KeyboardEvent<HTMLInputElement>) => handleKeyDown(undefined, e)}
						autoFocus/>
					<button className="sessions-action-btn" onClick=${createSession}><${SVG_Confirm}/></button>
					<button className="sessions-action-btn" onClick=${() => setIsCreating(false)}><${SVG_Cancel}/></button>
				</div>
			` : selectedIds.length > 0 ? html`
				<div className="sessions-modal-bar">
					<span>${t('sessions.selectedCount', { count: selectedIds.length })}${hiddenPicked > 0 && ` ${t('sessions.hiddenByFilter', { count: hiddenPicked })}`}</span>
					<button onClick=${() => sessionStorage.setPinned(selectedIds, !allPinned)}>
						${allPinned ? t('sessions.unpin') : t('sessions.pin')}
					</button>
					<button disabled=${disabled} onClick=${() => exportSessions(selectedIds)}>${t('sessions.export')}</button>
					<button onClick=${() => setFolderEdit({ ids: selectedIds, value: '' })}>${t('sessions.moveToFolder')}</button>
					<button disabled=${disabled || lastSession}
						title=${lastSession ? t('sessions.cantDeleteLast') : t('sessions.deleteSession')}
						onClick=${() => trashSessions(selectedIds)}>${t('sessions.delete')}</button>
					<button onClick=${() => setSelected(new Set())}>${t('sessions.clearSelection')}</button>
				</div>
			` : html`
				<div className="sessions-modal-bar sessions-modal-bar-hint">${t('sessions.pickHint')}</div>
			`}
			</div>
			<div className="sessions-modal-body">
				<div className="sessions-modal-list overflow-container" ref=${listRef}>
					${view === 'icons' ? renderIcons() : html`
						<table className="sessions-modal-table">
							<thead>
								<tr>
									<th className="sessions-col-star"></th>
									<th className="sessions-col-name" aria-sort=${ariaSort('name')}>${sortHeader('name', t('sessions.name'))}</th>
									<th className="sessions-col-modified" aria-sort=${ariaSort('modified')}>${sortHeader('modified', t('sessions.modified'))}</th>
								</tr>
							</thead>
							<tbody>
								${listItems.map(({ folder, entries }) => folder ? renderFolder(folder, entries) : renderSession(entries[0]))}
								${listItems.length === 0 && html`
									<tr key="empty"><td colSpan="3" className="sessions-modal-empty">${t('sessions.noMatches')}</td></tr>
								`}
							</tbody>
						</table>
					`}
				</div>
				<div className="sessions-pane-divider"
					role="separator"
					aria-orientation="vertical"
					aria-label=${t('sessions.resizePane')}
					tabIndex="0"
					onPointerDown=${dragDivider}
					onKeyDown=${dividerKeyDown}></div>
				<aside className="sessions-pane"
					aria-label=${t('sessions.details')}
					style=${paneWidth ? { '--pane-width': `${paneWidth}px` } : undefined}>
					${renderPane()}
				</aside>
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
