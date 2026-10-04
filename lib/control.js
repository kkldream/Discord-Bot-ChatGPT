'use strict';
const { AppError } = require('./errors');
class KeyedQueue {
  constructor({ maxPendingPerUser = 8, maxPendingTotal = 100 } = {}) {
    this.maxPerKey = maxPendingPerUser; this.maxTotal = maxPendingTotal;
    this.tails = new Map(); this.counts = new Map(); this.total = 0; this.closed = false;
  }
  run(key, task) {
    if (this.closed) return Promise.reject(new AppError('STOPPING'));
    if (this.total >= this.maxTotal || (this.counts.get(key) || 0) >= this.maxPerKey) return Promise.reject(new AppError('BUSY'));
    this.total++;
    this.counts.set(key, (this.counts.get(key) || 0) + 1);
    const result = (this.tails.get(key) || Promise.resolve()).then(task);
    const cleanup = () => {
      this.total--;
      const count = this.counts.get(key) - 1;
      if (count) this.counts.set(key, count); else this.counts.delete(key);
      if (this.tails.get(key) === tail) this.tails.delete(key);
    };
    const tail = result.then(cleanup, cleanup);
    this.tails.set(key, tail);
    return result;
  }
  async drain() { this.closed = true; await Promise.all(this.tails.values()); }
}
class RequestGate {
  constructor(config, now = Date.now) { this.config = config; this.now = now; this.users = new Map(); this.window = 0; this.used = 0; this.active = 0; }
  async run(userId, task) {
    const window = Math.floor(this.now() / 60000);
    if (window !== this.window) { this.window = window; this.users.clear(); this.used = 0; }
    const userCount = this.users.get(userId) || 0;
    if (userCount >= this.config.requestsPerMinute || this.used >= this.config.globalRequestsPerMinute) throw new AppError('RATE_LIMIT');
    if (this.active >= this.config.maxConcurrent) throw new AppError('BUSY');
    this.used++; this.users.set(userId, userCount + 1); this.active++;
    try { return await task(); } finally { this.active--; }
  }
}
class EventCache {
  constructor({ max = 10000, ttlMs = 600000, now = Date.now } = {}) { this.max = max; this.ttlMs = ttlMs; this.now = now; this.events = new Map(); }
  claim(id) {
    const now = this.now();
    for (const [key, expires] of this.events) { if (expires > now) break; this.events.delete(key); }
    if (this.events.has(id)) return false;
    if (this.events.size >= this.max) throw new AppError('BUSY');
    this.events.set(id, now + this.ttlMs); return true;
  }
}
module.exports = { KeyedQueue, RequestGate, EventCache };
