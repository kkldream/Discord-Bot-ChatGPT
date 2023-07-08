const {MongoClient} = require("mongodb");

class MongodbClient {
    static DB_NAME = "dcbot_chatgpt-dev";
    #client;
    tempCol;
    userCol;
    dmChannelCol;

    constructor(url) {
        this.#client = new MongoClient(url);
    }

    async connect() {
        this.#client = await this.#client.connect();
        const db = this.#client.db(MongodbClient.DB_NAME);
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
