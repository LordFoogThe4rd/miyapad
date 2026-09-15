import { html } from 'htm/react';
import { useEffect, useState } from 'react';
import { Modal } from '../Modal';
import { useT } from '../../i18n';
import type { SessionStorage } from '../../storage/SessionStorage';

interface SessionHistoryModalProps {
  isOpen: boolean;
  closeModal: () => void;
  sessionStorage: SessionStorage;
  cancel: (() => void) | null;
}

export function SessionHistoryModal({ isOpen, closeModal, sessionStorage, cancel }: SessionHistoryModalProps) {
	const t = useT();
	const [entries, setEntries] = useState<HistoryEntry[] | undefined>(undefined);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (!isOpen) return;
		let stale = false;
		setEntries(undefined);
		const sessionId = sessionStorage.selectedSession;
		if (sessionId === undefined) return;
		// Save any pending edits first so the newest version is on the list.
		sessionStorage.flushSnapshot()
			.then(() => sessionStorage.history.list(sessionId))
			.then(list => { if (!stale) setEntries([...list].reverse()); }, () => { if (!stale) setEntries([]); });
		return () => { stale = true; };
	}, [isOpen]);

	const reasonLabel: Record<HistoryReason, string> = {
		open: t('sessionHistory.reasonOpen'),
		idle: t('sessionHistory.reasonIdle'),
		deletion: t('sessionHistory.reasonDeletion'),
		generation: t('sessionHistory.reasonGeneration'),
		restore: t('sessionHistory.reasonRestore'),
	};

	const run = async (action: () => Promise<boolean>) => {
		setBusy(true);
		try {
			if (await action()) closeModal();
		} catch (e) {
			console.error('Failed to restore version:', e);
			alert(t('sessionHistory.restoreFailed'));
		} finally {
			setBusy(false);
		}
	};

	const restoreAsNew = (entry: HistoryEntry) => run(async () => {
		const name = `${sessionStorage.getProperty('name')} (${new Date(entry.time).toLocaleString()})`;
		const newId = await sessionStorage.restoreSnapshot(entry.time, name);
		if (newId === undefined) return false;
		await sessionStorage.switchSession(newId);
		// switchSession logs and swallows its own failures, so check it actually got there.
		if (sessionStorage.selectedSession !== newId) alert(t('sessionHistory.restoredNotOpened'));
		return true;
	});

	const overwrite = (entry: HistoryEntry) => run(() => sessionStorage.overwriteWithSnapshot(entry.time));

	return html`
		<${Modal} isOpen=${isOpen} onClose=${closeModal}
			title=${t('sessionHistory.title')}
			description=${t('sessionHistory.description')}>
			<div className="sessions-modal-list overflow-container">
				${entries === undefined ? html`<p>${t('sessionHistory.loading')}</p>`
				: entries.length === 0 ? html`<p>${t('sessionHistory.empty')}</p>`
				: html`
					<table className="sessions-modal-table session-history-table">
						<thead>
							<tr>
								<th className="sessions-col-modified">${t('sessionHistory.saved')}</th>
								<th className="sessions-col-name">${t('sessionHistory.endsWith')}</th>
								<th className="sessions-col-actions"></th>
							</tr>
						</thead>
						<tbody>
							${entries.map(entry => html`
								<tr key=${entry.time} className="sessions-modal-row session-history-row">
									<td className="sessions-col-modified">
										<div>${new Date(entry.time).toLocaleString()}</div>
										<small>${reasonLabel[entry.reason] ?? entry.reason} · ${entry.words} ${t('sessionHistory.words')}</small>
									</td>
									<td className="sessions-col-name">
										<span className="session-history-tail">…${entry.tail}</span>
									</td>
									<td className="sessions-col-actions">
										<div className="sessions-col-actions-inner">
											<button disabled=${!!cancel || busy} title=${t('sessionHistory.restoreAsNewTooltip')}
												onClick=${() => restoreAsNew(entry)}>${t('sessionHistory.restoreAsNew')}</button>
											<button disabled=${!!cancel || busy} title=${t('sessionHistory.replaceCurrentTooltip')}
												onClick=${() => overwrite(entry)}>${t('sessionHistory.replaceCurrent')}</button>
										</div>
									</td>
								</tr>
							`)}
						</tbody>
					</table>
				`}
			</div>
		</${Modal}>`;
}
