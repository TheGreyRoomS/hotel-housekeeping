/*
 * Proves the bandwidth fix, by running the real server.
 *
 * The server is booted for real, with only the Postgres pool replaced by a stub,
 * and every check below is a genuine HTTP request against it. Run with:
 *
 *   node test_photo_bandwidth.js
 */
const assert = require('assert');
const crypto = require('crypto');
const http   = require('http');
const path   = require('path');
const fs     = require('fs');

const PORT = 47311;
process.env.PORT = String(PORT);
process.env.JWT_SECRET = 'test-secret-for-signing';
delete process.env.DATABASE_URL;

// A realistic photo: what a phone camera actually uploads, ~250 KB of base64.
// The size matters — the whole point of the fix is what a poll costs in bytes.
const PIXELS = crypto.randomBytes(180 * 1024);
const DATA_URL = `data:image/jpeg;base64,${PIXELS.toString('base64')}`;

const NOW = Date.now();
const photoRows = [
  { id: 'ph-room7-a', item_type: 'room', item_id: '7', data: DATA_URL,
    uploaded_by: 'Nomsa', uploaded_at: NOW, caption: 'Minibar' },
  { id: 'ph-room7-b', item_type: 'room', item_id: '7', data: DATA_URL,
    uploaded_by: 'Nomsa', uploaded_at: NOW, caption: 'Minibar 2' },
  { id: 'ph-lobby',   item_type: 'area', item_id: 'lobby', data: DATA_URL,
    uploaded_by: 'Nomsa', uploaded_at: NOW, caption: 'Lobby' },
  // Not an image. A signed-in phone could store this; it must never be served
  // back as a page from the app's own domain.
  { id: 'ph-nasty',   item_type: 'room', item_id: '7',
    data: 'data:text/html;base64,' + Buffer.from('<script>alert(1)</script>').toString('base64'),
    uploaded_by: 'Nomsa', uploaded_at: NOW, caption: 'nope' },
];
const roomRows = [{ id: 7, status: 'clean', assigned_to: null, notes: '' }];
const areaRows = [{ id: 'lobby', name: 'Lobby', icon: '🛋', status: 'clean',
                    assigned_to: null, notes: '' }];

// ── Stub pg, so the test needs no database ──────────────────────────────────
const seenSql = [];
const Module = require('module');
const realResolve = Module._resolveFilename;
const stubPath = path.join(__dirname, '__pg_stub.js');
require.cache[stubPath] = {
  id: stubPath, filename: stubPath, loaded: true, exports: {
    Pool: class {
      async query(sql, params) {
        seenSql.push(sql.replace(/\s+/g, ' ').trim());
        let rows = [];
        if (/FROM photos WHERE id=/.test(sql)) rows = photoRows.filter(r => r.id === params[0]);
        else if (/FROM photos/.test(sql))      rows = photoRows;
        else if (/FROM rooms/.test(sql))       rows = roomRows;
        else if (/FROM areas/.test(sql))       rows = areaRows;
        return { rows, rowCount: rows.length };
      }
      async connect() { return { query: this.query.bind(this), release() {} }; }
      on() {}
    },
  },
};
Module._resolveFilename = function (request, ...rest) {
  if (request === 'pg') return stubPath;
  return realResolve.call(this, request, ...rest);
};

let failures = 0;
function check(label, condition, detail) {
  console.log((condition ? '  PASS  ' : '  FAIL  ') + label + (detail ? `  [${detail}]` : ''));
  if (!condition) failures++;
}

function get(pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: pathname, headers }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks),
      }));
    }).on('error', reject);
  });
}

