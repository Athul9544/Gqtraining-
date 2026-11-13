/* Shared helpers for the admin API.
 *
 * Files in /api whose name starts with "_" are NOT routed by Vercel, so this
 * module is private to the other functions.
 *
 * Nothing in here ever reaches the browser. The password lives only in
 * process.env.ADMIN_PASSWORD — it is never sent to the client, never written
 * into a page, and never committed (this repo is public).
 *
 * There are two ways the admin can store what it saves:
 *
 *   local  — write the files straight to the working copy and let git commit
 *            and push them. Used by dev-server.js on your own machine. Needs
 *            no GitHub token, because git is already authenticated there.
 *   github — commit through the GitHub Contents API. Used when the admin runs
 *            on Vercel, where there is no working copy and no git.
 *
 * Environment variables (Vercel -> Settings -> Environment Variables, or
 * .env.local when running dev-server.js):
 *   ADMIN_PASSWORD         required. The admin login password.
 *   BLOG_STORE             "local" or "github". dev-server.js sets "local";
 *                          anywhere else it defaults to "github".
 *   GITHUB_TOKEN           required by the github store only. Fine-grained PAT
 *                          with "Contents: Read and write" on this repository.
 *   GITHUB_REPO            optional, defaults to the repo below.
 *   GITHUB_BRANCH          optional, defaults to "main".
 *   GIT_AUTOPUSH           local store only. "0" writes the files but leaves
 *                          committing to you. Anything else commits and pushes.
 *   ADMIN_SESSION_SECRET   optional. Signs session cookies. Falls back to
 *                          ADMIN_PASSWORD, which means changing the password
 *                          also logs everyone out — usually what you want.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const COOKIE = 'gq_admin';
const TTL_SECONDS = 8 * 60 * 60;
const POSTS_PATH = 'data/posts.json';
const PROJECT_ROOT = path.resolve(__dirname, '..');

/* ---------------------------------------------------------- configuration */

const repoSlug = () => process.env.GITHUB_REPO || 'Athul9544/Gqtraining-';
const branch = () => process.env.GITHUB_BRANCH || 'main';

const store = () => (process.env.BLOG_STORE === 'local' ? 'local' : 'github');
const isLocalStore = () => store() === 'local';
const autoPush = () => process.env.GIT_AUTOPUSH !== '0';

function missingConfig() {
  const missing = [];
  if (!process.env.ADMIN_PASSWORD) missing.push('ADMIN_PASSWORD');
  if (!isLocalStore() && !process.env.GITHUB_TOKEN) missing.push('GITHUB_TOKEN');
  return missing;
}

/* ------------------------------------------------------------------ auth  */

function sessionSecret() {
  return process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || '';
}

function sign(value) {
  return crypto.createHmac('sha256', sessionSecret()).update(value).digest('base64url');
}

function issueToken() {
  const expiresAt = String(Date.now() + TTL_SECONDS * 1000);
  return expiresAt + '.' + sign(expiresAt);
}

function tokenValid(token) {
  if (!token || !sessionSecret()) return false;
  const dot = token.indexOf('.');
  if (dot < 1) return false;

  const expiresAt = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const want = Buffer.from(sign(expiresAt));

  if (given.length !== want.length) return false;
  if (!crypto.timingSafeEqual(given, want)) return false;

  return Number(expiresAt) > Date.now();
}

/* Hashing both sides first gives two equal-length buffers, so the comparison
   is constant time whatever the attempted password's length. */
function passwordMatches(attempt) {
  const want = process.env.ADMIN_PASSWORD;
  if (!want) return false;
  const a = crypto.createHash('sha256').update(String(attempt == null ? '' : attempt)).digest();
  const b = crypto.createHash('sha256').update(want).digest();
  return crypto.timingSafeEqual(a, b);
}

function readCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach(part => {
    const eq = part.indexOf('=');
    if (eq < 0) return;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  });
  return out;
}

const isLocal = (req) => /^(localhost|127\.0\.0\.1)(:|$)/.test(req.headers.host || '');

function cookieAttributes(req, maxAge) {
  const bits = ['Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=' + maxAge];
  if (!isLocal(req)) bits.push('Secure');
  return bits.join('; ');
}

