// Node 25 exposes a method-less `localStorage` stub when no `--localstorage-file`
// path is given, and vitest's jsdom population skips `localStorage` because the
// key already exists on globalThis. Install a working in-memory Storage so tests
// that read/write persistent state don't crash on the stub.
const store = new Map<string, string>();
const storage: Storage = {
	get length() { return store.size; },
	clear: () => store.clear(),
	getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
	key: (index: number) => (index >= 0 && index < store.size ? [...store.keys()][index]! : null),
	removeItem: (key: string) => { store.delete(key); },
	setItem: (key: string, value: string) => { store.set(key, String(value)); },
};
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
