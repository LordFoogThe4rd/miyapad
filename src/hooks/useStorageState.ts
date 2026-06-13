import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';

export function useStorageState<T>(storage: { getStorageData(): T; performFullSave(data: T): Promise<void> }, initialState: T): [T, Dispatch<SetStateAction<T>>] {
	const savedState = useMemo(() => storage.getStorageData(), []);

	const [value, setValue] = useState(Object.keys(savedState as Record<string, unknown>).length === 0 ? initialState : savedState);

	const updateState = (newValue: SetStateAction<T>) => {
		setValue((prevValue) => {
			const updatedValue = typeof newValue === 'function' ? (newValue as (prev: T) => T)(prevValue) : newValue;
			storage.performFullSave(updatedValue);
			return updatedValue;
		});
	};

	return [value, updateState];
}
