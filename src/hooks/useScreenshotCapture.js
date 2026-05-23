import { useCallback } from 'react';
import { useSettings } from '../contexts/SettingsContext.js';
import { useGeneration } from '../contexts/GenerationContext.js';
import { toPng } from 'html-to-image';

export function useScreenshotCapture() {
	const {
		screenshotIncludeSessionName, screenshotIncludeDate,
		screenshotBackgroundUrl, screenshotBackgroundColor,
		screenshotStoryFont, screenshotGeneralFont,
		screenshotFontWeight, screenshotFontSize, screenshotLineHeight,
		screenshotFontColor, screenshotAiTextColor, screenshotModelAvatarUrl,
		sessionStorage, endpointModel
	} = useSettings();

	const { promptArea, promptChunks } = useGeneration();

	const toDataURL = useCallback(async (url) => {
		if (!url) return '';
		try {
			let fetchUrl = url;
			if (sessionStorage?.sessionEndpoint) {
				fetchUrl = `${sessionStorage.sessionEndpoint}/proxy-image?url=${encodeURIComponent(url)}`;
			}
			const response = await fetch(fetchUrl);
			const blob = await response.blob();
			return new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.onloadend = () => resolve(reader.result);
				reader.onerror = reject;
				reader.readAsDataURL(blob);
			});
		} catch (err) {
			console.error("Failed to convert image to base64", err);
			return url;
		}
	}, [sessionStorage]);

	const takeScreenshot = useCallback(async () => {
		const area = promptArea.current;
		if (!area) return;

		const storyText = area.value.substring(area.selectionStart, area.selectionEnd);
		if (!storyText) {
			alert("Please select some text first!");
			return;
		}

		const start = area.selectionStart;
		const end = area.selectionEnd;
		let formattedStoryHTML = "";
		let currentPos = 0;

		for (const chunk of promptChunks) {
			const chunkLen = chunk.content.length;
			const chunkStart = currentPos;
			const chunkEnd = currentPos + chunkLen;

			const intersectStart = Math.max(chunkStart, start);
			const intersectEnd = Math.min(chunkEnd, end);

			if (intersectStart < intersectEnd) {
				const textPart = chunk.content.substring(intersectStart - chunkStart, intersectEnd - chunkStart);
				const escapedText = textPart.replace(/&/g, "&amp;")
					.replace(/</g, "&lt;")
					.replace(/>/g, "&gt;")
					.replace(/"/g, "&quot;")
					.replace(/'/g, "&#039;");

				if (chunk.type !== 'user') {
					formattedStoryHTML += `<span class="novel-gold">${escapedText}</span>`;
				} else {
					formattedStoryHTML += escapedText;
				}
			}
			currentPos += chunkLen;
		}

		if (!formattedStoryHTML) {
			formattedStoryHTML = storyText.replace(/&/g, "&amp;")
				.replace(/</g, "&lt;")
				.replace(/>/g, "&gt;")
				.replace(/"/g, "&quot;")
				.replace(/'/g, "&#039;");
		}

		const storyTitle = screenshotIncludeSessionName
			? (document.querySelector('.Session.selected')?.textContent?.trim() || sessionStorage.getProperty('name') || 'Untitled')
			: 'Excerpt';
		const dateString = new Date().toISOString().split('T')[0];
		const modelName = endpointModel || 'Unknown';

		let avatarUrl = screenshotModelAvatarUrl;
		if (avatarUrl) {
			avatarUrl = await toDataURL(avatarUrl);
		}
		const avatarHtml = avatarUrl
			? `<img class="novel-avatar" src="${avatarUrl}" alt="">`
			: `<div class="novel-avatar"></div>`;

		let backgroundUrl = screenshotBackgroundUrl;
		if (backgroundUrl) {
			backgroundUrl = await toDataURL(backgroundUrl);
		}

		let staging = document.getElementById('screenshot-staging-area');
		if (!staging) {
			staging = document.createElement('div');
			staging.id = 'screenshot-staging-area';
			document.body.appendChild(staging);
		}

		const captureContainer = document.createElement('div');
		captureContainer.className = 'novel-excerpt-container';

		if (backgroundUrl) {
			captureContainer.style.backgroundImage = `url(${backgroundUrl})`;
			captureContainer.style.backgroundSize = 'cover';
		} else {
			captureContainer.style.backgroundColor = screenshotBackgroundColor;
		}

		captureContainer.innerHTML = `
			<header>
				${screenshotIncludeSessionName ? `<div class="novel-subtitle novel-gold">AN EXCERPT FROM</div>
				<h1 class="novel-title novel-gold">${storyTitle}</h1>` : ''}
				${screenshotIncludeDate ? `<div class="novel-date novel-grey">${dateString}</div>` : ''}
			</header>
			<div class="novel-body" style="
				font-family: ${screenshotStoryFont}, Arial, sans-serif;
				font-weight: ${screenshotFontWeight};
				font-size: ${screenshotFontSize}px;
				line-height: ${screenshotLineHeight}px;
				color: ${screenshotFontColor};
			">${formattedStoryHTML}</div>
			<footer class="novel-footer">
				<div class="novel-legend">
					<div class="novel-legend-item"><span class="novel-color-box box-ai"></span> AI</div>
					<div class="novel-legend-item"><span class="novel-color-box box-user"></span> User</div>
				</div>
				<div class="novel-footer-right">
					<span>Written alongside</span>
					${avatarHtml}
					<span class="novel-model-name novel-gold">${modelName}</span>
				</div>
			</footer>
		`;

		// Inject screenshot-specific CSS if not already present
		if (!document.getElementById('mikupad-screenshot-css')) {
			const css = `
				#screenshot-staging-area {
					position: absolute;
					left: -9999px;
					top: 0;
				}
				.novel-excerpt-container {
					width: 800px;
					padding: 60px;
					box-sizing: border-box;
					display: flex;
					flex-direction: column;
					font-family: ${screenshotGeneralFont}, sans-serif;
				}
				.novel-gold { color: ${screenshotAiTextColor}; }
				.novel-grey { color: #777777; }
				.novel-subtitle { font-size: 14px; font-weight: 700; text-transform: uppercase; margin-bottom: 5px; }
				.novel-title { font-size: 32px; font-weight: 700; margin: 0 0 10px 0; }
				.novel-date { font-size: 16px; margin-bottom: 40px; }
				.novel-body { line-height: 1.6; margin-bottom: 40px; white-space: pre-wrap; }
				.novel-footer { display: flex; justify-content: space-between; align-items: center; font-size: 14px; color: #777777; }
				.novel-legend { display: flex; gap: 20px; }
				.novel-legend-item { display: flex; align-items: center; }
				.novel-color-box { width: 12px; height: 12px; margin-right: 8px; }
				.box-ai { background-color: ${screenshotAiTextColor}; }
				.box-user { background-color: ${screenshotFontColor}; }
				.novel-footer-right { display: flex; align-items: center; }
				.novel-avatar { width: 30px; height: 30px; margin: 0 12px; object-fit: cover; background: #333; }
				.novel-model-name { font-weight: 700; }
			`;
			const style = document.createElement('style');
			style.id = 'mikupad-screenshot-css';
			style.textContent = css;
			document.head.appendChild(style);
		}

		staging.appendChild(captureContainer);

		try {
			const dataUrl = await toPng(captureContainer, {
				backgroundColor: null,
				pixelRatio: 2,
				skipFonts: true,
			});

			const win = window.open();
			if (win) {
				win.document.write('<img src="' + dataUrl + '"/>');
				win.document.close();
			}
		} catch (err) {
			console.error("Screenshot failed:", err);
		} finally {
			staging.removeChild(captureContainer);
		}
	}, [
		promptArea, promptChunks,
		screenshotIncludeSessionName, screenshotIncludeDate,
		screenshotBackgroundUrl, screenshotBackgroundColor,
		screenshotStoryFont, screenshotGeneralFont,
		screenshotFontWeight, screenshotFontSize, screenshotLineHeight,
		screenshotFontColor, screenshotAiTextColor, screenshotModelAvatarUrl,
		sessionStorage, endpointModel, toDataURL
	]);

	return { takeScreenshot };
}
