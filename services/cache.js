// Think of this like a middleware file where we are overwriting what happens when you
// run a query in mongoDB

const mongoose = require("mongoose");
const redis = require("redis");
// used to promisify call
const util = require("util");

const redisUrl = "redis://127.0.0.1:6379";
const client = redis.createClient(redisUrl);
client.hget = util.promisify(client.hget);

// We want to manipulate the mongoose source code
// stores a reference to the original exec function
const exec = mongoose.Query.prototype.exec;

// adding another function
mongoose.Query.prototype.cache = function (options = {}) {
  // this = the query instance
  this.useCache = true;
  // if user passes in key (arbitary name) -> we will use this
  this.hashKey = JSON.stringify(options.key || "");

  return this;
};

// extra code to overwrite this function
// we have to use this notation
// Think of this code like middleware which runs ahead of every mongo db query
mongoose.Query.prototype.exec = async function () {
  if (!this.useCache) {
    return exec.apply(this, arguments);
  }

  // Object.assign is used to safely copy properties from one object to another
  const key = JSON.stringify(
    Object.assign({}, this.getQuery(), {
      collection: this.mongooseCollection.name,
    })
  );
  console.log(key);

  // See if we have a value for key in Redis,
  const cacheValue = await client.hget(this.hashKey, key);

  if (cacheValue) {
    // remember we are writing middleware to overwrite the exec function.
    // the exec function doesn't deal with stored JSON in Redis
    // it deals with mongooseDocuments
    console.log("returning cached data");
    console.log(cacheValue);
    // reference to current query executing
    console.log(this);
    // new creates a new instance of that model
    // this.model() refers to the model that this query is attached to
    const doc = JSON.parse(cacheValue);
    // we have to handle the case where doc = object and doc = array of objects
    // check if Array
    return Array.isArray(doc)
      ? doc.map((d) => new this.model(d))
      : new this.model(doc);
  }
  // If we do return that

  // Otherwise issue the query and store the result in Redis

  const result = await exec.apply(this, arguments);
  console.log(result);

  client.hset(this.hashKey, key, JSON.stringify(result), "EX", 10);
  return result;
};

module.exports = {
  clearHash(hashKey) {
    client.del(JSON.stringify(hashKey));
  },
};
