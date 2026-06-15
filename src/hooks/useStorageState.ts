import { useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';

export function useStorageState<T>(storage: { getStorageData(): T; performFullSave(data: T): Promise<void> }, initialState: T): [T, Dispatch<SetStateAction<T>>] {
	const savedState = useMemo(() => storage.getStorageData(), []);

	const [value, setValue] = useState(Object.keys(savedState as Record<string, unknown>).length === 0 ? initialState : savedState);

	const versionRef = useRef(0);
	const updateState = (newValue: SetStateAction<T>) => {
		const myVersion = ++versionRef.current;
		setValue((prevValue) => {
			const updatedValue = typeof newValue === 'function' ? (newValue as (prev: T) => T)(prevValue) : newValue;
			storage.performFullSave(updatedValue).catch((error) => {
				setValue((current) => myVersion === versionRef.current ? prevValue : current);
				reportError(error);
			});
			return updatedValue;
		});
	};

	return [value, updateState];
}
