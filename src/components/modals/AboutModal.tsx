import { html } from 'htm/react';
import { Modal } from '../Modal';
import { useUpdateCheck } from '../../hooks/useUpdateCheck';

interface AboutModalProps {
	isOpen: boolean;
	closeModal: () => void;
	isMiyapadEndpoint: boolean;
}

export function AboutModal({ isOpen, closeModal, isMiyapadEndpoint }: AboutModalProps) {
	const { currentVersion, latestVersion, downloadUrl, repoUrl, updateAvailable, checking, error, check } = useUpdateCheck(isMiyapadEndpoint);

	const updateScript = navigator.userAgent.includes('Windows') ? 'miyapad-update.ps1' : 'miyapad-update.sh';

	return html`
		<${Modal}
			isOpen=${isOpen}
			onClose=${closeModal}
			title="About miyapad"
			style=${{ 'max-width': '32em' }}>
			<div className="vbox" style=${{ gap: '1rem' }}>
				<div>
					<strong>Current version:</strong> ${currentVersion}
				</div>
				${latestVersion && html`
					<div style=${{ color: updateAvailable ? 'var(--confirm-color, #4caf50)' : 'inherit', opacity: updateAvailable ? 1 : 0.7 }}>
						<strong>Latest version:</strong> ${latestVersion} ${updateAvailable ? '(update available)' : '(up to date)'}
					</div>`}
				${error && html`<div className="error-text">${error}</div>`}

				<button disabled=${checking} onClick=${check}>
					${checking ? 'Checking…' : 'Check for Updates'}
				</button>

				${updateAvailable && html`
					<div className="vbox" style=${{ gap: '0.5rem' }}>
						<button onClick=${() => window.open(downloadUrl, '_blank', 'noopener')}>
							Download v${latestVersion}
						</button>
						${isMiyapadEndpoint && html`
							<div style=${{ fontSize: '0.9em', opacity: 0.85 }}>
								Or run the update script from your install directory:
								<code style=${{ display: 'block', marginTop: '4px', fontFamily: 'monospace' }}>./${updateScript}</code>
							</div>`}
					</div>`}

				<div style=${{ borderTop: '1px solid rgba(128,128,128,0.2)', paddingTop: '0.8rem', fontSize: '0.9em' }}>
					<a href=${repoUrl} target="_blank" rel="noopener">View on GitHub</a>
				</div>
			</div>
		</${Modal}>
	`;
}
