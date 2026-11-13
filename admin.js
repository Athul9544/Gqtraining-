/* Blog admin — front end.
 *
 * This file holds no password and no credentials of any kind. Signing in
 * posts the typed password to /api/admin, which compares it against the
 * ADMIN_PASSWORD environment variable on the server and replies with an
 * HttpOnly session cookie. The cookie is not readable from JavaScript, and
 * this page never learns what the password is.
 */
(function () {
  'use strict';

  const API = '/api/admin';

  const gate = document.getElementById('gate');
  const app = document.getElementById('app');
  const loginForm = document.getElementById('login-form');
  const loginBtn = document.getElementById('login-btn');
  const loginMsg = document.getElementById('login-msg');
  const passwordInput = document.getElementById('password');
  const statusEl = document.getElementById('status');
  const listEl = document.getElementById('list');
  const countEl = document.getElementById('count');
  const template = document.getElementById('row-template');

  let posts = [];
  let open = new Set();
  let dirty = false;
  let serial = 0;

  /* ----------------------------------------------------------- plumbing */

  async function call(action, payload, method) {
    const options = { method: method || 'POST', headers: {}, credentials: 'same-origin' };
    if (options.method === 'POST') {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(Object.assign({ action }, payload || {}));
    }
    const url = options.method === 'GET' ? API + '?action=' + encodeURIComponent(action) : API;

    let response;
    try {
      response = await fetch(url, options);
    } catch (err) {
      throw new Error('Could not reach the server. Check your connection.');
    }

    let data = {};
    try { data = await response.json(); } catch (err) { /* non-JSON error page */ }

    if (!response.ok || data.ok === false) {
      const error = new Error(data.message || describe(response.status));
      error.code = data.error;
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function describe(status) {
    if (status === 401) return 'Your session has expired. Sign in again.';
    if (status === 404) return 'The admin API is not deployed. Push the api/ folder and redeploy.';
    if (status === 413) return 'That file is too large.';
    return 'The server returned an error (' + status + ').';
  }

  function say(message, tone) {
    statusEl.textContent = message || '';
    statusEl.className = 'bar-status' + (tone ? ' ' + tone : '');
  }

  const markDirty = () => { dirty = true; };

  addEventListener('beforeunload', (event) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });

  /* -------------------------------------------------------------- model */

  const blankPost = () => ({
    id: 'new-' + (++serial) + '-' + Date.now().toString(36),
    slug: '',
    title: '',
    tag: '',
    excerpt: '',
    image: '',
    imageAlt: '',
    link: '',
    body: '',
    date: '',
    published: true
  });

  /* ---------------------------------------------------------------- view */

  function summarise(post) {
    const bits = [];
    if (post.tag) bits.push(post.tag);
    if (post.date) bits.push(post.date);
    if (post.link) bits.push('links out');
    else if (String(post.body || '').trim()) bits.push('has an article page');
    else bits.push('card only');
    return bits.join(' · ');
  }

  function paintHead(row, post) {
    row.querySelector('.row-title').textContent = post.title || 'Untitled post';
    row.querySelector('.row-sub').textContent = summarise(post);

    const pill = row.querySelector('[data-role="state"]');
    pill.textContent = post.published ? 'Published' : 'Draft';
    pill.classList.toggle('draft', !post.published);
    row.classList.toggle('draft', !post.published);
  }

  function paintThumb(row, post) {
    const thumb = row.querySelector('[data-role="thumb"]');
    const img = thumb.querySelector('img');
    const value = String(post.image || '').trim();
    if (value) {
      img.src = value;
      thumb.hidden = false;
    } else {
      img.removeAttribute('src');
      thumb.hidden = true;
    }
  }

  function buildRow(post, index) {
    const row = template.content.firstElementChild.cloneNode(true);
    const body = row.querySelector('.row-body');
    const chev = row.querySelector('.chev');

    row.dataset.id = post.id;

    /* bind every field to the post object */
    row.querySelectorAll('[data-field]').forEach(input => {
      const key = input.dataset.field;
      if (input.type === 'checkbox') input.checked = post[key] !== false;
      else input.value = post[key] == null ? '' : post[key];

      input.addEventListener('input', () => {
        post[key] = input.type === 'checkbox' ? input.checked : input.value;
        markDirty();
        if (key === 'title' || key === 'tag' || key === 'date' || key === 'link' || key === 'body') paintHead(row, post);
        if (key === 'image') paintThumb(row, post);
      });
      if (input.type === 'checkbox') {
        input.addEventListener('change', () => {
          post.published = input.checked;
          markDirty();
          paintHead(row, post);
        });
      }
    });

    const setOpen = (shouldOpen) => {
      body.hidden = !shouldOpen;
      row.classList.toggle('open', shouldOpen);
      chev.setAttribute('aria-expanded', String(shouldOpen));
      if (shouldOpen) open.add(post.id); else open.delete(post.id);
    };
    setOpen(open.has(post.id));

    row.querySelectorAll('[data-act="toggle"]').forEach(el => {
      el.addEventListener('click', () => setOpen(body.hidden));
    });

    row.querySelector('[data-act="up"]').disabled = index === 0;
    row.querySelector('[data-act="down"]').disabled = index === posts.length - 1;

    row.querySelector('[data-act="up"]').addEventListener('click', () => move(index, -1));
    row.querySelector('[data-act="down"]').addEventListener('click', () => move(index, 1));
    row.querySelector('[data-act="delete"]').addEventListener('click', () => remove(index, post));
    row.querySelector('[data-act="upload"]').addEventListener('change', (event) => upload(event, row, post));

    paintHead(row, post);
    paintThumb(row, post);
    return row;
  }

  function render() {
    listEl.textContent = '';
    posts.forEach((post, index) => listEl.appendChild(buildRow(post, index)));
    const published = posts.filter(p => p.published !== false).length;
    countEl.textContent = posts.length === 0
      ? 'Nothing here yet.'
      : posts.length + (posts.length === 1 ? ' article' : ' articles') +
        ' · ' + published + ' published · ' + (posts.length - published) + ' draft';
  }

  /* ------------------------------------------------------------- actions */

  function move(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= posts.length) return;
    const [item] = posts.splice(index, 1);
    posts.splice(target, 0, item);
    markDirty();
    render();
  }

  function remove(index, post) {
    const name = post.title || 'this untitled article';
    if (!confirm('Delete “' + name + '”?\n\nIt is removed from the blog when you press Save & publish.')) return;
    posts.splice(index, 1);
    open.delete(post.id);
    markDirty();
    render();
    say('Deleted “' + name + '”. Press Save & publish to make it final.');
  }

  function add() {
    const post = blankPost();
    posts.unshift(post);
    open.add(post.id);
    markDirty();
    render();
    const first = listEl.querySelector('input[data-field="title"]');
    if (first) first.focus();
  }

  function upload(event, row, post) {
    const input = event.target;
    const file = input.files && input.files[0];
    if (!file) return;

    if (file.size > 3 * 1024 * 1024) {
      say('That image is ' + Math.round(file.size / 1024) + 'KB. The limit is 3MB — resize it first.', 'bad');
      input.value = '';
      return;
    }

    say('Uploading ' + file.name + '…', 'busy');
    const reader = new FileReader();

    reader.onload = async () => {
      try {
        const result = await call('upload', { filename: file.name, data: reader.result });
        post.image = result.path;
        row.querySelector('[data-field="image"]').value = result.path;
        paintThumb(row, post);
        markDirty();
        say('Uploaded ' + result.path + '. Press Save & publish when you are done.', 'ok');
      } catch (err) {
        say(err.message, 'bad');
        if (err.status === 401) showGate('Your session expired. Sign in again.');
      } finally {
        input.value = '';
      }
    };

    reader.onerror = () => { say('That file could not be read.', 'bad'); input.value = ''; };
    reader.readAsDataURL(file);
  }

  async function save() {
    const button = document.getElementById('save-btn');
    const untitled = posts.filter(p => !String(p.title || '').trim()).length;
    if (untitled && !confirm(untitled + ' article(s) have no title and will be saved as “Untitled post”. Continue?')) return;

    button.disabled = true;
    say('Saving…', 'busy');

    try {
      const result = await call('save', { posts });
      posts = result.posts;
      dirty = false;
      render();

      /* The local store reports back what git actually managed to do, which
         may be less than a clean commit-and-push. */
      if (result.git && !result.git.pushed) {
        say('Saved. ' + result.git.note, result.git.committed ? 'busy' : 'bad');
      } else {
        say('Saved. The live blog updates in about a minute.', 'ok');
      }
    } catch (err) {
      say(err.message, 'bad');
      if (err.status === 401) showGate('Your session expired. Sign in again.');
    } finally {
      button.disabled = false;
    }
  }

  async function load() {
    say('Loading articles…', 'busy');
    try {
      const result = await call('posts', null, 'GET');
      posts = result.posts || [];
      dirty = false;
      render();
      say('');
    } catch (err) {
      if (err.status === 401) return showGate('Please sign in.');
      render();
      say(err.message, 'bad');
    }
  }

  /* --------------------------------------------------------------- gates */

  function showGate(message) {
    app.hidden = true;
    gate.hidden = false;
    dirty = false;
    loginMsg.textContent = message || '';
    loginMsg.className = 'note' + (message ? ' bad' : '');
    passwordInput.value = '';
    passwordInput.focus();
  }

  function showApp() {
    gate.hidden = true;
    app.hidden = false;
    load();
  }

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    loginBtn.disabled = true;
    loginMsg.className = 'note';
    loginMsg.textContent = 'Checking…';

    try {
      await call('login', { password: passwordInput.value });
      passwordInput.value = '';
      showApp();
    } catch (err) {
      loginMsg.className = 'note bad';
      loginMsg.textContent = err.message;
    } finally {
      loginBtn.disabled = false;
    }
  });

  document.getElementById('logout-btn').addEventListener('click', async () => {
    if (dirty && !confirm('You have unsaved changes. Sign out anyway?')) return;
    try { await call('logout'); } catch (err) { /* the cookie expires regardless */ }
    showGate('Signed out.');
  });

  document.getElementById('save-btn').addEventListener('click', save);
  document.getElementById('add-btn').addEventListener('click', add);

  /* Ctrl/Cmd+S saves, the way every editor does. */
  addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && !app.hidden) {
      event.preventDefault();
      save();
    }
  });

  /* The footer line should say what saving will really do here, which is not
     the same when the admin runs locally as when it runs on Vercel. */
  function describeStore(state) {
    const note = document.getElementById('store-note');
    if (!note) return;

    if (state.store === 'local') {
      note.textContent = state.autoPush
        ? 'Saving writes data/posts.json, commits it and pushes. The live blog updates about a minute later.'
        : 'Saving writes data/posts.json only (GIT_AUTOPUSH=0). Commit and push it yourself to publish.';
    } else {
      note.textContent = 'Saving commits data/posts.json to ' + (state.repo || 'the repository') +
        ', which triggers a redeploy. The live blog updates within about a minute.';
    }
  }

  /* ---------------------------------------------------------------- boot */

  (async function boot() {
    try {
      const state = await call('session', null, 'GET');
      describeStore(state);
      if (state.signedIn) return showApp();

      if (!state.configured) {
        showGate('Not finished setting up: ' + state.missing.join(' and ') +
                 ' must be added to the Vercel project before this page can work.');
        return;
      }
      showGate('');
    } catch (err) {
      showGate(err.message);
    }
  })();
})();
