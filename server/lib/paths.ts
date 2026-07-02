import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const basedir = (() => {
	if (typeof __dirname !== 'undefined') return __dirname as string;
	return path.dirname(fileURLToPath(import.meta.url));
})();

export function resolveExeRelative(name: string, sourcePath: string): string {
	const exePath = path.join(path.dirname(process.execPath), name);
	return fs.existsSync(exePath) ? exePath : sourcePath;
}
