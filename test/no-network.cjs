'use strict';
// Every offline test worker blocks actual network transports. SDK tests inject fetch.
const blocked = () => { throw new Error('NETWORK_DISABLED_IN_OFFLINE_TEST'); };
require('node:net').Socket.prototype.connect = blocked;
require('node:tls').connect = blocked;
for (const name of ['node:http', 'node:https']) {
  const module = require(name); module.request = blocked; module.get = blocked;
}
const dns = require('node:dns'); dns.lookup = blocked; dns.resolve = blocked;
globalThis.fetch = blocked;
