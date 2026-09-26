import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, fireEvent, cleanup } from '@testing-library/react';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

const { gen, logic, tts } = vi.hoisted(() => ({
	gen: {
		modalState: {} as Record<string, boolean>,
		keyState: { current: {} as Record<string, boolean> },
		cancel: null as null | (() => void),
		toggleModal: vi.fn(),
	},
	logic: { predict: vi.fn(), undoAndPredict: vi.fn(), undo: vi.fn(), redo: vi.fn() },
	tts: { ttsStop: vi.fn() },
}));

vi.mock('../contexts/GenerationContext', () => ({ useGeneration: () => gen }));
vi.mock('./useGenerationLogic', () => ({ useGenerationLogic: () => logic }));
vi.mock('./useTTS', () => ({ useTTS: () => tts }));

/** Presses a key on the window; true when the shortcut kept the browser's own action. */
function press(key: string, modifiers: { ctrlKey?: boolean; shiftKey?: boolean; metaKey?: boolean; altKey?: boolean } = {}) {
	return fireEvent.keyDown(window, { key, ...modifiers });
}

beforeEach(() => {
	vi.clearAllMocks();
	gen.modalState = {};
	gen.keyState.current = {};
	gen.cancel = null;
	logic.undo.mockReturnValue(true);
	logic.redo.mockReturnValue(true);
	renderHook(() => useKeyboardShortcuts());
});

afterEach(() => {
	cleanup();
});

describe('useKeyboardShortcuts', () => {
	it('predicts on Ctrl+Enter and Shift+Enter, instead of adding a newline', () => {
		expect(press('Enter', { ctrlKey: true })).toBe(false);
		expect(press('Enter', { shiftKey: true })).toBe(false);
		expect(logic.predict).toHaveBeenCalledTimes(2);
	});

	it('leaves a plain Enter and ordinary typing alone', () => {
		expect(press('Enter')).toBe(true);
		expect(press('r')).toBe(true);
		expect(logic.predict).not.toHaveBeenCalled();
		expect(logic.undoAndPredict).not.toHaveBeenCalled();
	});

	it('cancels a generation on Escape', () => {
		gen.cancel = vi.fn();
		cleanup();
		renderHook(() => useKeyboardShortcuts());

		press('Escape');

		expect(gen.cancel).toHaveBeenCalledOnce();
	});

	it('undoes on Ctrl+Z, stopping a generation first', () => {
		gen.cancel = vi.fn();
		cleanup();
		renderHook(() => useKeyboardShortcuts());

		expect(press('z', { ctrlKey: true })).toBe(false);

		expect(gen.cancel).toHaveBeenCalledOnce();
		expect(logic.undo).toHaveBeenCalledOnce();
	});

	it('lets the editor undo on its own when there is nothing of ours to undo', () => {
		logic.undo.mockReturnValue(false);

		expect(press('z', { ctrlKey: true })).toBe(true);
	});

	it('redoes on Ctrl+Shift+Z and Ctrl+Y', () => {
		press('Z', { ctrlKey: true, shiftKey: true });
		press('y', { ctrlKey: true });

		expect(logic.redo).toHaveBeenCalledTimes(2);
	});

	it('undoes and predicts again on Ctrl+R, instead of reloading the page', () => {
		expect(press('r', { ctrlKey: true })).toBe(false);
		expect(logic.undoAndPredict).toHaveBeenCalledOnce();
	});

	it('stops speech on Ctrl+E', () => {
		press('e', { ctrlKey: true });
		expect(tts.ttsStop).toHaveBeenCalledOnce();
	});

	it('opens search on Ctrl+F and the quick switcher on Ctrl+P or Cmd+P', () => {
		press('f', { ctrlKey: true });
		press('p', { ctrlKey: true });
		press('p', { metaKey: true });

		expect(gen.toggleModal.mock.calls).toEqual([['searchAndReplace'], ['quickSwitcher'], ['quickSwitcher']]);
	});

	it('keeps the browser\'s own Ctrl+ArrowRight', () => {
		expect(press('ArrowRight', { ctrlKey: true })).toBe(true);
	});

	it('does nothing while a modal is open', () => {
		gen.modalState = { settings: true };
		cleanup();
		renderHook(() => useKeyboardShortcuts());

		expect(press('Enter', { ctrlKey: true })).toBe(true);
		expect(logic.predict).not.toHaveBeenCalled();
	});

	it('does nothing for a key something else already handled', () => {
		const event = new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, cancelable: true });
		event.preventDefault();
		window.dispatchEvent(event);

		expect(logic.predict).not.toHaveBeenCalled();
	});

	it('tracks which keys are held, and forgets them all when the window loses focus', () => {
		press('Shift', { shiftKey: true });
		press('a');
		expect(gen.keyState.current).toEqual({ Shift: true, a: true });

		fireEvent.keyUp(window, { key: 'a' });
		expect(gen.keyState.current).toEqual({ Shift: true });

		fireEvent.blur(window);
		expect(gen.keyState.current).toEqual({});
	});
});
