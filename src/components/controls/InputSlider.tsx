import { html } from 'htm/react';

export function InputSlider({ label, value, min = 0, max = 100, step = 1, readOnly, hidden, strict, onValueChange, ...props }) {
	const handleChange = (newValue) => {
		if (strict) {
			if (newValue < min) newValue = min;
			if (newValue > max) newValue = max;
		}
		onValueChange(newValue);
	};

	return html`
		<label className="InputBox" style=${hidden ? {'display': 'none'} : {}}>
			${label}
			<div className="InputSlider-container">
				<input
					type="range"
					value=${value}
					min=${min}
					max=${max}
					step=${step}
					disabled=${readOnly}
					onInput=${({ target }) => handleChange(Number(target.value))}/>
				<input
					type="number"
					value=${value}
					min=${min}
					max=${max}
					step=${step}
					readOnly=${readOnly}
					onChange=${({ target }) => handleChange(Number(target.value))}
					...${props}/>
			</div>
		</label>`;
}
