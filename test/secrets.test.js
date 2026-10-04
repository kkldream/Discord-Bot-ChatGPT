'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { findIssues } = require('../scripts/check-secrets');
const scan = (path, value = '') => findIssues(path, Buffer.from(value));
test('private environment and draft filenames are rejected even if force-added', () => {
  for (const path of ['.env', '.env.dev', '.env.prod', 'config/.env.local', 'openaiApi.js.backup',
    'private.pem', 'credentials.json', '.artifacts/evidence.json']) assert.ok(scan(path).length, path);
});
test('public env template placeholders are allowed but embedded credentials are not', () => {
  assert.deepEqual(scan('.env.example', 'GEMINI_API_KEY=replace-gemini-key'), []);
  assert.ok(scan('.env.example', 'GEMINI_API_KEY=' + 'AIza' + 'z'.repeat(35)).length);
});
test('common secret formats are detected without including the secret in a finding', () => {
  const secrets = ['ghp_' + 'x'.repeat(36), 'sk-proj-' + 'x'.repeat(40), 'AKIA' + 'A'.repeat(16),
    ['-----BEGIN ', 'PRIVATE KEY-----'].join(''), ['mongodb://', 'user:password', '@host.invalid'].join('')];
  for (const secret of secrets) {
    const found = scan('source.js', secret); assert.ok(found.length);
    assert.ok(!JSON.stringify(found).includes(secret));
  }
});
test('safe test fixtures and filenames do not require scanner bypasses', () => {
  assert.deepEqual(scan('test/fixture.js', "const key = 'offline-gemini-key';"), []);
  assert.deepEqual(scan('lib/providers/gemini.js', 'const endpoint = "https://generativelanguage.googleapis.com";'), []);
});
