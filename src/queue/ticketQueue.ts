import { Queue } from 'bullmq';

const REDIS_URL: String = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

// Parse Redis URL to extract connection options
const parseRedisUrl = (url: String) => {
  const urlObj = new URL(url.toString());
  return {
    host: urlObj.hostname,
    port: parseInt(urlObj.port) || 6379,
  };
};

const connection = parseRedisUrl(REDIS_URL);

// Create ticket release queue
const ticketQueue = new Queue('ticket-releases', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: {
      count: 100, // Keep last 100 completed jobs
      age: 3600, // Keep for 1 hour
    },
    removeOnFail: {
      count: 500, // Keep last 500 failed jobs
    },
  },
});

ticketQueue.on('error', (err) => {
  console.error('Ticket Queue Error:', err);
});

export { ticketQueue };
