import { useMemo, useState } from 'react';

export function useStorageState(storage: any, initialState: any) {
	const savedState = useMemo(() => storage.getStorageData(), []);

	const [value, setValue] = useState(Object.keys(savedState).length === 0 ? initialState : savedState);

	const updateState = (newValue: any) => {
		setValue((prevValue: any) => {
			const updatedValue = typeof newValue === 'function' ? newValue(prevValue) : newValue;
			storage.performFullSave(updatedValue);
			return updatedValue;
		});
	};

	return [value, updateState];
}
