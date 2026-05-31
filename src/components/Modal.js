import { html } from 'htm/react';
import { useEffect, useRef, useState } from 'react';
import { SVG_Close } from './icons/index.js';

export function Modal({ isOpen, onClose, title, description, children, ...props }) {
	const [internalVisible, setInternalVisible] = useState(isOpen);
	const prevIsOpen = useRef(isOpen);
	const closeTimerRef = useRef(null);
	const isClosing = !isOpen && internalVisible;

	useEffect(() => {
		if (isOpen) {
			if (closeTimerRef.current) {
				clearTimeout(closeTimerRef.current);
				closeTimerRef.current = null;
			}
			setInternalVisible(true);
		} else if (prevIsOpen.current) {
			closeTimerRef.current = setTimeout(() => {
				setInternalVisible(false);
				closeTimerRef.current = null;
			}, 150);
		}
		prevIsOpen.current = isOpen;
		return () => {
			if (closeTimerRef.current) {
				clearTimeout(closeTimerRef.current);
				closeTimerRef.current = null;
			}
		};
	}, [isOpen]);

	useEffect(() => {
		if (!isOpen) return;
		const onKeyDown = (event) => {
			if (event.key === 'Escape') {
				onClose();
			}
		};
		document.addEventListener('keydown', onKeyDown);
		return () => {
			document.removeEventListener('keydown', onKeyDown);
		};
	}, [isOpen]);

	if (!internalVisible) {
		return null;
	}

	return html`
		<div className="modal-overlay ${isClosing ? 'closing' : ''}" onClick=${onClose}>
			<div className="modal-container">
				<div className="modal ${isClosing ? 'closing' : ''}" onClick=${(e) => e.stopPropagation()} ...${props}>
					<div class="modal-title">${title}</div>
					${ description=="" ? false : html`<div style=${{ whiteSpace: 'pre-line' }} class='modal-desc'>${description}</div>` }
					<hr/>
					<div className="modal-content">
						${children}
					</div>
					<button
					class="button-modal-top"
					onClick=${onClose}>
						<${SVG_Close}/>
					</button>
				</div>
			</div>
		</div>`;
}
