/* Golden Qube — interactions */

/* ---------------------------------------------------------------------
   Motion
   ---------------------------------------------------------------------
   Scroll-driven animation that maps scroll position straight onto a
   transform moves exactly as fast as the wheel does: it starts and stops
   dead, and a flick reads as a jerk. iOS never does that — a gesture sets
   a target and the view chases it, so motion keeps flowing for a moment
   after your finger leaves the glass and eases into place.

   This is that, for the scroll-driven sections. Each one reports where it
   WANTS to be, and this loop carries the rendered value toward that target
   on a critically-damped curve, frame-rate independent, so it behaves the
   same at 60Hz and 120Hz. The loop sleeps as soon as everything has
   settled, so it costs nothing when the page is still.                 */
const Motion = (() => {
  const painters = new Set();
  let running = false;
  let last = 0;

  const frame = (now) => {
    // clamp dt so a backgrounded tab doesn't resume with one giant jump
    const dt = last ? Math.min((now - last) / 1000, 0.064) : 1 / 60;
    last = now;

    let busy = false;
    painters.forEach(fn => { if (fn(dt)) busy = true; });

    if (busy) {
      requestAnimationFrame(frame);
    } else {
      running = false;
      last = 0;
    }
  };

  const wake = () => {
    if (running) return;
    running = true;
    last = 0;
    requestAnimationFrame(frame);
  };

  return {
    /* fn(dt) runs every frame and returns true while it still has work.
       Scroll, resize and load all wake the loop back up. */
    add(fn) {
      painters.add(fn);
      addEventListener('scroll', wake, { passive: true });
      addEventListener('resize', wake);
      addEventListener('load', wake);
      wake();
    },
    wake,

    /* Exponential approach — the shape a critically-damped spring settles
       on. tau is the time constant in seconds: roughly how long it takes
       to cover the first 63% of the remaining distance. Lower is snappier.
       Written this way it is exact for any dt, so it never depends on the
       frame rate. */
    toward(current, target, dt, tau) {
      return target + (current - target) * Math.exp(-dt / tau);
    },

    /* close enough that another frame would not change a rendered pixel */
    settled(current, target) {
      return Math.abs(current - target) < 0.0008;
    }
  };
})();

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
    /* Normally the track slides left, so cards arrive from the right edge.
       Reversed, it starts shifted left and travels back to zero, so the
       cards arrive from the left edge instead. The CSS flips their running
       order to match, which keeps the points in sequence either way. */
    const x = section.hasAttribute('data-hs-reverse')
      ? -(1 - progress) * distance
      : -progress * distance;
    track.style.transform = 'translate3d(' + x + 'px,0,0)';
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

/* Email links that always land somewhere.
 *
 * A bare mailto: only works when the machine has a mail app registered.
 * On a typical Windows PC or a shared computer nothing happens at all, so
 * the visitor thinks the link is broken.
 *
 * These links keep mailto: in the href — that is what a phone, a Mac, or
 * anyone with Outlook should use, and it is the no-JS fallback — but on a
 * desktop browser we send the click to Gmail's compose window instead, with
 * the address and subject already filled in.
 */
