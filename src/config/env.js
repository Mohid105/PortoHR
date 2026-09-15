'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 5000,
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/portohr',
  jwtSecret: process.env.JWT_SECRET || 'portohr-dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  corsOrigin: process.env.CORS_ORIGIN || '*',
};

env.isProduction = env.nodeEnv === 'production';

if (env.isProduction && env.jwtSecret === 'portohr-dev-secret-change-me') {
  throw new Error('JWT_SECRET must be set to a unique value in production');
}

module.exports = env;
