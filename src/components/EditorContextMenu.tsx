import { html } from 'htm/react';
import { useState, useEffect, useRef, useCallback } from 'react';
import type { EditorContextMenuProps } from '../types/components';

export function EditorContextMenu({ isOpen, closeMenu, menuItems, className, ...props }: EditorContextMenuProps) {
	const menuRef = useRef<HTMLDivElement | null>(null);
	const [subMenuOpen, setSubMenuOpen] = useState<string | null>(null);
	const isNested = className === 'nested';

	const handleClose = useCallback(() => {
		if (!isNested) setSubMenuOpen(null);
		closeMenu();
	}, [closeMenu, isNested]);

	useEffect(() => {
		if (!isNested)
			return;
		if (menuRef.current) {
			const rect = menuRef.current.getBoundingClientRect();
			let newTop = rect.top;
			let newLeft = rect.left;

			if (rect.bottom > window.innerHeight)
				newTop = window.innerHeight - rect.height;

			if (rect.right > window.innerWidth)
				newLeft = window.innerWidth - rect.width;

			newTop = -4 + newTop - rect.top;
			newLeft = 210 + newLeft - rect.left;

			menuRef.current.style.top = `${newTop}px`;
			menuRef.current.style.left = `${newLeft}px`;
		}
	}, [isOpen]);

	useEffect(() => {
		if (isNested)
			return;
		const handleClickOutside = (e: any) => {
			if (!isOpen)
				return;
			if (menuRef.current && !menuRef.current.contains(e.target))
				handleClose();
		};
		document.addEventListener('mousedown', handleClickOutside);
		return () => document.removeEventListener('mousedown', handleClickOutside);
	}, [isOpen, handleClose]);

	useEffect(() => {
		if (isNested)
			return;
		if (props.y === undefined)
			return;
		if (menuRef.current) {
			const rect = menuRef.current.getBoundingClientRect();
			let newTop = props.y;
			let newLeft = props.x ?? 0;

			if (rect.bottom > window.innerHeight)
				newTop = Math.max(newTop - rect.height, 0);

			if (rect.right > window.innerWidth)
				newLeft = Math.max(newLeft - rect.width, 0);

			menuRef.current.style.top = `${newTop}px`;
			menuRef.current.style.left = `${newLeft}px`;
		}
	}, [props.x, props.y]);

	return html`
		<div
			ref=${menuRef}
			className="EditorContextMenu ${className || ''}"
			style=${{
				...(isOpen ? { display: 'block' } : {}),
                ...(props.y !== undefined ? { top: props.y + 'px' } : {}),
                ...(props.x !== undefined ? { left: props.x + 'px' } : {})
			}}>
			<ul>
				${menuItems.map(
					(item: any) => html`
						<li
							className="MenuItem ${item.disabled ? 'disabled' : ''} ${item.subItems ? 'hasSubItems' : ''}"
							onClick=${(event: any) => {
								if (item.action && !item.disabled && !item.subItems) {
									item.action();
									handleClose();
									event.stopPropagation();
								}
							}}
							onMouseEnter=${(event: any) => {
								setSubMenuOpen(null);
								if (item.subItems && !item.disabled)
									setSubMenuOpen(item.label);
							}}>
							${item.label}
							${item.subItems
								? html`
									<span className="arrow">→</span>
									<${EditorContextMenu}
										isOpen=${item.label === subMenuOpen}
										menuItems=${item.subItems}
										closeMenu=${handleClose}
										className="nested"
									/>`
								: ''}
						</li>
					`
				)}
			</ul>
		</div>
	`;
}
