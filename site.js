// Cigar Locker's home page: the download buttons, and the page's quiet motion.
//
// THE DOWNLOAD SWITCH. The day the app is in a store, put that store's address
// here and publish the site. Every button on the page then becomes a real
// download (Apple's own badge for the App Store), the header's "Coming soon"
// becomes the coral "Get the app", the closing headline changes, and on a phone
// a small bar keeps the download one tap away. Leave a store empty and its
// button keeps saying "Coming soon" and goes nowhere.
//
//   ios:      'https://apps.apple.com/app/id6827316453'
//   android:  'https://play.google.com/store/apps/details?id=com.cigarlocker.app'
const STORES = { ios: '', android: '' };

// What moves (2026-10-29, quieter since 2026-11-13): what comes into view rises
// once and draws itself, figures count up, the stars light one by one, two rows
// drift past, the photos behind sections move a little slower than the page,
// the header turns to glass once scrolled, and the hero's phone leans toward
// the pointer. Nothing moves for anyone whose phone or computer asks for less
// motion; everything is simply shown.

(() => {
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = document.documentElement;

  // ---- The stores ----------------------------------------------------------
  const phone = /iPhone|iPad|iPod/.test(navigator.userAgent) ? 'ios' : /Android/.test(navigator.userAgent) ? 'android' : null;
  const anyLive = Boolean(STORES.ios || STORES.android);
  for (const badge of document.querySelectorAll('[data-store]')) {
    const url = STORES[badge.dataset.store];
    if (!url) continue;
    badge.href = url;
    badge.removeAttribute('aria-disabled');
    badge.removeAttribute('role');
    badge.classList.add('is-live');
    const soon = badge.querySelector('.soon');
    const live = badge.querySelector('.live');
    if (soon) soon.hidden = true;
    if (live) live.hidden = false;
  }
  if (anyLive) {
    root.classList.add('live');
    for (const el of document.querySelectorAll('[data-soon]')) el.hidden = true;
    for (const el of document.querySelectorAll('[data-live]')) el.hidden = false;
    // The header's button goes to this phone's own store when it has one, else to the page's download section.
    const mine = (phone && STORES[phone]) || '';
    for (const get of document.querySelectorAll('[data-get]')) {
      get.classList.add('is-live');
      if (mine) get.href = mine;
    }
    // On a phone whose store has the app: a bar that stays, once the first screen is behind.
    const bar = document.querySelector('.get-bar');
    const go = bar && bar.querySelector('[data-get-store]');
    if (bar && go && mine) {
      go.href = mine;
      bar.hidden = false;
      const closing = document.querySelector('.closing');
      const place = () => {
        const past = window.scrollY > window.innerHeight * 0.7;
        const atEnd = closing ? closing.getBoundingClientRect().top < window.innerHeight * 0.75 : false;
        bar.classList.toggle('on', past && !atEnd);
      };
      window.addEventListener('scroll', place, { passive: true });
      place();
    }
  }

  // ---- The header: clear over the photo, glass once the page moves ---------
  const header = document.querySelector('.site-header');
  const onScroll = () => header && header.classList.toggle('scrolled', window.scrollY > 24);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Each drifting row is two copies side by side, so the loop never shows a gap.
  for (const track of document.querySelectorAll('.marquee-track')) {
    const group = track.querySelector('.marquee-group');
    if (!group) continue;
    const copy = group.cloneNode(true);
    copy.setAttribute('aria-hidden', 'true');
    for (const img of copy.querySelectorAll('img')) img.alt = '';
    track.appendChild(copy);
  }

  // The drifting rows' pictures wait until their row is near (they are far down the page), then all load together:
  // left to load one by one as each slid into view, a row would drift in with empty frames.
  const rows = [...document.querySelectorAll('.marquee')].filter((row) => row.querySelector('img[loading="lazy"]'));
  const loadRow = (row) => row.querySelectorAll('img[loading="lazy"]').forEach((img) => (img.loading = 'eager'));
  if (!('IntersectionObserver' in window)) rows.forEach(loadRow);
  else {
    const near = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          loadRow(e.target);
          near.unobserve(e.target);
        }
      },
      { rootMargin: '900px 0px' },
    );
    rows.forEach((row) => near.observe(row));
  }

  const countUp = (el) => {
    const end = Number(el.dataset.count);
    const suffix = el.dataset.suffix || '';
    if (still || !end) {
      el.textContent = end.toLocaleString('en-US') + suffix;
      return;
    }
    const start = performance.now();
    const length = 1400;
    const step = (now) => {
      const t = Math.min(1, (now - start) / length);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = Math.round(end * eased).toLocaleString('en-US') + suffix;
      if (t < 1) requestAnimationFrame(step);
    };
    el.textContent = '0' + suffix;
    requestAnimationFrame(step);
  };

  const lightStars = (el) => {
    const stars = [...el.querySelectorAll('svg')].slice(0, 9);
    stars.forEach((s, i) => (still ? s.classList.add('lit') : setTimeout(() => s.classList.add('lit'), 300 + i * 100)));
  };

  const show = (el) => {
    el.classList.add('on');
    if (el.dataset.count) countUp(el);
    if (el.classList.contains('stars')) lightStars(el);
  };

  const watched = document.querySelectorAll('.reveal, .draw, [data-count], .stars');
  if (!('IntersectionObserver' in window)) {
    watched.forEach(show);
  } else {
    const seen = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          show(e.target);
          seen.unobserve(e.target);
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -4% 0px' },
    );
    watched.forEach((el) => seen.observe(el));
  }

  if (still) return;

  // The photos behind the sections drift slower than the page.
  const layers = [...document.querySelectorAll('[data-parallax]')];
  let ticking = false;
  const drift = () => {
    ticking = false;
    const h = window.innerHeight;
    for (const layer of layers) {
      const box = layer.parentElement.getBoundingClientRect();
      if (box.bottom < -200 || box.top > h + 200) continue;
      const off = (box.top + box.height / 2 - h / 2) * -0.1;
      layer.style.transform = `translate3d(0, ${off.toFixed(1)}px, 0)`;
    }
  };
  const ask = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(drift);
    }
  };
  window.addEventListener('scroll', ask, { passive: true });
  window.addEventListener('resize', ask);
  drift();

  // The hero's phone leans toward the pointer, on a computer.
  const hero = document.querySelector('.hero');
  const front = document.querySelector('.hero-phone');
  if (hero && front && window.matchMedia('(pointer: fine)').matches) {
    hero.addEventListener('pointermove', (e) => {
      const box = hero.getBoundingClientRect();
      const x = (e.clientX - box.left) / box.width - 0.5;
      const y = (e.clientY - box.top) / box.height - 0.5;
      front.style.setProperty('--ry', `${(x * 10).toFixed(2)}deg`);
      front.style.setProperty('--rx', `${(-y * 8).toFixed(2)}deg`);
    });
    hero.addEventListener('pointerleave', () => {
      front.style.removeProperty('--ry');
      front.style.removeProperty('--rx');
    });
  }
})();
