const { getDefaultConfig } = require('expo/metro-config');
const { isExcluded, releaseBlockList } = require('./config/boundaries.cjs');

const config = getDefaultConfig(__dirname);
config.resolver.unstable_enablePackageExports = true;
config.resolver.blockList = [
  ...(Array.isArray(config.resolver.blockList)
    ? config.resolver.blockList
    : config.resolver.blockList
      ? [config.resolver.blockList]
      : []),
  ...releaseBlockList(__dirname),
];
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const result = context.resolveRequest(context, moduleName, platform);
  const files =
    result.type === 'assetFiles'
      ? result.filePaths
      : result.type === 'sourceFile'
        ? [result.filePath]
        : [];
  if (files.some(isExcluded))
    throw new Error('App graph excludes tests, helpers, fixtures and spikes.');
  return result;
};
module.exports = config;
