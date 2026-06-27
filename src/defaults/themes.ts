export const defaultThemes = {
    "Serif Dark": {
		order: 0,
		isDefault: true,
        className: "serif-dark",
        css: `/* Serif Dark */
html.serif-dark {
	--color-base-0: oklch(0.95 0.04 30);
	--color-base-10: color-mix(in oklch, var(--color-base-100) 10%, var(--color-base-0));
	--color-base-20: color-mix(in oklch, var(--color-base-100) 80%, var(--color-base-0));
	--color-base-30: color-mix(in oklch, var(--color-base-100) 70%, var(--color-base-0));
	--color-base-40: color-mix(in oklch, var(--color-base-100) 60%, var(--color-base-0));
	--color-base-50: color-mix(in oklch, var(--color-base-100) 50%, var(--color-base-0));
	--color-base-60: color-mix(in oklch, var(--color-base-100) 40%, var(--color-base-0));
	--color-base-70: color-mix(in oklch, var(--color-base-100) 30%, var(--color-base-0));
	--color-base-80: color-mix(in oklch, var(--color-base-100) 20%, var(--color-base-0));
	--color-base-90: color-mix(in oklch, var(--color-base-100) 10%, var(--color-base-0));
	--color-base-100: oklch(0.20 0.02 30);
	--color-dark: var(--color-base-100);
	--color-light: var(--color-base-0);

	--color-text-ui: var(--color-light);

	color-scheme: dark;
}
	`},
    "Monospace Dark": {
		order: 1,
		isDefault: true,
        className: "monospace-dark",
        css: `/* Monospace Dark */
html.monospace-dark {
	--color-base-0: oklch(77.65% 0.0752 285.22);
	--color-base-10: color-mix(in oklch, var(--color-base-100) 90%, var(--color-base-0));
	--color-base-20: color-mix(in oklch, var(--color-base-100) 80%, var(--color-base-0));
	--color-base-30: color-mix(in oklch, var(--color-base-100) 70%, var(--color-base-0));
	--color-base-40: color-mix(in oklch, var(--color-base-100) 60%, var(--color-base-0));
	--color-base-50: color-mix(in oklch, var(--color-base-100) 50%, var(--color-base-0));
	--color-base-60: color-mix(in oklch, var(--color-base-100) 40%, var(--color-base-0));
	--color-base-70: color-mix(in oklch, var(--color-base-100) 30%, var(--color-base-0));
	--color-base-80: color-mix(in oklch, var(--color-base-100) 20%, var(--color-base-0));
	--color-base-90: color-mix(in oklch, var(--color-base-100) 10%, var(--color-base-0));
	--color-base-100: oklch(24.28% 0.015 285.22);
	--color-dark: var(--color-base-100);
	--color-light: var(--color-base-0);

	--color-text-ui: var(--color-light);
	--color-text-prompt: #bababa;

	--color-bg-ui-1: #282833;
	--color-bg-ui-2: var(--color-base-20);
	--color-bg-prompt: #202020;
	--color-bg-popover-1: var(--color-base-20);
	--color-bg-popover-2: var(--color-base-20);
	--color-bg-highlight-2: var(--color-base-40);
	--color-bg-highlight-3: var(--color-base-40);
	--color-bg-highlight-4: var(--color-base-20);
	--color-bg-active: var(--color-base-10);
	--color-bg-disabled-1: var(--color-base-20);
	--color-bg-disabled-2: var(--color-base-10);

	font-family: monospace;
	font-size: 15px;

	accent-color: var(--color-base-30);
	background: none;
	color: var(--color-text-prompt);
	color-scheme: dark;
}
html.monospace-dark #probs {
	border: 1px solid #4a4a4a;
	border-radius: calc(4px * var(--font-size-multiplier));
	box-shadow: none;
}
html.monospace-dark #sidebar {
	width: 265px;
}
html.monospace-dark .tooltip .tooltiptext,
html.monospace-dark .tooltip .tooltiptext.short {
	transform: translate(0, -65%);
}
html.monospace-dark .eye-button {
	position: relative;
	margin-top: auto;
	width: 1.891rem;
	height: 1.725rem;
}
@media (max-width: 767.98px) {
	html.monospace-dark #sidebar {
		width: auto;
		max-height: calc(93vh - 8px);
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
	}
}
    `},
    "NockoffAI": {
		order: 2,
		isDefault: true,
        className: "nockoffAI",
        css: `/* NockoffAI */
html.nockoffAI {
	--color-base-0: #fff;
	--color-base-10: color-mix(in oklch, var(--color-base-100) 90%, var(--color-base-0));
	--color-base-20: color-mix(in oklch, var(--color-base-100) 80%, var(--color-base-0));
	--color-base-30: color-mix(in oklch, var(--color-base-100) 70%, var(--color-base-0));
	--color-base-40: color-mix(in oklch, var(--color-base-100) 60%, var(--color-base-0));
	--color-base-50: color-mix(in oklch, var(--color-base-100) 50%, var(--color-base-0));
	--color-base-60: color-mix(in oklch, var(--color-base-100) 40%, var(--color-base-0));
	--color-base-70: color-mix(in oklch, var(--color-base-100) 30%, var(--color-base-0));
	--color-base-80: color-mix(in oklch, var(--color-base-100) 20%, var(--color-base-0));
	--color-base-90: color-mix(in oklch, var(--color-base-100) 10%, var(--color-base-0));
	--color-base-100: #13152c;
	--color-dark: var(--color-base-100);
	--color-light: #fff;
	--token-prob-box: #4a4a4a;

	--color-text-ui: var(--color-base-80);
	--color-text-prompt: var(--color-light);

	--color-bg-input-1: #0e0f21;
	--color-bg-ui-1: var(--color-base-100);
	--color-bg-ui-2: #0e0f21;
	--color-bg-prompt: #191b31;
	--color-bg-popover-1: #0e0f21;
	--color-bg-highlight-2: #2B2C41;
	--color-bg-highlight-3: #13152c;
	--color-bg-active: #191b31;
	--color-bg-disabled-1: #161833;
	--color-bg-disabled-2: #161833;

	font-family: "Source Sans Pro", "Helvetica Neue", sans-serif;
	font-size: 15.5px;

	accent-color: var(--color-base-30);
	background: none;
	color: var(--color-text-prompt);
	color-scheme: dark;
}
html.nockoffAI body {
	background: var(--color-bg-prompt);
}
html.nockoffAI #prompt-area,
html.nockoffAI #prompt-overlay {
	text-indent: 1em each-line;
}
html.nockoffAI #memory-area,
html.nockoffAI #an-area,
html.nockoffAI .expanded-text-area-settings,
html.nockoffAI .wi-textarea {
	background: var(--color-bg-input-1);
}
html.nockoffAI #probs {
	background: var(--color-base-10);
	border: 1px solid var(--token-prob-box);
	border-radius: calc(4px * var(--font-size-multiplier));
	box-shadow: none;
}
html.nockoffAI .modal {
	color: var(--color-base-50);
}
html.nockoffAI .modal-title {
	color: var(--color-text-ui);
}
html.nockoffAI  #context-order-desc,
html.nockoffAI  #contextTokensTable,
html.nockoffAI .modal-desc {
	color: var(--color-text-ui);
}
html.nockoffAI #sidebar {
	color: var(--color-base-50);
	width: 255px;
}
html.nockoffAI .InputBox > div > input, html.nockoffAI .SelectBox > select {
	color: var(--color-text-ui);
}
html.nockoffAI .horz-separator {
	border-top: 3px dotted color-mix(in oklch, var(--color-base-100) 90%, var(--color-light));
}
html.nockoffAI button {
	background: #22253f;
	color: var(--color-text-ui);
}
html.nockoffAI .Session button:not(:hover),
html.nockoffAI button.textAreaSettings:not(:hover) {
	background: none;
}
html.nockoffAI button:hover {
	background: #282b44;
}
html.nockoffAI .Session {
	margin: 0.25rem;
	padding: 0.25rem;
}
html.nockoffAI .Session > input {
	outline: none;
}
html.nockoffAI .Session.selected {
	color: var(--color-text-ui);
}
@media (max-width: 767.98px) {
	html.nockoffAI #sidebar {
		width: auto;
		max-height: calc(93vh - 8px);
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
	}
}
html.nockoffAI .EditorContextMenu {
	border: 1px solid var(--color-bg-popover-2);
    border-radius: 4px;
}
    `},
    "E-Reader": {
		order: 3,
		isDefault: true,
        className: "ereader",
        css: `/* E-Reader */
html.ereader {
	--color-base-0: #000;
	--color-base-10: color-mix(in srgb, var(--color-base-100) 10%, var(--color-base-0));
	--color-base-20: color-mix(in srgb, var(--color-base-100) 20%, var(--color-base-0));
	--color-base-30: color-mix(in srgb, var(--color-base-100) 30%, var(--color-base-0));
	--color-base-40: color-mix(in srgb, var(--color-base-100) 40%, var(--color-base-0));
	--color-base-50: color-mix(in srgb, var(--color-base-100) 50%, var(--color-base-0));
	--color-base-60: color-mix(in srgb, var(--color-base-100) 60%, var(--color-base-0));
	--color-base-70: color-mix(in srgb, var(--color-base-100) 70%, var(--color-base-0));
	--color-base-80: color-mix(in srgb, var(--color-base-100) 80%, var(--color-base-0));
	--color-base-90: color-mix(in srgb, var(--color-base-100) 90%, var(--color-base-0));
	--color-base-100: #fff;
	--color-miku: #08f;

	font-family: monospace;
	font-size: 16px;

	background: var(--color-base-10);
}
html.ereader #prompt-container:hover #prompt-overlay > .machine {
	background: color-mix(in srgb, var(--bg-color, var(--color-miku)) 20%, transparent);
}
html.ereader #sidebar {
	width: 280px;
}
    `},
};
