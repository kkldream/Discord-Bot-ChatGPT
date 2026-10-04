'use strict';
// Local/CI tripwire, not a substitute for a full secret scanner or credential rotation.
// Reports paths and rule names only; never prints a matching secret or source line.
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const rules = [
  ['private-key', /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['github-token', /\b(?:gh[pousr]_[0-9A-Za-z]{30,}|github_pat_[0-9A-Za-z_]{30,})\b/],
  ['openai-style-key', /\bsk-(?:proj-|svcacct-)?[0-9A-Za-z_-]{32,}\b/],
  ['aws-access-key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['discord-token', /\b[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}\b/],
  ['credential-bearing-uri', /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|https?):\/\/[^\s/"'<>]+:[^\s/"'<>]+@/i],
];
function findIssues(name, bytes) {
  const path = name.replace(/\\/g, '/'); const findings = [];
  if (/(?:^|\/)\.env(?:$|\.)/.test(path) && !/(?:^|\/)\.env\.example$/.test(path)) findings.push({ rule: 'private-env-file' });
  if (/\.(?:backup|bak|orig|rej|pem|key|p12|pfx)$/i.test(path) ||
      /(?:^|\/)(?:id_rsa|id_ed25519|credentials\.json|service-account[^/]*\.json)$/i.test(path) ||
      /(?:^|\/)(?:\.artifacts|node_modules|backups?|\.local-backups)(?:\/|$)/.test(path)) findings.push({ rule: 'private-or-generated-file' });
  const text = bytes.toString('utf8');
  for (const [rule, pattern] of rules) {
    const match = pattern.exec(text);
    if (match) findings.push({ rule, line: text.slice(0, match.index).split('\n').length });
  }
  return findings;
}
function scan(staged = false) {
  const git = args => execFileSync('git', args, { maxBuffer: 32 * 1024 * 1024 });
  const entries = staged ? git(['ls-files', '--stage', '-z']).toString('utf8').split('\0').filter(Boolean).map(row => {
    const match = /^(\d+) ([0-9a-f]+) ([0-3])\t([\s\S]+)$/.exec(row);
    if (!match || match[3] !== '0') throw new Error('Index has unresolved entries');
    return { name: match[4], oid: match[2] };
  }) : git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).toString('utf8').split('\0').filter(Boolean).map(name => ({ name }));
  const findings = [];
  for (const entry of entries) {
    const bytes = staged ? git(['cat-file', 'blob', entry.oid]) : readFileSync(entry.name);
    for (const issue of findIssues(entry.name, bytes)) findings.push({ path: entry.name, ...issue });
  }
  return { mode: staged ? 'index' : 'worktree', checkedFiles: entries.length, findings };
}
if (require.main === module) {
  try {
    const result = scan(process.argv.includes('--staged'));
    console.log(JSON.stringify(result)); if (result.findings.length) process.exitCode = 1;
  } catch { console.error('Secret scan could not complete; commit/push must not proceed.'); process.exitCode = 1; }
}
module.exports = { findIssues, scan };
