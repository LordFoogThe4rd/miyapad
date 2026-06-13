import { html } from 'htm/react';
import { useState, useEffect, useMemo, useRef } from 'react';
import { SVG_Star } from './icons/index';

export function QuickSwitcher({ isOpen, closeModal, sessionStorage, cancel }) {
	const [query, setQuery] = useState('');
	const [selectedIndex, setSelectedIndex] = useState(-1);
	const inputRef = useRef(null);
	const [version, setVersion] = useState(0);

	useEffect(() => {
		const incrementVersion = () => setVersion(v => v + 1);
		sessionStorage.addEventListener('change', incrementVersion);
		return () => sessionStorage.removeEventListener('change', incrementVersion);
	}, []);

	useEffect(() => {
		if (isOpen) {
			setQuery('');
			setSelectedIndex(-1);
			setTimeout(() => inputRef.current?.focus(), 0);
		}
	}, [isOpen]);

	const results = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return [];
		return (Object.entries(sessionStorage.sessions) as [string, SessionData][])
			.filter(([_, s]) => (s.name || '').toLowerCase().includes(q))
			.map(([id, s]) => ({ id: +id, name: s.name, pinned: !!s.pinned }))
			.sort((a, b) => {
				if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
				return (a.name || '').localeCompare(b.name || '');
			});
	}, [query, version, sessionStorage.sessions]);

	const disabled = !!cancel;

	function handleKeyDown(e) {
		if (disabled) return;
		e.stopPropagation();

		switch (e.key) {
			case 'ArrowUp':
				e.preventDefault();
				if (results.length > 0) {
					setSelectedIndex(i => Math.max(0, i - 1));
				}
				break;
			case 'ArrowDown':
				e.preventDefault();
				if (results.length > 0) {
					setSelectedIndex(i => {
						if (i < 0) return 0;
						return Math.min(results.length - 1, i + 1);
					});
				}
				break;
			case 'Enter':
				e.preventDefault();
				if (selectedIndex >= 0 && selectedIndex < results.length) {
					const sessionId = results[selectedIndex].id;
					sessionStorage.switchSession(sessionId).then(() => closeModal());
				}
				break;
			case 'Escape':
				e.preventDefault();
				closeModal();
				break;
		}
	}

	if (!isOpen) return null;

	return html`
		<div className="quick-switcher-overlay" onClick=${closeModal}>
			<div className="quick-switcher-panel" onClick=${(e) => e.stopPropagation()}>
				<input
					ref=${inputRef}
					className="quick-switcher-input"
					type="text"
					placeholder="Search sessions…"
					value=${query}
					onChange=${(e) => { setQuery(e.target.value); setSelectedIndex(-1); }}
					onKeyDown=${handleKeyDown}
					disabled=${disabled}
				/>
				<div className="quick-switcher-list">
					${results.length === 0 ? html`
						<div className="quick-switcher-empty">No sessions found</div>
					` : results.map((session, i) => html`
						<div
							key=${session.id}
							className="quick-switcher-item ${i === selectedIndex ? 'selected' : ''}"
							onMouseDown=${() => {
								if (!disabled) {
									sessionStorage.switchSession(session.id).then(() => closeModal());
								}
							}}
						>${session.pinned ? html`<span className="quick-switcher-star"><${SVG_Star}/></span>` : ''}${session.name}</div>
					`)}
				</div>
			</div>
		</div>`;
}
