/* Shared helpers for the admin API.
 *
 * Files in /api whose name starts with "_" are NOT routed by Vercel, so this
 * module is private to the other functions.
 *
 * Nothing in here ever reaches the browser. The password lives only in
 * process.env.ADMIN_PASSWORD — it is never sent to the client, never written
 * into a page, and never committed (this repo is public).
 *
 * Environment variables (Vercel -> Settings -> Environment Variables):
 *   ADMIN_PASSWORD         required. The admin login password.
 *   GITHUB_TOKEN           required to save. Fine-grained PAT with
 *                          "Contents: Read and write" on this repository.
 *   GITHUB_REPO            optional, defaults to the repo below.
 *   GITHUB_BRANCH          optional, defaults to "main".
 *   ADMIN_SESSION_SECRET   optional. Signs session cookies. Falls back to
 *                          ADMIN_PASSWORD, which means changing the password
 *                          also logs everyone out — usually what you want.
 */

const crypto = require('crypto');

const COOKIE = 'gq_admin';
const TTL_SECONDS = 8 * 60 * 60;
const POSTS_PATH = 'data/posts.json';

/* ---------------------------------------------------------- configuration */

const repoSlug = () => process.env.GITHUB_REPO || 'Athul9544/Gqtraining-';
const branch = () => process.env.GITHUB_BRANCH || 'main';

function missingConfig() {
  const missing = [];
  if (!process.env.ADMIN_PASSWORD) missing.push('ADMIN_PASSWORD');
  if (!process.env.GITHUB_TOKEN) missing.push('GITHUB_TOKEN');
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

/* Returns { json, sha } — sha is null when the file does not exist yet. */
async function readPosts() {
  try {
    const file = await githubRequest(contentsUrl(POSTS_PATH) + '?ref=' + encodeURIComponent(branch()));
    /* A byte-order mark is invisible in an editor but makes JSON.parse throw,
       so strip it rather than failing on a file someone saved from Windows. */
    const text = Buffer.from(file.content || '', 'base64').toString('utf8').replace(/^﻿/, '');
    try {
      return { json: JSON.parse(text), sha: file.sha };
    } catch (parseError) {
      const err = new Error(POSTS_PATH + ' in the repository is not valid JSON: ' + parseError.message);
      err.status = 500;
      throw err;
    }
  } catch (err) {
    if (err.status === 404) return { json: { posts: [] }, sha: null };
    throw err;
  }
}

async function writeFile(path, buffer, message, sha) {
  const body = {
    message,
    content: buffer.toString('base64'),
    branch: branch()
  };
  if (sha) body.sha = sha;

  return githubRequest(contentsUrl(path), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

/* Needed before overwriting an image that may or may not already exist. */
async function existingSha(path) {
  try {
    const file = await githubRequest(contentsUrl(path) + '?ref=' + encodeURIComponent(branch()));
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
