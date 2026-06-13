import { html } from 'htm/react';
import { useState, useEffect, useRef } from 'react';

export function EditorContextMenu({ isOpen, closeMenu, menuItems, className, ...props }) {
	const menuRef = useRef(null);
	const [subMenuOpen, setSubMenuOpen] = useState(null);

	if (className == 'nested') {
		useEffect(() => {
			if (menuRef.current) {
				const rect = menuRef.current.getBoundingClientRect();
				let newTop = rect.top;
				let newLeft = rect.left;

				// Check for overflow on the bottom
				if (rect.bottom > window.innerHeight) {
					newTop = window.innerHeight - rect.height; // Move menu up
				}

				// Check for overflow on the right
				if (rect.right > window.innerWidth) {
					newLeft = window.innerWidth - rect.width; // Move menu to the left
				}

				newTop = -4 + newTop - rect.top;
				newLeft = 210 + newLeft - rect.left;

				// Apply corrected positions
				menuRef.current.style.top = `${newTop}px`;
				menuRef.current.style.left = `${newLeft}px`;
			}
		}, [isOpen]);
	} else {
		let prevCloseMenu = closeMenu;
		closeMenu = () => { setSubMenuOpen(null); prevCloseMenu(); };

		// Close the menu when clicking outside of it
		useEffect(() => {
			const handleClickOutside = (e) => {
				if (!isOpen)
					return;
				if (menuRef.current && !menuRef.current.contains(e.target)) {
					closeMenu();
				}
			}
			document.addEventListener('mousedown', handleClickOutside);
			return () => document.removeEventListener('mousedown', handleClickOutside);
		}, [isOpen]);

		useEffect(() => {
			if (!props.y)
				return;
			if (menuRef.current) {
				const rect = menuRef.current.getBoundingClientRect();
				let newTop = props.y;
				let newLeft = props.x;

				// Check for overflow on the bottom
				if (rect.bottom > window.innerHeight) {
					newTop = Math.max(newTop - rect.height, 0); // Move menu up
				}

				// Check for overflow on the right
				if (rect.right > window.innerWidth) {
					newLeft = Math.max(newLeft - rect.width, 0); // Move menu to the left
				}

				// Apply corrected positions
				menuRef.current.style.top = `${newTop}px`;
				props.y = newTop;
				menuRef.current.style.left = `${newLeft}px`;
				props.x = newLeft;
			}
		}, [props.x, props.y]);
	}

	return html`
		<div
			ref=${menuRef}
			className="EditorContextMenu ${className || ''}"
			style=${{
				...(isOpen ? { display: 'block' } : {}),
                ...(props.y ? { top: props.y + 'px' } : {}),
                ...(props.x ? { left: props.x + 'px' } : {})
			}}>
			<ul>
				${menuItems.map(
					(item) => html`
						<li
							className="MenuItem ${item.disabled ? 'disabled' : ''} ${item.subItems ? 'hasSubItems' : ''}"
							onClick=${(event) => {
								if (item.action && !item.disabled && !item.subItems) {
									item.action();
									closeMenu();
									event.stopPropagation();
								}
							}}
							onMouseEnter=${(event) => {
								setSubMenuOpen(null);
								if (item.subItems && !item.disabled) {
									setSubMenuOpen(item.label);
								}
							}}>
							${item.label}
							${item.subItems
								? html`
									<span className="arrow">→</span>
									${EditorContextMenu({
										isOpen: item.label === subMenuOpen,
										menuItems: item.subItems,
										closeMenu: closeMenu,
										className: 'nested',
									})}`
								: ''}
						</li>
					`
				)}
			</ul>
		</div>
	`;
}
