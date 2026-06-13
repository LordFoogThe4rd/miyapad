import { useMemo, useState } from 'react';

export function usePersistentState(name, initialState) {
	const savedState = useMemo(() => {
		try {
			const item = localStorage.getItem(name);
			if (item === "undefined" || item === null) return undefined;
			return JSON.parse(item);
		} catch (e) {
			console.warn(`Failed to parse persistent state for ${name}:`, e);
			return null;
		}
	}, []);

	const [value, setValue] = useState(savedState ?? initialState);

	const updateState = (newValue) => {
		setValue((prevValue) => {
			const updatedValue = typeof newValue === 'function' ? newValue(prevValue) : newValue;
			localStorage.setItem(name, JSON.stringify(updatedValue));
			return updatedValue;
		});
	};

	return [value, updateState];
}
