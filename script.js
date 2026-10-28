/* Golden Qube — interactions */

// Mobile navigation
const burger = document.getElementById('burger');
const nav = document.getElementById('nav');
burger.addEventListener('click', () => {
  const open = nav.classList.toggle('open');
  burger.classList.toggle('open', open);
  burger.setAttribute('aria-expanded', String(open));
});
nav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
  nav.classList.remove('open');
  burger.classList.remove('open');
  burger.setAttribute('aria-expanded', 'false');
}));

// Scroll reveal
const io = new IntersectionObserver((entries) => {
  entries.forEach((e, i) => {
    if (!e.isIntersecting) return;
    setTimeout(() => e.target.classList.add('visible'), i * 70);
    io.unobserve(e.target);
  });
}, { threshold: 0.12, rootMargin: '0px 0px -60px' });
document.querySelectorAll('.reveal').forEach(el => io.observe(el));

/* Pinned horizontal scroll: while the section is stuck to the viewport the cards
   travel sideways; once they run out, the page carries on scrolling normally. */
document.querySelectorAll('[data-hscroll]').forEach(section => {
  // data attributes first, so a section can bring its own class names
  const outer = section.querySelector('[data-hs-outer]') || section.querySelector('.hscroll-outer');
  const track = section.querySelector('[data-hs-track]') || section.querySelector('.hscroll-track');
  const viewport = section.querySelector('[data-hs-viewport]') || section.querySelector('.hscroll-viewport');
  if (!outer || !track || !viewport) return;

  const narrow = window.matchMedia('(max-width: 1080px)');
  const still = window.matchMedia('(prefers-reduced-motion: reduce)');
  let distance = 0;
  let ticking = false;

  const measure = () => {
    if (narrow.matches || still.matches) {
      section.classList.remove('hs-on');
      outer.style.height = '';
      track.style.transform = '';
      distance = 0;
      return;
    }
    section.classList.add('hs-on');
    // how far the cards must travel to bring the last one fully into view
    distance = Math.max(0, track.scrollWidth - viewport.clientWidth);
    // pinned height = one screen + the horizontal distance
    outer.style.height = (window.innerHeight + distance) + 'px';
    update();
  };

  const update = () => {
    if (!distance) return;
    const rect = outer.getBoundingClientRect();
    const progress = Math.min(Math.max(-rect.top / distance, 0), 1);
    track.style.transform = 'translate3d(' + -progress * distance + 'px,0,0)';
  };

  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { update(); ticking = false; });
  }, { passive: true });

  window.addEventListener('resize', measure);
  narrow.addEventListener('change', measure);
  window.addEventListener('load', measure);
  measure();
});

/* Scroll-driven card stage: the active card sits centre stage, the one before it
   shrinks away to the top-left and the next waits small at the bottom-right. */
document.querySelectorAll('[data-stage]').forEach(section => {
  const outer = section.querySelector('.stage-outer');
  const stage = section.querySelector('.stage');
  const dotWrap = section.querySelector('.stage-dots');
  if (!outer || !stage) return;

  const cards = Array.from(stage.querySelectorAll('.stage-card'));
  if (!cards.length) return;

  const narrow = window.matchMedia('(max-width: 1080px)');
  const still = window.matchMedia('(prefers-reduced-motion: reduce)');
  let distance = 0, ticking = false, dots = [];

  if (dotWrap && !dotWrap.children.length) {
    cards.forEach(() => dotWrap.appendChild(document.createElement('span')));
    dots = Array.from(dotWrap.children);
  }

  const reset = () => {
    section.classList.remove('stage-on');
    outer.style.height = '';
    cards.forEach(c => { c.style.transform = ''; c.style.opacity = ''; c.style.zIndex = ''; });
    distance = 0;
  };

  const measure = () => {
    if (narrow.matches || still.matches) return reset();
    section.classList.add('stage-on');
    // one screen of travel per transition between cards
    distance = Math.round(window.innerHeight * 0.85) * (cards.length - 1);
    outer.style.height = (window.innerHeight + distance) + 'px';
    update();
  };

  const update = () => {
    if (!distance) return;
    const rect = outer.getBoundingClientRect();
    const progress = Math.min(Math.max(-rect.top / distance, 0), 1);
    const pos = progress * (cards.length - 1);   // 0 .. n-1

    cards.forEach((card, i) => {
      const d = pos - i;               // <0 upcoming, 0 centre, >0 leaving
      const t = Math.min(Math.max(d, -1), 1);
      const away = Math.abs(t);
      // centre when t = 0; shrink toward the corners as it moves either way
      const scale = 1 - away * 0.72;
      // percentages are relative to the card itself, so fold the -50% centring
      // straight into the number (calc() with a negative addend is invalid CSS)
      const x = (-50 + t * -34).toFixed(2);   // leaving drifts left, upcoming waits right
      const y = (-50 + t * -26).toFixed(2);   // leaving rises, upcoming waits low
      card.style.transform =
        'translate3d(' + x + '%,' + y + '%,0) scale(' + scale.toFixed(3) + ')';
      card.style.opacity = away >= 1 ? 0 : (1 - away * 0.55).toFixed(3);
      card.style.zIndex = String(100 - Math.round(away * 100));
      card.style.pointerEvents = away < 0.5 ? 'auto' : 'none';
    });

    if (dots.length) {
      const active = Math.round(pos);
      dots.forEach((dot, i) => dot.classList.toggle('on', i === active));
    }
  };

  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { update(); ticking = false; });
  }, { passive: true });

  window.addEventListener('resize', measure);
  narrow.addEventListener('change', measure);
  window.addEventListener('load', measure);
  measure();
});

