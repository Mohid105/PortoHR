'use strict';

const app = require('./app');
const env = require('./config/env');
const logger = require('./utils/logger');
const { connectWithRetry, disconnectDatabase } = require('./config/database');

let server;
let shuttingDown = false;

async function start() {
  try {
    await connectWithRetry();
  } catch (err) {
    logger.error('Could not reach MongoDB:', err.message);
    process.exit(1);
  }

  try {
    await require('./services/shift.service').ensureDefaults();
  } catch (err) {
    logger.warn('Could not load shifts, using the built-in ones:', err.message);
  }

  server = app.listen(env.port, env.host, () => {
    logger.info(`PortoHR listening on http://${env.host}:${env.port} (${env.nodeEnv})`);
  });
  // Longer than the usual 60s proxy idle timeout, so the proxy never reuses a socket we already closed.
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
}

async function shutdown(signal, code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.warn(`${signal} received, shutting down`);
  // Never hang: force the exit if connections do not drain.
  const timer = setTimeout(() => process.exit(code || 1), 10000);
  timer.unref();
  try {
    if (server) await new Promise((resolve) => server.close(resolve));
    await disconnectDatabase();
  } catch (err) {
    logger.error('Error while shutting down:', err.message);
  }
  process.exit(code);
}

['SIGINT', 'SIGTERM'].forEach((signal) => process.on(signal, () => shutdown(signal)));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection:', reason && reason.stack ? reason.stack : reason);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', err.stack || err);
  shutdown('uncaughtException', 1);
});

start();
