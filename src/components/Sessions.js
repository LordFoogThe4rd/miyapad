import { html } from 'htm/react';
import { useState, useEffect } from 'react';
import { SVG_Confirm, SVG_Cancel, SVG_Rename, SVG_Trash } from './icons/index.js';
import { exportText } from '../api/common.js';

export function Sessions({ sessionStorage, disabled }) {
	const [version, setVersion] = useState(0);
	const [newSessionName, setNewSessionName] = useState('');
	const [renameSessionName, setRenameSessionName] = useState('');
	const [renamingId, setRenamingId] = useState(undefined);
	const [isCreating, setIsCreating] = useState(false);

	useEffect(() => {
		const incrementVersion = () => setVersion(v => v + 1);
		sessionStorage.addEventListener('change', incrementVersion);
		return () => sessionStorage.removeEventListener('change', incrementVersion);
	}, []);

	const switchSession = async (sessionId) => {
		if (sessionStorage.selectedSession != sessionId) {
			await sessionStorage.switchSession(sessionId);
		}
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
			// This is done for compatibility with localStorage export files.
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
			// This is done for compatibility with localStorage export files.
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
			if (isCreating)
				setIsCreating(false);
			else if (renamingId !== undefined)
				setRenamingId(undefined);
		}
	}

	return html`
		<div className="Sessions ${disabled ? 'disabled' : ''}">
			<ul>
				${isCreating && html`
					<li key=-1>
						<a className="Session">
							<input
								type="text"
								value=${newSessionName}
								onChange=${(e) => setNewSessionName(e.target.value)}
								onKeyDown=${(e) => handleKeyDown(undefined, e)}
								onClick=${(e) => e.stopPropagation()}
								autoFocus
							/>
							<div className="flex-separator"></div>
							<button onClick=${(e) => (createSession(), e.stopPropagation())}><${SVG_Confirm}/></button>
							<button onClick=${(e) => (setIsCreating(false), e.stopPropagation())}><${SVG_Cancel}/></button>
						</a>
					</li>
				`}
				${Object.entries(sessionStorage.sessions).reverse().map(([sessionId, session]) => html`
					<li key=${sessionId}>
						<a className="Session ${sessionStorage.selectedSession == sessionId ? 'selected' : ''}"
						onClick=${() => switchSession(+sessionId)}>
							${renamingId == sessionId ? html`
								<input
									type="text"
									value=${renameSessionName}
									onChange=${(e) => setRenameSessionName(e.target.value)}
									onKeyDown=${(e) => handleKeyDown(+sessionId, e)}
									onClick=${(e) => e.stopPropagation()}
									autoFocus
								/>
								<div className="flex-separator"></div>
								<button onClick=${(e) => (renameSession(+sessionId), e.stopPropagation())}><${SVG_Confirm}/></button>
								<button onClick=${(e) => (setRenamingId(undefined), e.stopPropagation())}><${SVG_Cancel}/></button>
							` : html`
								${session.name}
								<div className="flex-separator"></div>
								<button
									onClick=${(e) => (startRenameSession(+sessionId, session.name), e.stopPropagation())}>
									<${SVG_Rename}/>
								</button>
								<button
									onClick=${(e) => (deleteSession(+sessionId), e.stopPropagation())}>
									<${SVG_Trash}/>
								</button>
							`}
						</a>
					</li>
				`)}
			</ul>
			<div className="vbox">
				<button disabled=${disabled} onClick=${startCreateSession}>Create</button>
				<button disabled=${disabled} onClick=${importSession}>Import</button>
				<button disabled=${disabled} onClick=${exportSession}>Export</button>
				<button disabled=${disabled} onClick=${exportAll}>Export All</button>
				<button disabled=${disabled} onClick=${cloneSession}>Clone</button>
			</div>
		</div>`;
}
