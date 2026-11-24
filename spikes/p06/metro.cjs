const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

if (process.env.NODE_ENV !== 'development')
  throw new Error('The P06 component gallery requires development Metro.');

const root = path.resolve(__dirname, '../..');
const config = getDefaultConfig(root);
const rewrite = config.server.rewriteRequestUrl;

// Retarget only this server's Android dev bundle. The Router entry and route tree on
// disk stay untouched, and the ordinary Metro config blocks this entire directory.
config.server.rewriteRequestUrl = (url) => {
  const resolved = rewrite(url);
  const parsed = new URL(resolved, 'http://localhost');
  if (
    parsed.searchParams.get('platform') === 'android' &&
    parsed.searchParams.get('dev') === 'true' &&
    /\/expo-router\/entry(?:\.js)?\.bundle$/.test(parsed.pathname)
  )
    return `/spikes/p06/index.bundle${parsed.search}`;
  return resolved;
};

module.exports = config;
