import { html } from 'htm/react';
import { useEffect, useId, useRef, useState } from 'react';
import type { ModalProps } from '../types/components';
import { SVG_Close } from './icons/index';
import { useT } from '../i18n';

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export function Modal({
	isOpen,
	onClose,
	title,
	description,
	children,
	onKeyDown,
	...props
}: ModalProps & Omit<React.HTMLAttributes<HTMLDivElement>, keyof ModalProps>) {
	const [internalVisible, setInternalVisible] = useState(isOpen);
	const prevIsOpen = useRef(isOpen);
	const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const isClosing = !isOpen && internalVisible;
	const mouseDownOnBackground = useRef<boolean>(false);
	const modalRef = useRef<HTMLDivElement>(null);
	/** What had focus before the modal opened, to give it back on close. */
	const returnFocus = useRef<Element | null>(null);
	const titleId = useId();
	const t = useT();

	useEffect(() => {
		if (isOpen) {
			returnFocus.current = document.activeElement;
			return;
		}
		const back = returnFocus.current;
		returnFocus.current = null;
		// Unless something else took focus already, like the modal opened next.
		const active = document.activeElement;
		if (back instanceof HTMLElement && back.isConnected && (!active || active === document.body || modalRef.current?.contains(active)))
			back.focus();
	}, [isOpen]);

	// The modal mounts a render after it opens. A field inside with autoFocus has focus by then; otherwise the modal takes it.
	useEffect(() => {
		if (isOpen && internalVisible && !modalRef.current?.contains(document.activeElement))
			modalRef.current?.focus();
	}, [isOpen, internalVisible]);

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
		// Only the modal on top closes, so one opened over another leaves that one for the next Escape. Modals share
		// a z-index, so the one on top is the last open in the page. Handling it tells the rest, and the shortcuts, to leave it.
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape' || event.defaultPrevented || [...document.querySelectorAll('.modal:not(.closing)')].at(-1) !== modalRef.current)
				return;
			event.preventDefault();
			onClose();
		};
		document.addEventListener('keydown', onKeyDown);
		return () => document.removeEventListener('keydown', onKeyDown);
	}, [isOpen]);

	if (!internalVisible) {
		return null;
	}

	// Presses inside the box bubble on to the document, where menus in it listen for a press outside themselves to close.
	const handleOverlayMouseDown = (e: React.MouseEvent) => {
		mouseDownOnBackground.current = !modalRef.current?.contains(e.target as Node);
	};

	/** Keeps Tab inside the modal, so it never walks the page behind the overlay. */
	const trapTab = (e: React.KeyboardEvent) => {
		if (e.key !== 'Tab' || !modalRef.current) return;
		const focusable = [...modalRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => el.getClientRects().length);
		const first = focusable[0];
		const last = focusable.at(-1);
		if (!first || !last) {
			e.preventDefault();
			return;
		}
		const active = document.activeElement;
		if (e.shiftKey && (active === first || active === modalRef.current)) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && active === last) {
			e.preventDefault();
			first.focus();
		}
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
					ref=${modalRef}
					role="dialog"
					aria-modal="true"
					aria-labelledby=${titleId}
					tabIndex="-1"
					onKeyDown=${(e: React.KeyboardEvent<HTMLDivElement>) => { trapTab(e); onKeyDown?.(e); }}
					onClick=${(e: React.MouseEvent) => e.stopPropagation()}
					...${props}>
					<div className="modal-title" id=${titleId}>${title}</div>
					${ description=="" ? false : html`<div style=${{ whiteSpace: 'pre-line' }} className='modal-desc'>${description}</div>` }
					<hr/>
					<div className="modal-content">
						${children}
					</div>
					<button
					className="button-modal-top"
					aria-label=${t('modals.close')}
					onClick=${onClose}>
						<${SVG_Close}/>
					</button>
				</div>
			</div>
		</div>`;
}
