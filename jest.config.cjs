const shared = {
  preset: 'jest-expo',
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  // Noble v2 ESM must be transformed, with its explicit .js package exports intact.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|expo-.*|@noble/hashes|react-native-.*)/)',
  ],
};
module.exports = {
  watchman: false,
  projects: [
    {
      ...shared,
      displayName: 'core-node',
      testEnvironment: 'node',
      setupFiles: [],
      testMatch: ['<rootDir>/__tests__/core/**/*.test.ts'],
    },
    {
      ...shared,
      displayName: 'app',
      testMatch: [
        '<rootDir>/__tests__/app/**/*.test.ts',
        '<rootDir>/__tests__/app/**/*.test.tsx',
      ],
    },
  ],
};
