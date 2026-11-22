// Explicit development-only launcher. Never imported by the application.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const backup = path.join(root, '.artifacts/p01b/wiring.json');
const targets = ['package.json', 'metro.config.cjs', 'tsconfig.json'];
if (process.argv.includes('--restore')) {
  const saved = JSON.parse(fs.readFileSync(backup, 'utf8'));
  for (const name of targets)
    fs.writeFileSync(path.join(root, name), saved[name]);
  fs.unlinkSync(backup);
  process.exit(0);
}
if (process.env.XFILES_P01B !== '1' || process.env.NODE_ENV === 'production') {
  throw new Error('Use XFILES_P01B=1 for this development-only harness.');
}
if (fs.existsSync(backup))
  throw new Error('Restore previous spike wiring first.');
fs.mkdirSync(path.dirname(backup), { recursive: true });
const saved = Object.fromEntries(
  targets.map((name) => [name, fs.readFileSync(path.join(root, name), 'utf8')]),
);
fs.writeFileSync(backup, JSON.stringify(saved));
function restore() {
  for (const name of targets)
    fs.writeFileSync(path.join(root, name), saved[name]);
  if (fs.existsSync(backup)) fs.unlinkSync(backup);
}
process.on('exit', restore);
const pkg = JSON.parse(saved['package.json']);
pkg.main = 'spikes/p01b/index.tsx';
pkg.expo = {
  ...pkg.expo,
  autolinking: {
    ...pkg.expo?.autolinking,
    nativeModulesDir: './spikes/p01b/native',
  },
};
fs.writeFileSync(
  path.join(root, 'package.json'),
  JSON.stringify(pkg, null, 2) + '\n',
);
fs.writeFileSync(
  path.join(root, 'metro.config.cjs'),
  "module.exports = require('./spikes/p01b/metro.cjs');\n",
);
const child = spawn(
  process.execPath,
  [
    path.join(root, 'node_modules/expo/bin/cli'),
    'start',
    '--dev-client',
    '--localhost',
    '--port',
    '8081',
    '--clear',
  ],
  {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, XFILES_P01B: '1', EXPO_NO_TELEMETRY: '1' },
  },
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => child.kill(signal));
child.on('error', () => process.exit(1));
child.on('exit', (code) => process.exit(code ?? 1));
