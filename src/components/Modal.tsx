import { html } from 'htm/react';
import { useEffect, useRef, useState } from 'react';
import type { ModalProps } from '../types/components';
import { SVG_Close } from './icons/index';

export function Modal({
	isOpen,
	onClose,
	title,
	description,
	children,
	...props
}: ModalProps & Omit<React.HTMLAttributes<HTMLDivElement>, keyof ModalProps>) {
	const [internalVisible, setInternalVisible] = useState(isOpen);
	const prevIsOpen = useRef(isOpen);
	const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const isClosing = !isOpen && internalVisible;
	const mouseDownOnBackground = useRef<boolean>(false);

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
		const onKeyDown = (event: KeyboardEvent) => {
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

	const handleOverlayMouseDown = (e: React.MouseEvent) => {
		mouseDownOnBackground.current = true;
	};

	const handleOverlayClick = (e: React.MouseEvent) => {
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
					onClick=${(e: React.MouseEvent) => e.stopPropagation()}
					onMouseDown=${(e: React.MouseEvent) => { e.stopPropagation(); mouseDownOnBackground.current = false; }}
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
