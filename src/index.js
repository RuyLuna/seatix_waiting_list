require('dotenv').config();
const express = require('express');
const bodyParser = require('express').json;
const waitlistRoutes = require('./routes/waitlist');
const providersRoutes = require('./routes/providers');
const initDb = require('./scripts/init_db');
const { connect: connectRedis } = require('./cache/redis');
const { rebuildRedisQueues } = require('./scripts/rebuild_redis_queues');

const app = express();
app.use(bodyParser());

// initialize DB (creates tables if needed)
initDb().catch(err => {
  console.error('Failed to initialize DB', err);
  process.exit(1);
});

// initialize Redis and rebuild queues from SQLite if needed
connectRedis()
  .then(() => rebuildRedisQueues())
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
