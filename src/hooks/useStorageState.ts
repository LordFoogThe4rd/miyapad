import { useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';

export function useStorageState<T>(storage: { getStorageData(): T; performFullSave(data: T): Promise<void> }, initialState: T): [T, Dispatch<SetStateAction<T>>] {
	const savedState = useMemo(() => storage.getStorageData(), []);

	const [value, setValue] = useState(Object.keys(savedState as Record<string, unknown>).length === 0 ? initialState : savedState);

	const versionRef = useRef(0);
	const latestValueRef = useRef(value);
	const saveChainRef = useRef<Promise<void>>(Promise.resolve());
	const persistedRef = useRef(value);

	const updateState = (newValue: SetStateAction<T>) => {
		const myVersion = ++versionRef.current;
		const prevValue = latestValueRef.current;
		const nextValue = typeof newValue === 'function' ? (newValue as (prev: T) => T)(prevValue) : newValue;
		latestValueRef.current = nextValue;
		setValue(nextValue);

		const snapshot = nextValue;
		saveChainRef.current = saveChainRef.current.then(async () => {
			try {
				await storage.performFullSave(snapshot);
				persistedRef.current = snapshot;
			} catch (error) {
				if (myVersion === versionRef.current) {
					setValue(persistedRef.current);
					latestValueRef.current = persistedRef.current;
				}
				reportError(error instanceof Error ? error : new Error(String(error)));
			}
		});
	};

	return [value, updateState];
}
