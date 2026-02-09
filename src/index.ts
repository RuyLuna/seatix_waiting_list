import 'dotenv/config';
import express, { Express } from 'express';
import waitlistRoutes from './routes/waitlist.js';
import providersRoutes from './routes/providers.js';
import seedApiKeys from './scripts/seed_api_keys.js';
import { connect as connectRedis } from './cache/redis.js';
import { rebuildRedisQueues } from './scripts/rebuild_redis_queues.js';
import { startWorker } from './workers/ticketWorker.js';
import { startExpirationListener } from './workers/offerExpirationListener.js';
import { prisma } from './db/prisma.js';

const app: Express = express();
app.use(express.json());

// Initialize Prisma and seed API keys
(async () => {
  try {
    await prisma.$connect();
    console.log('✅ Database connected successfully');
    
    // Test connection with a simple query
    const count = await prisma.waitlist.count();
    console.log(`📊 Waitlist entries: ${count}`);
    
    // Seed test API keys
    await seedApiKeys();
    console.log('Database and test API keys initialized');
  } catch (err) {
    console.error('❌ Failed to initialize database or seed API keys', err);
    process.exit(1);
  }
})();

// Initialize Redis and rebuild queues from database if needed
connectRedis()
  .then(() => rebuildRedisQueues())
  .then(() => {
    // Start the ticket release worker after Redis is connected
    startWorker();
    console.log('Ticket release worker initialized');
    
    // Start the offer expiration listener
    return startExpirationListener();
  })
  .then(() => {
    console.log('Offer expiration listener initialized');
  })
  .catch((err: Error) => {
    console.error('Failed to initialize Redis or rebuild queues', err);
    process.exit(1);
  });

app.use('/waitlist', waitlistRoutes);
app.use('/providers', providersRoutes);

const PORT: number = parseInt(process.env.PORT || '3000', 10);

// Export app for testing
export default app;

// Only start server if this file is run directly (not imported)
if (import.meta.url === `file://${process.argv[1]}`) {
  app.listen(PORT, () => {
    console.log(`Seatix waitlist API listening on port ${PORT}`);
  });
}
