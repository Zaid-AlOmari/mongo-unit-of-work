import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

const eslintRecommendedRules = tsPlugin.configs['eslint-recommended'].overrides[0].rules;

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2015,
      sourceType: 'module',
      parser: tsParser,
      globals: {
        Atomics: 'readonly',
        SharedArrayBuffer: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...eslintRecommendedRules,
      'no-unused-vars': 'off',
    },
  },
];
