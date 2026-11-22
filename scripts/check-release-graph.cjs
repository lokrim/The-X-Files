const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isExcluded } = require('../config/boundaries.cjs');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.artifacts/release');
function walk(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? walk(path.join(dir, entry.name))
        : [path.join(dir, entry.name)],
    );
}
const files = walk(output);
const maps = files.filter((file) => file.endsWith('.map'));
assert(maps.length > 0, 'No actual Metro source map to inspect');
const sources = maps.flatMap(
  (file) => JSON.parse(fs.readFileSync(file, 'utf8')).sources,
);
assert(
  sources.some((source) => /(?:^|\/)app\/index\.tsx$/.test(source)),
  'Home was not in the actual graph',
);
for (const source of sources) {
  assert(!isExcluded(source), `Development/test source shipped: ${source}`);
  assert(
    !/(?:expo-updates|expo-notifications|@notifee|@sentry|axios|firebase|fflate|jszip)(?:\/|$)/.test(
      source,
    ),
    `Unauthorized runtime module: ${source}`,
  );
}
const metadata = JSON.parse(
  fs.readFileSync(path.join(output, 'metadata.json'), 'utf8'),
);
assert(metadata.fileMetadata.android.bundle, 'Missing embedded Android bundle');
const assets = metadata.fileMetadata.android.assets;
assert(assets.length > 0, 'Bundled icon font/assets missing');
const assetMap = JSON.parse(
  fs.readFileSync(path.join(output, 'assetmap.json'), 'utf8'),
);
for (const asset of Object.values(assetMap)) {
  for (const file of asset.files || [])
    assert(!isExcluded(file), `Development asset shipped: ${file}`);
}
fs.writeFileSync(
  path.join(output, 'graph-evidence.json'),
  JSON.stringify(
    {
      sources: sources.length,
      assets: assets.length,
      hasHome: true,
      excludedHelpers: true,
      otaAbsent: true,
    },
    null,
    2,
  ),
);
console.log(
  `PASS: actual production Metro graph (${sources.length} sources), ${assets.length} local assets and embedded Android JS inspected.`,
);
