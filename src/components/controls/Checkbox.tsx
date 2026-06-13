import { html } from 'htm/react';

export function Checkbox({ label, value, hidden, onValueChange, ...props }) {
	return html`
		<label className="Checkbox" style=${hidden ? {'display': 'none'} : {}} ...${{...(props.title ? { 'title': props.title } : {})}}>
			<input
				type="checkbox"
				checked=${value}
				onChange=${({ target }) => onValueChange(target.checked)}
				...${props}/>
			${label}
		</label>`;
}
