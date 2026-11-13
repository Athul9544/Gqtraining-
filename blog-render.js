/* Renders blog posts from data/posts.json on blog.html and post.html.
 *
 * data/posts.json is a plain static file. The admin page commits a new copy
 * through the GitHub API, Vercel redeploys, and these pages pick it up — so
 * nothing here needs a server or a database.
 *
 * Every value out of the JSON is written with textContent or through a URL
 * check, never as raw HTML, so a post can never inject markup into the page.
 */
(function () {
  'use strict';

  const POSTS_URL = 'data/posts.json';

  /* Blocks javascript:, data: and anything else that is not a plain link. */
  function safeUrl(value) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    if (/^(assets|data)\//.test(raw)) return raw;
    if (/^\/(?!\/)/.test(raw)) return raw;
    if (/^[\w.-]+\.html(\?|#|$)/.test(raw)) return raw;
    return '';
  }

  const isExternal = (url) => /^https?:\/\//i.test(url);

  function loadPosts() {
    return fetch(POSTS_URL, { cache: 'no-cache' })
      .then(response => {
        if (!response.ok) throw new Error('posts ' + response.status);
        return response.json();
      })
      .then(data => (data && Array.isArray(data.posts) ? data.posts : []))
      .then(posts => posts.filter(post => post && post.published !== false && post.title));
  }

  function readMoreTarget(post) {
    const link = safeUrl(post.link);
    if (link) return { href: link, external: isExternal(link) };
    if (String(post.body || '').trim() && post.slug) {
      return { href: 'post.html?p=' + encodeURIComponent(post.slug), external: false };
    }
    return null;
  }

  function formatDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return '';
    const parsed = new Date(value + 'T00:00:00');
    if (isNaN(parsed)) return '';
    return parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  /* ------------------------------------------------------------- cards -- */

  function buildCard(post) {
    const article = document.createElement('article');
    article.className = 'card post';

    const image = safeUrl(post.image);
    if (image) {
      const photo = document.createElement('div');
      photo.className = 'photo';
      const img = document.createElement('img');
      img.src = image;
      img.alt = post.imageAlt || '';
      img.loading = 'lazy';
      img.decoding = 'async';
      photo.appendChild(img);
      article.appendChild(photo);
    }

    const bodyEl = document.createElement('div');
    bodyEl.className = 'card-body';

    if (post.tag) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = post.tag;
      bodyEl.appendChild(tag);
    }

    const heading = document.createElement('h3');
    heading.textContent = post.title;
    bodyEl.appendChild(heading);

    if (post.excerpt) {
      const paragraph = document.createElement('p');
      paragraph.textContent = post.excerpt;
      bodyEl.appendChild(paragraph);
    }

    const target = readMoreTarget(post);
    if (target) {
      const link = document.createElement('a');
      link.className = 'link-more';
      link.href = target.href;
      if (target.external) {
        link.target = '_blank';
        link.rel = 'noopener';
      }
      link.appendChild(document.createTextNode('Read More '));
      const arrow = document.createElement('i');
      arrow.textContent = '→';
      link.appendChild(arrow);
      bodyEl.appendChild(link);
    }

    article.appendChild(bodyEl);
    return article;
  }

  function renderList() {
    const grid = document.getElementById('post-grid');
    if (!grid) return;

    loadPosts().then(posts => {
      /* Leave the markup already in the page alone if there is nothing to
         show — a blank grid is worse than the posts that shipped with it. */
      if (!posts.length) return;
      grid.textContent = '';
      posts.forEach(post => grid.appendChild(buildCard(post)));
    }).catch(() => { /* keep the static cards that are already on the page */ });
  }

  /* -------------------------------------------------------- post bodies - */

  /* A deliberately small subset of Markdown. The text is escaped on the way
     in by using textContent for every leaf, so no HTML in a post body is ever
     interpreted — only these patterns become markup. */
  function renderInline(target, text) {
    const pattern = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(\[([^\]]+)\]\(([^)\s]+)\))/g;
    let cursor = 0;
    let match;

    while ((match = pattern.exec(text)) !== null) {
      if (match.index > cursor) {
        target.appendChild(document.createTextNode(text.slice(cursor, match.index)));
      }
      if (match[2] !== undefined) {
        const strong = document.createElement('strong');
        strong.textContent = match[2];
        target.appendChild(strong);
      } else if (match[4] !== undefined) {
        const em = document.createElement('em');
        em.textContent = match[4];
        target.appendChild(em);
      } else {
        const href = safeUrl(match[7]);
        const node = document.createElement(href ? 'a' : 'span');
        node.textContent = match[6];
        if (href) {
          node.href = href;
          if (isExternal(href)) { node.target = '_blank'; node.rel = 'noopener'; }
        }
        target.appendChild(node);
      }
      cursor = pattern.lastIndex;
    }

    if (cursor < text.length) target.appendChild(document.createTextNode(text.slice(cursor)));
  }

  function renderBody(container, body) {
    const blocks = String(body || '').replace(/\r\n/g, '\n').split(/\n{2,}/);

    blocks.forEach(block => {
      const trimmed = block.trim();
      if (!trimmed) return;

      const heading = /^(#{2,3})\s+(.*)$/.exec(trimmed);
      if (heading) {
        const element = document.createElement(heading[1].length === 2 ? 'h2' : 'h3');
        renderInline(element, heading[2]);
        container.appendChild(element);
        return;
      }

      const lines = trimmed.split('\n');
      if (lines.every(line => /^\s*[-*]\s+/.test(line))) {
        const list = document.createElement('ul');
        lines.forEach(line => {
          const item = document.createElement('li');
          renderInline(item, line.replace(/^\s*[-*]\s+/, ''));
          list.appendChild(item);
        });
        container.appendChild(list);
        return;
      }

      const paragraph = document.createElement('p');
      lines.forEach((line, index) => {
        if (index) paragraph.appendChild(document.createElement('br'));
        renderInline(paragraph, line);
      });
      container.appendChild(paragraph);
    });
  }

  function renderSingle() {
    const root = document.getElementById('post-single');
    if (!root) return;

    const slug = new URLSearchParams(location.search).get('p') || '';

    const fail = (message) => {
      root.textContent = '';
      const heading = document.createElement('h1');
      heading.className = 'page-title';
      heading.textContent = 'Post not found';
      const paragraph = document.createElement('p');
      paragraph.textContent = message;
      const back = document.createElement('a');
      back.className = 'btn btn-gold';
      back.href = 'blog.html';
      back.textContent = 'Back to the blog';
      root.append(heading, paragraph, back);
    };

    loadPosts().then(posts => {
      const post = posts.find(item => item.slug === slug);
      if (!post) return fail('That article may have been renamed or removed.');

      document.title = post.title + ' — Golden Qube';
      root.textContent = '';

      if (post.tag) {
        const eyebrow = document.createElement('p');
        eyebrow.className = 'eyebrow';
        eyebrow.textContent = post.tag;
        root.appendChild(eyebrow);
      }

      const heading = document.createElement('h1');
      heading.className = 'page-title';
      heading.textContent = post.title;
      root.appendChild(heading);

      const when = formatDate(post.date);
      if (when) {
        const time = document.createElement('p');
        time.className = 'post-date';
        time.textContent = when;
        root.appendChild(time);
      }

      const image = safeUrl(post.image);
      if (image) {
        const figure = document.createElement('div');
        figure.className = 'post-hero';
        const img = document.createElement('img');
        img.src = image;
        img.alt = post.imageAlt || '';
        img.decoding = 'async';
        figure.appendChild(img);
        root.appendChild(figure);
      }

      const article = document.createElement('div');
      article.className = 'post-body';
      if (String(post.body || '').trim()) {
        renderBody(article, post.body);
      } else if (post.excerpt) {
        const paragraph = document.createElement('p');
        paragraph.textContent = post.excerpt;
        article.appendChild(paragraph);
      }
      root.appendChild(article);

      const back = document.createElement('a');
      back.className = 'link-more';
      back.href = 'blog.html';
      back.textContent = '← Back to all articles';
      root.appendChild(back);
    }).catch(() => fail('The article list could not be loaded. Please try again.'));
  }

  function start() {
    renderList();
    renderSingle();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
