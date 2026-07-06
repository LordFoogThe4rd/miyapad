import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const distDir = path.join(root, 'miyapad-dist');

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

const nodeDest = process.platform === 'win32' ? 'node.exe' : 'node';
fs.copyFileSync(process.execPath, path.join(distDir, nodeDest));

fs.copyFileSync(
  path.join(root, 'dist-server', 'server.cjs'),
  path.join(distDir, 'server.cjs')
);

const zstdLibName = process.platform === 'win32' ? 'sqlite_zstd.dll'
  : `libsqlite_zstd.${process.platform === 'darwin' ? 'dylib' : 'so'}`;
const zstdSrc = path.join(root, zstdLibName);
if (fs.existsSync(zstdSrc)) {
  fs.copyFileSync(zstdSrc, path.join(distDir, zstdLibName));
} else {
  console.warn(`Warning: ${zstdLibName} not found, skipping`);
}

const copyDir = (src, dest) => {
  if (!fs.existsSync(src)) return;
  fs.cpSync(src, dest, { recursive: true });
};

copyDir(path.join(root, '..', 'dist'), path.join(distDir, 'dist'));
copyDir(path.join(root, 'tokenizers'), path.join(distDir, 'tokenizers'));
copyDir(path.join(root, 'node_modules'), path.join(distDir, 'node_modules'));

fs.copyFileSync(path.join(root, '..', 'LICENSE'), path.join(distDir, 'LICENSE'));

fs.copyFileSync(path.join(root, 'THIRD_PARTY_LICENSES'), path.join(distDir, 'THIRD_PARTY_LICENSES'));

fs.writeFileSync(path.join(distDir, 'miyapad.sh'), `#!/bin/sh
set -e
DIR="\$(CDPATH='' cd -- "\$(dirname -- "\$0")" && pwd -P)"
exec "\$DIR/node" "\$DIR/server.cjs" "\$@"
`, { mode: 0o755 });

fs.writeFileSync(path.join(distDir, 'miyapad.bat'), `@echo off
set "DIR=%~dp0"
"%DIR%node.exe" "%DIR%server.cjs" %*
`);

console.log(`Distribution assembled at ${distDir}`);
