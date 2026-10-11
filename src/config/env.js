'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const DEV_SECRET = 'portohr-dev-secret-change-me';

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';

const env = {
  nodeEnv,
  isProduction,
  port: Number(process.env.PORT) || 5000,
  host: process.env.HOST || '0.0.0.0',
  mongoUri: process.env.MONGO_URI || (isProduction ? '' : 'mongodb://127.0.0.1:27017/portohr'),
  /** The company's clock. Shifts, punches, "today" and month boundaries all follow it, whatever the server's own timezone. */
  timezone: process.env.APP_TIMEZONE || 'Asia/Karachi',
  mongoPoolSize: Number(process.env.MONGO_POOL_SIZE) || (isProduction ? 10 : 5),
  jwtSecret: process.env.JWT_SECRET || DEV_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  /** Comma-separated origins allowed to call the API from another site. Empty = same-origin only. */
  corsOrigin: (process.env.CORS_ORIGIN || '').trim(),
  /** Number of reverse proxies in front of the app (Hostinger / nginx / Cloudflare = 1). */
  trustProxy: process.env.TRUST_PROXY === undefined ? 1 : Number(process.env.TRUST_PROXY),
  /** Requests per minute per IP across the whole API. */
  apiRateLimit: Number(process.env.API_RATE_LIMIT) || 600,
};

/** Production refuses to start on unsafe or missing settings, with a message saying what to fix. */
function assertProductionReady(cfg) {
  const problems = [];
  if (!cfg.mongoUri) problems.push('MONGO_URI is not set (use your MongoDB Atlas or server connection string).');
  if (cfg.jwtSecret === DEV_SECRET || cfg.jwtSecret.length < 32) {
    problems.push('JWT_SECRET must be set to a random string of at least 32 characters.');
  }
  if (!require('../utils/zoned').isValidTimeZone(cfg.timezone)) {
    problems.push(`APP_TIMEZONE "${cfg.timezone}" is not a valid timezone name (for example Asia/Karachi).`);
  }
  if (cfg.corsOrigin === '*') {
    problems.push('CORS_ORIGIN must not be "*" in production. Leave it empty for same-origin, or list your site, e.g. https://hr.example.com.');
  }
  if (problems.length) {
    throw new Error(`Cannot start in production:\n - ${problems.join('\n - ')}`);
  }
}

if (isProduction) assertProductionReady(env);

env.assertProductionReady = assertProductionReady;
module.exports = env;
