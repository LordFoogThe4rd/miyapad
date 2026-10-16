import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { html } from 'htm/react';
import { ContextModal } from './ContextModal';
import type { SessionStorage } from '../../storage/SessionStorage';

vi.mock('../../api/index', () => ({
	getTokenCount: vi.fn().mockResolvedValue(0),
	serverTokenCount: vi.fn().mockResolvedValue(0),
}));

afterEach(cleanup);

const memoryTokens: MemoryTokensData = { contextOrder: '', prefix: '', text: '', suffix: '' };

const view = (previewWithPlugins: () => Promise<string>) => html`
	<${ContextModal}
		isOpen=${true}
		closeModal=${() => {}}
		tokens=${5}
		memoryTokens=${memoryTokens}
		memoryTokenCount=${1}
		worldInfoTokenCount=${1}
		authorNoteTokenCount=${1}
		handleMemoryTokensChange=${() => {}}
		finalPromptText=${'raw'}
		previewWithPlugins=${previewWithPlugins}
		defaultPresets=${{ memoryTokens } as DefaultPresets}
		cancel=${null}
		apiConfig=${{ sessionStorage: {} as SessionStorage, endpoint: '', endpointAPI: 0, endpointAPIKey: '', isMiyapadEndpoint: false, useServerTokenization: false }}/>`;

const area = (container: HTMLElement) => container.querySelector<HTMLTextAreaElement>('#context-area-settings')!;

describe('ContextModal', () => {
	it('shows the pre-hook prompt first, then the preview', async () => {
		const { container } = render(view(vi.fn().mockResolvedValue('hooked')));
		expect(area(container).value).toBe('raw');

		await waitFor(() => expect(area(container).value).toBe('hooked'));
	});

	it('keeps an edit made before the preview lands', async () => {
		let resolve!: (text: string) => void;
		const pending = new Promise<string>(r => { resolve = r; });
		const { container } = render(view(vi.fn().mockReturnValue(pending)));

		fireEvent.input(area(container), { target: { value: 'mine' } });
		resolve('hooked');
		await act(async () => { await pending; });

		expect(area(container).value).toBe('mine');
	});
});
