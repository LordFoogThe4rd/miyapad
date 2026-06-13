import { useEffect } from 'react';
import { useGeneration } from '../contexts/GenerationContext';

export function useTouchGestures() {
	const { promptArea, cancel, setContextMenuState } = useGeneration();

	useEffect(() => {
		const element = promptArea.current;
		if (!element) return;

		const isTouchDevice = () => {
			return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
		};

		const showMenu = (x: any, y: any) => {
			if (cancel) return;
			setContextMenuState({
				visible: true,
				x: x,
				y: y,
			});
		};

		if (isTouchDevice()) {
			// This is a smartphone!
			const SWIPE_THRESHOLD = 30; // Max distance fingers can move to be a "tap"
			const TIME_LENIENCY_MS = 50;  // How long to wait for the second finger lift

			let isTwoFingerGesture = false;
			let startTouches: any[] = [];
			let firstTouchEndTime = 0;
			let leniencyTimeout: any = null;

			const resetGestureState = () => {
				isTwoFingerGesture = false;
				startTouches = [];
				firstTouchEndTime = 0;
				clearTimeout(leniencyTimeout);
			};

			const handleTouchStart = (e: any) => {
				if (e.touches.length === 2) {
					isTwoFingerGesture = true;
					startTouches = [e.touches[0], e.touches[1]];
				} else {
					resetGestureState();
				}
			};

			const handleTouchMove = (e: any) => {
				if (!isTwoFingerGesture) return;

				// Cancel gesture if fingers move too far
				const movedTooFar = startTouches.some((startTouch, index) => {
					const currentTouch = e.touches[index];
					return (
						Math.abs(currentTouch.screenX - startTouch.screenX) > SWIPE_THRESHOLD ||
						Math.abs(currentTouch.screenY - startTouch.screenY) > SWIPE_THRESHOLD
					);
				});

				if (movedTooFar) {
					resetGestureState();
				}
			};

			const handleTouchEnd = (e: any) => {
				if (!isTwoFingerGesture) return;

				if (e.touches.length === 1) {
					firstTouchEndTime = Date.now();
					// Wait for the second finger
					leniencyTimeout = setTimeout(resetGestureState, TIME_LENIENCY_MS);
				} else if (e.touches.length === 0 && firstTouchEndTime > 0) {
					const timeDifference = Date.now() - firstTouchEndTime;

					if (timeDifference <= TIME_LENIENCY_MS) {
						// Success! a two-finger tap was detected
						e.preventDefault();
						clearTimeout(leniencyTimeout);

						const lowerTouch = startTouches[0].clientY > startTouches[1].clientY
							? startTouches[0]
							: startTouches[1];

						showMenu(lowerTouch.clientX, lowerTouch.clientY);
					}

					// Gesture is complete.
					resetGestureState();
				}
			};

			element.addEventListener('touchstart', handleTouchStart);
			element.addEventListener('touchmove', handleTouchMove);
			element.addEventListener('touchend', handleTouchEnd);

			return () => {
				element.removeEventListener('touchstart', handleTouchStart);
				element.removeEventListener('touchmove', handleTouchMove);
				element.removeEventListener('touchend', handleTouchEnd);
				clearTimeout(leniencyTimeout);
			};
		} else {
			// This is a desktop!
			const handleContextMenu = (e: any) => {
				if (e.ctrlKey) {
					e.preventDefault();
					showMenu(e.pageX, e.pageY);
				}
			};

			element.addEventListener('contextmenu', handleContextMenu);

			return () => {
				element.removeEventListener('contextmenu', handleContextMenu);
			};
		}
	}, [promptArea, cancel, setContextMenuState]);
}