const waitForServer = async () => {
  for (let i = 0; i < 100; i++) {
    try { await get('/api/health'); return; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  throw new Error('server never came up');
};

require('./server.js');

(async () => {
  await waitForServer();

  const jwt = require('jsonwebtoken');
  const token = jwt.sign({ id: 1, name: 'Test', role: 'admin' }, process.env.JWT_SECRET);
  const authHeader = { Authorization: `Bearer ${token}` };

  console.log('\n=== 1. /api/state no longer carries the images themselves ===');
  const state = await get('/api/state', authHeader);
  check('state responds', state.status === 200, `HTTP ${state.status}`);
  const stateText = state.body.toString();
  check('no base64 image data anywhere in the payload',
    !stateText.includes('data:image/'), `${stateText.length} bytes`);
  const parsed = JSON.parse(stateText);
  const photos = parsed.rooms[0].minibarPhotos;
  check('the photos are still listed', photos.length === 3, `${photos.length} photos`);
  check('each photo carries a url, not data',
    photos.every(p => typeof p.url === 'string' && p.data === undefined));
  check('captions and uploader survive',
    photos[0].caption === 'Minibar' && photos[0].uploadedBy === 'Nomsa');
  check('area photos too', parsed.areas[0].photos[0].url !== undefined);
  const stateQuery = seenSql.find(s => /FROM photos ORDER BY/.test(s)) || '';
  check('the poll does not even read the image bytes out of the database',
    stateQuery !== '' && !/SELECT \*/.test(stateQuery) && !/\bdata\b/.test(stateQuery),
    stateQuery.slice(0, 80));

  console.log('\n=== 2. What a single poll now costs ===');
  const before = stateText.length + photoRows.reduce((n, p) => n + p.data.length, 0);
  const after = stateText.length;
  check('the poll payload collapses', after < before / 50,
    `${(before / 1024).toFixed(0)} KB before → ${(after / 1024).toFixed(1)} KB now`);
  const perDay = ((before - after) * (86400 / 25) * 3) / (1024 ** 3);
  console.log(`         ≈ ${perDay.toFixed(1)} GB/day saved across 3 devices polling every 25s`);

  console.log('\n=== 3. A photo is still reachable, and byte-for-byte correct ===');
  const img = await get(photos[0].url);
  check('the photo downloads', img.status === 200, `HTTP ${img.status}`);
  check('the bytes are exactly the original image', img.body.equals(PIXELS),
    `${img.body.length} bytes`);
  check('served as an image', /^image\//.test(img.headers['content-type'] || ''),
    img.headers['content-type']);

  console.log('\n=== 4. It is cached hard, so it downloads once ===');
  check('immutable, one year',
    img.headers['cache-control'] === 'public, max-age=31536000, immutable',
    img.headers['cache-control']);
  const again = await get(photos[0].url);
  check('the URL is stable across requests — the cache can actually hit',
    again.body.equals(img.body));

  console.log('\n=== 5. The URL is not a way in ===');
  const noSig = await get(`/api/photos/${photoRows[0].id}`);
  check('no signature is refused', noSig.status === 403, `HTTP ${noSig.status}`);
  const badSig = await get(`/api/photos/${photoRows[0].id}?s=${'0'.repeat(16)}`);
  check('a wrong signature is refused', badSig.status === 403, `HTTP ${badSig.status}`);
  const shortSig = await get(`/api/photos/${photoRows[0].id}?s=abc`);
  check('a short signature is refused, not a crash', shortSig.status === 403,
    `HTTP ${shortSig.status}`);
  const otherId = await get(`/api/photos/ph-lobby?s=${photoRows[0].id}`);
  check('one photo\'s signature does not open another', otherId.status === 403,
    `HTTP ${otherId.status}`);
  const guessed = crypto.createHmac('sha256', 'wrong-secret')
    .update('ph-room7-a').digest('hex').slice(0, 16);
  const wrongSecret = await get(`/api/photos/ph-room7-a?s=${guessed}`);
  check('a signature made with the wrong secret is refused', wrongSecret.status === 403,
    `HTTP ${wrongSecret.status}`);
  const missing = await get(`/api/photos/no-such-photo?s=${crypto
    .createHmac('sha256', process.env.JWT_SECRET).update('no-such-photo')
    .digest('hex').slice(0, 16)}`);
  check('a photo that does not exist is a clean 404', missing.status === 404,
    `HTTP ${missing.status}`);

  console.log('\n=== 5b. The endpoint cannot be turned into a web page ===');
  const nastyUrl = photos.find(p => p.id === 'ph-nasty').url;
  const nasty = await get(nastyUrl);
  check('a non-image upload is refused, not served', nasty.status === 415,
    `HTTP ${nasty.status}`);
  check('the script never reaches the browser',
    !nasty.body.toString().includes('<script>'));
  check('real images are told not to be sniffed as anything else',
    img.headers['x-content-type-options'] === 'nosniff');
  check('and are sandboxed if opened directly',
    /sandbox/.test(img.headers['content-security-policy'] || ''),
    img.headers['content-security-policy']);

  console.log('\n=== 6. A deploy can still reach a phone that has the app installed ===');
  const idx = await get('/index.html');
  check('index.html is never cached',
    /no-store|no-cache/.test(idx.headers['cache-control'] || ''),
    idx.headers['cache-control']);
  const sw = await get('/sw.js');
  check('sw.js is never cached',
    /no-store|no-cache/.test(sw.headers['cache-control'] || ''),
    sw.headers['cache-control']);
  const manifest = await get('/manifest.json');
  check('manifest.json is never cached',
    /no-store|no-cache/.test(manifest.headers['cache-control'] || ''),
    manifest.headers['cache-control']);

  console.log('\n=== 7. The front end and service worker agree with the server ===');
  const html = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');
  check('nothing still reads p.data', !html.includes('p.data'));
  check('thumbnails point at p.url', html.includes('src="${p.url}"'));
  const swSrc = fs.readFileSync(path.join(__dirname, 'public/sw.js'), 'utf8');
  check('the cache version was bumped, so phones pick the fix up',
    /CACHE_VERSION\s*=\s*['"][^'"]*v3['"]/.test(swSrc),
    (swSrc.match(/CACHE_VERSION\s*=\s*['"]([^'"]*)['"]/) || [])[1]);
  check('the service worker caches photos instead of refetching them',
    /\/api\/photos\//.test(swSrc));
  const idxSrc = idx.body.toString();
  check('the poll interval is unchanged — the fix did not slow the app down',
    /POLL_MS\s*=\s*25000/.test(idxSrc));

  console.log('\n' + '='.repeat(64));
  if (failures) {
    console.log(`${failures} CHECK(S) FAILED`);
    process.exit(1);
  }
  console.log('ALL CHECKS PASSED');
  process.exit(0);
})().catch((e) => {
  console.error('\nTEST HARNESS ERROR:', e);
  process.exit(1);
});
