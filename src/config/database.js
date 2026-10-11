'use strict';

const mongoose = require('mongoose');
const env = require('./env');
const logger = require('../utils/logger');

mongoose.set('strictQuery', true);

let listenersBound = false;
let connecting;

function bindListeners() {
  if (listenersBound) return;
  listenersBound = true;
  mongoose.connection.on('connected', () => logger.info('MongoDB connected'));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('error', (err) => logger.error('MongoDB error:', err.message));
}

async function connectDatabase(uri = env.mongoUri) {
  bindListeners();
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (!connecting) {
    connecting = mongoose
      .connect(uri, {
        serverSelectionTimeoutMS: 10000,
        maxPoolSize: env.mongoPoolSize,
        // Build indexes on first boot; afterwards they already exist and this is a no-op.
        autoIndex: true,
      })
      .then(() => mongoose.connection)
      .catch((err) => {
        connecting = null;
        throw err;
      });
  }
  return connecting;
}

/** Tries a few times with a pause, so a database that is still starting does not kill the app. */
async function connectWithRetry(attempts = 5, delayMs = 3000) {
  let lastError;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await connectDatabase();
    } catch (err) {
      lastError = err;
      logger.warn(`MongoDB not reachable (attempt ${i}/${attempts}): ${err.message}`);
      if (i < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

async function disconnectDatabase() {
  await mongoose.connection.close();
}

module.exports = { connectDatabase, connectWithRetry, disconnectDatabase };
