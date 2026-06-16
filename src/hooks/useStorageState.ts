import { useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';

export function useStorageState<T>(storage: { getStorageData(): T; performFullSave(data: T): Promise<void> }, initialState: T): [T, Dispatch<SetStateAction<T>>] {
	const savedState = useMemo(() => storage.getStorageData(), []);

	const [value, setValue] = useState(Object.keys(savedState as Record<string, unknown>).length === 0 ? initialState : savedState);

	const versionRef = useRef(0);
	const latestValueRef = useRef(value);
	const updateState = (newValue: SetStateAction<T>) => {
		const myVersion = ++versionRef.current;
		const prevValue = latestValueRef.current;
		const nextValue = typeof newValue === 'function' ? (newValue as (prev: T) => T)(prevValue) : newValue;
		latestValueRef.current = nextValue;
		setValue(nextValue);
		storage.performFullSave(nextValue).catch((error) => {
			if (myVersion === versionRef.current) {
				setValue(prevValue);
				latestValueRef.current = prevValue;
			}
			reportError(error instanceof Error ? error : new Error(String(error)));
		});
	};

	return [value, updateState];
}
