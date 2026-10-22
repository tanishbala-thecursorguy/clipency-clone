/* The two retired page copies must not be reachable as stale dashboards.
 *
 * Run from the repo root:  node tests/stale-pages-redirect.test.js
 *
 *   - /clipper (the old root copy of the creator dashboard) redirects to the
 *     maintained one at /client/clipper
 *   - /client/client-dashboard and /client-dashboard redirect to the client
 *     portal home, on the main deploy and on the portal's own vercel.json
 *   - the files themselves are gone from the served tree, the redirect
 *     targets exist, and no redirect points at another redirect (no loops)
 */
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) pass++; else { fail++; console.log('  FAIL', n, x === undefined ? '' : JSON.stringify(x)); } };

const root = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
const portal = JSON.parse(fs.readFileSync('clipency-client-portal/vercel.json', 'utf8'));
const find = (cfg, src) => (cfg.redirects || []).find(r => r.source === src);

ok(find(root, '/clipper') && find(root, '/clipper').destination === '/client/clipper', '/clipper -> /client/clipper');
ok(find(root, '/client/client-dashboard') && find(root, '/client/client-dashboard').destination === '/client/home', '/client/client-dashboard -> /client/home');
ok(find(root, '/client-dashboard') && find(root, '/client-dashboard').destination === '/client/home', '/client-dashboard -> /client/home');
ok(find(portal, '/client-dashboard') && find(portal, '/client-dashboard').destination === '/home', 'portal: /client-dashboard -> /home');

ok(!fs.existsSync('clipper.html'), 'root clipper.html retired');
ok(!fs.existsSync('clipency-client-portal/client-dashboard.html'), 'portal client-dashboard.html retired');
ok(fs.existsSync('clipency-client-portal/clipper.html'), 'maintained clipper page exists');
ok(fs.existsSync('clipency-client-portal/home.html'), 'portal home exists');

// /client/:file* is rewritten into the portal folder
const rw = (root.rewrites || []).find(r => r.source === '/client/:file*');
ok(rw && rw.destination === '/clipency-client-portal/:file*', '/client/* serves the portal folder', rw);

for (const cfg of [root, portal]) {
  const srcs = new Set((cfg.redirects || []).map(r => r.source));
  for (const r of cfg.redirects || []) ok(!srcs.has(r.destination), 'no redirect chains: ' + r.source, r);
}
console.log((fail ? 'FAILED ' : 'OK ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
