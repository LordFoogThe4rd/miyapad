import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginEventBus } from './events';
import { clearPluginRuntimeError, getPluginRuntimeErrors } from '../plugins';

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	clearPluginRuntimeError();
	vi.restoreAllMocks();
});

describe('PluginEventBus', () => {
	it('fires ready once for listeners registered before emitReady and on a microtask for late listeners', async () => {
		const bus = new PluginEventBus();
		const early = vi.fn();
		const late = vi.fn();
		const events = bus.forPlugin('alpha');

		events.on('ready', early);
		expect(early).not.toHaveBeenCalled();

		bus.emitReady();
		expect(early).toHaveBeenCalledTimes(1);

		// Idempotent: a second emitReady does nothing.
		bus.emitReady();
		expect(early).toHaveBeenCalledTimes(1);

		// Subscribing after ready fires asynchronously on a microtask.
		events.on('ready', late);
		expect(late).not.toHaveBeenCalled();
		await Promise.resolve();
		expect(late).toHaveBeenCalledTimes(1);
	});

	it('cancels a late ready listener if off() is called synchronously before the microtask runs', async () => {
		const bus = new PluginEventBus();
		const fn = vi.fn();
		const events = bus.forPlugin('alpha');

		bus.emitReady();
		events.on('ready', fn);
		events.off('ready', fn);
		await Promise.resolve();
		expect(fn).not.toHaveBeenCalled();
	});

	it('supports once() and off() for repeated events', () => {
		const bus = new PluginEventBus();
		const events = bus.forPlugin('alpha');
		const always = vi.fn();
		const onceOnly = vi.fn();
		const removedBeforeFire = vi.fn();

		events.on('sessionChange', always);
		events.once('sessionChange', onceOnly);
		events.once('sessionChange', removedBeforeFire);
		events.off('sessionChange', removedBeforeFire);

		bus.emit('sessionChange', { sessionId: 1 });
		bus.emit('sessionChange', { sessionId: 2 });

		expect(always).toHaveBeenCalledTimes(2);
		expect(always).toHaveBeenNthCalledWith(1, { sessionId: 1 });
		expect(always).toHaveBeenNthCalledWith(2, { sessionId: 2 });
		expect(onceOnly).toHaveBeenCalledTimes(1);
		expect(onceOnly).toHaveBeenCalledWith({ sessionId: 1 });
		expect(removedBeforeFire).not.toHaveBeenCalled();

		events.off('sessionChange', always);
		bus.emit('sessionChange', { sessionId: 3 });
		expect(always).toHaveBeenCalledTimes(2);
	});

	it('scopes off() to the owning plugin id', () => {
		const bus = new PluginEventBus();
		const sharedFn = vi.fn();
		bus.forPlugin('a').on('sessionChange', sharedFn);
		bus.forPlugin('b').off('sessionChange', sharedFn);

		bus.emit('sessionChange', { sessionId: 4 });
		expect(sharedFn).toHaveBeenCalledTimes(1);
	});

	it('catches throwing and rejecting listeners, logs under plugin id, and keeps calling later listeners', async () => {
		const bus = new PluginEventBus();
		const after = vi.fn();

		bus.forPlugin('broken-sync').on('generationStart', () => {
			throw new Error('sync boom');
		});
		bus.forPlugin('broken-async').on('generationStart', () => {
			return Promise.reject(new Error('async boom')) as unknown as void;
		});
		bus.forPlugin('healthy').on('generationStart', after);

		bus.emit('generationStart', { mode: 'completion', sessionId: 7 });
		await Promise.resolve();

		expect(after).toHaveBeenCalledWith({ mode: 'completion', sessionId: 7 });
		expect(getPluginRuntimeErrors()).toEqual({
			'broken-sync': 'Error: sync boom',
			'broken-async': 'Error: async boom',
		});
		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining('[plugins] "broken-sync":'),
			expect.any(Error),
		);
		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining('[plugins] "broken-async":'),
			expect.any(Error),
		);
	});

	it('rejects non-function listeners with TypeError', () => {
		const bus = new PluginEventBus();
		expect(() => bus.forPlugin('p').on('ready', null as unknown as () => void)).toThrow(TypeError);
		expect(() => bus.forPlugin('p').once('sessionChange', 123 as unknown as () => void)).toThrow(TypeError);
	});
});
