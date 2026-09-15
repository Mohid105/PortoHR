'use strict';

/**
 * Vercel serverless entry. Local `npm start` still uses src/server.js.
 * Mongo is connected on the first request and reused across warm invocations.
 */
const app = require('../src/app');
const { connectDatabase } = require('../src/config/database');

module.exports = async (req, res) => {
  await connectDatabase();
  return app(req, res);
};
