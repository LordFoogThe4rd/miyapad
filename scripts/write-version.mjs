import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
const resolved = process.env.MIYAPAD_VERSION || version;

writeFileSync(join(root, 'src', 'version.ts'), `export const APP_VERSION = '${resolved}';\n`);
console.log(`Wrote src/version.ts (v${resolved})`);
