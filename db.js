'use strict';
const { MongoClient } = require('mongodb');
class MongodbClient {
  constructor(url, dbName, { client } = {}) {
    this.client = client || new MongoClient(url, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000,
      socketTimeoutMS: 10000, maxPoolSize: 10, monitorCommands: false });
    this.dbName = dbName;
  }
  async connect() {
    await this.client.connect();
    const db = this.client.db(this.dbName);
    this.userCol = db.collection('user');
    this.dmChannelCol = db.collection('dmChannel');
    this.tempCol = db.collection('temp');
    return this;
  }
  async ping() { await this.client.db(this.dbName).command({ ping: 1 }, { timeoutMS: 2000 }); }
  async close() { await this.client.close(); }
}
module.exports = MongodbClient;
