'use strict';
module.exports = [{ ignores: ['node_modules/**', '.artifacts/**', 'coverage/**', 'scripts/baseline-regressions.cjs'] }, {
  files: ['**/*.js', '**/*.cjs'],
  languageOptions: { ecmaVersion: 2024, sourceType: 'commonjs', globals: {
    Buffer: 'readonly', console: 'readonly', process: 'readonly', AbortSignal: 'readonly',
    AbortController: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', setImmediate: 'readonly',
    URL: 'readonly', Response: 'readonly', Headers: 'readonly', fetch: 'readonly', structuredClone: 'readonly',
  } },
  rules: { 'no-undef': 'error', 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
    'no-unreachable': 'error', 'no-async-promise-executor': 'error', 'no-unsafe-finally': 'error',
    'constructor-super': 'error', 'valid-typeof': 'error', 'no-dupe-args': 'error', 'no-dupe-keys': 'error' },
}];
