import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const distDir = path.join(root, 'miyapad-dist');

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

// sqlite-zstd is user-provided for now; will be built and bundled later
const nodeDest = process.platform === 'win32' ? 'node.exe' : 'node';
fs.copyFileSync(process.execPath, path.join(distDir, nodeDest));

fs.copyFileSync(
  path.join(root, 'dist-server', 'server.cjs'),
  path.join(distDir, 'server.cjs')
);

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
ZSTD="libsqlite_zstd.so"
[ "\$(uname -s)" = "Darwin" ] && ZSTD="libsqlite_zstd.dylib"
if [ ! -f "\$DIR/\$ZSTD" ]; then
  echo "Error: \$ZSTD not found in \$DIR" >&2
  echo "Download the sqlite-zstd extension for your platform from:" >&2
  echo "  https://github.com/phiresky/sqlite-zstd" >&2
  exit 1
fi
exec "\$DIR/node" "\$DIR/server.cjs" "\$@"
`, { mode: 0o755 });

fs.writeFileSync(path.join(distDir, 'miyapad.bat'), `@echo off
set "DIR=%~dp0"
set "ZSTD=%DIR%sqlite_zstd.dll"
if not exist "%ZSTD%" (
  echo Error: sqlite_zstd.dll not found
  echo Download from https://github.com/phiresky/sqlite-zstd
  exit /b 1
)
"%DIR%node.exe" "%DIR%server.cjs" %*
`);

console.log(`Distribution assembled at ${distDir}`);
