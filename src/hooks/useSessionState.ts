import { useEffect, useMemo, useState } from 'react';

export function useSessionState(sessionStorage: any, name: any, initialState: any) {
	const savedState = useMemo(() => {
		try {
			return sessionStorage.getProperty(name);
		} catch (e: any) {
			console.warn(`Failed to retrieve session state for ${name}:`, e);
			return null;
		}
	}, []);

	const [value, setValue] = useState(savedState ?? initialState);

	useEffect(() => {
		function deepCopy(value: any) {
			if (value === undefined) return undefined;
			return JSON.parse(JSON.stringify(value));
		}
		function onSessionChange() {
			setValue(sessionStorage.getProperty(name) ?? deepCopy(initialState));
		}

		sessionStorage.addEventListener('sessionchange', onSessionChange);
		return () => sessionStorage.removeEventListener('sessionchange', onSessionChange);
	}, []);

	const updateState = (newValue: any) => {
		setValue((prevValue: any) => {
			const updatedValue = typeof newValue === 'function' ? newValue(prevValue) : newValue;
			sessionStorage.setProperty(name, updatedValue);
			return updatedValue;
		});
	};

	return [value, updateState];
}
