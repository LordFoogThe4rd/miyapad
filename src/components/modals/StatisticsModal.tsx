import { html } from 'htm/react';
import { useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { useT } from '../../i18n';
import { sanitizeStats } from '../../storage/SessionStorage';
import type { SessionStorage } from '../../storage/SessionStorage';

interface StatisticsModalProps {
	isOpen: boolean;
	closeModal: () => void;
	sessionStorage: SessionStorage;
	promptText: string;
}

function addStats(total: SessionStats, stats: SessionStats): SessionStats {
	for (const key of Object.keys(total) as (keyof SessionStats)[]) total[key] += stats[key];
	return total;
}

function formatDuration(ms: number): string {
	const seconds = Math.round(ms / 1000);
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = seconds % 60;
	if (h) return `${h}h ${m}m`;
	if (m) return `${m}m ${s}s`;
	return `${s}s`;
}

/** `a` as a percentage of `a + b`, or a dash when there is nothing to divide. */
function share(a: number, b: number): string {
	const total = a + b;
	return total ? `${Math.round((a / total) * 100)}%` : '—';
}

function perSecond(tokens: number, ms: number): string {
	return ms > 0 ? (tokens / (ms / 1000)).toFixed(1) : '—';
}

function count(n: number): string {
	return n.toLocaleString();
}

export function StatisticsModal({ isOpen, closeModal, sessionStorage, promptText }: StatisticsModalProps) {
	const t = useT();
	// Bumped after a reset so the counters below are read again.
	const [tick, setTick] = useState(0);
	const [busy, setBusy] = useState(false);

	// Null while closed: this component re-renders with every keystroke, and neither the
	// totals nor the word count of the prompt are worth computing for a modal nobody sees.
	const view = useMemo(() => {
		if (!isOpen) return null;
		const sessions = Object.values(sessionStorage.sessions);
		const selectedId = sessionStorage.selectedSession;
		const selected = selectedId !== undefined ? sessionStorage.sessions[selectedId] : undefined;
		return {
			name: typeof selected?.name === 'string' ? selected.name : '',
			created: typeof selected?.created === 'number' ? selected.created : null,
			modified: typeof selected?.modified === 'number' ? selected.modified : null,
			session: sanitizeStats(selected?.stats),
			total: sessions.reduce((sum, s) => addStats(sum, sanitizeStats(s.stats)), sanitizeStats(undefined)),
			sessionCount: sessions.length,
			words: promptText.match(/\S+/g)?.length ?? 0,
			chars: promptText.length,
		};
	}, [isOpen, tick, sessionStorage, promptText]);

	const reset = async (all: boolean) => {
		const sessionId = sessionStorage.selectedSession;
		// Without this, resetStats(undefined) would take the "every session" branch.
		if (!all && sessionId === undefined) return;
		if (!window.confirm(all ? t('statistics.confirmResetAll') : t('statistics.confirmReset'))) return;
		setBusy(true);
		try {
			await sessionStorage.resetStats(all ? undefined : sessionId);
			setTick(v => v + 1);
		} catch (e) {
			console.error('Failed to reset statistics:', e);
			alert(t('statistics.resetFailed'));
		} finally {
			setBusy(false);
		}
	};

	const statRows = (s: SessionStats): [string, string][] => [
		[t('statistics.generations'), count(s.generations)],
		[t('statistics.tokensGenerated'), count(s.genTokens)],
		[t('statistics.tokensPerGeneration'), s.generations ? count(Math.round(s.genTokens / s.generations)) : '—'],
		[t('statistics.averageSpeed'), `${perSecond(s.genTokens, s.genMs)} ${t('statistics.tokensPerSecond')}`],
		[t('statistics.timeGenerating'), formatDuration(s.genMs)],
		[t('statistics.charsWritten'), count(s.typedChars)],
		[t('statistics.charsGenerated'), count(s.genChars)],
		[t('statistics.writtenByModel'), share(s.genChars, s.typedChars)],
		[t('statistics.charsDeleted'), count(s.deletedChars)],
	];

	const table = (rows: [string, string][]) => html`
		<table className="stats-table">
			<tbody>
				${rows.map(([label, value]) => html`
					<tr key=${label}>
						<th>${label}</th>
						<td>${value}</td>
					</tr>`)}
			</tbody>
		</table>`;

	return html`
		<${Modal} isOpen=${isOpen} onClose=${closeModal}
			title=${t('statistics.title')}
			description=${t('statistics.description')}
			style=${{ maxWidth: '32em' }}>
			${view && html`
				<div className="stats-modal overflow-container">
					<div className="stats-section">
						<div className="stats-section-head">
							<h3>${t('statistics.thisSession')}</h3>
							<button disabled=${busy} onClick=${() => reset(false)}>${t('statistics.reset')}</button>
						</div>
						${view.name && html`<small className="stats-session-name">${view.name}</small>`}
						${table([
							...statRows(view.session),
							[t('statistics.promptWords'), count(view.words)],
							[t('statistics.promptChars'), count(view.chars)],
							[t('statistics.created'), view.created ? new Date(view.created).toLocaleString() : '—'],
							[t('statistics.modified'), view.modified ? new Date(view.modified).toLocaleString() : '—'],
						])}
					</div>
					<div className="stats-section">
						<div className="stats-section-head">
							<h3>${t('statistics.allSessions')}</h3>
							<button disabled=${busy} onClick=${() => reset(true)}>${t('statistics.resetAll')}</button>
						</div>
						<small className="stats-session-name">${t('statistics.sessions')}: ${count(view.sessionCount)}</small>
						${table(statRows(view.total))}
					</div>
				</div>`}
		</${Modal}>
	`;
}
