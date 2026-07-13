import { html } from 'htm/react';
import { useState, useEffect } from 'react';
import { Modal } from '../Modal';
import { useT } from '../../i18n';

interface ZstdCompressionConfig {
  compression_level?: number;
  train_dict_samples_ratio?: number;
  table?: string;
  column?: string;
  [key: string]: unknown;
}

export function CompressionInfoModal({ isOpen, closeModal }: any) {
	const [compressionData, setCompressionData] = useState<Record<string, unknown> | null>(null);
	const t = useT();

	useEffect(() => {
		if (!isOpen) return;
		const fetchConfigs = async () => {
			try {
				const res = await fetch('/zstd_get_configs');
				const data = await res.json();
				if (data.ok) {
					setCompressionData(data.configs);
				}
			} catch (err) {
				console.error('Failed to fetch compression configs:', err);
			}
		};
		fetchConfigs();
	}, [isOpen]);

	const entries = Object.entries(compressionData || {}).map(([id, raw]) => {
		let cfg = raw;
		if (typeof raw === 'string') {
			try { cfg = JSON.parse(raw); } catch (_) {}
		}
		return { id, raw, cfg: cfg && typeof cfg === 'object' ? cfg : null };
	});

	const first = (entries[0]?.cfg || {}) as ZstdCompressionConfig;
	const levelNum = Number(first?.compression_level);
	const levelDisplay = Number.isFinite(levelNum) ? String(levelNum) : t('compression.notSet');
	const ratioNum = Number(first?.train_dict_samples_ratio);
	const ratioDisplay = Number.isFinite(ratioNum) ? String(ratioNum) : t('compression.notSet');

	return html`
		<${Modal}
			isOpen=${isOpen}
			onClose=${closeModal}
			title=${t('compression.title')}
			style=${{ 'max-width': '36em' }}>
			<div className="vbox" style=${{ gap: '1.2rem' }}>
				${entries.length === 0 ? html`<div>${t('compression.noData')}</div>` : html`
					<table border="1" frame="void" rules="all" style=${{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
						<thead>
							<tr style=${{ backgroundColor: 'rgba(128,128,128,0.1)' }}>
								<th style=${{ padding: '8px' }}>${t('compression.tableHeader')}</th>
								<th style=${{ padding: '8px' }}>${t('compression.columnHeader')}</th>
								<th style=${{ padding: '8px' }}>${t('compression.levelHeader')}</th>
								<th style=${{ padding: '8px' }}>${t('compression.trainingRatioHeader')}</th>
							</tr>
						</thead>
						<tbody>
							${entries.map(({ id, cfg }) => {
								const c = cfg as ZstdCompressionConfig;
								const tbl = c?.table || `${t('compression.idPrefix')}${id}`;
								const col = c?.column || t('compression.na');
								const lv = Number(c?.compression_level);
								const lvDisplay = Number.isFinite(lv) ? String(lv) : t('compression.notSet');
								const r = Number(c?.train_dict_samples_ratio);
								const rDisplay = Number.isFinite(r) ? String(r) : t('compression.notSet');
								return html`
									<tr key=${id}>
										<td style=${{ padding: '8px', fontWeight: 'bold' }}>${tbl}</td>
										<td style=${{ padding: '8px', fontFamily: 'monospace' }}>${col}</td>
										<td style=${{ padding: '8px' }}>${lvDisplay}</td>
										<td style=${{ padding: '8px' }}>${rDisplay}</td>
									</tr>
								`;
							})}
						</tbody>
					</table>
				`}

				<div style=${{ fontSize: '0.9em', display: 'flex', flexDirection: 'column', gap: '0.8rem', borderTop: '1px solid rgba(128,128,128,0.2)', paddingTop: '1rem' }}>
					<div>
						<strong style=${{ display: 'block', marginBottom: '2px' }}>${t('compression.levelLabel')}</strong>
						<span style=${{ opacity: 0.85 }}>
							${t('compression.levelDescription')}
							<ul style=${{ margin: '4px 0 0 16px', padding: 0 }}>
								<li><strong>${t('compression.levelRange1')}</strong>: ${t('compression.levelRange1Desc')}</li>
								<li><strong>${t('compression.levelRange2')}</strong>: ${t('compression.levelRange2Desc')}</li>
								<li><strong>${t('compression.levelRange3')}</strong>: ${t('compression.levelRange3Desc')}</li>
							</ul>
						</span>
					</div>
					<div>
						<strong style=${{ display: 'block', marginBottom: '2px' }}>${t('compression.trainingRatioLabel')}</strong>
						<span style=${{ opacity: 0.85 }}>
							${t('compression.trainingRatioDesc1')}
							${t('compression.trainingRatioDesc2')}
							${t('compression.trainingRatioSee')}<a href="https://github.com/facebook/zstd/issues/3111#issuecomment-1098318000" target="_blank" rel="noopener">${t('compression.technicalExplanation')}</a>.
						</span>
					</div>
				</div>
			</div>
		</${Modal}>
	`;
}
