const {MongoClient} = require("mongodb");

class MongodbClient {
    #client;
    dbName;
    tempCol;
    userCol;
    dmChannelCol;

    constructor(url, dbName) {
        this.#client = new MongoClient(url);
        this.dbName = dbName;
    }

    async connect() {
        this.#client = await this.#client.connect();
        const db = this.#client.db(this.dbName);
        this.tempCol = db.collection('temp');
        this.userCol = db.collection('user');
        this.dmChannelCol = db.collection('dmChannel');
    }

    db(dbName) {
        return this.#client.db(dbName);
    }

    close() {
        this.#client.close().then(r => {
            console.log('mongo client is disconnect')
        });
    }
}

module.exports = MongodbClient;
