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
      .connect(uri, { serverSelectionTimeoutMS: 10000, maxPoolSize: 5 })
      .then(() => mongoose.connection)
      .catch((err) => {
        connecting = null;
        throw err;
      });
  }
  return connecting;
}

async function disconnectDatabase() {
  await mongoose.connection.close();
}

module.exports = { connectDatabase, disconnectDatabase };
