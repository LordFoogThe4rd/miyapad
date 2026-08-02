import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema } from '../editor/schema';
import { textToDoc } from '../editor/syncReactToPM';
import { ProseMirrorAdapter } from '../editor/EditorAdapter';
import { useInsertTemplate } from './useInsertTemplate';

const mockTemplates = {
	Test: { sysPre: 'S<', sysSuf: '>S', instPre: 'I<', instSuf: '>I' },
};

vi.mock('../contexts/SettingsContext', () => ({
	useSettings: () => ({ templates: mockTemplates, selectedTemplate: 'Test' }),
}));

const mockGeneration = { promptEditorView: { current: null as ProseMirrorAdapter | null } };

vi.mock('../contexts/GenerationContext', () => ({
	useGeneration: () => mockGeneration,
}));

function makeView(text: string): { adapter: ProseMirrorAdapter; view: EditorView; container: HTMLDivElement } {
	const container = document.createElement('div');
	document.body.appendChild(container);
	const state = EditorState.create({ doc: textToDoc(schema, text) });
	const view = new EditorView(container, { state });
	return { adapter: new ProseMirrorAdapter(view), view, container };
}

let holder: { adapter: ProseMirrorAdapter; view: EditorView; container: HTMLDivElement };

beforeEach(() => {
	holder = makeView('hello brave world');
	mockGeneration.promptEditorView.current = holder.adapter;
});

afterEach(() => {
	holder.view.destroy();
	holder.container.remove();
});

describe('insertTemplate', () => {
	it('appends {predict} to the template at an empty cursor position', () => {
		holder.adapter.setSelection(5, 5);
		const { result } = renderHook(() => useInsertTemplate());
		act(() => result.current.insertTemplate('inst'));
		expect(holder.adapter.getText()).toBe('helloI<>I{predict} brave world');
		expect(holder.adapter.getSelection()).toEqual({ from: 7, to: 7 });
	});

	it('keeps {predict} as a separate range after a non-empty selection', () => {
		holder.adapter.setSelection(6, 11);
		const { result } = renderHook(() => useInsertTemplate());
		act(() => result.current.insertTemplate('inst'));
		expect(holder.adapter.getText()).toBe('hello I<brave>I{predict} world');
		expect(holder.adapter.getSelection()).toEqual({ from: 15, to: 15 });
	});
});
