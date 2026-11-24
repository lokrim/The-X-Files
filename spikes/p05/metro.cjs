if (
  process.env.NODE_ENV === 'production' ||
  process.env.XFILES_P05_BENCH !== '1'
)
  throw new Error('P05 device benchmark is development-only.');
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');
const config = getDefaultConfig(path.resolve(__dirname, '../..'));
config.resolver.unstable_enablePackageExports = true;
module.exports = config;
