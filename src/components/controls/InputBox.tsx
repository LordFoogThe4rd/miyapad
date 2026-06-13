import { html } from 'htm/react';

export function InputBox({ label, className, tooltip, tooltipSize, value, type, datalist, onValueChange, children, ...props }) {
	return html`
		<label className="InputBox ${tooltip ? 'tooltip' : ''}">
			${label}
			<div className="${children ? 'hbox-flex' : ''}">
				<input
					className="flex1 ${className}"
					type=${type || 'text'}
					list="${datalist ? label + '-datalist' : ''}"
					value=${value}
					size="1"
					onChange=${({ target }) => {
						let value = type === 'number' ? target.valueAsNumber : target.value;
						if (props.inputmode === 'numeric') {
							props.pattern = '^-?[0-9]*$';
							if (value && !isNaN(+value))
								value = +target.value;
						}
						if (props.pattern && !new RegExp(props.pattern).test(value))
							return;
						onValueChange(value);
					}}
					...${props}/>
				${children}
			</div>
			${datalist && html`
				<datalist id="${label + '-datalist'}">
					${datalist.map(opt => html`
						<option key="${opt}">
							${opt}
						</option>`)}
				</datalist>`}
			${tooltip && html`
				<span class="tooltiptext ${tooltipSize || ''}">
					${tooltip}
				</span>`}
		</label>`;
}
