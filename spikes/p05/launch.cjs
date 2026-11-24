// Explicit debug-only launcher. The original project entry/config are restored
// byte-for-byte on exit. Native autolinking continues to use production modules.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const backup = path.join(root, '.artifacts/p05/bench-wiring.json');
const files = ['package.json', 'metro.config.cjs'];

function restore() {
  const saved = JSON.parse(fs.readFileSync(backup, 'utf8'));
  for (const name of files)
    fs.writeFileSync(path.join(root, name), saved[name]);
  fs.unlinkSync(backup);
}
if (process.argv.includes('--restore')) {
  restore();
  process.exit(0);
}
if (
  process.env.NODE_ENV === 'production' ||
  process.env.XFILES_P05_BENCH !== '1'
)
  throw new Error('Set XFILES_P05_BENCH=1 for the development-only harness.');
const port = process.env.XFILES_P05_PORT ?? '8081';
if (!/^[0-9]{1,5}$/.test(port) || Number(port) < 1024 || Number(port) > 65535)
  throw new Error(
    'XFILES_P05_PORT must be an available TCP port from 1024 to 65535.',
  );
fs.mkdirSync(path.dirname(backup), { recursive: true });
const saved = Object.fromEntries(
  files.map((name) => [name, fs.readFileSync(path.join(root, name), 'utf8')]),
);
fs.writeFileSync(backup, JSON.stringify(saved), { flag: 'wx' });
process.on('exit', restore);
const pkg = JSON.parse(saved['package.json']);
pkg.main = 'spikes/p05/index.tsx';
fs.writeFileSync(
  path.join(root, 'package.json'),
  JSON.stringify(pkg, null, 2) + '\n',
);
fs.writeFileSync(
  path.join(root, 'metro.config.cjs'),
  "module.exports = require('./spikes/p05/metro.cjs');\n",
);
const child = spawn(
  process.execPath,
  [
    require.resolve('expo/bin/cli'),
    'start',
    '--dev-client',
    '--localhost',
    '--port',
    port,
  ],
  {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, EXPO_OFFLINE: '1', EXPO_NO_TELEMETRY: '1' },
  },
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => child.kill(signal));
child.on('error', () => process.exit(1));
child.on('exit', (code) => process.exit(code ?? 0));
