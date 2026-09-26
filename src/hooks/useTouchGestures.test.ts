import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { useTouchGestures } from './useTouchGestures';

const { gen } = vi.hoisted(() => ({
	gen: {
		promptEditorView: { current: null as null | { dom: HTMLElement } },
		promptEditorVersion: 0,
		cancel: null as null | (() => void),
		setContextMenuState: vi.fn(),
	},
}));

vi.mock('../contexts/GenerationContext', () => ({ useGeneration: () => gen }));

// jsdom defines window.ontouchstart, which is how the hook tells a touch screen.
const touchHandler = Object.getOwnPropertyDescriptor(window, 'ontouchstart')!;

let dom: HTMLElement;

beforeEach(() => {
	vi.clearAllMocks();
	dom = document.createElement('div');
	gen.promptEditorView.current = { dom };
	gen.cancel = null;
});

afterEach(() => {
	cleanup();
});

describe('useTouchGestures on a desktop', () => {
	beforeEach(() => {
		delete (window as { ontouchstart?: unknown }).ontouchstart;
	});

	afterEach(() => {
		Object.defineProperty(window, 'ontouchstart', touchHandler);
	});

	function contextMenu(ctrlKey: boolean) {
		const event = new MouseEvent('contextmenu', { ctrlKey, cancelable: true });
		Object.defineProperties(event, { pageX: { value: 40 }, pageY: { value: 70 } });
		dom.dispatchEvent(event);
		return event;
	}

	it('opens the editor menu on Ctrl+right-click, instead of the browser one', () => {
		renderHook(() => useTouchGestures());

		expect(contextMenu(true).defaultPrevented).toBe(true);
		expect(gen.setContextMenuState).toHaveBeenCalledWith({ visible: true, x: 40, y: 70 });
	});

	it('leaves a plain right-click to the browser', () => {
		renderHook(() => useTouchGestures());

		expect(contextMenu(false).defaultPrevented).toBe(false);
		expect(gen.setContextMenuState).not.toHaveBeenCalled();
	});

	it('shows no menu while generating', () => {
		gen.cancel = vi.fn();
		renderHook(() => useTouchGestures());

		contextMenu(true);

		expect(gen.setContextMenuState).not.toHaveBeenCalled();
	});
});

describe('useTouchGestures on a touch screen', () => {
	const touch = (x: number, y: number) => ({ clientX: x, clientY: y, screenX: x, screenY: y });

	function fire(type: string, touches: ReturnType<typeof touch>[]) {
		const event = new Event(type, { cancelable: true });
		Object.defineProperty(event, 'touches', { value: touches });
		dom.dispatchEvent(event);
		return event;
	}

	it('opens the menu at the lower finger of a two-finger tap', () => {
		renderHook(() => useTouchGestures());
		const upper = touch(10, 100), lower = touch(30, 200);

		fire('touchstart', [upper, lower]);
		fire('touchend', [lower]);
		const lastLift = fire('touchend', []);

		expect(lastLift.defaultPrevented).toBe(true);
		expect(gen.setContextMenuState).toHaveBeenCalledWith({ visible: true, x: 30, y: 200 });
	});

	it('treats two fingers that moved apart as a gesture, not a tap', () => {
		renderHook(() => useTouchGestures());

		fire('touchstart', [touch(10, 100), touch(30, 200)]);
		fire('touchmove', [touch(10, 100), touch(30, 260)]);
		fire('touchend', [touch(10, 100)]);
		fire('touchend', []);

		expect(gen.setContextMenuState).not.toHaveBeenCalled();
	});

	it('ignores a one-finger tap', () => {
		renderHook(() => useTouchGestures());

		fire('touchstart', [touch(10, 100)]);
		fire('touchend', []);

		expect(gen.setContextMenuState).not.toHaveBeenCalled();
	});

	it('ignores two fingers lifted too far apart in time', () => {
		vi.useFakeTimers();
		try {
			renderHook(() => useTouchGestures());

			fire('touchstart', [touch(10, 100), touch(30, 200)]);
			fire('touchend', [touch(30, 200)]);
			vi.advanceTimersByTime(100);
			fire('touchend', []);

			expect(gen.setContextMenuState).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});
});
