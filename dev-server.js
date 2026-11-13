/* Local server for the blog admin.
 *
 *   node dev-server.js        then open http://localhost:4321/admin.html
 *
 * It serves the site exactly as Vercel does and runs the functions in api/
 * in the same way, reading ADMIN_PASSWORD and GITHUB_TOKEN from .env.local
 * (which is gitignored and never deployed).
 *
 * This exists because the hosted /admin.html needs those two values set as
 * environment variables on Vercel, and that project is currently blocked. The
 * admin still works from here: saving commits to GitHub exactly as it would
 * in production, and the public blog picks the change up on the next deploy.
 *
 * Nothing about this file is required in production — it is a convenience for
 * running the same code on your own machine.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 4321;

/* ------------------------------------------------- .env.local into process */

function loadEnv() {
  const file = path.join(ROOT, '.env.local');
  if (!fs.existsSync(file)) return;

  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    const eq = trimmed.indexOf('=');
    if (eq < 1) return;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (/^(".*"|'.*')$/.test(value)) value = value.slice(1, -1);

    if (!(key in process.env)) process.env[key] = value;
  });
}
loadEnv();

/* ------------------------------------------------------------- the routes */

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};

/* Gives the handlers the small slice of the Vercel request/response API they
   use: req.query, req.body, res.status(), res.json(). */
async function runFunction(name, req, res, url) {
  const handler = require(path.join(ROOT, 'api', name + '.js'));

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');

  req.query = Object.fromEntries(url.searchParams);
  try { req.body = raw ? JSON.parse(raw) : {}; } catch (err) { req.body = raw; }

  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => {
    if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(payload));
    return res;
  };

  try {
    await handler(req, res);
  } catch (err) {
    console.error('api/' + name + ' failed:', err);
    if (!res.headersSent) res.status(500).json({ ok: false, error: 'function_failed', message: String(err.message || err) });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  const fn = /^\/api\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname);
  if (fn) {
    if (fn[1].startsWith('_') || !fs.existsSync(path.join(ROOT, 'api', fn[1] + '.js'))) {
      res.statusCode = 404;
      return res.end('no such function');
    }
    return runFunction(fn[1], req, res, url);
  }

  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.resolve(ROOT, '.' + rel);

  /* never serve anything outside the project, or the secrets file */
  if (!file.startsWith(path.resolve(ROOT)) || path.basename(file).startsWith('.env')) {
    res.statusCode = 403;
    return res.end('forbidden');
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.statusCode = 404;
      return res.end('not found');
    }
    res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.end(data);
  });
});

server.listen(PORT, () => {
  const missing = ['ADMIN_PASSWORD', 'GITHUB_TOKEN'].filter(key => !process.env[key]);
  console.log('Golden Qube running on http://localhost:' + PORT);
  console.log('Blog admin:            http://localhost:' + PORT + '/admin.html');
  if (missing.length) {
    console.log('\n  ! ' + missing.join(' and ') + ' missing from .env.local — the admin will not sign in.');
  } else {
    console.log('\n  Saving in the admin commits to ' +
      (process.env.GITHUB_REPO || 'Athul9544/Gqtraining-') + ' and the live site follows.');
  }
  console.log('\nPress Ctrl+C to stop.');
});
