import { html } from 'htm/react';

export function SelectBox({ label, value, hidden, onValueChange, options, template, ...props }: any) {
	const optList = typeof options === 'function' ? options() : options;
	return html`
		<label className="SelectBox" style=${hidden ? {'display': 'none'} : {}}>
			${label}
			<select
				value=${template ? value : JSON.stringify(value)}
				onChange=${template
					? ({ target }: any) => onValueChange(JSON.parse(JSON.stringify(target.value)))
					: ({ target }: any) => onValueChange(JSON.parse(target.value))}
				...${props}>
				${optList.map((o: any) => html`<option
					key=${JSON.stringify(o.value)}
					value=${template ? o.nameNew : JSON.stringify(o.value)}>${template ? o.nameNew : o.name}</option>`)}
			</select>
		</label>`;
}
