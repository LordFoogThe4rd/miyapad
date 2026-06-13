import { html } from 'htm/react';
import { useState, useEffect, useMemo } from 'react';
import { Modal } from '../Modal';
import { InputBox } from '../controls/InputBox';
import { SelectBox } from '../controls/SelectBox';
import { SVG_Confirm, SVG_Cancel, SVG_Rename, SVG_Trash, SVG_Star, SVG_StarOutline } from '../icons/index';
import { exportText } from '../../api/common';

function formatDate(ts: any) {
	if (!ts) return '—';
	const d = new Date(ts);
	const pad = (n: any) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type TagGroup = Array<{ pattern: string; negate: boolean; regex: RegExp | null }>;

function compileTagRegex(pattern: any) {
	if (!pattern.includes('*')) return null;
	const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
	return new RegExp('^' + escaped + '$', 'i');
}

function parseTagFilter(input: any): TagGroup[] | null {
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

function tagMatches(tag: any, pattern: any, regex: any) {
	if (regex) return regex.test(tag);
	return tag.toLowerCase() === pattern.toLowerCase();
}

function sessionMatches(session: any, groups: TagGroup[] | null) {
	if (!groups) return true;
	if (groups.length === 0) return true;
	return groups.some((group: TagGroup) =>
		group.every(({ pattern, negate, regex }) => {
			const match = (session.tags || []).some((tag: any) => tagMatches(tag, pattern, regex));
			return negate ? !match : match;
		})
	);
}

export function SessionsModal({ isOpen, closeModal, sessionStorage, cancel }: any) {
	const [version, setVersion] = useState(0);
	const [newSessionName, setNewSessionName] = useState('');
	const [renameSessionName, setRenameSessionName] = useState('');
	const [renamingId, setRenamingId] = useState<any>(undefined);
	const [isCreating, setIsCreating] = useState(false);
	const [searchQuery, setSearchQuery] = useState('');
	const [tagFilterQuery, setTagFilterQuery] = useState('');
	const [editingTagsId, setEditingTagsId] = useState<any>(undefined);
	const [editTagsValue, setEditTagsValue] = useState('');
	const [sortBy, setSortByState] = useState(() => localStorage.getItem('miyapad-sessions-sortBy') || 'modified');
	const [sortAsc, setSortAscState] = useState(() => localStorage.getItem('miyapad-sessions-sortAsc') === 'true');

	const setSortBy = (v: any) => { setSortByState(v); localStorage.setItem('miyapad-sessions-sortBy', v); };
	const setSortAsc = (v: any) => { const next = typeof v === 'function' ? v(sortAsc) : v; setSortAscState(next); localStorage.setItem('miyapad-sessions-sortAsc', String(next)); };

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
		const compare = ([idA, a]: any, [idB, b]: any) => {
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

	const switchSession = async (sessionId: any) => {
		if (sessionStorage.selectedSession != sessionId) {
			await sessionStorage.switchSession(sessionId);
		}
		closeModal();
	};

	const startRenameSession = (sessionId: any, name: any) => {
		setRenameSessionName(name);
		setRenamingId(sessionId);
	};

	const renameSession = async (sessionId: any) => {
		if (renameSessionName) {
			await sessionStorage.renameSession(sessionId, renameSessionName);
			setRenamingId(undefined);
		}
	};

	const deleteSession = async (sessionId: any) => {
		await sessionStorage.deleteSession(sessionId);
	};

	const startCreateSession = () => {
		setNewSessionName(`MiyaPad #${sessionStorage.nextId + 1}`);
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
		fileInput.onchange = async (e: any) => {
			const files = (e.target as HTMLInputElement).files;
			if (!files || files.length === 0)
				return;

			const sortedFiles = Array.from(files ?? []).sort((a: any, b: any) => a.lastModified - b.lastModified);

			const reader = new FileReader();
			let lastNewId = null;

			for (const file of sortedFiles) {
				await new Promise<void>((resolve, reject) => {
					reader.onload = async (e: any) => {
						lastNewId = await sessionStorage.createSessionFromObject(JSON.parse((e.target as FileReader).result as string), false);
						resolve();
					};
					reader.onerror = (e: any) => {
						reject(e);
					};
					reader.readAsText(file);
				});
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
		const sessionObj = { ...sessionStorage.sessions[sessionStorage.selectedSession] };

		delete sessionObj.endpoint;
		delete sessionObj.endpointAPIKey;

		for (const [key, value] of Object.entries(sessionObj)) {
			sessionObj[key] = JSON.stringify(value);
		}
		exportText(`${sessionStorage.getProperty('name')}.json`, JSON.stringify(sessionObj));
	};

	const exportAll = async () => {
		if (confirm("Warning: This can take a lot of time and space. Be patient if you proceed.")) {
			const db = await sessionStorage.openDatabase();
			const sessionKeys = Object.keys(sessionStorage.sessions);
			for (const sessionKey of sessionKeys) {
				const processedSession = await sessionStorage.loadFromDatabase(db, sessionKey);
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
		const sessionObj = { ...sessionStorage.sessions[sessionStorage.selectedSession] };
		for (const [key, value] of Object.entries(sessionObj)) {
			sessionObj[key] = JSON.stringify(value);
		}
		const newId = await sessionStorage.createSessionFromObject(sessionObj, true);
		await sessionStorage.switchSession(newId);
	};

	function handleKeyDown(sessionId: any, e: any) {
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

	return html`
		<${Modal} isOpen=${isOpen} onClose=${closeModal}
			title="Sessions"
			description="">
			<div className="sessions-modal-toolbar">
				<div className="sessions-modal-toolbar-row">
					<${InputBox} label="Search"
						value=${searchQuery}
						onValueChange=${setSearchQuery}
						placeholder="Filter sessions…"/>
					<${InputBox} label="Tags"
						value=${tagFilterQuery}
						onValueChange=${setTagFilterQuery}
						placeholder="Filter tags…"
						tooltip="Filter tags. Use AND (implicit), OR, NOT, and * wildcards. Examples: wip OR writing, NOT archived, wip*"/>
					<${SelectBox}
						label="Sort By"
						value=${sortBy}
						onValueChange=${setSortBy}
						options=${[
							{ name: 'Last Modified', value: 'modified' },
							{ name: 'Created', value: 'created' },
							{ name: 'Name', value: 'name' },
						]}/>
					<button
						className="sessions-modal-sort-btn"
						title=${sortAsc ? "Ascending" : "Descending"}
						onClick=${() => setSortAsc((v: any) => !v)}
						style=${{ transform: sortAsc ? 'rotate(0deg)' : 'rotate(180deg)' }}>
						↑
					</button>
				</div>
				<div className="sessions-modal-toolbar-row">
					<button disabled=${disabled} onClick=${startCreateSession}>Create</button>
					<button disabled=${disabled} onClick=${importSession}>Import</button>
					<button disabled=${disabled} onClick=${exportSession}>Export</button>
					<button disabled=${disabled} onClick=${exportAll}>Export All</button>
					<button disabled=${disabled} onClick=${cloneSession}>Clone</button>
				</div>
			</div>
			<div className="sessions-modal-list overflow-container">
				<table className="sessions-modal-table">
					<thead>
						<tr>
							<th className="sessions-col-star"></th>
							<th className="sessions-col-name">Name</th>
							<th className="sessions-col-modified">Modified</th>
							<th className="sessions-col-created">Created</th>
							<th className="sessions-col-actions">Actions</th>
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
onChange=${(e: any) => setNewSessionName(e.target.value)}
onKeyDown=${(e: any) => handleKeyDown(undefined, e)}
onClick=${(e: any) => e.stopPropagation()}
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
								className="sessions-modal-row ${sessionStorage.selectedSession == sessionId ? 'selected' : ''}"
								onClick=${() => switchSession(+sessionId)}>
								<td className="sessions-col-star" onClick=${(e: any) => e.stopPropagation()}>
									<button className="sessions-action-btn"
										title=${session.pinned ? "Unpin session" : "Pin session"}
										onClick=${() => sessionStorage.togglePinSession(+sessionId)}>
										${session.pinned ? html`<${SVG_Star}/>` : html`<${SVG_StarOutline}/>`}
									</button>
								</td>
								<td className="sessions-col-name">
									${renamingId == sessionId ? html`
										<input
											type="text"
											className="sessions-modal-inline-input"
											value=${renameSessionName}
											onChange=${(e: any) => setRenameSessionName(e.target.value)}
											onKeyDown=${(e: any) => handleKeyDown(+sessionId, e)}
onClick=${(e: any) => e.stopPropagation()}
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
onChange=${(e: any) => setEditTagsValue(e.target.value)}
onKeyDown=${(e: any) => {
														if (e.key === 'Enter') {
															sessionStorage.setTags(+sessionId, editTagsValue);
															setEditingTagsId(undefined);
														} else if (e.key === 'Escape') {
															setEditingTagsId(undefined);
														}
														e.stopPropagation();
													}}
													onBlur=${() => {
															sessionStorage.setTags(+sessionId, editTagsValue);
															setEditingTagsId(undefined);
														}}
													onClick=${(e: any) => e.stopPropagation()}
													autoFocus
													title="Enter comma-separated tags."/>
											` : html`
												<span className="sessions-modal-tags ${session.tags && session.tags.length > 0 ? '' : 'sessions-modal-tags-empty'}"
													onClick=${(e: any) => {
														e.stopPropagation();
														setEditTagsValue(session.tags ? session.tags.join(', ') : '');
														setEditingTagsId(sessionId);
													}}>
													${session.tags && session.tags.length > 0 ? session.tags.join(', ') : '+ add tags'}
												</span>
											`}
										</div>
									`}
								</td>
								<td className="sessions-col-modified">${formatDate(session.modified)}</td>
								<td className="sessions-col-created">${formatDate(session.created)}</td>
								<td className="sessions-col-actions" onClick=${(e: any) => e.stopPropagation()}>
									<div className="sessions-col-actions-inner">
										${renamingId == sessionId ? html`
											<button className="sessions-action-btn" onClick=${() => renameSession(+sessionId)}><${SVG_Confirm}/></button>
											<button className="sessions-action-btn" onClick=${() => setRenamingId(undefined)}><${SVG_Cancel}/></button>
										` : html`
											<button className="sessions-action-btn" disabled=${disabled}
												onClick=${() => startRenameSession(+sessionId, session.name)}>
												<${SVG_Rename}/>
											</button>
											<button className="sessions-action-btn" disabled=${disabled}
												onClick=${() => deleteSession(+sessionId)}>
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
