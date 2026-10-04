'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createRuntime } = require('../lib/runtime');
const { config, tick } = require('./helpers');
function fixture() {
  const calls = []; let ready = true; let pingFails = false; let handleRequest;
  const server = new EventEmitter();
  server.listen = (_port, _host, callback) => { calls.push('listen'); server.listening = true; callback(); };
  server.close = callback => { calls.push('server.close'); server.listening = false; callback(); };
  const db = { connect: async () => { calls.push('connect'); }, close: async () => { calls.push('db.close'); },
    ping: async () => { calls.push('ping'); if (pingFails) throw new Error('offline failure'); } };
  const client = { user: { id: 'bot' }, on() {}, isReady: () => ready,
    login: async () => { calls.push('login'); }, destroy: async () => { calls.push('destroy'); } };
  const runtime = createRuntime(config(), { db, client, store: {}, provider: {}, system: 'system',
    createServer: handler => { handleRequest = handler; return server; }, logger: { info() {}, error() {} } });
  function request(url = '/readyz') {
    return new Promise(resolve => {
      const response = { status: null, writeHead(status) { this.status = status; return this; },
        end(body) { this.writableEnded = true; resolve({ status: this.status, body: body ? JSON.parse(body) : null }); } };
      handleRequest({ url }, response);
    });
  }
  return { runtime, calls, db, client, server, request, setReady: value => { ready = value; }, setPingFails: value => { pingFails = value; } };
}
test('readiness is false before startup, true only with Gateway and DB, and false after stop', async () => {
  const f = fixture(); assert.equal((await f.request()).status, 503);
  await f.runtime.start(); assert.deepEqual(await f.request(), { status: 200, body: { ready: true } });
  f.setReady(false); assert.equal((await f.request()).status, 503);
  f.setReady(true); f.setPingFails(true); assert.equal((await f.request()).status, 503);
  f.setPingFails(false); assert.equal((await f.request('/unknown')).status, 404);
  await f.runtime.stop(); assert.equal((await f.request()).status, 503);
});
test('shutdown received during database startup prevents a later bot login and closes connected resources', async () => {
  const f = fixture(); let release;
  f.db.connect = async () => { f.calls.push('connect'); await new Promise(resolve => { release = resolve; }); };
  const start = f.runtime.start(); await tick(); const stop = f.runtime.stop();
  release(); await Promise.all([start, stop]);
  assert.ok(!f.calls.includes('login')); assert.ok(!f.calls.includes('listen')); assert.ok(f.calls.includes('db.close'));
});
test('shutdown during health-server startup does not proceed to bot login', async () => {
  const f = fixture(); let listen;
  f.server.listen = (_port, _host, callback) => { f.server.listening = true; listen = callback; };
  const start = f.runtime.start(); await tick(); const stop = f.runtime.stop(); listen();
  await Promise.all([start, stop]); assert.ok(!f.calls.includes('login')); assert.ok(f.calls.includes('server.close'));
});
test('shutdown cleanup attempts every resource and rejects rather than hiding failure', async () => {
  const f = fixture(); f.db.close = async () => { f.calls.push('db.close'); throw new Error('offline-close-failure'); };
  await f.runtime.start(); await assert.rejects(f.runtime.stop(), error => error.code === 'UNEXPECTED');
  assert.ok(f.calls.includes('destroy')); assert.ok(f.calls.includes('server.close'));
});
test('repeated start is idempotent and stopping before start does not open connections', async () => {
  const first = fixture(); await Promise.all([first.runtime.start(), first.runtime.start()]); await first.runtime.stop();
  assert.equal(first.calls.filter(call => call === 'connect').length, 1);
  const second = fixture(); await second.runtime.stop(); await second.runtime.start();
  assert.ok(!second.calls.includes('connect')); assert.ok(!second.calls.includes('login'));
});
