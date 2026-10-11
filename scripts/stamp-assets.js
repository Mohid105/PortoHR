'use strict';

/**
 * Adds a version to every stylesheet and script address in the pages (and to the theme stylesheet that
 * theme-early.js loads), e.g. /css/theme.css?v=20261009-0142. Hosts and CDNs cache static files by
 * address, so without this an upload can keep showing the old design until each browser's cache expires.
 * Run it before building the zip:  npm run stamp
 */

const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, '..', 'public');
const d = new Date();
const pad = (n) => String(n).padStart(2, '0');
const version = process.argv[2] || `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;

const ASSET = /((?:href|src)=")(\/(?:css|js)\/[A-Za-z0-9._-]+\.(?:css|js))(?:\?v=[A-Za-z0-9._-]+)?(")/g;
let changed = 0;

fs.readdirSync(publicDir).filter((f) => f.endsWith('.html')).forEach((file) => {
  const full = path.join(publicDir, file);
  const before = fs.readFileSync(full, 'utf8');
  const after = before.replace(ASSET, `$1$2?v=${version}$3`);
  if (after !== before) { fs.writeFileSync(full, after); changed += 1; }
});

// The design-system stylesheet is added by script, so stamp it there.
const early = path.join(publicDir, 'js', 'theme-early.js');
const src = fs.readFileSync(early, 'utf8');
const next = src.replace(/link\.href = '\/css\/theme\.css(?:\?v=[A-Za-z0-9._-]+)?';/, `link.href = '/css/theme.css?v=${version}';`);
if (next !== src) { fs.writeFileSync(early, next); changed += 1; }

// The pages compare their own version with this file, and reload once if they are an old cached copy.
fs.writeFileSync(path.join(publicDir, 'version.json'), JSON.stringify({ v: version }) + '\n');

console.log(`Stamped assets with version ${version} (${changed} files updated).`);
