import { useMemo, useState } from 'react';

export function usePersistentState(name: any, initialState: any) {
	const savedState = useMemo(() => {
		try {
			const item = localStorage.getItem(name);
			if (item === "undefined" || item === null) return undefined;
			return JSON.parse(item);
		} catch (e: unknown) {
			console.warn(`Failed to parse persistent state for ${name}:`, e);
			return null;
		}
	}, []);

	const [value, setValue] = useState(savedState ?? initialState);

	const updateState = (newValue: any) => {
		setValue((prevValue: any) => {
			const updatedValue = typeof newValue === 'function' ? newValue(prevValue) : newValue;
			localStorage.setItem(name, JSON.stringify(updatedValue));
			return updatedValue;
		});
	};

	return [value, updateState];
}
