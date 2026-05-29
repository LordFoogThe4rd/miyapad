import { html } from 'htm/react';
import { useState, useEffect, useMemo } from 'react';
import { Modal } from '../Modal.js';
import { InputBox } from '../controls/InputBox.js';
import { SelectBox } from '../controls/SelectBox.js';
import { SVG_Confirm, SVG_Cancel, SVG_Rename, SVG_Trash } from '../icons/index.js';
import { exportText } from '../../api/common.js';

function formatDate(ts) {
	if (!ts) return '—';
	const d = new Date(ts);
	const pad = (n) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function SessionsModal({ isOpen, closeModal, sessionStorage, cancel }) {
	const [version, setVersion] = useState(0);
	const [newSessionName, setNewSessionName] = useState('');
	const [renameSessionName, setRenameSessionName] = useState('');
	const [renamingId, setRenamingId] = useState(undefined);
	const [isCreating, setIsCreating] = useState(false);
	const [searchQuery, setSearchQuery] = useState('');
	const [sortBy, setSortByState] = useState(() => localStorage.getItem('miyapad-sessions-sortBy') || 'modified');
	const [sortAsc, setSortAscState] = useState(() => localStorage.getItem('miyapad-sessions-sortAsc') === 'true');

	const setSortBy = (v) => { setSortByState(v); localStorage.setItem('miyapad-sessions-sortBy', v); };
	const setSortAsc = (v) => { const next = typeof v === 'function' ? v(sortAsc) : v; setSortAscState(next); localStorage.setItem('miyapad-sessions-sortAsc', String(next)); };

	useEffect(() => {
		const incrementVersion = () => setVersion(v => v + 1);
		sessionStorage.addEventListener('change', incrementVersion);
		return () => sessionStorage.removeEventListener('change', incrementVersion);
	}, []);

	useEffect(() => {
		if (isOpen) {
			setSearchQuery('');
			setRenamingId(undefined);
			setIsCreating(false);
		}
	}, [isOpen]);

	const sortedSessions = useMemo(() => {
		let entries = Object.entries(sessionStorage.sessions);

		// Filter by search query
		if (searchQuery.trim()) {
			const q = searchQuery.trim().toLowerCase();
			entries = entries.filter(([_, s]) => (s.name || '').toLowerCase().includes(q));
		}

		// Sort
		entries.sort(([idA, a], [idB, b]) => {
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
		});

		return entries;
	}, [version, searchQuery, sortBy, sortAsc, sessionStorage.sessions]);

	const switchSession = async (sessionId) => {
		if (sessionStorage.selectedSession != sessionId) {
			await sessionStorage.switchSession(sessionId);
		}
		closeModal();
	};

	const startRenameSession = (sessionId, name) => {
		setRenameSessionName(name);
		setRenamingId(sessionId);
	};

	const renameSession = async (sessionId) => {
		if (renameSessionName) {
			await sessionStorage.renameSession(sessionId, renameSessionName);
			setRenamingId(undefined);
		}
	};

	const deleteSession = async (sessionId) => {
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
		fileInput.onchange = async (e) => {
			const files = e.target.files;
			if (files.length === 0)
				return;

			const sortedFiles = Array.from(files).sort((a, b) => a.lastModified - b.lastModified);

			const reader = new FileReader();
			let lastNewId = null;

			for (const file of sortedFiles) {
				await new Promise((resolve, reject) => {
					reader.onload = async (e) => {
						lastNewId = await sessionStorage.createSessionFromObject(JSON.parse(e.target.result), false);
						resolve();
					};
					reader.onerror = (e) => {
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

	function handleKeyDown(sessionId, e) {
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
						onClick=${() => setSortAsc(v => !v)}>
						${sortAsc ? '↑' : '↓'}
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
							<th className="sessions-col-name">Name</th>
							<th className="sessions-col-modified">Modified</th>
							<th className="sessions-col-created">Created</th>
							<th className="sessions-col-actions">Actions</th>
						</tr>
					</thead>
					<tbody>
						${isCreating && html`
							<tr key="new" className="sessions-modal-row sessions-modal-row-new">
								<td colSpan="3">
									<input
										type="text"
										className="sessions-modal-inline-input"
										value=${newSessionName}
										onChange=${(e) => setNewSessionName(e.target.value)}
										onKeyDown=${(e) => handleKeyDown(undefined, e)}
										onClick=${(e) => e.stopPropagation()}
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
								<td className="sessions-col-name">
									${renamingId == sessionId ? html`
										<input
											type="text"
											className="sessions-modal-inline-input"
											value=${renameSessionName}
											onChange=${(e) => setRenameSessionName(e.target.value)}
											onKeyDown=${(e) => handleKeyDown(+sessionId, e)}
											onClick=${(e) => e.stopPropagation()}
											autoFocus
										/>
									` : html`
										<span className="sessions-modal-name">${session.name}</span>
									`}
								</td>
								<td className="sessions-col-modified">${formatDate(session.modified)}</td>
								<td className="sessions-col-created">${formatDate(session.created)}</td>
								<td className="sessions-col-actions" onClick=${(e) => e.stopPropagation()}>
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
