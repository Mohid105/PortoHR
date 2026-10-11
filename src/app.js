'use strict';

const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const env = require('./config/env');
const apiRoutes = require('./routes');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();
const publicDir = path.join(__dirname, '..', 'public');

app.set('trust proxy', env.trustProxy);
app.disable('x-powered-by');

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        // No inline or eval script: the pages ship compiled CSS and external scripts only.
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        // Inline style attributes are used for computed widths and colours.
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        ...(env.isProduction ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: env.isProduction ? { maxAge: 15552000, includeSubDomains: true } : false,
  })
);

// CORS is off unless origins are listed: the app and API share one origin.
if (env.corsOrigin) {
  const allowed = env.corsOrigin.split(',').map((origin) => origin.trim()).filter(Boolean);
  app.use(cors({ origin: allowed, credentials: true }));
}
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(env.isProduction ? 'combined' : 'dev'));

// A blanket limit for the whole API; sign-in has its own, stricter one.
app.use(
  '/api',
  rateLimit({
    windowMs: 60 * 1000,
    limit: env.apiRateLimit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests, please slow down' },
  })
);

app.use(
  express.static(publicDir, {
    extensions: ['html'],
    // Files are revalidated with their ETag on every load, so a deploy is picked up at once.
    setHeaders(res, filePath) {
      if (/\.(woff2?|png|jpe?g|svg|ico|webp)$/i.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=86400');
      else res.setHeader('Cache-Control', 'no-cache');
    },
  })
);

app.use('/api', apiRoutes);

// Unmatched /api/* requests get JSON; anything else falls back to the login page.
app.use('/api', notFound);
app.get('*', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));

app.use(errorHandler);

module.exports = app;
