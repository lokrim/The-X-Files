if (process.env.XFILES_P01B !== '1' || process.env.NODE_ENV === 'production') {
  throw new Error('P01b Metro configuration is development-only.');
}
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(path.resolve(__dirname, '../..'));
config.resolver.unstable_enablePackageExports = true;
module.exports = config;
