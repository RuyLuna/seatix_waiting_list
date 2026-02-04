require('dotenv').config();
const express = require('express');
const bodyParser = require('express').json;
const waitlistRoutes = require('./routes/waitlist');
const providersRoutes = require('./routes/providers');
const initDb = require('./scripts/init_db');
const seedApiKeys = require('./scripts/seed_api_keys');
const { connect: connectRedis } = require('./cache/redis');
const { rebuildRedisQueues } = require('./scripts/rebuild_redis_queues');
const { startWorker } = require('./workers/ticketWorker');
const { startExpirationListener } = require('./workers/offerExpirationListener');

const app = express();
app.use(bodyParser());

// initialize DB (creates tables if needed)
initDb()
  .then(() => seedApiKeys())
  .then(() => {
    console.log('Database and test API keys initialized');
  })
  .catch(err => {
    console.error('Failed to initialize DB or seed API keys', err);
    process.exit(1);
  });

// initialize Redis and rebuild queues from SQLite if needed
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
  .catch(err => {
    console.error('Failed to initialize Redis or rebuild queues', err);
    process.exit(1);
  });

app.use('/waitlist', waitlistRoutes);
app.use('/providers', providersRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Seatix waitlist API listening on port ${PORT}`);
});