const startSession = (req, res) =>
  res.setHeader('Set-Cookie', COOKIE + '=' + issueToken() + '; ' + cookieAttributes(req, TTL_SECONDS));

const endSession = (req, res) =>
  res.setHeader('Set-Cookie', COOKIE + '=; ' + cookieAttributes(req, 0));

const isSignedIn = (req) => tokenValid(readCookies(req)[COOKIE]);

/* Rejects the request and returns true when the caller is not signed in. */
function requireSession(req, res) {
  if (isSignedIn(req)) return false;
  res.setHeader('Cache-Control', 'no-store');
  res.status(401).json({ ok: false, error: 'unauthorised' });
  return true;
}

/* --------------------------------------------- login throttling (per pod) */

/* A warm serverless instance keeps this map between invocations. It is not a
   shared store, so it will not stop a determined distributed attack — it is
   there to make casual password guessing through one connection useless. */
const attempts = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 8;

function throttleKey(req) {
  const fwd = req.headers['x-forwarded-for'] || '';
  return String(fwd).split(',')[0].trim() || 'unknown';
}

function tooManyAttempts(req) {
  const record = attempts.get(throttleKey(req));
  if (!record) return false;
  if (Date.now() - record.first > WINDOW_MS) return false;
  return record.count >= MAX_ATTEMPTS;
}

function noteFailure(req) {
  const key = throttleKey(req);
  const record = attempts.get(key);
  if (!record || Date.now() - record.first > WINDOW_MS) {
    attempts.set(key, { first: Date.now(), count: 1 });
  } else {
    record.count += 1;
  }
}

const clearFailures = (req) => attempts.delete(throttleKey(req));

/* ------------------------------------------------------- the local store  */

/* Keeps every write inside the project, whatever the caller passes. */
function localPath(relative) {
  const full = path.resolve(PROJECT_ROOT, relative);
  if (full !== PROJECT_ROOT && !full.startsWith(PROJECT_ROOT + path.sep)) {
    throw new Error('refusing to write outside the project: ' + relative);
  }
  return full;
}

function git(args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd: PROJECT_ROOT, timeout: 90000 }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        out: String(stdout || '').trim(),
        err: String((err && err.message) || stderr || '').trim()
      });
    });
  });
}

/* Commits only the paths given — never the whole working tree, which may
   hold edits that have nothing to do with the blog. */
async function commitAndPush(wanted, message) {
  if (!autoPush()) {
    return { committed: false, pushed: false, note: 'GIT_AUTOPUSH=0 — files written, not committed.' };
  }

  /* git add fails outright on a path that does not exist, and the uploads
     folder only appears once someone has uploaded something. */
  const paths = wanted.filter(p => fs.existsSync(localPath(p)));
  if (!paths.length) return { committed: false, pushed: false, note: 'Nothing on disk to publish.' };

  const add = await git(['add', '--'].concat(paths));
  if (!add.ok) return { committed: false, pushed: false, note: 'git add failed: ' + add.err };

  const staged = await git(['diff', '--cached', '--name-only', '--'].concat(paths));
  if (!staged.out) {
    return { committed: false, pushed: false, note: 'Nothing changed, so nothing to publish.' };
  }

  const commit = await git(['commit', '-m', message, '--'].concat(paths));
  if (!commit.ok) return { committed: false, pushed: false, note: 'git commit failed: ' + commit.err };

  const push = await git(['push']);
  if (!push.ok) {
    return {
      committed: true,
      pushed: false,
      note: 'Committed locally, but the push failed: ' + push.err + ' — run "git push" yourself.'
    };
  }

  return { committed: true, pushed: true, note: 'Committed and pushed. The live blog follows the deploy.' };
}

/* ----------------------------------------------------------------- github */

async function githubRequest(path, init) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is not set');

  const response = await fetch('https://api.github.com' + path, Object.assign({}, init, {
    headers: Object.assign({
      'Authorization': 'Bearer ' + token,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'golden-qube-admin'
    }, (init && init.headers) || {})
  }));

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    const err = new Error('GitHub ' + response.status + ': ' + detail);
    err.status = response.status;
    throw err;
  }
  return response.json();
}

