'use strict';
const { spawnSync } = require('node:child_process');
const { mkdirSync, writeFileSync } = require('node:fs');
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run using npm run sbom.');
const result = spawnSync(process.execPath, [npm, 'sbom', '--sbom-format=cyclonedx'], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
if (result.status !== 0) { console.error('SBOM generation failed.'); process.exitCode = 1; }
else {
  JSON.parse(result.stdout);
  mkdirSync('.artifacts', { recursive: true });
  writeFileSync('.artifacts/sbom.cdx.json', result.stdout, 'utf8');
  console.log('Wrote .artifacts/sbom.cdx.json');
}
