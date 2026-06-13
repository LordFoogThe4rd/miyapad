import { useEffect, useMemo, useState } from 'react';

export function useSessionState(sessionStorage, name, initialState) {
	const savedState = useMemo(() => {
		try {
			return sessionStorage.getProperty(name);
		} catch (e) {
			console.warn(`Failed to retrieve session state for ${name}:`, e);
			return null;
		}
	}, []);

	const [value, setValue] = useState(savedState ?? initialState);

	useEffect(() => {
		function deepCopy(value) {
			if (value === undefined) return undefined;
			return JSON.parse(JSON.stringify(value));
		}
		function onSessionChange() {
			setValue(sessionStorage.getProperty(name) ?? deepCopy(initialState));
		}

		sessionStorage.addEventListener('sessionchange', onSessionChange);
		return () => sessionStorage.removeEventListener('sessionchange', onSessionChange);
	}, []);

	const updateState = (newValue) => {
		setValue((prevValue) => {
			const updatedValue = typeof newValue === 'function' ? newValue(prevValue) : newValue;
			sessionStorage.setProperty(name, updatedValue);
			return updatedValue;
		});
	};

	return [value, updateState];
}
