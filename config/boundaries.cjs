const path = require('node:path');

const forbiddenPart =
  /(?:^|[/\\])(?:test-utils|__tests__|spikes|fixtures|coverage)(?:[/\\]|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/;
const excludedRoots = ['test-utils', '__tests__', 'spikes'];
const allowedPackages = new Set([
  'react',
  'react-native',
  'expo',
  'expo-router',
  'expo-status-bar',
  'expo-font',
  'expo-document-picker',
  'expo-file-system',
  'expo-sharing',
  'expo-clipboard',
  'expo-screen-capture',
  'expo-haptics',
  'expo-crypto',
  'expo-keep-awake',
  'expo-secure-store',
  'expo-system-ui',
  '@expo/vector-icons',
  '@expo/ui',
  'zustand',
  'react-native-reanimated',
  'react-native-worklets',
  'react-native-safe-area-context',
  'react-native-screens',
  'react-native-gesture-handler',
  'react-native-quick-crypto',
  'react-native-nitro-modules',
  'react-native-quick-base64',
  '@noble/hashes',
]);
function packageName(specifier) {
  return specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0];
}
function isExcluded(file) {
  return forbiddenPart.test(file);
}
function releaseBlockList(root) {
  const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [
    new RegExp(
      `${escaped}[/\\\\](?:test-utils|__tests__|spikes|fixtures|coverage)(?:[/\\\\]|$)`,
    ),
    /\.(test|spec)\.[cm]?[jt]sx?$/,
  ];
}
function localTarget(specifier, from, root) {
  if (specifier.startsWith('@/'))
    return path.resolve(root, 'src', specifier.slice(2));
  if (specifier.startsWith('.'))
    return path.resolve(path.dirname(from), specifier);
  if (path.isAbsolute(specifier)) return specifier;
  return null;
}
function importViolation(specifier, from, root) {
  const target = localTarget(specifier, from, root);
  if (isExcluded(specifier) || (target && isExcluded(target)))
    return 'Test helpers/spikes cannot enter app imports or assets.';
  const core = path
    .relative(root, from)
    .replaceAll('\\', '/')
    .startsWith('src/core/');
  if (target) {
    const relative = path.relative(root, target).replaceAll('\\', '/');
    if (
      !relative.startsWith('src/') &&
      !relative.startsWith('app/') &&
      !relative.startsWith('assets/')
    )
      return 'App imports must stay in src/app/assets.';
    if (core && !relative.startsWith('src/core/'))
      return 'Core imports must stay within core.';
    return null;
  }
  if (core && !/^@noble\/hashes\/(?:sha2|hmac)\.js$/.test(specifier))
    return 'Core has no React/native/platform/Node or concrete KDF dependencies.';
  if (!allowedPackages.has(packageName(specifier)))
    return `Package is not approved for offline application imports: ${specifier}`;
  if (
    specifier === 'expo' &&
    path.relative(root, from).replaceAll('\\', '/') !== 'src/platform/native.ts'
  )
    return 'Expo native bridge is confined to the platform adapter.';
  if (
    specifier.startsWith('expo/') ||
    specifier.startsWith('react-native/') ||
    (specifier.startsWith('expo-file-system/') &&
      specifier !== 'expo-file-system/legacy')
  )
    return 'Unapproved native/internal or file-system subpath.';
  if (specifier.startsWith('zustand/') && specifier !== 'zustand/vanilla')
    return 'Generic persistence middleware is outside the settings-only storage boundary.';
  if (specifier.startsWith('@noble/hashes/') && !specifier.endsWith('.js'))
    return 'Noble 2.x imports require explicit .js subpaths.';
  if (
    packageName(specifier) === 'expo-secure-store' &&
    path.relative(root, from).replaceAll('\\', '/') !==
      'src/platform/settings-storage.ts'
  )
    return 'Persistence is confined to the settings-only adapter.';
  return null;
}
module.exports = {
  excludedRoots,
  isExcluded,
  releaseBlockList,
  importViolation,
  packageName,
};
