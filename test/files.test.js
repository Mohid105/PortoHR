'use strict';

const test = require('node:test');
const assert = require('node:assert');
const files = require('../src/services/files.service');

const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 1)]);
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64)]);

test('real PDFs and images are accepted and typed by their bytes', () => {
  assert.strictEqual(files.inspect(pdf, 'contract.pdf').mime, 'application/pdf');
  assert.strictEqual(files.inspect(png, 'cnic.PNG').mime, 'image/png');
});

test('a program renamed to .pdf is refused', () => {
  assert.throws(() => files.inspect(exe, 'invoice.pdf'), /must match its extension/);
});

test('an extension that does not match the bytes is refused', () => {
  assert.throws(() => files.inspect(pdf, 'photo.png'));
  assert.throws(() => files.inspect(pdf, 'script.js'));
});

test('empty and oversized files are refused', () => {
  assert.throws(() => files.inspect(Buffer.alloc(0), 'a.pdf'), /empty/);
  assert.throws(() => files.inspect(Buffer.concat([pdf, Buffer.alloc(files.MAX_BYTES)]), 'big.pdf'), /5 MB/);
});

test('file names lose paths and control characters', () => {
  assert.strictEqual(files.cleanName('..\\..\\secret/evil"name.pdf'), 'evilname.pdf');
  assert.strictEqual(files.cleanName(''), 'document');
});