/* "Talk to Our Team" reveals call / email / WhatsApp */
document.querySelectorAll('[data-contact]').forEach(pop => {
  const trigger = pop.querySelector('button');
  if (!trigger) return;

  const setOpen = open => {
    pop.classList.toggle('open', open);
    trigger.setAttribute('aria-expanded', String(open));
  };

  trigger.addEventListener('click', e => {
    e.stopPropagation();
    setOpen(!pop.classList.contains('open'));
  });

  // clicking anywhere else, or pressing Escape, closes it
  document.addEventListener('click', e => {
    if (!pop.contains(e.target)) setOpen(false);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') setOpen(false);
  });
  pop.querySelectorAll('.contact-opts a').forEach(a =>
    a.addEventListener('click', () => setOpen(false))
  );
});

/* Contact page: interest chips + enquiry form */
const chipWrap = document.getElementById('chips');
if (chipWrap) {
  chipWrap.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      chip.classList.toggle('on');
      chip.setAttribute('aria-pressed', String(chip.classList.contains('on')));
      const picked = Array.from(chipWrap.querySelectorAll('.chip.on')).map(c => c.textContent.trim());
      const field = document.getElementById('interests');
      if (field) field.value = picked.join(', ');
    });
  });
}

const enquiry = document.getElementById('enquiry-form');
if (enquiry) {
  enquiry.addEventListener('submit', e => {
    e.preventDefault();
    const msg = document.getElementById('enquiry-msg');
    const name = enquiry.querySelector('[name="name"]');
    const email = enquiry.querySelector('[name="email"]');
    const category = enquiry.querySelector('[name="category"]');
    if (!name.value.trim() || !email.value.trim()) {
      msg.textContent = 'Please add your name and e-mail so we can reply.';
      return;
    }
    if (category && !category.value) {
      msg.textContent = 'Please choose a category.';
      category.focus();
      return;
    }
    // front-end only — connect this to your mail service or form endpoint
    msg.textContent = 'Thank you — we will get back to you shortly.';
    enquiry.reset();
    chipWrap && chipWrap.querySelectorAll('.chip.on').forEach(c => c.classList.remove('on'));
    setTimeout(() => (msg.textContent = ''), 6000);
  });
}

/* Horizontal card slider: each arrow moves one card along and switches
   off at its end. Shared by Student Stories and, on phones, Learner Stories. */
function wireSlider(trackId, prevId, nextId, cardSelector) {
  const track = document.getElementById(trackId);
  if (!track) return null;

  const prev = document.getElementById(prevId);
  const next = document.getElementById(nextId);

  const step = () => {
    const card = track.querySelector(cardSelector);
    const gap = parseFloat(getComputedStyle(track).columnGap || '14');
    return card ? card.getBoundingClientRect().width + gap : track.clientWidth;
  };

  const sync = () => {
    const max = track.scrollWidth - track.clientWidth - 2;
    if (prev) prev.disabled = track.scrollLeft <= 2;
    if (next) next.disabled = max <= 0 || track.scrollLeft >= max;
  };

  if (next) next.addEventListener('click', () => track.scrollBy({ left: step(), behavior: 'smooth' }));
  if (prev) prev.addEventListener('click', () => track.scrollBy({ left: -step(), behavior: 'smooth' }));
  track.addEventListener('scroll', sync, { passive: true });
  window.addEventListener('resize', sync);
  sync();
  return track;
}

