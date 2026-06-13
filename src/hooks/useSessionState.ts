import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';

export function useSessionState<T>(sessionStorage: any, name: string, initialState: T): [T, Dispatch<SetStateAction<T>>] {
	const savedState = useMemo<T | undefined>(() => {
		try {
			return sessionStorage.getProperty(name);
		} catch (e: unknown) {
			console.warn(`Failed to retrieve session state for ${name}:`, e);
			return undefined;
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

	const updateState: Dispatch<SetStateAction<T>> = (newValue) => {
		setValue((prevValue) => {
			const updatedValue = typeof newValue === 'function' ? (newValue as (prev: T) => T)(prevValue) : newValue;
			sessionStorage.setProperty(name, updatedValue);
			return updatedValue;
		});
	};

	return [value, updateState];
}
