import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
let commit = 'source-archive';
let dirty = false;
try {
  commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  dirty = !!execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
} catch { /* GitHub source archives can be built without a .git directory. */ }
const info = { component: 'plugin-frontend', version, commit, builtAt: new Date().toISOString(), dirty };
for (const [file, text] of [
  ['public/version.json', JSON.stringify(info, null, 2) + '\n'],
  ['src/build-info.ts', '// Generated frontend build metadata.\nexport const BUILD_INFO = ' + JSON.stringify(info, null, 2) + ' as const;\n'],
]) {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
}