document.querySelectorAll('a[data-mail]').forEach(link => {
  const address = link.dataset.mail;
  if (!address) return;

  /* Phones and tablets hand mailto: to the mail app that is always there,
     so leave those alone — webmail would be the worse experience. */
  const handheld = matchMedia('(hover: none) and (pointer: coarse)').matches;
  if (handheld) return;

  const compose = 'https://mail.google.com/mail/?view=cm&fs=1&to=' +
    encodeURIComponent(address) +
    (link.dataset.subject ? '&su=' + encodeURIComponent(link.dataset.subject) : '');

  link.addEventListener('click', event => {
    /* let ctrl/cmd-click, middle-click and the context menu behave normally */
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;

    event.preventDefault();
    const tab = window.open(compose, '_blank', 'noopener');
    /* if a popup blocker stopped it, fall back to the mailto: in the href */
    if (!tab) window.location.href = link.href;
  });
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

/* Why Choose: as each card in the stack gets covered by the next, it eases
   back and dims a little, which is what gives the pile its sense of depth.
   The stacking itself is plain CSS sticky — this only adds the recede, and
   writes a single number per card, so if it never runs the cards simply sit
   flat and nothing is broken. */
(() => {
  const stack = document.querySelector('.tp-why-stack');
  if (!stack) return;

  const cards = Array.from(stack.querySelectorAll('.tp-why-card'));
  if (cards.length < 2) return;

  const still = window.matchMedia('(prefers-reduced-motion: reduce)');
  // ease-in-out, so a card leaves and settles gently rather than linearly
  const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  const clamp = v => (v < 0 ? 0 : v > 1 ? 1 : v);

  // what is on screen now, chasing what the scroll position asks for
  const shown = cards.map(() => ({ arr: 1, cov: 0 }));
  let primed = false;

  const paint = (dt) => {
    const vh = window.innerHeight;
    let busy = false;

    cards.forEach((card, i) => {
      if (still.matches) {
        card.style.setProperty('--cov', '0');
        card.style.setProperty('--arr', '1');
        return;
      }

      const r = card.getBoundingClientRect();

      /* Grows from 75% to full as the card rises into view, and is already
         there by the time it parks at the top of the stack. */
      const arr = ease(clamp(1 - (r.top - vh * 0.15) / (vh * 0.6)));

      const next = cards[i + 1];
      // 0 while the next card is still below, 1 once it sits right on top
      const cov = next
        ? ease(clamp(r.height > 0 ? (r.bottom - next.getBoundingClientRect().top) / r.height : 0))
        : 0;

      const s = shown[i];
      if (!primed) { s.arr = arr; s.cov = cov; }

      /* The arrival is the one you watch, so it trails a little further
         behind the scroll; the recede is a background cue and keeps up. */
      s.arr = Motion.toward(s.arr, arr, dt, 0.13);
      s.cov = Motion.toward(s.cov, cov, dt, 0.10);
      if (!Motion.settled(s.arr, arr) || !Motion.settled(s.cov, cov)) busy = true;

      card.style.setProperty('--arr', s.arr.toFixed(4));
      card.style.setProperty('--cov', s.cov.toFixed(4));
    });

    primed = true;
    return busy;
  };

  Motion.add(paint);
  still.addEventListener('change', Motion.wake);
})();

/* Job roles: the cards fan out from behind the globe one after another as
   they come up the screen, and fold back on the way up. Read off the scroll
   position each frame rather than fired once, and --in defaults to 1, so
   without this the fan simply sits open. */
(() => {
  const stage = document.querySelector('[data-fan]');
  if (!stage) return;

  const cards = Array.from(stage.querySelectorAll('.tp-fan'));
  if (!cards.length) return;

  const still = window.matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = v => (v < 0 ? 0 : v > 1 ? 1 : v);
  const ease = t => 1 - Math.pow(1 - t, 3);

  const shown = cards.map(() => 1);
  let primed = false;

  const paint = (dt) => {
    if (still.matches) {
      cards.forEach(c => c.style.setProperty('--in', '1'));
      return false;
    }
    const vh = window.innerHeight;
    let busy = false;

    cards.forEach((card, i) => {
      const r = card.getBoundingClientRect();
      const want = ease(clamp(1 - (r.top - vh * 0.2) / (vh * 0.5)));

      if (!primed) shown[i] = want;
      /* a touch slower down the fan, so the cards arrive in a run rather
         than all snapping to the same beat */
      shown[i] = Motion.toward(shown[i], want, dt, 0.12 + i * 0.012);
      if (!Motion.settled(shown[i], want)) busy = true;

      card.style.setProperty('--in', shown[i].toFixed(3));
    });

    primed = true;
    return busy;
  };

  Motion.add(paint);
  still.addEventListener('change', Motion.wake);
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

/* Journey modules: each tile flies in from beyond the nearest screen edge as
   it reaches the viewport, and a rail under the heading fills to show how
   far through the twelve you have scrolled. Both read the scroll position
   each frame, so they run backwards on the way up rather than firing once. */
document.querySelectorAll('[data-stagger]').forEach(grid => {
  const items = Array.from(grid.children);
  if (!items.length) return;

  const section = grid.closest('section');
  const rail = section && section.querySelector('.tp-journey-rail');
  const still = window.matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = v => (v < 0 ? 0 : v > 1 ? 1 : v);
  const ease = t => 1 - Math.pow(1 - t, 3);

  /* How far each tile must travel to sit just outside the screen: one on the
     left half goes far enough left to clear that edge, one on the right far
     enough right.

     offsetLeft and offsetWidth are used rather than getBoundingClientRect
     because they report the laid-out position and ignore transforms. A rect
     reads where the tile has already been pushed to, so each call would
     measure a shorter distance than the last and the travel would collapse
     toward nothing. */
  const place = () => {
    const vw = window.innerWidth;
    const host = items[0].offsetParent || document.body;
    const hostLeft = host.getBoundingClientRect().left;

    items.forEach(el => {
      const left = hostLeft + el.offsetLeft;
      const w = el.offsetWidth;
      const from = (left + w / 2) < vw / 2
        ? -(left + w + 60)           // off the left edge
        : (vw - left + 60);          // off the right edge
      el.style.setProperty('--from', Math.round(from) + 'px');
    });
  };

  /* The section pins while the tiles arrive, so the page cannot move on
     until every one has landed. Only on screens wide enough to hold the
     whole grid at once — stacked two-wide on a phone it is far too tall to
     pin, so there the tiles just arrive as they scroll past. */
  const narrow = window.matchMedia('(max-width: 1080px)');
  const section2 = document.querySelector('[data-journey]');
  const outer = section2 && section2.querySelector('[data-journey-outer]');

  const measure = () => {
    if (!outer) return;
    if (narrow.matches || still.matches) {
      section2.classList.remove('pin-on');
      outer.style.height = '';
      return;
    }
    section2.classList.add('pin-on');
    // one screen held, plus a bit over another to bring them all in
    outer.style.height = Math.round(window.innerHeight * 2.15) + 'px';
  };

  const shown = items.map(() => 1);
  let shownRail = 1;
  let primed = false;

  const paint = (dt) => {
    const vh = window.innerHeight;
    const n = items.length;

    if (still.matches) {
      items.forEach(el => el.style.setProperty('--r', '1'));
      if (rail) rail.style.setProperty('--p', '1');
      return false;
    }

    const pinned = section2 && section2.classList.contains('pin-on');
    const want = new Array(n);
    let wantRail;

    if (pinned) {
      const span = outer.offsetHeight - vh;
      const p = span > 0 ? clamp(-outer.getBoundingClientRect().top / span) : 0;
      /* overlapping windows: each tile has its own slot in the scroll, but
         the slots run three wide so one starts before the last has finished
         and the arrivals flow rather than march */
      const step = 1 / (n + 2);
      for (let i = 0; i < n; i++) want[i] = ease(clamp((p - i * step) / (step * 3)));
      wantRail = p;
    } else {
      items.forEach((el, i) => {
        const r = el.getBoundingClientRect();
        /* a small offset per column makes a row arrive in sequence rather
           than all at once, without needing a timed delay */
        const stagger = (i % 7) * 0.05;
        want[i] = ease(clamp(1 - (r.top - vh * 0.18) / (vh * 0.52) - stagger));
      });
      if (rail) {
        const g = grid.getBoundingClientRect();
        // 0 as the grid reaches the bottom of the screen, 1 once it has passed
        wantRail = clamp((vh - g.top - vh * 0.25) / (g.height + vh * 0.5));
      }
    }

    let busy = false;
    for (let i = 0; i < n; i++) {
      if (!primed) shown[i] = want[i];
      shown[i] = Motion.toward(shown[i], want[i], dt, 0.15);
      if (!Motion.settled(shown[i], want[i])) busy = true;
      items[i].style.setProperty('--r', shown[i].toFixed(3));
    }
    if (rail && wantRail !== undefined) {
      if (!primed) shownRail = wantRail;
      // the rail is a readout, so it tracks the scroll more closely
      shownRail = Motion.toward(shownRail, wantRail, dt, 0.07);
      if (!Motion.settled(shownRail, wantRail)) busy = true;
      rail.style.setProperty('--p', shownRail.toFixed(3));
    }

    primed = true;
    return busy;
  };

  const relayout = () => { measure(); place(); primed = false; Motion.wake(); };
  narrow.addEventListener('change', relayout);
  window.addEventListener('resize', relayout);
  window.addEventListener('load', relayout);
  still.addEventListener('change', relayout);

  measure();
  place();
  Motion.add(paint);
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

/* ---------------------------------------------------------------------
   Reel ring (business page)
   ---------------------------------------------------------------------
   Two jobs: raise the cards into the circle as the section is scrolled
   through, and open a reel in the player when one is tapped.          */
(() => {
  const section = document.querySelector('[data-vs]');
  if (!section) return;

  const outer = section.querySelector('[data-vs-outer]');
  const stage = section.querySelector('.vs-stage');
  const cards = Array.from(section.querySelectorAll('.vs-card'));
  if (!outer || !stage || !cards.length) return;

  const still = window.matchMedia('(prefers-reduced-motion: reduce)');
  /* Below this the ring is laid out as a swipeable row instead, and a row
     has nothing to assemble — the CSS already shows every card. */
  const narrow = window.matchMedia('(max-width: 640px)');
  const clamp = v => (v < 0 ? 0 : v > 1 ? 1 : v);
  const ease = t => 1 - Math.pow(1 - t, 3);

  /* ---- the climb ---- */

  const measure = () => {
    if (narrow.matches || still.matches) {
      section.classList.remove('pin-on');
      outer.style.height = '';
      cards.forEach(c => c.style.setProperty('--r', '1'));
      return;
    }
    section.classList.add('pin-on');
    /* One screen held still, plus most of another to bring the seven in.
       Any longer and the circle sits finished while the page refuses to
       move on, which reads as the scroll having jammed. */
    outer.style.height = Math.round(window.innerHeight * 1.95) + 'px';
  };

  const shown = cards.map(() => 0);
  let primed = false;

  const paint = (dt) => {
    if (!section.classList.contains('pin-on')) {
      if (!primed) { cards.forEach(c => c.style.setProperty('--r', '1')); primed = true; }
      return false;
    }

    const span = outer.offsetHeight - window.innerHeight;
    const p = span > 0 ? clamp(-outer.getBoundingClientRect().top / span) : 0;

    /* Overlapping windows, so the cards flow in one after another rather
       than marching: each gets its own slot, but a slot is three times
       the gap between starts, so the next lifts off before the last has
       landed. They finish together by about 80% of the scroll, leaving a
       beat with the circle whole before the page moves on. */
    const n = cards.length;
    const step = 0.8 / (n + 2);

    let busy = false;
    for (let i = 0; i < n; i++) {
      const want = ease(clamp((p - i * step) / (step * 3)));
      if (!primed) shown[i] = want;
      shown[i] = Motion.toward(shown[i], want, dt, 0.13);
      if (!Motion.settled(shown[i], want)) busy = true;
      cards[i].style.setProperty('--r', shown[i].toFixed(3));
    }

    primed = true;
    return busy;
  };

  const relayout = () => { measure(); primed = false; Motion.wake(); };
  window.addEventListener('resize', relayout);
  window.addEventListener('load', relayout);
  narrow.addEventListener('change', relayout);
  still.addEventListener('change', relayout);

  measure();
  Motion.add(paint);

  /* ---- the player ---- */

  const box = document.getElementById('vs-lightbox');
  const frame = document.getElementById('vs-lb-frame');
  if (!box || !frame) return;

  let lastFocus = null;

  const open = (code) => {
    lastFocus = document.activeElement;
    frame.src = 'https://www.instagram.com/reel/' + encodeURIComponent(code) + '/embed/';
    box.hidden = false;
    document.body.style.overflow = 'hidden';
    const close = box.querySelector('.vs-lb-close');
    if (close) close.focus();
  };

  const close = () => {
    box.hidden = true;
    frame.src = '';                      // this is what stops the video
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  };

  cards.forEach(card => {
    card.addEventListener('click', e => {
      const code = card.dataset.reel;
      /* Let the browser do its usual thing for a new tab, a middle click
         or a modified click — the href is still the real reel. */
      if (!code || e.defaultPrevented || e.button !== 0 ||
          e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      open(code);
    });
  });

  box.addEventListener('click', e => {
    if (e.target.hasAttribute('data-vs-close')) close();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !box.hidden) close();
  });
})();

// Footer year
document.getElementById('year').textContent = new Date().getFullYear();
