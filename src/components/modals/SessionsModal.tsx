import { html } from 'htm/react';
import { useState, useEffect, useMemo, type ChangeEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { Modal } from '../Modal';
import { InputBox } from '../controls/InputBox';
import { SelectBox } from '../controls/SelectBox';
import { SVG_Confirm, SVG_Cancel, SVG_Rename, SVG_Trash, SVG_Star, SVG_StarOutline } from '../icons/index';
import { exportText } from '../../api/common';
import { useT } from '../../i18n';
import type { SessionStorage } from '../../storage/SessionStorage';

interface SessionsModalProps {
  isOpen: boolean;
  closeModal: () => void;
  sessionStorage: SessionStorage;
  cancel: (() => void) | null;
}

type TagGroup = Array<{ pattern: string; negate: boolean; regex: RegExp | null }>;

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

export function SessionsModal({ isOpen, closeModal, sessionStorage, cancel }: SessionsModalProps) {
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
			setIsCreating(false);
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
			const nameMatch = !q || (s.name || '').toLowerCase().includes(q);
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

	const switchSession = async (sessionId: string | number) => {
		if (sessionStorage.selectedSession != sessionId) {
			cancel?.();
			await sessionStorage.switchSession(sessionId);
		}
		closeModal();
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

	const deleteSession = async (sessionId: string | number) => {
		await sessionStorage.deleteSession(sessionId);
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

	const exportSession = () => {
		const sid = sessionStorage.selectedSession;
		if (sid == null) return;
		const sessionObj = { ...sessionStorage.sessions[sid] };

		delete sessionObj.endpoint;
		delete sessionObj.endpointAPIKey;

		for (const [key, value] of Object.entries(sessionObj)) {
			sessionObj[key] = JSON.stringify(value);
		}
		exportText(`${sessionStorage.getProperty('name')}.json`, JSON.stringify(sessionObj));
	};

	const exportAll = async () => {
		if (confirm(t('sessions.exportAllWarning'))) {
			const db = await sessionStorage.openDatabase();
			const sessionKeys = Object.keys(sessionStorage.sessions);
			for (const sessionKey of sessionKeys) {
				const processedSession = (await sessionStorage.loadFromDatabase(db, sessionKey)) as Record<string, unknown>;
				delete processedSession.endpoint;
				delete processedSession.endpointAPIKey;
				for (const [key, value] of Object.entries(processedSession)) {
					processedSession[key] = JSON.stringify(value);
				}
				exportText(`${processedSession.name}.json`, JSON.stringify(processedSession));
			}
		}
	};

	const cloneSession = async () => {
		const sid = sessionStorage.selectedSession;
		if (sid == null) return;
		const sessionObj = { ...sessionStorage.sessions[sid] };
		for (const [key, value] of Object.entries(sessionObj)) {
			sessionObj[key] = JSON.stringify(value);
		}
		const newId = await sessionStorage.createSessionFromObject(sessionObj as Record<string, string>, true);
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
					<button disabled=${disabled || noSession} onClick=${exportSession}>${t('sessions.export')}</button>
					<button disabled=${disabled} onClick=${exportAll}>${t('sessions.exportAll')}</button>
					<button disabled=${disabled || noSession} onClick=${cloneSession}>${t('sessions.clone')}</button>
				</div>
			</div>
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
						${sortedSessions.map(([sessionId, session]) => html`
							<tr key=${sessionId}
								className="sessions-modal-row ${String(sessionStorage.selectedSession) === sessionId ? 'selected' : ''}"
								onClick=${() => switchSession(sessionId)}>
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
										${renamingId == sessionId ? html`
											<button className="sessions-action-btn" onClick=${() => renameSession(sessionId)}><${SVG_Confirm}/></button>
											<button className="sessions-action-btn" onClick=${() => setRenamingId(undefined)}><${SVG_Cancel}/></button>
										` : html`
											<button className="sessions-action-btn" disabled=${disabled}
												onClick=${() => startRenameSession(sessionId, session.name ?? '')}>
												<${SVG_Rename}/>
											</button>
											<button className="sessions-action-btn" disabled=${disabled}
												onClick=${() => deleteSession(sessionId)}>
												<${SVG_Trash}/>
											</button>
										`}
									</div>
								</td>
							</tr>
						`)}
					</tbody>
				</table>
			</div>
		</${Modal}>`;
}
