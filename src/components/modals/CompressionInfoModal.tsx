import { html } from 'htm/react';
import { useState, useEffect } from 'react';
import { Modal } from '../Modal';

export function CompressionInfoModal({ isOpen, closeModal }) {
	const [compressionData, setCompressionData] = useState(null);

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

	const first = entries[0]?.cfg || {};
	const levelNum = Number(first?.compression_level);
	const levelDisplay = Number.isFinite(levelNum) ? String(levelNum) : 'not set';
	const ratioNum = Number(first?.train_dict_samples_ratio);
	const ratioDisplay = Number.isFinite(ratioNum) ? String(ratioNum) : 'not set';

	return html`
		<${Modal}
			isOpen=${isOpen}
			onClose=${closeModal}
			title="Current compression settings"
			style=${{ 'max-width': '36em' }}>
			<div className="vbox" style=${{ gap: '1.2rem' }}>
				${entries.length === 0 ? html`<div>No compression data available.</div>` : html`
					<table border="1" frame="void" rules="all" style=${{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
						<thead>
							<tr style=${{ backgroundColor: 'rgba(128,128,128,0.1)' }}>
								<th style=${{ padding: '8px' }}>Table</th>
								<th style=${{ padding: '8px' }}>Column</th>
								<th style=${{ padding: '8px' }}>Level</th>
								<th style=${{ padding: '8px' }}>Training Ratio</th>
							</tr>
						</thead>
						<tbody>
							${entries.map(({ id, cfg }) => {
								const tbl = cfg?.table || `ID: ${id}`;
								const col = cfg?.column || 'N/A';
								const lv = Number(cfg?.compression_level);
								const lvDisplay = Number.isFinite(lv) ? String(lv) : 'not set';
								const r = Number(cfg?.train_dict_samples_ratio);
								const rDisplay = Number.isFinite(r) ? String(r) : 'not set';
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
						<strong style=${{ display: 'block', marginBottom: '2px' }}>Compression Level</strong>
						<span style=${{ opacity: 0.85 }}>
							Configures the speed/compression ratio tradeoff:
							<ul style=${{ margin: '4px 0 0 16px', padding: 0 }}>
								<li><strong>Level 1-3</strong>: Realtime, fast, less compression (Default: 3)</li>
								<li><strong>Level 4-11</strong>: Balanced speed and database size</li>
								<li><strong>Level 22</strong>: Maximum compression, archival quality, very slow</li>
							</ul>
						</span>
					</div>
					<div>
						<strong style=${{ display: 'block', marginBottom: '2px' }}>Training Sample Ratio</strong>
						<span style=${{ opacity: 0.85 }}>
							Determines the proportion of records sampled to train the Zstandard compression dictionary.
							Setting this too high on small databases can result in training errors, while setting it too low can reduce compression ratio.
							See the <a href="https://github.com/facebook/zstd/issues/3111#issuecomment-1098318000" target="_blank" rel="noopener">Technical Explanation</a>.
						</span>
					</div>
				</div>
			</div>
		</${Modal}>
	`;
}
