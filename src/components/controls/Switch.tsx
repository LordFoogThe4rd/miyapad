import { html } from 'htm/react';
import type { SwitchProps } from '../../types/components';

export function Switch({ checked, onChange, label, ariaLabel, disabled = false, className, title }: SwitchProps) {
	const button = html`
		<button
			type="button"
			role="switch"
			aria-checked=${checked}
			aria-label=${label ? undefined : ariaLabel}
			disabled=${disabled}
			title=${label ? undefined : title}
			className=${className ? `switch ${className}` : 'switch'}
			onClick=${() => onChange(!checked)}>
			<span className="switch-thumb" aria-hidden="true"></span>
		</button>`;

	if (!label) return button;

	return html`
		<label className=${disabled ? 'switch-field switch-field-disabled' : 'switch-field'} title=${title}>
			${button}
			<span>${label}</span>
		</label>`;
}
