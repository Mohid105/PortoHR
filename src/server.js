'use strict';

const app = require('./app');
const env = require('./config/env');
const logger = require('./utils/logger');
const { connectDatabase, disconnectDatabase } = require('./config/database');

let server;

async function start() {
  try {
    await connectDatabase();
  } catch (err) {
    logger.error('Could not reach MongoDB:', err.message);
    process.exit(1);
  }

  server = app.listen(env.port, () => {
    logger.info(`PortoHR API listening on http://localhost:${env.port} (${env.nodeEnv})`);
  });
}

async function shutdown(signal) {
  logger.warn(`${signal} received, shutting down`);
  if (server) await new Promise((resolve) => server.close(resolve));
  await disconnectDatabase();
  process.exit(0);
}

['SIGINT', 'SIGTERM'].forEach((signal) => process.on(signal, () => shutdown(signal)));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection:', reason);
  shutdown('unhandledRejection');
});

start();
