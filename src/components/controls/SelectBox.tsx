import { html } from 'htm/react';

export function SelectBox({ label, value, hidden, onValueChange, options, ...props }) {
	return html`
		<label className="SelectBox" style=${hidden ? {'display': 'none'} : {}}>
			${label}
			<select
				value=${JSON.stringify(value)}
				onChange=${({ target }) => onValueChange(JSON.parse(target.value))}
				...${props}>
				${(options = typeof options === 'function' ? options() : options).map(o => html`<option
					key=${JSON.stringify(o.value)}
					value=${JSON.stringify(o.value)}>${o.name}</option>`)}
			</select>
		</label>`;
}

export function SelectBoxTemplate({ label, value, onValueChange, options, ...props }) {
	return html`
		<label className="SelectBox">
			${label}
			<select
				value=${value}
				onChange=${({ target }) => onValueChange(JSON.parse(JSON.stringify(target.value)))}
				...${props}>
				${(options = typeof options === 'function' ? options() : options).map(o => html`<option
					key=${JSON.stringify(o.value)}
					value=${o.nameNew}>${o.nameNew}</option>`)}
			</select>
		</label>`;
}
