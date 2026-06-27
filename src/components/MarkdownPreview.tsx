import { html } from 'htm/react';
import { useMemo, useLayoutEffect } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useSettings } from '../contexts/SettingsContext';
import { useGeneration } from '../contexts/GenerationContext';
import { usePromptBuilder } from '../hooks/usePromptBuilder';
import type { MarkdownPreviewProps } from '../types/components';

export function MarkdownPreview({ sidebarHeight }: MarkdownPreviewProps) {
	const { showMarkdownPreview, isMobile } = useSettings();
	const { markdownPreviewRef } = useGeneration();
	const { promptText } = usePromptBuilder();

	useLayoutEffect(() => {
		if (showMarkdownPreview) {
			document.body.classList.add('markdown-preview-on');
		} else {
			document.body.classList.remove('markdown-preview-on');
		}
		return () => {
			document.body.classList.remove('markdown-preview-on');
		};
	}, [showMarkdownPreview]);

	const markdownHtml = useMemo(() => {
		if (!showMarkdownPreview) return '';
		const raw = marked.parse(promptText, { gfm: true, breaks: true });
		return DOMPurify.sanitize(typeof raw === 'string' ? raw : '');
	}, [promptText, showMarkdownPreview]);

	return html`
		<div id="markdown-preview" ref=${markdownPreviewRef} style=${{ 'margin-bottom': isMobile ? sidebarHeight + 'px' : 0 }}>
			<div dangerouslySetInnerHTML=${{__html: markdownHtml}} />
		</div>
	`;
}
