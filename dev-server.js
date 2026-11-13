/* Local server for the blog admin.
 *
 *   node dev-server.js        then open http://localhost:4321/admin.html
 *
 * It serves the site exactly as Vercel does and runs the same functions from
 * api/, reading ADMIN_PASSWORD from .env.local (gitignored, never deployed).
 *
 * Saving writes straight to the working copy and then lets git commit and
 * push it, so no GitHub token is involved — your machine is already
 * authenticated with GitHub. The push triggers the usual Vercel deploy and
 * the live blog follows a minute later.
 *
 * Set GIT_AUTOPUSH=0 to have it write the files and leave committing to you.
 *
 * Nothing here is required in production; it is a way to run the same code on
 * your own machine.
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

/* Running here means there is a working copy and a git remote, so the admin
   saves to disk and pushes rather than going through the GitHub API. */
if (!process.env.BLOG_STORE) process.env.BLOG_STORE = 'local';

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
  console.log('Golden Qube running on http://localhost:' + PORT);
  console.log('Blog admin:            http://localhost:' + PORT + '/admin.html');

  if (!process.env.ADMIN_PASSWORD) {
    console.log('\n  ! ADMIN_PASSWORD is missing from .env.local — the admin will not sign in.');
  } else if (process.env.GIT_AUTOPUSH === '0') {
    console.log('\n  Saving writes the files only (GIT_AUTOPUSH=0). Commit and push them yourself.');
  } else {
    console.log('\n  Saving commits and pushes to git, and the live site follows the deploy.');
  }
  console.log('\nPress Ctrl+C to stop.');
});
