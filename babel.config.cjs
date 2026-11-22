module.exports = function (api) {
  api.cache(true);
  // babel-preset-expo configures the SDK-matched Reanimated/worklets transform.
  return { presets: [require.resolve('expo/internal/babel-preset')] };
};
