import { useEffect, useRef, type RefObject } from 'react';

/**
 * Gives focus back, when `isOpen` turns off, to whatever had it when it turned on. Unless something
 * else has taken focus by then, like the dialog opened next, rather than it being left in `container`
 * or on the page.
 */
export function useReturnFocus(isOpen: boolean, container: RefObject<HTMLElement | null>): void {
	const returnFocus = useRef<Element | null>(null);

	useEffect(() => {
		if (isOpen) {
			returnFocus.current = document.activeElement;
			return;
		}
		const back = returnFocus.current;
		returnFocus.current = null;
		const active = document.activeElement;
		if (back instanceof HTMLElement && back.isConnected && (!active || active === document.body || container.current?.contains(active)))
			back.focus();
	}, [isOpen]);
}
