import { html } from 'htm/react';
import { useEffect, useState } from 'react';
import { Modal } from '../Modal';
import { InputBox } from '../controls/InputBox';
import { SVG_Copy, SVG_Download } from '../icons/index';
import { exportUrl } from '../../api/common';
import { useT } from '../../i18n';
import type { ScreenshotResult } from '../../hooks/useScreenshotCapture';

interface ScreenshotPreviewModalProps {
	isOpen: boolean;
	closeModal: () => void;
	screenshot: ScreenshotResult | null;
}

export function ScreenshotPreviewModal({ isOpen, closeModal, screenshot }: ScreenshotPreviewModalProps) {
	const t = useT();
	const [name, setName] = useState('');

	useEffect(() => {
		if (screenshot)
			setName(screenshot.name);
	}, [screenshot]);

	if (!screenshot)
		return null;

	const copyImage = () => {
		navigator.clipboard.write([new ClipboardItem({ 'image/png': screenshot.blob })])
			.catch((e: unknown) => console.error("Copying the screenshot failed:", e));
	};

	return html`
		<${Modal}
			isOpen=${isOpen}
			onClose=${closeModal}
			title=${t('screenshot.title')}
			style=${{ maxWidth: '48em' }}>
			<div style=${{ display: 'flex', flexDirection: 'column', gap: '1em' }}>
				<img src=${screenshot.url} alt=""
					style=${{ maxWidth: '100%', maxHeight: '60vh', objectFit: 'contain', alignSelf: 'center' }}/>
				<div style=${{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
					<div style=${{ flex: 1 }}>
						<${InputBox} label=${t('screenshot.fileName')}
							value=${name}
							onValueChange=${(v: string | number) => setName(String(v))}/>
					</div>
					<button title=${t('screenshot.copy')} onClick=${copyImage}>
						<${SVG_Copy}/>
					</button>
					<button title=${t('screenshot.download')}
						onClick=${() => exportUrl(name.endsWith('.png') ? name : `${name}.png`, screenshot.url)}>
						<${SVG_Download}/>
					</button>
				</div>
			</div>
		</${Modal}>
	`;
}
