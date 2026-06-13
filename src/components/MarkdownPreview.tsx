import { html } from 'htm/react';
import { useMemo, useLayoutEffect } from 'react';
import { marked } from 'marked';
import { useSettings } from '../contexts/SettingsContext';
import { useGeneration } from '../contexts/GenerationContext';
import { usePromptBuilder } from '../hooks/usePromptBuilder';

export function MarkdownPreview({ sidebarHeight }: any) {
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
		return marked.parse(promptText, { gfm: true, breaks: true });
	}, [promptText, showMarkdownPreview]);

	return html`
		<div id="markdown-preview" ref=${markdownPreviewRef} style=${{ 'margin-bottom': isMobile ? sidebarHeight + 'px' : 0 }}>
			<div dangerouslySetInnerHTML=${{__html: markdownHtml}} />
		</div>
	`;
}
