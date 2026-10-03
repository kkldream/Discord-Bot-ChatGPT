'use strict';
const port = process.env.READINESS_PORT || '8080';
if (!/^\d+$/.test(port)) process.exitCode = 1;
else void fetch(`http://127.0.0.1:${port}/readyz`, { signal: AbortSignal.timeout(3000) })
  .then(response => { if (!response.ok) process.exitCode = 1; })
  .catch(() => { process.exitCode = 1; });
