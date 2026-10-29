// Cigar Locker's home page in motion (2026-10-29): what comes into view rises
// and draws itself, figures count up, the stars light one by one, the rows of
// tiles drift past, the photos behind the sections move a little slower than
// the page, the header turns to glass once scrolled, and the front phone leans
// toward the pointer. Nothing moves for anyone whose phone or computer asks
// for less motion; everything is simply shown.

(() => {
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // The header: clear over the photo, glass once the page moves.
  const header = document.querySelector('.site-header');
  const onScroll = () => header && header.classList.toggle('scrolled', window.scrollY > 24);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Each row of tiles is two copies side by side, so the loop never shows a gap.
  for (const track of document.querySelectorAll('.marquee-track')) {
    const group = track.querySelector('.marquee-group');
    if (!group) continue;
    const copy = group.cloneNode(true);
    copy.setAttribute('aria-hidden', 'true');
    for (const img of copy.querySelectorAll('img')) img.alt = '';
    track.appendChild(copy);
  }

  const countUp = (el) => {
    const end = Number(el.dataset.count);
    const suffix = el.dataset.suffix || '';
    if (still || !end) {
      el.textContent = end.toLocaleString('en-US') + suffix;
      return;
    }
    const start = performance.now();
    const length = 1600;
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
    stars.forEach((s, i) => (still ? s.classList.add('lit') : setTimeout(() => s.classList.add('lit'), 350 + i * 110)));
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
      { threshold: 0.15, rootMargin: '0px 0px -5% 0px' },
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
      const off = (box.top + box.height / 2 - h / 2) * -0.12;
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

  // The front phone leans toward the pointer, on a computer.
  const hero = document.querySelector('.hero');
  const front = document.querySelector('.hero-phones .phone.front');
  if (hero && front && window.matchMedia('(pointer: fine)').matches) {
    hero.addEventListener('pointermove', (e) => {
      const box = hero.getBoundingClientRect();
      const x = (e.clientX - box.left) / box.width - 0.5;
      const y = (e.clientY - box.top) / box.height - 0.5;
      front.style.setProperty('--ry', `${(-8 + x * 14).toFixed(2)}deg`);
      front.style.setProperty('--rx', `${(4 - y * 10).toFixed(2)}deg`);
    });
    hero.addEventListener('pointerleave', () => {
      front.style.removeProperty('--ry');
      front.style.removeProperty('--rx');
    });
  }
})();
