import { html } from 'htm/react';
import { useState, useEffect, useMemo, useRef, useId } from 'react';
import { useT } from '../i18n';
import { useReturnFocus } from '../hooks/useReturnFocus';
import { SVG_Star } from './icons/index';
import type { QuickSwitcherProps } from '../types/components';

interface Row {
	key: string;
	label: string;
	pinned?: boolean;
	disabled: boolean;
	run: () => void;
}

export function QuickSwitcher({ isOpen, closeModal, sessionStorage, cancel, commands }: QuickSwitcherProps) {
	const t = useT();
	const [query, setQuery] = useState('');
	const [selectedIndex, setSelectedIndex] = useState(-1);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const listRef = useRef<HTMLDivElement | null>(null);
	const listId = useId();
	const [version, setVersion] = useState(0);
	useReturnFocus(!!isOpen, inputRef);

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

	useEffect(() => {
		listRef.current?.children[selectedIndex]?.scrollIntoView?.({ block: 'nearest' });
	}, [selectedIndex]);

	const commandMode = query.trimStart().startsWith('>');

	const results = useMemo((): Row[] => {
		if (commandMode) {
			const q = query.trimStart().slice(1).trim().toLowerCase();
			return commands
				.filter(c => c.label.toLowerCase().includes(q))
				.map(c => ({
					key: c.label,
					label: c.label,
					disabled: c.disabled,
					// Closed first: a command may open another modal or run a whole generation.
					run: () => { closeModal(); c.action?.(); },
				}));
		}
		const q = query.trim().toLowerCase();
		if (!q) return [];
		return (Object.entries(sessionStorage.sessions) as [string, SessionData][])
			.filter(([_, s]) => (s.name || '').toLowerCase().includes(q))
			.map(([id, s]) => ({ id: +id, name: s.name, pinned: !!s.pinned }))
			.sort((a, b) => {
				if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
				return (a.name || '').localeCompare(b.name || '');
			})
			.map(s => ({
				key: String(s.id),
				label: s.name || '',
				pinned: s.pinned,
				disabled: !!cancel,
				run: () => { sessionStorage.switchSession(s.id).then(() => closeModal()); },
			}));
	}, [query, version, sessionStorage.sessions, commands, cancel]);

	function pick(row: Row | undefined) {
		if (row && !row.disabled) row.run();
	}

	function handleKeyDown(e: any) {
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
				pick(results[selectedIndex]);
				break;
			case 'Escape':
				e.preventDefault();
				closeModal();
				break;
			// The box is all there is to focus, and Tab would carry on into the page behind.
			case 'Tab':
				e.preventDefault();
				break;
		}
	}

	if (!isOpen) return null;

	return html`
		<div className="quick-switcher-overlay" onClick=${closeModal}>
			<div className="quick-switcher-panel"
				role="dialog"
				aria-modal="true"
				aria-label=${t('quickSwitcher.title')}
				onClick=${(e: any) => e.stopPropagation()}>
				<input
					ref=${inputRef}
					className="quick-switcher-input"
					type="text"
					role="combobox"
					aria-autocomplete="list"
					aria-expanded=${results.length > 0}
					aria-controls=${listId}
					aria-activedescendant=${results[selectedIndex] ? `${listId}-${selectedIndex}` : undefined}
					placeholder=${t('quickSwitcher.searchPlaceholder')}
					value=${query}
					onChange=${(e: any) => { setQuery(e.target.value); setSelectedIndex(-1); }}
					onKeyDown=${handleKeyDown}
				/>
				<div ref=${listRef} id=${listId} role="listbox" className="quick-switcher-list">
					${results.map((row, i) => html`
						<div
							key=${row.key}
							id=${`${listId}-${i}`}
							role="option"
							aria-selected=${i === selectedIndex}
							className="quick-switcher-item ${i === selectedIndex ? 'selected' : ''} ${row.disabled ? 'disabled' : ''}"
							aria-disabled=${row.disabled}
							onMouseDown=${() => pick(row)}
						>${row.pinned ? html`<span className="quick-switcher-star"><${SVG_Star}/></span>` : ''}${row.label}</div>
					`)}
				</div>
				${results.length === 0 && html`
					<div className="quick-switcher-empty">${t(commandMode ? 'quickSwitcher.noCommands' : 'quickSwitcher.noSessions')}</div>`}
			</div>
		</div>`;
}
