'use strict';

const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const IntegrationConnector = require('../models/IntegrationConnector');
const WebhookDelivery = require('../models/WebhookDelivery');
const env = require('../config/env');
const logger = require('../utils/logger');

const SIGNATURE_HEADER = 'x-portohr-signature';
const EVENT_HEADER = 'x-portohr-event';
const DELIVERY_HEADER = 'x-portohr-delivery';

function isSeedProcess() {
  return String(process.argv[1] || '').includes('seed.js');
}

function present(doc) {
  if (!doc) return null;
  const json = doc.toJSON ? doc.toJSON() : doc;
  json.id = String(json.id || json._id);
  return json;
}

function inboxUrl() {
  return `http://127.0.0.1:${env.port}/api/integrations/inbox`;
}

function signBody(secret, raw) {
  return crypto.createHmac('sha256', secret || '').update(raw).digest('hex');
}

function signatureHeader(secret, raw) {
  return `sha256=${signBody(secret, raw)}`;
}

function verifySignature(secret, raw, header) {
  const expected = signatureHeader(secret, raw);
  const given = String(header || '');
  if (!secret || !given || expected.length !== given.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given));
  } catch (err) {
    return false;
  }
}

function postJson(url, headers, raw) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (err) {
      reject(new Error('Invalid endpoint URL'));
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      reject(new Error('Endpoint must be http or https'));
      return;
    }
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method: 'POST',
        headers: Object.assign(
          {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(raw),
          },
          headers
        ),
        timeout: 8000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            body: Buffer.concat(chunks).toString('utf8').slice(0, 400),
          });
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Webhook timed out'));
    });
    req.write(raw);
    req.end();
  });
}

async function webhookConnector() {
  let row = await IntegrationConnector.findOne({ kind: 'webhook' });
  if (!row) {
    row = await IntegrationConnector.create({
      kind: 'webhook',
      name: 'Outbound webhook',
      enabled: true,
      endpoint: inboxUrl(),
      secret: 'portohr-webhook-dev',
      rateLimitPerMin: 60,
    });
    return row;
  }
  if (!row.endpoint) {
    row.enabled = true;
    row.endpoint = inboxUrl();
    row.secret = row.secret || 'portohr-webhook-dev';
    await row.save();
  }
  return row;
}

async function rateLimited(connector) {
  const perMin = Number(connector && connector.rateLimitPerMin) || 60;
  const since = new Date(Date.now() - 60 * 1000);
  const recent = await WebhookDelivery.countDocuments({
    direction: 'out',
    createdAt: { $gte: since },
    status: { $in: ['sent', 'queued', 'failed'] },
  });
  return recent >= perMin;
}

async function deliver(event, payload) {
  const connector = await webhookConnector();
  const data = payload && typeof payload === 'object' ? payload : {};
  const endpoint = (connector && connector.endpoint && connector.endpoint.trim()) || inboxUrl();
  const row = await WebhookDelivery.create({
    direction: 'out',
    event,
    payload: data,
    endpoint,
    status: 'queued',
  });

  if (!connector || !connector.enabled) {
    row.status = 'held';
    row.lastError = connector ? 'Webhook connector is disabled' : 'Webhook connector is missing';
    await row.save();
    return present(row);
  }

  if (!/^https?:\/\//i.test(endpoint)) {
    row.status = 'held';
    row.lastError = 'No http(s) endpoint configured';
    await row.save();
    return present(row);
  }

  if (await rateLimited(connector)) {
    row.status = 'failed';
    row.lastError = `Rate limit ${connector.rateLimitPerMin}/min reached`;
    row.attempts = 1;
    await row.save();
    return present(row);
  }

  const envelope = {
    event,
    occurredAt: new Date().toISOString(),
    deliveryId: String(row._id),
    data,
  };
  const raw = JSON.stringify(envelope);
  const secret = connector.secret || '';
  const signature = signatureHeader(secret, raw);
  row.signature = signature;
  row.attempts = (row.attempts || 0) + 1;

  try {
    const response = await postJson(
      endpoint,
      {
        [EVENT_HEADER]: event,
        [DELIVERY_HEADER]: String(row._id),
        [SIGNATURE_HEADER]: signature,
      },
      raw
    );
    row.responseStatus = response.status;
    if (response.status >= 200 && response.status < 300) {
      row.status = 'sent';
      row.deliveredAt = new Date();
      row.lastError = '';
    } else {
      row.status = 'failed';
      row.lastError = `HTTP ${response.status} ${response.body || ''}`.trim().slice(0, 240);
    }
  } catch (err) {
    row.status = 'failed';
    row.lastError = (err && err.message ? err.message : 'Delivery failed').slice(0, 240);
  }

  await row.save();
  return present(row);
}

function emit(event, payload) {
  if (isSeedProcess()) return;
  setImmediate(() => {
    deliver(event, payload).catch((err) => {
      logger.warn('Webhook emit failed:', err && err.message ? err.message : err);
    });
  });
}

function emitApprovalCompleted(fields) {
  emit('approval.completed', {
    kind: fields.kind || '',
    decision: fields.decision || '',
    objectId: fields.objectId ? String(fields.objectId) : '',
    employeeCode: fields.employeeCode || '',
    fullName: fields.fullName || '',
  });
}

async function receiveInbox(headers, body) {
  const connector = await webhookConnector();
  const raw = JSON.stringify(body || {});
  const header = headers[SIGNATURE_HEADER] || headers['X-PortoHR-Signature'] || '';
  const event = (body && body.event) || headers[EVENT_HEADER] || 'unknown';

  if (!connector || !connector.secret) {
    const row = await WebhookDelivery.create({
      direction: 'in',
      event,
      payload: body || {},
      status: 'rejected',
      lastError: 'Webhook secret is not configured',
    });
    return { ok: false, status: 401, delivery: present(row), message: 'Webhook secret is not configured' };
  }

  if (!verifySignature(connector.secret, raw, header)) {
    const row = await WebhookDelivery.create({
      direction: 'in',
      event,
      payload: body || {},
      status: 'rejected',
      lastError: 'Invalid HMAC signature',
    });
    return { ok: false, status: 401, delivery: present(row), message: 'Invalid HMAC signature' };
  }

  const row = await WebhookDelivery.create({
    direction: 'in',
    event,
    payload: body || {},
    status: 'received',
    signature: String(header),
    deliveredAt: new Date(),
  });
  return { ok: true, status: 202, delivery: present(row) };
}

async function listDeliveries(query) {
  const filter = {};
  if (query && query.direction && ['in', 'out'].indexOf(query.direction) !== -1) {
    filter.direction = query.direction;
  }
  const rows = await WebhookDelivery.find(filter).sort({ createdAt: -1 }).limit(80);
  return rows.map(present);
}

module.exports = {
  inboxUrl,
  present,
  signBody,
  signatureHeader,
  verifySignature,
  deliver,
  emit,
  emitApprovalCompleted,
  receiveInbox,
  listDeliveries,
};
