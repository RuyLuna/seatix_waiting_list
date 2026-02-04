const redis = require('redis');

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const client = redis.createClient({ url: REDIS_URL });

client.on('error', (err) => {
  console.error('Redis Client Error:', err.message);
});

async function connect() {
  if (!client.isOpen) {
    await client.connect();
    console.log('Connected to Redis at:', REDIS_URL);
  }
}

module.exports = { client, connect, REDIS_URL };