const contentsUrl = (path) =>
  '/repos/' + repoSlug() + '/contents/' + path.split('/').map(encodeURIComponent).join('/');

/* A byte-order mark is invisible in an editor but makes JSON.parse throw, so
   strip it rather than failing on a file someone saved from Windows. */
function parsePosts(text, where) {
  try {
    return JSON.parse(text.replace(/^﻿/, ''));
  } catch (parseError) {
    const err = new Error(POSTS_PATH + ' in ' + where + ' is not valid JSON: ' + parseError.message);
    err.status = 500;
    throw err;
  }
}

/* Returns { json, sha } — sha is null for the local store and for a file that
   does not exist yet. */
async function readPosts() {
  if (isLocalStore()) {
    const file = localPath(POSTS_PATH);
    if (!fs.existsSync(file)) return { json: { posts: [] }, sha: null };
    return { json: parsePosts(fs.readFileSync(file, 'utf8'), 'the working copy'), sha: null };
  }

  try {
    const file = await githubRequest(contentsUrl(POSTS_PATH) + '?ref=' + encodeURIComponent(branch()));
    const text = Buffer.from(file.content || '', 'base64').toString('utf8');
    return { json: parsePosts(text, 'the repository'), sha: file.sha };
  } catch (err) {
    if (err.status === 404) return { json: { posts: [] }, sha: null };
    throw err;
  }
}

async function writeFile(relative, buffer, message, sha) {
  if (isLocalStore()) {
    const file = localPath(relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buffer);
    return { local: true, path: relative };
  }

  const body = {
    message,
    content: buffer.toString('base64'),
    branch: branch()
  };
  if (sha) body.sha = sha;

  return githubRequest(contentsUrl(relative), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

/* Needed before overwriting an image that may or may not already exist.
   The local store overwrites in place, so there is no sha to fetch. */
async function existingSha(relative) {
  if (isLocalStore()) return null;
  try {
    const file = await githubRequest(contentsUrl(relative) + '?ref=' + encodeURIComponent(branch()));
    return file.sha;
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

/* ------------------------------------------------------------ post shape  */

const text = (value, max) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);

/* Only same-origin paths and plain http(s) links are allowed through, so a
   stored post can never become a javascript: or data: URL on the public page. */
function safeUrl(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  if (/^(assets|data)\//.test(raw) || /^\/(?!\/)/.test(raw) || /^[\w.-]+\.html(\?|#|$)/.test(raw)) {
    return raw.slice(0, 400);
  }
  if (/^https?:\/\//i.test(raw)) return raw.slice(0, 400);
  return '';
}

function slugify(value, fallback) {
  const slug = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
  return slug || fallback;
}

/* Everything the admin sends is rebuilt field by field. Unknown keys are
   dropped, so the stored file can only ever hold the shape below. */
function normalisePosts(input) {
  const list = Array.isArray(input) ? input : [];
  const seen = new Set();

  return list.slice(0, 200).map((raw, index) => {
    const item = raw && typeof raw === 'object' ? raw : {};
    const title = text(item.title, 160) || 'Untitled post';

    let slug = slugify(item.slug || title, 'post-' + (index + 1));
    while (seen.has(slug)) slug += '-' + (index + 1);
    seen.add(slug);

    return {
      id: text(item.id, 40) || slug,
      slug,
      title,
      tag: text(item.tag, 40),
      excerpt: text(item.excerpt, 400),
      image: safeUrl(item.image),
      imageAlt: text(item.imageAlt, 160),
      link: safeUrl(item.link),
      body: String(item.body == null ? '' : item.body).slice(0, 40000),
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(item.date || '')) ? String(item.date) : '',
      published: item.published !== false
    };
  });
}

module.exports = {
  POSTS_PATH,
  repoSlug,
  branch,
  store,
  isLocalStore,
  autoPush,
  commitAndPush,
  missingConfig,
  passwordMatches,
  startSession,
  endSession,
  isSignedIn,
  requireSession,
  tooManyAttempts,
  noteFailure,
  clearFailures,
  readPosts,
  writeFile,
  existingSha,
  normalisePosts,
  slugify
};
