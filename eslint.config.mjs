import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import offline from './config/eslint-offline.cjs';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      '.expo/**',
      '.artifacts/**',
      'android/**',
      'ios/**',
      'dist/**',
    ],
  },
  {
    ...js.configs.recommended,
    files: [
      'src/**/*.{ts,tsx}',
      'app/**/*.{ts,tsx}',
      '__tests__/**/*.{ts,tsx}',
    ],
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: [
      'src/**/*.{ts,tsx}',
      'app/**/*.{ts,tsx}',
      '__tests__/**/*.{ts,tsx}',
      'test-utils/**/*.{ts,tsx}',
    ],
  })),
  {
    files: ['src/**/*.{ts,tsx}', 'app/**/*.{ts,tsx}'],
    plugins: { offline },
    rules: { 'no-console': 'error', 'offline/boundaries': 'error' },
  },
);
