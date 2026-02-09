import redis, { RedisClientType } from 'redis';

const REDIS_URL: string = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const client: RedisClientType = redis.createClient({ url: REDIS_URL });

client.on('error', (err: Error) => {
  console.error('Redis Client Error:', err.message);
});

async function connect(): Promise<void> {
  if (!client.isOpen) {
    await client.connect();
    console.log('Connected to Redis at:', REDIS_URL);
  }
}

export { client, connect, REDIS_URL };
