import { html } from 'htm/react';
import { useEffect, useRef, useState } from 'react';
import { SVG_Close } from './icons/index';

export function Modal({ isOpen, onClose, title, description, children, ...props }: any) {
	const [internalVisible, setInternalVisible] = useState(isOpen);
	const prevIsOpen = useRef(isOpen);
	const closeTimerRef = useRef<any>(null);
	const isClosing = !isOpen && internalVisible;
	const mouseDownOnBackground = useRef<any>(false);

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
		const onKeyDown = (event: any) => {
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

	const handleOverlayMouseDown = (e: any) => {
		mouseDownOnBackground.current = true;
	};

	const handleOverlayClick = (e: any) => {
		if (mouseDownOnBackground.current) {
			onClose();
		}
		mouseDownOnBackground.current = false;
	};

	return html`
		<div className="modal-overlay ${isClosing ? 'closing' : ''}"
			onMouseDown=${handleOverlayMouseDown}
			onClick=${handleOverlayClick}>
			<div className="modal-container">
				<div className="modal ${isClosing ? 'closing' : ''}"
					onClick=${(e: any) => e.stopPropagation()}
					onMouseDown=${(e: any) => { e.stopPropagation(); mouseDownOnBackground.current = false; }}
					...${props}>
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