/* Wheel over a track travels sideways instead of scrolling the page, so the
   cards stay put under the cursor. Once the track runs out in that direction
   the page takes the scroll back, so it never traps you mid-page. */
function wheelToHorizontal(track) {
  if (!track) return;
  track.addEventListener('wheel', e => {
    if (e.ctrlKey) return;                                  // leave pinch-zoom alone
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;    // already a sideways gesture
    const max = track.scrollWidth - track.clientWidth;
    if (max <= 1) return;                                   // nothing to scroll
    const atStart = track.scrollLeft <= 0;
    const atEnd = track.scrollLeft >= max - 1;
    if ((e.deltaY < 0 && atStart) || (e.deltaY > 0 && atEnd)) return;
    e.preventDefault();
    // 'instant' is required here: 'auto' would defer to the track's CSS
    // scroll-behavior:smooth and animate every single wheel tick
    track.scrollBy({ left: e.deltaY, behavior: 'instant' });
  }, { passive: false });
}

// Learner Stories — a grid on desktop, a slider once it stacks
wireSlider('rev-track', 'rev-prev', 'rev-next', '.review');

/* Live Google reviews.
   The cards already in the HTML are the fallback: if the key is missing, the
   request fails, or Google is down, nothing here runs and they stay exactly
   as they are. Only a good response replaces them. */
(() => {
  const track = document.getElementById('rev-track');
  if (!track || !window.fetch) return;

  // escapes, not the glyphs themselves — a stray re-encode of this file would
  // otherwise turn the stars into mojibake
  const FULL = '★', EMPTY = '☆';
  const stars = n => {
    const filled = Math.max(0, Math.min(5, Math.round(n)));
    return FULL.repeat(filled) + EMPTY.repeat(5 - filled);
  };

  const when = r => {
    if (r.publishedAt) {
      const d = new Date(r.publishedAt);
      if (!isNaN(d)) {
        return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      }
    }
    return r.relative || '';
  };

  // the reviews are other people's words — build with DOM calls, never innerHTML
  const card = r => {
    const el = document.createElement('article');
    el.className = 'card review reveal visible';   // already on screen, so skip the reveal

    const avatar = document.createElement('span');
    avatar.className = 'quote-avatar';
    if (r.photo) {
      const img = document.createElement('img');
      img.src = r.photo;
      img.alt = '';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';          // Google blocks hot-linking without this
      avatar.appendChild(img);
    } else {
      avatar.classList.add('is-initial');
      avatar.textContent = (r.name || '?').trim().charAt(0).toUpperCase();
    }

    const quote = document.createElement('p');
    quote.textContent = '"' + r.text + '"';

    const name = document.createElement('b');
    name.textContent = r.name;

    const date = document.createElement('small');
    date.textContent = when(r);

    const rating = document.createElement('div');
    rating.className = 'stars';
    rating.textContent = stars(r.rating);
    rating.setAttribute('aria-label', r.rating + ' out of 5');

    el.append(avatar, quote, name, date, rating);
    return el;
  };

  const summary = data => {
    const box = document.getElementById('g-rating');
    if (!box || typeof data.rating !== 'number') return;
    document.getElementById('g-score').textContent = data.rating.toFixed(1);
    document.getElementById('g-stars').textContent = stars(data.rating);
    document.getElementById('g-count').textContent =
      data.total ? data.total + ' Google reviews' : 'on Google';
    if (data.url) box.href = data.url;
    box.hidden = false;
  };

  fetch('/api/reviews', { headers: { Accept: 'application/json' } })
    .then(r => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
    .then(data => {
      if (!data || !data.ok || !Array.isArray(data.reviews) || !data.reviews.length) return;
      track.replaceChildren(...data.reviews.map(card));
      summary(data);
      // the slider measures the cards, so let it re-check now they have changed
      track.dispatchEvent(new Event('scroll'));
      window.dispatchEvent(new Event('resize'));
    })
    .catch(() => { /* keep the cards that are already in the page */ });
})();

/* Student reels: four cards at a time, arrows reveal the rest,
   clicking a card plays the Instagram reel inside the page. */
(() => {
  const track = wireSlider('reel-track', 'reel-prev', 'reel-next', '.reel-card');
  wheelToHorizontal(track);
  const modal = document.getElementById('reel-modal');
  const frame = document.getElementById('reel-iframe');
  const openLink = document.getElementById('reel-open');
  if (!track || !modal || !frame) return;

  const open = code => {
    frame.src = 'https://www.instagram.com/reel/' + code + '/embed';
    if (openLink) openLink.href = 'https://www.instagram.com/reel/' + code + '/';
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
  };
  const close = () => {
    modal.hidden = true;
    frame.src = '';                 // stops playback
    document.body.style.overflow = '';
  };

  track.querySelectorAll('.reel-card[data-reel]').forEach(card => {
    card.addEventListener('click', () => open(card.dataset.reel));
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(card.dataset.reel); }
    });
  });

  modal.querySelectorAll('[data-reel-close]').forEach(el => el.addEventListener('click', close));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) close(); });
})();

