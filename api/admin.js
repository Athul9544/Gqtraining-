/* Admin API for the blog — everything behind the password happens here.
 *
 * POST /api/admin  { action: "login",  password }   -> sets a signed session cookie
 * POST /api/admin  { action: "logout" }             -> clears it
 * GET  /api/admin?action=session                    -> { signedIn, configured }
 * GET  /api/admin?action=posts                      -> every post, drafts included
 * POST /api/admin  { action: "save",   posts: [] }  -> commits data/posts.json
 * POST /api/admin  { action: "upload", filename, data } -> commits an image
 *
 * The password is only ever compared on this server. It is never returned to
 * the browser and never written into a page.
 */

const lib = require('./_lib');

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const IMAGE_TYPES = { jpg: 'jpg', jpeg: 'jpg', png: 'png', webp: 'webp', gif: 'gif', svg: 'svg' };

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  const body = parseBody(req);
  const action = String((req.query && req.query.action) || body.action || '').toLowerCase();

  /* Every async branch is awaited, not just returned. Returning a promise
     from inside try/catch would let a rejection escape this handler and
     become an unhandled rejection instead of a 502. */
  try {
    switch (action) {
      case 'session': return session(req, res);
      case 'login':   return login(req, res, body);
      case 'logout':  return logout(req, res);
      case 'posts':   return await listPosts(req, res);
      case 'save':    return await savePosts(req, res, body);
      case 'upload':  return await uploadImage(req, res, body);
      default:
        return res.status(400).json({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    return res.status(502).json({
      ok: false,
      error: 'request_failed',
      message: String((err && err.message) || err)
    });
  }
};

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body); } catch (err) { return {}; }
}

/* ---------------------------------------------------------------- actions */

function session(req, res) {
  const missing = lib.missingConfig();
  return res.status(200).json({
    ok: true,
    signedIn: lib.isSignedIn(req),
    configured: missing.length === 0,
    missing,
    store: lib.store(),
    autoPush: lib.isLocalStore() && lib.autoPush(),
    repo: lib.repoSlug(),
    branch: lib.branch()
  });
}

function login(req, res, body) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  if (!process.env.ADMIN_PASSWORD) {
    return res.status(503).json({
      ok: false,
      error: 'not_configured',
      message: 'ADMIN_PASSWORD is not set on this deployment.'
    });
  }

  if (lib.tooManyAttempts(req)) {
    return res.status(429).json({
      ok: false,
      error: 'too_many_attempts',
      message: 'Too many failed attempts. Try again in a few minutes.'
    });
  }

  if (!lib.passwordMatches(body.password)) {
    lib.noteFailure(req);
    return res.status(401).json({ ok: false, error: 'bad_password', message: 'That password is not right.' });
  }

  lib.clearFailures(req);
  lib.startSession(req, res);
  return res.status(200).json({ ok: true, signedIn: true });
}

function logout(req, res) {
  lib.endSession(req, res);
  return res.status(200).json({ ok: true, signedIn: false });
}

async function listPosts(req, res) {
  if (lib.requireSession(req, res)) return;
  const stored = await lib.readPosts();
  return res.status(200).json({
    ok: true,
    posts: lib.normalisePosts(stored.json && stored.json.posts)
  });
}

async function savePosts(req, res, body) {
  if (lib.requireSession(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  if (!Array.isArray(body.posts)) return res.status(400).json({ ok: false, error: 'posts_required' });

  const posts = lib.normalisePosts(body.posts);
  const payload = { updatedAt: new Date().toISOString(), posts };
  const current = await lib.readPosts();

  await lib.writeFile(
    lib.POSTS_PATH,
    Buffer.from(JSON.stringify(payload, null, 2) + '\n', 'utf8'),
    'Blog: update posts from the admin page',
    current.sha
  );

  /* The github store committed as it wrote. The local store wrote to the
     working copy, so git has to carry it the rest of the way — including any
     images uploaded since the last save. */
  let git = null;
  if (lib.isLocalStore()) {
    git = await lib.commitAndPush(
      [lib.POSTS_PATH, 'assets/img/blog'],
      'Blog: update posts from the admin page'
    );
  }

  return res.status(200).json({ ok: true, posts, count: posts.length, git });
}

async function uploadImage(req, res, body) {
  if (lib.requireSession(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const match = /\.([A-Za-z0-9]+)$/.exec(String(body.filename || ''));
  const extension = match && IMAGE_TYPES[match[1].toLowerCase()];
  if (!extension) {
    return res.status(400).json({
      ok: false,
      error: 'bad_file_type',
      message: 'Use a .jpg, .png, .webp, .gif or .svg image.'
    });
  }

  /* The browser sends a data: URL; keep only the base64 payload. */
  const base64 = String(body.data || '').replace(/^data:[^,]*,/, '');
  let buffer;
  try {
    buffer = Buffer.from(base64, 'base64');
  } catch (err) {
    return res.status(400).json({ ok: false, error: 'bad_image_data' });
  }
  if (!buffer.length) return res.status(400).json({ ok: false, error: 'empty_image' });
  if (buffer.length > MAX_IMAGE_BYTES) {
    return res.status(413).json({
      ok: false,
      error: 'image_too_large',
      message: 'That image is ' + Math.round(buffer.length / 1024) + 'KB. The limit is 3MB — resize it first.'
    });
  }

  const stem = lib.slugify(String(body.filename || '').replace(/\.[^.]+$/, ''), 'image');
  const path = 'assets/img/blog/' + stem + '-' + Date.now().toString(36) + '.' + extension;

  await lib.writeFile(path, buffer, 'Blog: add image ' + path, await lib.existingSha(path));

  return res.status(200).json({ ok: true, path, bytes: buffer.length });
}
