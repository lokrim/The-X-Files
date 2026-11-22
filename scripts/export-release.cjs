const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
fs.rmSync(path.join(root, '.artifacts/release'), {
  recursive: true,
  force: true,
});
const result = spawnSync(
  process.execPath,
  [
    require.resolve('expo/bin/cli'),
    'export',
    '--platform',
    'android',
    '--output-dir',
    '.artifacts/release',
    '--source-maps',
    '--dump-assetmap',
    '--max-workers',
    '2',
  ],
  {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, CI: '1', EXPO_NO_TELEMETRY: '1' },
  },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
require('./check-release-graph.cjs');