// Animated counter (100+ Active Business Owners)
document.querySelectorAll('.counter').forEach(el => {
  const target = Number(el.dataset.count) || 0;
  const counterIO = new IntersectionObserver(entries => {
    if (!entries[0].isIntersecting) return;
    counterIO.disconnect();
    const start = performance.now(), duration = 1400;
    const tick = now => {
      const p = Math.min((now - start) / duration, 1);
      el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, { threshold: 0.5 });
  counterIO.observe(el);
});

// Newsletter form (front-end only — wire to your provider/backend)
/* Footer "Send": carries the address over to the contact form */
const form = document.getElementById('subscribe-form');
const msg = document.getElementById('form-msg');
if (form) {
  form.addEventListener('submit', e => {
    e.preventDefault();
    const email = (form.querySelector('input[type="email"]').value || '').trim();
    if (!email) {
      if (msg) msg.textContent = 'Please enter your e-mail address.';
      return;
    }
    window.location.href = 'contact.html?email=' + encodeURIComponent(email);
  });
}

/* Contact page: pre-fill the e-mail passed from the footer */
(() => {
  const emailField = document.getElementById('cf-email');
  if (!emailField) return;
  const passed = new URLSearchParams(window.location.search).get('email');
  if (!passed) return;
  emailField.value = passed;
  const note = document.getElementById('enquiry-msg');
  if (note) note.textContent = 'We have added your e-mail — tell us a little about what you need.';
  const name = document.getElementById('cf-name');
  if (name) setTimeout(() => name.focus({ preventScroll: true }), 200);
})();

/* Certificates: each one takes a turn out front, on a loop. The spotlight is
   a class, so all the sizing and easing stays in the stylesheet. */
(() => {
  const wrap = document.querySelector('.tp-certs');
  if (!wrap) return;

  const cards = Array.from(wrap.querySelectorAll('.tp-certcard'));
  if (cards.length < 2) return;

  // whichever card is marked in the HTML is the one the loop starts from
  const first = Math.max(0, cards.findIndex(c => c.classList.contains('is-active')));
  let at = first;
  const show = n => cards.forEach((c, i) => c.classList.toggle('is-active', i === n));
  show(first);

  // holding still is the point of the reduced-motion setting, so stop here
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  /* Run the loop only while the certificates are on screen. Started on page
     load it would have cycled several times before anyone scrolled down, so
     the first card they actually saw was whichever one it happened to be on.
     Leaving the section resets it, so it always opens on the same card. */
  let timer = null;
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting && timer === null) {
        at = first;
        show(first);
        timer = setInterval(() => { at = (at + 1) % cards.length; show(at); }, 2800);
      } else if (!e.isIntersecting && timer !== null) {
        clearInterval(timer);
        timer = null;
        at = first;
        show(first);
      }
    });
  }, { threshold: 0.3 });

  io.observe(wrap);
})();

/* Journey modules: once the grid reaches the viewport the cards arrive one
   after another, so the section reads as a sequence rather than a block.
   The hiding class is added from here, so with JS off nothing disappears. */
document.querySelectorAll('[data-stagger]').forEach(grid => {
  const still = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (still.matches) return;                  // no entrance for anyone who opted out

  const items = Array.from(grid.children);
  grid.classList.add('stagger-ready');

  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      items.forEach((el, i) => {
        el.style.transitionDelay = (i * 85) + 'ms';
        el.classList.add('in');
      });
      io.disconnect();                        // a one-off entrance, not a loop
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -50px' });

  io.observe(grid);
});

/* Tools marquee (training page): duplicate each row's chips so the CSS can
   loop by shifting exactly -50% and land back where it started, with no seam.
   Without the clone the row would visibly jump when it restarts. */
document.querySelectorAll('.tp-mq-track').forEach(track => {
  Array.from(track.children).forEach(chip => {
    const copy = chip.cloneNode(true);
    copy.setAttribute('aria-hidden', 'true');   // a screen reader reads the row once
    track.appendChild(copy);
  });
});

// Footer year
document.getElementById('year').textContent = new Date().getFullYear();
