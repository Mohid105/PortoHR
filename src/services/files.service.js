'use strict';

/**
 * Personnel-file storage in MongoDB GridFS: no extra service to run, and the
 * files are backed up with the rest of the data. Uploads are checked by their
 * actual bytes, never by what the browser claims they are.
 */

const mongoose = require('mongoose');
const { Readable } = require('stream');
const ApiError = require('../utils/ApiError');

const MAX_BYTES = 5 * 1024 * 1024;

/** Kinds we accept: how to recognise the bytes, and which extensions may carry them. */
const KINDS = [
  { mime: 'application/pdf', ext: ['pdf'], match: (b) => b.slice(0, 4).toString('latin1') === '%PDF' },
  { mime: 'image/png', ext: ['png'], match: (b) => b.length > 8 && b[0] === 0x89 && b.slice(1, 4).toString('latin1') === 'PNG' },
  { mime: 'image/jpeg', ext: ['jpg', 'jpeg'], match: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ext: ['docx'],
    match: (b) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04,
  },
  {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ext: ['xlsx'],
    match: (b) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04,
  },
  { mime: 'application/msword', ext: ['doc'], match: (b) => b.length > 4 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0 },
  { mime: 'application/vnd.ms-excel', ext: ['xls'], match: (b) => b.length > 4 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0 },
];

function extensionOf(name) {
  const match = /\.([A-Za-z0-9]{1,5})$/.exec(String(name || ''));
  return match ? match[1].toLowerCase() : '';
}

/** A filename safe to store and to put in a header: no paths, no control characters. */
function cleanName(name) {
  const base = String(name || 'document').split(/[\\/]/).pop();
  // eslint-disable-next-line no-control-regex
  const safe = base.replace(/[\u0000-\u001f\u007f"<>:|?*]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
  return safe || 'document';
}

/**
 * Decides what an upload really is. Throws a friendly error for anything that
 * is too big, empty, of a type we do not take, or whose bytes disagree with
 * its extension (a program renamed to .pdf, for instance).
 */
function inspect(buffer, filename) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw ApiError.badRequest('The file is empty');
  if (buffer.length > MAX_BYTES) throw ApiError.badRequest('Files can be at most 5 MB');
  const ext = extensionOf(filename);
  const kind = KINDS.find((k) => k.ext.includes(ext) && k.match(buffer));
  if (!kind) {
    throw ApiError.badRequest('Only PDF, JPG, PNG, Word and Excel files are accepted, and the file must match its extension');
  }
  return { mime: kind.mime, name: cleanName(filename), size: buffer.length };
}

function bucket() {
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'personnel_files' });
}

function store(buffer, filename, metadata) {
  return new Promise((resolve, reject) => {
    const upload = bucket().openUploadStream(filename, { metadata });
    upload.on('error', reject);
    upload.on('finish', () => resolve(upload.id));
    Readable.from(buffer).pipe(upload);
  });
}

function openDownload(id) {
  return bucket().openDownloadStream(new mongoose.Types.ObjectId(String(id)));
}

async function remove(id) {
  try {
    await bucket().delete(new mongoose.Types.ObjectId(String(id)));
  } catch (err) {
    /* already gone */
  }
}

module.exports = { MAX_BYTES, inspect, cleanName, store, openDownload, remove };
