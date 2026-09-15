'use strict';

function maskTail(value, visible) {
  const text = String(value || '').trim();
  if (!text) return '';
  const keep = visible || 4;
  if (text.length <= keep) return '•'.repeat(text.length);
  return '•'.repeat(Math.max(4, text.length - keep)) + text.slice(-keep);
}

function maskNationalId(value) {
  const text = String(value || '').replace(/\s/g, '');
  if (!text) return '';
  if (text.includes('-') && text.length >= 13) {
    return text.slice(0, 5) + '-*******-' + text.slice(-1);
  }
  return maskTail(text, 3);
}

function maskAccount(value) {
  return maskTail(String(value || '').replace(/\s/g, ''), 4);
}

module.exports = { maskTail, maskNationalId, maskAccount };
