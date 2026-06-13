import { html } from 'htm/react';
import { useMemo } from 'react';
import { useSettings } from '../contexts/SettingsContext';
import { useGeneration } from '../contexts/GenerationContext';
import { replaceUnprintableBytes } from '../utils/strings';

export function ProbsDisplay() {
	const { templates, selectedTemplate } = useSettings();
	const { promptChunks, setPromptChunks, currentPromptChunk, showProbs, setTriggerPredict, setRestartedPredict } = useGeneration();

	const probs = useMemo(() => {
		const rawProbs = showProbs && promptChunks[currentPromptChunk?.index]?.completion_probabilities?.[0]?.probs;
		return rawProbs
			? rawProbs.filter((prob: any) => prob.prob > 0).sort((a: any, b: any) => b.prob - a.prob)
			: undefined;
	}, [promptChunks, currentPromptChunk, showProbs]);

	async function switchCompletion(i: any, tok: any) {
		const remainingPrompt = promptChunks.slice(i);
		const instPre = templates[selectedTemplate]?.instPre?.replace(/\\n/g, '\n');
		const lastChunk = promptChunks[promptChunks.length - 1];

		const hasRealUserTextAfter = remainingPrompt.some((chunk: any) =>
			chunk.type === 'user' &&
			!(chunk === lastChunk && (chunk.content === instPre || chunk.content.length <= 50))
		);
		if (hasRealUserTextAfter) {
			return;
		}

		const newPrompt = [
			...promptChunks.slice(0, i),
			{
				...promptChunks[i],
				content: tok.tok_str,
				prob: tok.prob
			},
		];
		setPromptChunks(newPrompt);
		setTriggerPredict(true);
		setRestartedPredict(true);
	}

	if (!probs) return null;

	return html`
		<div
			id="probs"
			style=${{
				'display': 'none'
			}}>
			${probs.map((prob: any, i: any) => {
				const index = currentPromptChunk?.index;
				const isCurrentToken = promptChunks[index]?.prob == prob.prob;
				return html`<button key=${i} className=${isCurrentToken ? 'current' : ''} onClick=${() => switchCompletion(index, prob)}>
					<div className="tok">${replaceUnprintableBytes(prob.tok_str.replaceAll(' ', '␣').replaceAll('\t', '⇥').replaceAll('\n', '↵'))}</div>
					<div className="prob">${(prob.prob * 100).toFixed(2)}%</div>
				</button>`;
			})}
		</div>
	`;
}
