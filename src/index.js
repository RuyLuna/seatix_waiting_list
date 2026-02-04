require('dotenv').config();
const express = require('express');
const bodyParser = require('express').json;
const waitlistRoutes = require('./routes/waitlist');
const providersRoutes = require('./routes/providers');
const initDb = require('./scripts/init_db');
const { connect: connectRedis } = require('./cache/redis');

const app = express();
app.use(bodyParser());

// initialize DB (creates tables if needed)
initDb().catch(err => {
  console.error('Failed to initialize DB', err);
  process.exit(1);
});

// initialize Redis
connectRedis().catch(err => {
  console.error('Failed to connect to Redis', err);
  process.exit(1);
});

app.use('/waitlist', waitlistRoutes);
app.use('/providers', providersRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Seatix waitlist API listening on port ${PORT}`);
});
