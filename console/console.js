// Cigar Locker's console (2026-10-29): his control panel, on the web only.
// This page holds nothing. It signs in with his console email (a link, or a
// code where the email shows one), then the six-digit code from his
// authenticator app, and only then asks the console function for the
// figures (supabase/functions/console). The sign-in lives in this tab only
// and ends after 30 minutes untouched. Every name, note and address on the
// screen was typed by somebody, so all of it goes in as text, never as HTML.

(() => {
  const SUPABASE_URL = 'https://nypahhdmoxrfvwnfufdf.supabase.co';
  const PUBLIC_KEY = 'sb_publishable_QeBMueHE5KTcVrtU4Ys8AA_nFi_kdb1';
  const IDLE_MINUTES = 30;
  const REFRESH_MINUTES = 5;
  const ZONE = 'America/New_York';

  const client = window.supabase.createClient(SUPABASE_URL, PUBLIC_KEY, {
    auth: {
      storage: window.sessionStorage,
      storageKey: 'cigar.console',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'implicit',
    },
  });

  const $ = (id) => document.getElementById(id);

  // What this computer remembers: the look, the part shown, the folded filters.
  function remember(key, value) {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch {
      // A browser that keeps nothing starts as new each time.
    }
  }
  function recall(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  // Bright, or the website's dark (his words, 2026-10-30: "I need to make it brighter").
  const LOOK = 'console.look';
  function setLook(look) {
    if (look === 'dark') document.documentElement.dataset.look = 'dark';
    else delete document.documentElement.dataset.look;
    $('look').textContent = look === 'dark' ? 'Bright' : 'Dark';
    remember(LOOK, look === 'dark' ? 'dark' : '');
  }
  setLook(recall(LOOK));
  $('look').addEventListener('click', () => setLook(document.documentElement.dataset.look === 'dark' ? '' : 'dark'));

  // The buttons along the top (his words: "buttons at the top that'll say
  // global"): one part of the console at a time, remembered.
  const TAB = 'console.tab';
  const TABS = ['global', 'people', 'market', 'emails', 'knowledge', 'featured', 'health'];
  function showTab(name) {
    const tab = TABS.includes(name) ? name : 'global';
    for (const el of document.querySelectorAll('[data-tab]')) el.hidden = el.dataset.tab !== tab;
    for (const b of document.querySelectorAll('#tabs [data-show]')) b.setAttribute('aria-selected', b.dataset.show === tab ? 'true' : 'false');
    remember(TAB, tab);
    if (tab === 'featured' && !$('board').hidden) loadFeatured();
  }
  for (const b of document.querySelectorAll('#tabs [data-show]')) {
    b.addEventListener('click', () => {
      showTab(b.dataset.show);
      window.scrollTo(0, 0);
    });
  }
  showTab(recall(TAB) || 'global');

  /** An element with its attributes and children; strings become text. */
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      // Set through the page's own script: the page allows no inline styles.
      else if (k === 'style') Object.assign(el.style, v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  const SVG = 'http://www.w3.org/2000/svg';
  function s(tag, attrs) {
    const el = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
    return el;
  }

  // ---- words and figures ----------------------------------------------------

  const whole = new Intl.NumberFormat('en-US');
  const n = (x) => whole.format(Math.round(Number(x) || 0));
  const money = (cents) => {
    const d = (Number(cents) || 0) / 100;
    return d >= 100 ? `$${whole.format(Math.round(d))}` : `$${d.toFixed(2)}`;
  };
  const minutes = (m) => {
    m = Math.round(Number(m) || 0);
    if (m < 60) return `${m} min`;
    return `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim();
  };
  const plural = (count, one, many) => `${n(count)} ${Number(count) === 1 ? one : many || `${one}s`}`;
  const dayFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: ZONE });
  const dayYearFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: ZONE });
  const timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: ZONE });
  const weekdayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' });
  /** A calendar day ("2026-10-29") read as that day, wherever this computer is. */
  const calendarDay = (d) => new Date(`${d}T12:00:00Z`);
  const shortDay = (d) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(calendarDay(d));
  const longDay = (d) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(calendarDay(d));

  function ago(iso) {
    if (!iso) return '';
    const sec = (Date.now() - Date.parse(iso)) / 1000;
    if (sec < 90) return 'just now';
    if (sec < 3600) return `${Math.round(sec / 60)} min ago`;
    if (sec < 86400) return `${Math.round(sec / 3600)} h ago`;
    if (sec < 7 * 86400) return `${Math.round(sec / 86400)} days ago`;
    return dayYearFmt.format(new Date(iso));
  }

  let today = '';
  function whichDay(d) {
    if (!d) return '';
    if (d === today) return 'today';
    const yesterday = new Date(calendarDay(today).getTime() - 86400000).toISOString().slice(0, 10);
    if (d === yesterday) return 'yesterday';
    return `on ${weekdayFmt.format(calendarDay(d))}`;
  }

  // ---- signing in -------------------------------------------------------------

  let typedEmail = '';

  function gate(title, words, show) {
    $('board').hidden = true;
    $('top-right').hidden = true;
    $('tabs').hidden = true;
    $('gate').hidden = false;
    $('gate-title').textContent = title;
    $('gate-words').textContent = words;
    $('gate-error').textContent = '';
    for (const id of ['email-form', 'otp-form', 'enroll', 'code-form']) $(id).hidden = !show.includes(id);
    const first = show.map((id) => $(id).querySelector('input')).find(Boolean);
    if (first) setTimeout(() => first.focus(), 0);
  }

  const failed = (e) => {
    $('gate-error').textContent = e && e.message ? e.message : String(e);
  };

  function askEmail() {
    gate('Sign in', 'The console opens only for its own account, with a code from your authenticator app.', ['email-form']);
  }

  $('email-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    typedEmail = $('email').value.trim();
    const { error } = await client.auth.signInWithOtp({
      email: typedEmail,
      options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname },
    });
    // The same words whether or not the address has an account here.
    if (error && !/signups not allowed|user not found/i.test(error.message)) return failed(error);
    gate('Check your email', `If ${typedEmail} can open the console, a sign-in link is on its way. Open it on this computer.`, ['otp-form']);
  });

  $('otp-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const { error } = await client.auth.verifyOtp({ email: typedEmail, token: $('otp').value.trim(), type: 'email' });
    if (error) return failed(error);
    await afterSignIn();
  });

  $('start-over').addEventListener('click', askEmail);

  let factorId = null;

  /** Signed in with the email: now the authenticator code, set up the first time. */
  async function afterSignIn() {
    const { data: level, error } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) return failed(error);
    if (level.currentLevel === 'aal2') return openBoard();
    const { data: factors, error: listError } = await client.auth.mfa.listFactors();
    if (listError) return failed(listError);
    const ready = (factors.totp || []).find((f) => f.status === 'verified');
    if (ready) {
      factorId = ready.id;
      return gate('One more step', 'Enter the six-digit code your authenticator app shows for Cigar Locker Console.', ['code-form']);
    }
    // First time: an authenticator app is set up now. A half-finished one
    // from an earlier try is cleared first.
    for (const f of factors.all || []) {
      if (f.factor_type === 'totp' && f.status !== 'verified') await client.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data: made, error: enrollError } = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Cigar Locker Console' });
    if (enrollError) return failed(enrollError);
    factorId = made.id;
    $('qr').src = made.totp.qr_code;
    // On a phone the QR code cannot be scanned: its link opens the phone's
    // authenticator app with the account filled in, and the key is in
    // fours, copied whole by a button.
    $('totp-link').href = made.totp.uri;
    $('secret').textContent = made.totp.secret.replace(/(.{4})/g, '$1 ').trim();
    $('copy-secret').onclick = () =>
      navigator.clipboard.writeText(made.totp.secret).then(
        () => ($('copy-secret').textContent = 'Copied'),
        () => ($('copy-secret').textContent = 'Copy failed: type it in'),
      );
    gate(
      'Set up your authenticator',
      "Scan this with your phone's camera or authenticator app (the iPhone's Passwords app, Google Authenticator or 1Password), then enter the six digits it shows. From now on the console asks for them each time.",
      ['enroll', 'code-form'],
    );
  }

  $('code-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const { error } = await client.auth.mfa.challengeAndVerify({ factorId, code: $('code').value.trim() });
    $('code').value = '';
    if (error) return failed(error);
    await openBoard();
  });

  async function signOut(words) {
    clearInterval(refreshTimer);
    await client.auth.signOut().catch(() => undefined);
    askEmail();
    if (words) $('gate-words').textContent = words;
  }

  $('sign-out').addEventListener('click', () => signOut('Signed out.'));

  // Untouched for half an hour: signed out.
  let lastTouch = Date.now();
  for (const evName of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
    window.addEventListener(evName, () => (lastTouch = Date.now()), { passive: true });
  }
  setInterval(() => {
    if (!$('board').hidden && Date.now() - lastTouch > IDLE_MINUTES * 60000) {
      signOut(`Signed out after ${IDLE_MINUTES} minutes untouched.`);
    }
  }, 30000);

  // ---- asking the server ------------------------------------------------------

  async function ask(body) {
    const { data } = await client.auth.getSession();
    const token = data.session && data.session.access_token;
    if (!token) throw Object.assign(new Error('Sign in first.'), { code: 'no sign-in' });
    const res = await fetch(`${SUPABASE_URL}/functions/v1/console`, {
      method: 'POST',
      headers: { apikey: PUBLIC_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(out.error || 'The console could not be read.'), { code: out.code, status: res.status });
    return out;
  }

  let refreshTimer = null;
  let snapshot = null;

  async function openBoard() {
    $('gate').hidden = true;
    $('board').hidden = false;
    $('top-right').hidden = false;
    $('tabs').hidden = false;
    await refresh();
    if (recall(TAB) === 'featured') loadFeatured();
    clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, REFRESH_MINUTES * 60000);
  }

  /** The board again; worked out afresh on the server when he asks (the Refresh button). */
  async function refresh(fresh = false) {
    $('board').classList.add('loading');
    try {
      snapshot = await ask({ action: 'snapshot', fresh: fresh === true });
      render(snapshot);
    } catch (e) {
      if (e.status === 401 || e.status === 403) {
        await signOut(e.message);
        return;
      }
      $('updated').textContent = e.message;
    } finally {
      $('board').classList.remove('loading');
    }
  }

  $('refresh').addEventListener('click', () => refresh(true));

  // ---- the board ----------------------------------------------------------------

  // The names of the members in "What's happening", from the server.
  let names = {};

  function who(id, install) {
    if (!id) return install ? `Someone not signed in (install ${install})` : 'Someone not signed in';
    return names[id] || 'A member';
  }

  function render(d) {
    today = d.today;
    names = d.names || {};
    $('updated').textContent = `Updated ${timeFmt.format(new Date(d.at))}`;
    tiles(d.totals, d.plus || {});
    barChart($('chart-active'), d.daily, 'active', (v) => plural(v, 'person', 'people'));
    barChart($('chart-scans'), d.daily, 'scans', (v) => plural(v, 'scan'));
    feed(d.feed);
    renderFilters();
    loadPeople(false);
    market(d.market);
    knowledge(d.knowledge);
    mailBox(d.mail, d.totals);
    health(d.health, d.totals);
    log(d.log);
  }

  /** What Cigar Locker knows of cigars: its libraries, look-ups and scans. */
  function knowledge(k) {
    if (!k) return $('knowledge').replaceChildren();
    const added = k.newThisMonth || {};
    $('knowledge').replaceChildren(
      tile('Cigar lines on record', n(k.lines), `From ${n(k.makers)} makers, ${n(k.sizes)} sizes · ${n(k.linesFromWeb)} found on the web`),
      tile('Bands it recognises', n(k.bands), k.bandsFromScans ? `${n(k.bandsFromScans)} learned from members’ scans` : 'From makers’ catalogues and your photos'),
      tile('Cigars looked up in detail', n(k.lookedUp), `${n(k.withPhoto)} with a photo`),
      tile('Scans so far', n(k.scans), `${n(k.scans30)} in the last 30 days`),
      tile('Kinds in members’ humidors', n(k.kindsOwned), k.kindsOwned ? `${Math.round((k.kindsKnown / k.kindsOwned) * 100)}% with full details` : ''),
      tile('Added this month', n((added.lines || 0) + (added.bands || 0) + (added.lookedUp || 0)), `${n(added.lines)} lines, ${n(added.bands)} bands, ${n(added.lookedUp)} look-ups`),
    );
  }

  function tile(label, value, note) {
    return h('div', { class: 'tile' }, h('div', { class: 'tile-label', text: label }), h('div', { class: 'tile-value', text: value }), note ? h('div', { class: 'tile-note', text: note }) : null);
  }

  function tiles(t, plus) {
    $('tiles').replaceChildren(
      tile('Members', n(t.accounts), `${n(t.joined7)} new this week · ${n(t.finished)} finished sign-up`),
      tile('Plus members', n(plus.plus), `${n(plus.paying)} paying · ${n(plus.gifts)} given · ${plus.keysSet ? 'Apple keys in' : 'Apple keys not set yet'}`),
      tile('Installs', n(t.installs), `${n(t.installs7)} new this week · App Store figures to come`),
      tile('In the app today', n(t.activeToday), `${n(t.active7)} this week · ${n(t.active30)} in 30 days`),
      tile('Opens today', n(t.opensToday), `${minutes(t.minutesToday)} in all · a visit averages ${minutes(t.avgVisitSeconds7 / 60)}`),
      tile('Scans today', n(t.scansToday), `${n(t.scans30)} in 30 days · ${n(t.lookups30)} look-ups · ${n(t.suggestions30)} suggestions`),
      tile('AI this month', money(t.aiCentsMonth), 'Estimated; the bill is in the Anthropic Console'),
      tile('Cigars tracked', n(t.cigarsTracked), 'In members’ humidors now'),
      tile('On Friends', n(t.usernames), `${plural(t.posts7, 'post')} and ${plural(t.messages7, 'message')} this week${t.openReports ? ` · ${plural(t.openReports, 'report')} waiting` : ''}`),
    );
  }

  // One series per chart, so no legend: the title says what it is. Each bar
  // shows its day and figure on hover or focus, and the numbers are below.
  function barChart(box, daily, key, words) {
    const W = 520;
    const H = 170;
    const pad = { l: 34, r: 8, t: 10, b: 26 };
    const values = daily.map((d) => Number(d[key]) || 0);
    const top = niceTop(Math.max(1, ...values));
    const slot = (W - pad.l - pad.r) / daily.length;
    const bar = Math.min(24, Math.max(3, slot - 2));
    const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / top);
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'bars', role: 'img', 'aria-label': box.previousElementSibling.textContent });
    for (const tick of [0, top / 2, top]) {
      svg.append(s('line', { x1: pad.l, x2: W - pad.r, y1: y(tick), y2: y(tick), class: 'grid' }));
      const label = s('text', { x: pad.l - 6, y: y(tick) + 4, class: 'tick', 'text-anchor': 'end' });
      label.textContent = compact(tick);
      svg.append(label);
    }
    daily.forEach((d, i) => {
      const v = values[i];
      const x = pad.l + i * slot + (slot - bar) / 2;
      const hit = s('rect', { x: pad.l + i * slot, y: pad.t, width: slot, height: H - pad.t - pad.b, class: 'hit', tabindex: 0 });
      const text = `${shortDay(d.day)}: ${words(v)}`;
      hit.setAttribute('aria-label', text);
      const show = (ev) => tip(text, ev, hit);
      hit.addEventListener('pointermove', show);
      hit.addEventListener('focus', show);
      hit.addEventListener('pointerleave', hideTip);
      hit.addEventListener('blur', hideTip);
      if (v > 0) {
        const g = s('path', { d: roundedTop(x, y(v), bar, y(0) - y(v)), class: d.day === today ? 'bar now' : 'bar' });
        svg.append(g);
      }
      svg.append(hit);
      if (i === 0 || i === daily.length - 1 || i === Math.floor(daily.length / 2)) {
        const label = s('text', { x: x + bar / 2, y: H - 8, class: 'tick', 'text-anchor': 'middle' });
        label.textContent = i === daily.length - 1 ? 'Today' : shortDay(d.day);
        svg.append(label);
      }
    });
    const rows = daily
      .filter((d, i) => values[i] > 0)
      .reverse()
      .map((d) => h('tr', {}, h('td', { text: longDay(d.day) }), h('td', { class: 'num', text: n(d[key]) })));
    box.replaceChildren(
      svg,
      h('details', { class: 'numbers' }, h('summary', { text: 'Show the numbers' }), rows.length ? h('table', { class: 'plain' }, h('tbody', {}, rows)) : h('p', { class: 'muted small', text: 'Nothing yet.' })),
    );
  }

  function niceTop(max) {
    const step = Math.pow(10, Math.floor(Math.log10(max)));
    for (const m of [1, 2, 4, 5, 10]) if (m * step >= max) return Math.max(2, m * step);
    return max;
  }
  const compact = (v) => (v >= 1000 ? `${Math.round(v / 100) / 10}K` : String(Math.round(v)));

  /** A bar with a 4px rounded top and a square foot on the baseline. */
  function roundedTop(x, top, w, height) {
    const r = Math.min(4, w / 2, height);
    const bottom = top + height;
    return `M${x},${bottom}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${bottom}Z`;
  }

  function tip(text, ev, target) {
    const t = $('tip');
    t.textContent = text;
    t.hidden = false;
    const box = target.getBoundingClientRect();
    const x = ev && ev.clientX ? ev.clientX : box.left + box.width / 2;
    t.style.left = `${Math.min(window.innerWidth - t.offsetWidth - 8, Math.max(8, x - t.offsetWidth / 2))}px`;
    t.style.top = `${box.top + window.scrollY - t.offsetHeight - 6}px`;
  }
  const hideTip = () => ($('tip').hidden = true);

  const SCAN_WORDS = {
    scans: (k) => `scanned ${plural(k, 'cigar')}`,
    lookups: (k) => `looked up ${plural(k, 'cigar')}`,
    pairings: (k) => `asked for ${plural(k, 'suggestion')}`,
    shops: (k) => `looked up ${plural(k, 'shop')}`,
  };

  function feedWords(item) {
    const name = who(item.who, item.install);
    switch (item.kind) {
      case 'joined':
        return `${name} joined Cigar Locker`;
      case 'opens':
        return `${name} opened the app ${item.n === 1 ? 'once' : `${n(item.n)} times`} ${whichDay(item.day)} (${minutes(item.minutes)})`;
      case 'purchase':
        return `${name} added ${n(item.n)} ${item.cigar || 'cigars'}${item.shop ? ` from ${item.shop}` : ''}${item.cents ? ` (${money(item.cents)})` : ''}`;
      case 'import':
        return `${name} brought in a collection: ${plural(item.n, 'cigar')}, ${plural(item.kinds, 'kind')}`;
      case 'rating':
        return `${name} rated ${item.cigar || 'a cigar'} ${n(item.rating)} of 10`;
      case 'post':
        return `${name} told friends they're enjoying ${item.cigar || 'a cigar'}`;
      default:
        return SCAN_WORDS[item.kind] ? `${name} ${SCAN_WORDS[item.kind](item.n)} ${whichDay(item.day)}` : null;
    }
  }

  function feed(items) {
    const lines = items.map((i) => [i, feedWords(i)]).filter(([, w]) => w);
    $('feed').replaceChildren(
      ...(lines.length
        ? lines.map(([i, w]) => h('li', {}, h('span', { text: w }), h('time', { datetime: i.at, text: ago(i.at) })))
        : [h('li', { class: 'muted', text: 'Nothing in the last few days.' })]),
    );
  }

  // ---- members ------------------------------------------------------------------

  const COLUMNS = [
    { key: 'member', label: 'Member', sort: (m) => (m.name || m.username || m.email).toLowerCase() },
    { key: 'phone', label: 'Phone', sort: (m) => m.phone },
    { key: 'home', label: 'Lives in', sort: (m) => `${m.state} ${m.city} ${m.zip}` },
    { key: 'age', label: 'Age', num: true, sort: (m) => m.age ?? -1 },
    { key: 'joined', label: 'Joined', sort: (m) => m.joined },
    { key: 'seen', label: 'Last seen', sort: (m) => m.lastSeen || m.lastSignIn || '' },
    { key: 'visits', label: 'In the app', num: true, sort: (m) => m.minutesToday * 1e6 + m.minutes7 },
    { key: 'scans', label: 'Scans', num: true, sort: (m) => m.scans30 * 1000 + m.scansToday },
    { key: 'now', label: 'Cigars now', num: true, sort: (m) => m.cigarsNow },
    { key: 'bought', label: 'Bought, 12 mo', num: true, sort: (m) => m.bought12 },
    { key: 'paid', label: 'Paid vs retail', num: true, sort: (m) => (m.retailCents ? m.paidCents / m.retailCents : -1) },
    { key: 'ratings', label: 'Ratings', num: true, sort: (m) => m.rated },
    { key: 'sensors', label: 'Sensors', num: true, sort: (m) => m.sensors },
    { key: 'shop', label: 'Buys most at', sort: (m) => m.topShop.toLowerCase() },
    { key: 'mail', label: 'Emails', sort: (m) => (m.news ? 2 : 0) + (m.offers ? 1 : 0) },
  ];

  let sortBy = 'joined';
  let sortDown = true;

  function paidWords(m) {
    if (!m.retailCents) return '';
    const pct = Math.round((m.paidCents / m.retailCents) * 100);
    return `${pct}%`;
  }

  function cells(m) {
    const where = [m.city, [m.state, m.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    return {
      member: h(
        'div',
        { class: 'who' },
        h('strong', { text: m.name || (m.username ? `@${m.username}` : 'No name given') }),
        m.name && m.username ? h('span', { class: 'muted', text: ` @${m.username}` }) : null,
        h('div', { class: 'muted small', text: m.email + (m.relay ? ' (Apple relay)' : '') }),
        m.profile ? null : h('div', { class: 'warn small', text: 'Sign-up not finished' }),
      ),
      phone: m.phone ? formatPhone(m.phone) : '',
      home: h('div', {}, where, m.street ? h('div', { class: 'muted small', text: m.street }) : null),
      age: m.age ?? '',
      joined: dayYearFmt.format(new Date(m.joined)),
      seen: ago(m.lastSeen || m.lastSignIn),
      visits: m.opens7
        ? h(
            'div',
            {},
            m.opensToday ? `${plural(m.opensToday, 'open')} today, ${minutes(m.minutesToday)}` : 'Not today',
            h('div', { class: 'muted small', text: `${plural(m.opens7, 'open')} this week, ${minutes(m.minutes7)}` }),
          )
        : '',
      scans: m.scans30 ? h('div', {}, `${n(m.scansToday)} today`, h('div', { class: 'muted small', text: `${n(m.scans30)} in 30 days` })) : '',
      now: m.cigarsNow ? h('div', {}, n(m.cigarsNow), h('div', { class: 'muted small', text: plural(m.kindsNow, 'kind') })) : '',
      bought: m.bought12 ? h('div', {}, n(m.bought12), h('div', { class: 'muted small', text: m.spent12 ? money(m.spent12) : 'no prices' })) : '',
      paid: paidWords(m),
      ratings: m.rated ? `${m.avgRating} avg · ${n(m.rated)}` : '',
      sensors: sensorCell(m),
      shop: m.topShop,
      mail: h(
        'div',
        { class: 'chips' },
        h('span', { class: m.news ? 'chip on' : 'chip', text: 'News' }),
        h('span', { class: m.offers ? 'chip on' : 'chip', text: 'Offers' }),
        h('span', { class: m.insights ? 'chip on' : 'chip', text: 'Insights' }),
      ),
    };
  }

  /** "6 sensors", then their humidity as the phone last sent it: "60–68% · 1 off · 2 hr ago". */
  function sensorCell(m) {
    const s = m.sensorStatus;
    const count = Math.max(m.sensors || 0, (s && s.sensors) || 0);
    if (!count) return '';
    const range = s && s.low != null ? (s.low === s.high ? `${s.low}%` : `${s.low}–${s.high}%`) : '';
    const line = s
      ? [range || 'No readings', s.off ? `${n(s.off)} off target` : '', s.quiet ? `${n(s.quiet)} quiet` : '', s.read ? ago(s.read) : ''].filter(Boolean).join(' · ')
      : 'No readings sent yet';
    return h('div', {}, plural(count, 'sensor'), h('div', { class: s && s.off ? 'warn small' : 'muted small', text: line }));
  }

  const formatPhone = (p) => {
    const d = p.replace(/\D/g, '').slice(-10);
    return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p;
  };

  // ---- people: any group he likes (groups.js), then email or a spreadsheet -------

  const G = window.CigarGroups;
  let filters = [];
  let loadedGroup = null;
  const ctx = () => ({ now: Date.now() });

  const placeFilter = () => filters.find((f) => f.field === 'place' && f.place);
  const milesTo = (m) => {
    const f = placeFilter();
    return f && m.lat != null ? G.milesBetween(f.place, m) : null;
  };

  /** What a filtered field shows in its own column. */
  function fieldText(f, m) {
    if (f.type === 'place') {
      const miles = milesTo(m);
      return miles == null ? '' : `${n(miles)} mi`;
    }
    const v = f.get(m, ctx());
    if (v === null || v === undefined || v === '') return '';
    if (f.type === 'yesno') return v ? 'Yes' : 'No';
    if (f.unit === 'dollars') return `$${n(v)}`;
    if (Array.isArray(v)) {
      const words = v.map(f.words || ((x) => x));
      return words.length > 4 ? `${words.slice(0, 4).join(', ')} and ${words.length - 4} more` : words.join(', ');
    }
    if (f.key === 'cigars') {
      const t = ((filters.find((x) => x.field === 'cigars') || {}).text || '').toLowerCase();
      return (m.cigars || []).filter((c) => !t || c.toLowerCase().includes(t)).slice(0, 3).join(', ');
    }
    return typeof v === 'number' ? n(v) : (f.words || ((x) => x))(String(v));
  }

  function fieldColumn(f) {
    return {
      key: `f:${f.key}`,
      label: f.key === 'place' ? 'Miles away' : f.label,
      num: f.type === 'range' || f.type === 'place',
      sort: (m) => {
        const v = f.type === 'place' ? milesTo(m) : f.get(m, ctx());
        if (v === null || v === undefined) return f.type === 'range' || f.type === 'place' ? -Infinity : '';
        return Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? Number(v) : v;
      },
      cell: (m) => fieldText(f, m),
    };
  }

  function columnsNow() {
    const seen = new Set();
    const extra = [];
    for (const filter of filters) {
      const f = G.byKey.get(filter.field);
      if (f && !seen.has(f.key) && f.key !== 'age') {
        seen.add(f.key);
        extra.push(fieldColumn(f));
      }
    }
    return [...COLUMNS, ...extra];
  }

  // The group, a page at a time, filtered, searched and sorted on the server
  // (console_find), so it is the same with ten members or half a million.
  const PAGE = 200;
  let page = { total: 0, reach: { news: 0, offers: 0 }, rows: [] };
  let pageAsked = 0;
  let pageTimer = null;
  let pageError = '';

  const search = () => $('member-search').value.trim();

  /** The group changed: ask again, once he has stopped typing for a moment. */
  function people() {
    clearTimeout(pageTimer);
    pageTimer = setTimeout(() => loadPeople(false), 250);
  }

  async function loadPeople(more) {
    if (!snapshot) return;
    const asked = ++pageAsked;
    try {
      const got = await ask({
        action: 'people',
        filters,
        search: search(),
        sort: sortBy,
        desc: sortDown,
        offset: more ? page.rows.length : 0,
        limit: PAGE,
      });
      if (asked !== pageAsked) return;
      page = more ? { ...got, rows: [...page.rows, ...got.rows] } : got;
      pageError = '';
    } catch (e) {
      if (asked !== pageAsked) return;
      pageError = e.message;
    }
    drawPeople();
  }

  function drawPeople() {
    const shown = page.rows;
    const all = (snapshot && snapshot.people && snapshot.people.total) || 0;
    const q = search();
    const columns = columnsNow();
    const narrowed = filters.some((f) => G.describe(f)) || q;
    $('member-count').textContent = pageError || (narrowed ? `${n(page.total)} of ${plural(all, 'member')}` : plural(all, 'member'));
    $('group-words').textContent = narrowed ? G.describeAll(filters) + (q ? ` · search "${q}"` : '') : 'Everyone';
    $('email-group').textContent = page.total === 1 ? 'Email this person' : `Email these ${n(page.total)} people`;
    $('email-group').disabled = page.total === 0;
    $('group-reach').textContent = `${n(page.reach.offers)} can get offers, ${n(page.reach.news)} can get news`;
    $('download-group').disabled = page.total === 0;
    $('members').tHead.replaceChildren(
      h(
        'tr',
        {},
        columns.map((c) =>
          h(
            'th',
            { class: c.num ? 'num' : null, 'aria-sort': c.key === sortBy ? (sortDown ? 'descending' : 'ascending') : null },
            h('button', {
              type: 'button',
              class: 'sort',
              text: c.label + (c.key === sortBy ? (sortDown ? ' ↓' : ' ↑') : ''),
              onclick: () => {
                if (sortBy === c.key) sortDown = !sortDown;
                else {
                  sortBy = c.key;
                  sortDown = true;
                }
                loadPeople(false);
              },
            }),
          ),
        ),
      ),
    );
    const body = [];
    for (const m of shown) {
      const c = cells(m);
      body.push(
        h(
          'tr',
          {
            class: 'member',
            tabindex: 0,
            title: 'Open their page',
            onclick: () => openPerson(m),
            onkeydown: (ev) => (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), openPerson(m)),
          },
          columns.map((col) => h('td', { class: col.num ? 'num' : null }, col.cell ? col.cell(m) : c[col.key])),
        ),
      );
    }
    if (shown.length < page.total) {
      body.push(
        h(
          'tr',
          {},
          h(
            'td',
            { colspan: columns.length, class: 'muted' },
            `Showing ${n(shown.length)} of ${n(page.total)}. `,
            h('button', { type: 'button', class: 'link', text: `Show ${n(Math.min(PAGE, page.total - shown.length))} more`, onclick: () => loadPeople(true) }),
            ' The spreadsheet has them all.',
          ),
        ),
      );
    }
    if (!shown.length) body.push(h('tr', {}, h('td', { colspan: columns.length, class: 'muted', text: all ? 'Nobody matches.' : 'No members yet.' })));
    $('members').tBodies[0].replaceChildren(...body);
  }

  $('member-search').addEventListener('input', people);

  // "Look up a person" in the top bar: the People list narrows as he types,
  // and Enter opens the one person found (or shows the list when several are).
  $('lookup').addEventListener('input', () => {
    $('member-search').value = $('lookup').value;
    showTab('people');
    people();
  });
  $('lookup').addEventListener('keydown', async (ev) => {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    clearTimeout(pageTimer);
    await loadPeople(false);
    showTab('people');
    if (page.rows.length === 1) openPerson(page.rows[0]);
  });

  // The filters, one row each.
  function renderFilters() {
    $('filters').replaceChildren(
      ...filters.map((filter, i) => {
        const f = G.byKey.get(filter.field);
        if (!f) return h('div');
        const remove = h('button', {
          type: 'button',
          class: 'remove',
          'aria-label': `Remove ${f.label}`,
          text: '×',
          onclick: () => {
            filters.splice(i, 1);
            renderFilters();
            people();
          },
        });
        return h('div', { class: 'filter-row' }, h('span', { class: 'filter-label', text: f.label }), editor(f, filter), remove);
      }),
    );
    renderGroupsBar();
    drawFilterChoices();
  }

  function numberBox(filter, key, placeholder) {
    return h('input', {
      type: 'number',
      inputmode: 'decimal',
      class: 'num-box',
      placeholder,
      value: filter[key] ?? '',
      oninput: (ev) => {
        filter[key] = ev.target.value;
        people();
      },
    });
  }

  function toggles(values, chosen, words, onToggle) {
    return h(
      'div',
      { class: 'toggles' },
      values.map((v) =>
        h('button', {
          type: 'button',
          class: chosen.includes(v) ? 'toggle on' : 'toggle',
          'aria-pressed': chosen.includes(v) ? 'true' : 'false',
          text: words(v),
          onclick: (ev) => {
            onToggle(v);
            const on = chosen.includes(v);
            ev.target.classList.toggle('on', on);
            ev.target.setAttribute('aria-pressed', on ? 'true' : 'false');
            people();
          },
        }),
      ),
    );
  }

  /** A choice or "has" filter's buttons: its own, or what members have, most common first (worked out on the server). */
  const choicesOf = (f) => f.options || (snapshot && snapshot.people && snapshot.people.choices && snapshot.people.choices[f.key]) || [];

  function editor(f, filter) {
    switch (f.type) {
      case 'range':
        return h('div', { class: 'editor' }, numberBox(filter, 'min', 'from'), h('span', { class: 'muted', text: 'to' }), numberBox(filter, 'max', 'to'), h('span', { class: 'muted small', text: f.unit || '' }));
      case 'choice':
      case 'has': {
        filter.values = filter.values || [];
        const options = choicesOf(f);
        if (!options.length) return h('span', { class: 'muted small', text: 'Nobody has one yet.' });
        return toggles(options.slice(0, 60), filter.values, f.words || ((x) => x), (v) => {
          const at = filter.values.indexOf(v);
          if (at >= 0) filter.values.splice(at, 1);
          else filter.values.push(v);
        });
      }
      case 'text':
        return h('input', {
          type: 'text',
          class: 'text-box',
          value: filter.text || '',
          placeholder: f.key === 'cigars' ? 'Padrón 1964, OpusX…' : '',
          oninput: (ev) => {
            filter.text = ev.target.value;
            people();
          },
        });
      case 'yesno': {
        const chosen = filter.yes === true ? ['Yes'] : filter.yes === false ? ['No'] : [];
        return toggles(['Yes', 'No'], chosen, (x) => x, (v) => {
          const want = v === 'Yes';
          filter.yes = filter.yes === want ? null : want;
          chosen.splice(0, chosen.length, ...(filter.yes === true ? ['Yes'] : filter.yes === false ? ['No'] : []));
          renderFilters();
        });
      }
      case 'place': {
        const found = h('span', { class: 'muted small', text: filter.place ? `Found: ${filter.place.name}` : '' });
        const where = h('input', { type: 'text', class: 'text-box', placeholder: 'St. Petersburg, FL or a ZIP code', value: filter.query || '' });
        const look = async () => {
          filter.query = where.value.trim();
          if (!filter.query) return;
          found.textContent = 'Finding…';
          try {
            filter.place = await ask({ action: 'place', query: filter.query });
            found.textContent = `Found: ${filter.place.name}`;
          } catch (e) {
            filter.place = null;
            found.textContent = e.message;
          }
          people();
        };
        where.addEventListener('keydown', (ev) => ev.key === 'Enter' && (ev.preventDefault(), look()));
        where.addEventListener('change', look);
        if (filter.miles === undefined) filter.miles = 100;
        return h('div', { class: 'editor' }, numberBox(filter, 'miles', 'miles'), h('span', { class: 'muted', text: 'miles of' }), where, h('button', { type: 'button', class: 'ghost', text: 'Find', onclick: look }), found);
      }
      default:
        return h('span');
    }
  }

  // Adding a filter: every field, by section.
  // Every filter on view, by section (his words, 2026-10-30: "I just want a
  // million filter options to be able to check everything"): click one to
  // add it to the list's filters; one in use is marked. A box finds them by
  // name, and the whole panel folds away.
  function addFilter(key) {
    filters.push({ field: key });
    renderFilters();
    const rows = $('filters').querySelectorAll('.filter-row');
    const last = rows[rows.length - 1];
    const first = last && last.querySelector('input, button.toggle');
    if (first) first.focus();
    people();
  }

  function drawFilterChoices() {
    const q = $('filter-find').value.trim().toLowerCase();
    const used = new Set(filters.map((f) => f.field));
    const groups = [...new Set(G.FIELDS.map((f) => f.group))];
    let shown = 0;
    $('filter-groups').replaceChildren(
      ...groups
        .map((g) => {
          const fields = G.FIELDS.filter((f) => f.group === g && (!q || f.label.toLowerCase().includes(q) || g.toLowerCase().includes(q)));
          shown += fields.length;
          if (!fields.length) return null;
          return h(
            'div',
            { class: 'filter-group' },
            h('h5', { text: g }),
            h(
              'div',
              { class: 'toggles' },
              fields.map((f) =>
                h('button', {
                  type: 'button',
                  class: used.has(f.key) ? 'toggle on' : 'toggle',
                  'aria-pressed': used.has(f.key) ? 'true' : 'false',
                  text: f.label,
                  onclick: () => addFilter(f.key),
                }),
              ),
            ),
          );
        })
        .filter(Boolean),
    );
    $('filter-count').textContent = q
      ? `${n(shown)} of ${n(G.FIELDS.length)} filters`
      : `${n(G.FIELDS.length)} filters. Click any to narrow the list: the people below match every filter you add.`;
  }

  $('filter-find').addEventListener('input', drawFilterChoices);
  const FOLD = 'console.filters-folded';
  function foldFilters(folded) {
    $('filter-groups').hidden = folded;
    $('filter-find').hidden = folded;
    $('filter-fold').textContent = folded ? 'Show all the filters' : 'Hide the filters';
    remember(FOLD, folded ? '1' : '');
  }
  $('filter-fold').addEventListener('click', () => foldFilters(!$('filter-groups').hidden));
  foldFilters(recall(FOLD) === '1');
  drawFilterChoices();

  // Saved groups.
  function renderGroupsBar() {
    const groups = (snapshot && snapshot.mail && snapshot.mail.groups) || [];
    const bar = [];
    if (groups.length) {
      bar.push(h('span', { class: 'muted small', text: 'Saved groups:' }));
      for (const g of groups) {
        bar.push(
          h('button', {
            type: 'button',
            class: loadedGroup && loadedGroup.id === g.id ? 'toggle on' : 'toggle',
            text: g.name,
            onclick: () => {
              filters = JSON.parse(JSON.stringify(g.filters || []));
              loadedGroup = { id: g.id, name: g.name };
              renderFilters();
              people();
            },
          }),
        );
      }
    }
    const has = filters.length > 0;
    if (has) bar.push(h('button', { type: 'button', class: 'ghost', text: loadedGroup ? `Save changes to “${loadedGroup.name}”` : 'Save as a group', onclick: () => saveGroup(!!loadedGroup) }));
    if (has && loadedGroup) bar.push(h('button', { type: 'button', class: 'ghost', text: 'Save as a new group', onclick: () => saveGroup(false) }));
    if (loadedGroup) bar.push(h('button', { type: 'button', class: 'ghost', text: `Delete “${loadedGroup.name}”`, onclick: deleteGroup }));
    if (has) {
      bar.push(
        h('button', {
          type: 'button',
          class: 'link',
          text: 'Clear the filters',
          onclick: () => {
            filters = [];
            loadedGroup = null;
            renderFilters();
            people();
          },
        }),
      );
    }
    $('groups-bar').replaceChildren(...bar);
  }

  async function saveGroup(update) {
    const name = update ? loadedGroup.name : (window.prompt('Name this group', loadedGroup ? `${loadedGroup.name} (copy)` : '') || '').trim();
    if (!name) return;
    try {
      const saved = await ask({ action: 'save-group', id: update ? loadedGroup.id : null, name, filters });
      const groups = snapshot.mail.groups.filter((g) => g.id !== saved.id);
      groups.push({ id: saved.id, name, filters: JSON.parse(JSON.stringify(filters)) });
      groups.sort((a, b) => a.name.localeCompare(b.name));
      snapshot.mail.groups = groups;
      loadedGroup = { id: saved.id, name };
      renderGroupsBar();
    } catch (e) {
      window.alert(e.message);
    }
  }

  async function deleteGroup() {
    if (!window.confirm(`Delete the group “${loadedGroup.name}”? The people in it are not touched.`)) return;
    try {
      await ask({ action: 'delete-group', id: loadedGroup.id });
      snapshot.mail.groups = snapshot.mail.groups.filter((g) => g.id !== loadedGroup.id);
      loadedGroup = null;
      renderGroupsBar();
    } catch (e) {
      window.alert(e.message);
    }
  }

  // A spreadsheet of the people shown, with everything known of them.
  const SHEET = [
    { label: 'Name', get: (m) => m.name },
    { label: 'Username', get: (m) => (m.username ? `@${m.username}` : '') },
    { label: 'Email', get: (m) => m.email },
    { label: 'Phone', get: (m) => (m.phone ? formatPhone(m.phone) : '') },
    { label: 'Street', get: (m) => m.street },
    { label: 'Town', get: (m) => m.city },
    { label: 'State', get: (m) => m.state },
    { label: 'ZIP', get: (m) => m.zip },
    { label: 'Age', get: (m) => m.age },
    { label: 'Birthday', get: (m) => m.birthDate },
    { label: 'Joined', get: (m) => (m.joined || '').slice(0, 10) },
    { label: 'Last in the app', get: (m) => (m.lastSeen || '').slice(0, 10) },
    { label: 'News emails', get: (m) => (m.news ? 'yes' : 'no') },
    { label: 'Offers emails', get: (m) => (m.offers ? 'yes' : 'no') },
    { label: 'Market insights', get: (m) => (m.insights ? 'yes' : 'no') },
    ...G.FIELDS.filter((f) => !['age', 'place', 'state', 'city', 'zip', 'news', 'offers', 'insights', 'birthMonth', 'hasName', 'hasPhone', 'hasAddress', 'joinedDays', 'lastSeenDays'].includes(f.key)).map((f) => ({
      label: f.label,
      get: (m, c) => {
        const v = f.get(m, c);
        return typeof v === 'boolean' ? (v ? 'yes' : 'no') : Array.isArray(v) ? v.map(f.words || ((x) => x)) : v;
      },
    })),
  ];

  // Every page of the group, then the spreadsheet.
  $('download-group').addEventListener('click', async () => {
    const button = $('download-group');
    const words = button.textContent;
    button.disabled = true;
    try {
      const rows = [];
      for (;;) {
        button.textContent = `Reading ${n(rows.length)} of ${n(page.total)}…`;
        const got = await ask({ action: 'people', filters, search: search(), sort: sortBy, desc: sortDown, offset: rows.length, limit: 5000 });
        rows.push(...got.rows);
        if (got.rows.length === 0 || rows.length >= got.total) break;
      }
      const extra = placeFilter() ? [{ label: `Miles from ${placeFilter().place.name}`, get: (m) => (milesTo(m) == null ? '' : Math.round(milesTo(m))) }] : [];
      const blob = new Blob([G.csv(rows, [...SHEET, ...extra], ctx())], { type: 'text/csv;charset=utf-8' });
      const link = h('a', { href: URL.createObjectURL(blob), download: `cigar-locker-people-${today || 'today'}.csv` });
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    } catch (e) {
      window.alert(e.message);
    } finally {
      button.textContent = words;
      button.disabled = page.total === 0;
    }
  });

  // ---- emailing the group ---------------------------------------------------------

  function emailReady(mail) {
    const st = mail.settings || {};
    return [
      mail.keySet ? null : 'Connect the email service (Resend): its key goes in Supabase’s secrets as RESEND_API_KEY.',
      (st.postal_address || '').trim() ? null : 'Add your postal address below: the law wants it in every promotional email.',
      st.from_news && st.from_offers ? null : 'Add who the emails come from, below.',
    ].filter(Boolean);
  }

  function composeKind() {
    return document.querySelector('input[name="compose-kind"]:checked').value;
  }

  function updateCompose() {
    const kind = composeKind();
    const reach = page.reach[kind];
    const missing = emailReady(snapshot.mail);
    $('compose-who').textContent = `${$('group-words').textContent}: ${plural(page.total, 'person', 'people')}.`;
    $('compose-reach').textContent = `${plural(reach, 'of them said', 'of them said')} yes to ${kind === 'news' ? 'news from Cigar Locker' : 'offers from local shops'} and will get it.${
      page.total > reach ? ` The other ${n(page.total - reach)} said no, gave no address, or bounced.` : ''
    }`;
    $('compose-missing').replaceChildren(...missing.map((m) => h('li', { text: m })));
    $('compose-missing').hidden = missing.length === 0;
    $('compose-send').textContent = `Send to ${plural(reach, 'person', 'people')}`;
    $('compose-send').disabled = missing.length > 0 || reach === 0;
    $('compose-test').disabled = missing.length > 0;
  }

  $('email-group').addEventListener('click', () => {
    $('compose-error').textContent = '';
    $('compose-done').textContent = '';
    updateCompose();
    $('compose').showModal();
    $('compose-subject').focus();
  });
  for (const r of document.querySelectorAll('input[name="compose-kind"]')) r.addEventListener('change', updateCompose);
  $('compose-cancel').addEventListener('click', () => $('compose').close());

  function letter() {
    return {
      kind: composeKind(),
      subject: $('compose-subject').value.trim(),
      body: $('compose-body').value.trim(),
      tagLinks: $('compose-tag').checked,
      paidLinks: $('compose-paid').checked,
    };
  }

  $('compose-test').addEventListener('click', async () => {
    const l = letter();
    $('compose-error').textContent = '';
    if (!l.subject || !l.body) return ($('compose-error').textContent = 'Write a subject and a message first.');
    try {
      await ask({ action: 'email-test', ...l });
      $('compose-done').textContent = 'A test is on its way to your console email.';
    } catch (e) {
      $('compose-error').textContent = e.message;
    }
  });

  $('compose-send').addEventListener('click', async () => {
    const l = letter();
    $('compose-error').textContent = '';
    if (!l.subject || !l.body) return ($('compose-error').textContent = 'Write a subject and a message first.');
    const reach = page.reach[l.kind];
    if (!window.confirm(`Send “${l.subject}” to ${plural(reach, 'person', 'people')}? It cannot be called back.`)) return;
    try {
      // The server works the group out again from its filters and sends only if it is still these people.
      const out = await ask({ action: 'email-send', ...l, filters, search: search(), audience: $('group-words').textContent, expect: reach });
      $('compose').close();
      $('compose-subject').value = '';
      $('compose-body').value = '';
      $('mail-note').textContent = `Sending to ${plural(out.sending, 'person', 'people')}. The figures fill in below as the email service reports back.`;
      setTimeout(refresh, 8000);
    } catch (e) {
      $('compose-error').textContent = e.message;
    }
  });

  // A person's own page (his words, 2026-10-30: "I need to be able to click
  // on individual people's names. And see how many cigars they have, their
  // full history of where they bought them, where their humidors are, how
  // much they pay, how often they scan, how often they use the app"): over
  // the whole console, Back (or Esc) returns to the list where it was.
  const details = new Map();
  let personFor = null;
  let scrollBefore = 0;

  function openPerson(m) {
    personFor = m.id;
    scrollBefore = window.scrollY;
    const sheet = $('person');
    const inner = $('person-inner');
    inner.replaceChildren(personHead(m), h('p', { class: 'muted', text: 'Reading…' }));
    sheet.hidden = false;
    sheet.scrollTop = 0;
    document.body.classList.add('locked');
    $('person-back').focus();
    const known = details.get(m.id);
    const show = (d) => personFor === m.id && inner.replaceChildren(personHead(m), ...detail(m, d));
    if (known) show(known);
    else
      ask({ action: 'member', id: m.id })
        .then((d) => {
          details.set(m.id, d);
          show(d);
        })
        .catch((e) => personFor === m.id && inner.replaceChildren(personHead(m), h('p', { class: 'error', text: e.message })));
  }

  function closePerson() {
    personFor = null;
    $('person').hidden = true;
    document.body.classList.remove('locked');
    window.scrollTo(0, scrollBefore);
  }

  document.addEventListener('keydown', (ev) => ev.key === 'Escape' && personFor && closePerson());

  /** Back, the name, and who they are in a line. */
  function personHead(m) {
    const where = [m.city, [m.state, m.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    return h(
      'div',
      { class: 'person-head' },
      h('button', { type: 'button', class: 'ghost', id: 'person-back', text: '← Back to People', onclick: closePerson }),
      h('h2', { class: 'person-name', id: 'person-name', text: m.name || (m.username ? `@${m.username}` : m.email) }),
      h(
        'p',
        { class: 'person-sub' },
        [m.name && m.username ? `@${m.username}` : '', m.email, m.phone ? formatPhone(m.phone) : '', where].filter(Boolean).join(' · '),
      ),
      h(
        'p',
        { class: 'muted small' },
        [
          `Joined ${dayYearFmt.format(new Date(m.joined))}`,
          m.lastSeen || m.lastSignIn ? `last seen ${ago(m.lastSeen || m.lastSignIn)}` : '',
          m.profile ? '' : 'sign-up not finished',
        ]
          .filter(Boolean)
          .join(' · '),
      ),
    );
  }

  /** A figure in a tile, with a line under it. */
  function tile(label, value, note) {
    return h('div', { class: 'tile' }, h('div', { class: 'tile-label', text: label }), h('div', { class: 'tile-value', text: value }), note ? h('div', { class: 'tile-note', text: note }) : null);
  }

  function detail(m, d) {
    const about = h(
      'dl',
      { class: 'facts' },
      fact('Email', m.email + (m.relay ? ' (Apple relay: reaches them once the domain is registered with Apple)' : '')),
      fact('Cigar Locker Plus', plusWords(d.plus)),
      fact('Phone', m.phone ? formatPhone(m.phone) : 'Not given'),
      fact('Address', [m.street, m.city, [m.state, m.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ') || 'Not given'),
      fact('Born', m.birthDate ? `${longDay(m.birthDate)} (${m.age})` : 'Not given'),
      fact('Signs in with', m.provider === 'apple' ? 'Apple' : m.provider || 'Unknown'),
      fact('Joined', `${dayYearFmt.format(new Date(m.joined))}${m.lastSignIn ? ` · last signed in ${ago(m.lastSignIn)}` : ''}`),
      fact('Friends', `${plural(d.social.friends, 'friend')} · ${plural(d.social.posts, 'post')} · ${plural(d.social.messages, 'message')}${d.social.reported ? ` · reported ${n(d.social.reported)} times` : ''}`),
      fact('Says yes to', [m.news && 'News emails', m.offers && 'Offers from shops', m.insights && 'Market insights'].filter(Boolean).join(', ') || 'Nothing'),
    );
    const buys = table(
      ['Bought', 'Cigar', 'Shop', 'How many', 'Left', 'Paid', 'Each', 'Retail each', 'Why'],
      d.purchases.map((p) => [
        p.imported ? 'Imported' : p.boughtOn ? longDay(p.boughtOn) : '',
        p.cigar,
        [p.shop, p.city].filter(Boolean).join(', '),
        n(p.qty),
        n(p.left),
        p.cents != null ? money(p.cents) : '',
        p.cents != null && p.qty ? money(p.cents / p.qty) : '',
        p.retail != null ? money(p.retail * 100) : '',
        [p.how === 'shipped' ? 'Shipped' : p.how === 'in-person' ? 'In person' : '', p.reasons.split(',').filter(Boolean).map(reasonWords).join(', ')].filter(Boolean).join(' · '),
      ]),
      [3, 4, 5, 6, 7],
    );
    const rated = table(
      ['Rated', 'Cigar', 'Stars', 'Tasting notes'],
      d.ratings.map((r) => [r.imported ? 'Imported' : r.on ? longDay(r.on) : '', r.cigar, `${n(r.rating)} of 10`, r.notes || '']),
      [2],
    );
    const days = table(
      ['Day', 'Opens', 'Time', 'Scans', 'Look-ups', 'Suggestions'],
      d.days.map((x) => [longDay(x.day), n(x.opens), minutes(x.minutes), n(x.scans), n(x.lookups), n(x.suggestions)]),
      [1, 2, 3, 4, 5],
    );
    const outs = table(
      ['Day', 'What', 'Cigar', 'To'],
      d.outs.map((o) => [o.on ? longDay(o.on) : '', { gifted: 'Gave away', traded: 'Traded', lost: 'Lost', damaged: 'Damaged' }[o.kind] || o.kind, `${n(o.n)} ${o.cigar}`, o.to]),
      [],
    );
    const time = G.usualTime(m);
    const habits = h(
      'dl',
      { class: 'facts' },
      fact('Cigars enjoyed', m.enjoyedAll ? `${n(m.enjoyedAll)} in all · ${n(m.enjoyed30)} in the last 30 days · about ${m.perWeek} a week` : 'None logged yet'),
      m.enjoyedAll ? fact('On a day they enjoy one', `${m.perEnjoyDay} on average, ${n(m.mostInADay)} at most`) : null,
      m.enjoyedAll
        ? fact('When', `${time ? `Usually in the ${time.toLowerCase()}` : 'Not known'} (morning ${n(m.morning)}, afternoon ${n(m.afternoon)}, evening ${n(m.evening)}, night ${n(m.night)}; ${n(m.weekend)} on weekends)`)
        : null,
      m.lastEnjoyed ? fact('Last enjoyed', longDay(m.lastEnjoyed)) : null,
      fact('Ratings', m.rated ? `${m.avgRating} of 10 on average, ${plural(m.rated, 'cigar')} · ${n(m.loved)} rated 8 or more · favorite ${m.favorite}` : 'None yet'),
      fact('Wrappers', [m.shadeMost && `keeps ${m.shadeMost} most`, m.shadesLoved && m.shadesLoved.length && `loves ${m.shadesLoved.join(', ')}`].filter(Boolean).join('; ') || 'Not known'),
      fact('Strength', m.strengthMost ? `${G.strengthWords(m.strengthMost)} most` : 'Not known'),
    );
    const STATUS = { ok: 'In range', dry: 'Too dry', humid: 'Too humid', quiet: 'No reading for 90 min', '': '' };
    const pct = (v) => (v == null ? '' : `${Math.round(v)}%`);
    const sensors = table(
      ['Humidor', 'Sensor', 'Humidity', 'Last hour', 'Temp', 'Target', 'Status', 'Read'],
      (d.sensors || []).map((x) => [
        x.humidor || 'In no humidor',
        x.name,
        pct(x.humidity),
        pct(x.hourHumidity),
        x.temperatureF == null ? '' : `${Math.round(x.temperatureF)}°F`,
        x.min != null && x.max != null ? `${Math.round(x.min)}–${Math.round(x.max)}%` : '',
        STATUS[x.status] ?? '',
        x.read ? ago(x.read) : 'Never',
      ]),
      [2, 3, 4],
    );
    const mails = table(
      ['Sent', 'Email', 'Delivered', 'Opened', 'Tapped'],
      (d.emails || []).map((e) => [
        dayYearFmt.format(new Date(e.sent)),
        `${e.subject} (${e.kind})${e.unsubscribed ? ' · unsubscribed from it' : ''}${e.bounced ? ' · bounced' : ''}`,
        e.delivered ? 'Yes' : '',
        e.opened ? `${n(e.opens)} times` : '',
        e.clicked ? 'Yes' : '',
      ]),
      [],
    );
    const figures = h(
      'div',
      { class: 'tiles' },
      tile('Cigars now', n(m.cigarsNow), plural(m.kindsNow, 'kind')),
      tile('Worth', m.valueCents ? money(m.valueCents) : '—', 'paid, else retail'),
      tile('Humidors', n(m.humidors), m.sensors ? plural(m.sensors, 'sensor') : 'no sensors'),
      tile('Spent this year', money(m.spentYear), plural(m.boughtYear, 'cigar')),
      tile('Paid a cigar', m.avgPaidCents != null ? money(m.avgPaidCents) : '—', m.paidPct != null ? `${m.paidPct}% of retail` : 'retail not known'),
      tile('Scans, 30 days', n(m.scans30), `${n(m.scansToday)} today · ${n(m.scansAll)} in all`),
      tile('App opens, 30 days', n(m.opens30), `${n(m.opensToday)} today · ${n(m.opensAll)} in all`),
      tile('Time in the app, 30 days', minutes(m.minutes30), `${minutes(m.minutesAll)} in all`),
    );
    const pctRange = (x) => (x.low == null ? '' : x.low === x.high ? `${x.low}%` : `${x.low}–${x.high}%`);
    const humidors = table(
      ['Humidor', 'Where', 'Cigars', 'Kinds', 'Sensors', 'Humidity'],
      (d.humidors || []).map((x) => [
        x.name,
        x.location || 'Not said',
        n(x.cigars),
        n(x.kinds),
        x.sensors ? n(x.sensors) : '',
        [pctRange(x), x.off ? `${n(x.off)} off target` : '', x.read ? ago(x.read) : ''].filter(Boolean).join(' · '),
      ]),
      [2, 3, 4],
    );
    // Where they buy: each shop's purchases, cigars, spend and last day, most spent first.
    const byShop = new Map();
    for (const p of d.purchases) {
      const key = p.imported && !p.shop ? 'Imported, no shop given' : p.shop || 'No shop given';
      const s = byShop.get(key) || { name: key, city: [p.city, p.region].filter(Boolean).join(', '), lots: 0, cigars: 0, cents: 0, priced: false, last: null };
      s.lots += 1;
      s.cigars += p.qty || 0;
      if (p.cents != null) {
        s.cents += p.cents;
        s.priced = true;
      }
      if (!p.imported && p.boughtOn && (!s.last || p.boughtOn > s.last)) s.last = p.boughtOn;
      byShop.set(key, s);
    }
    const shops = table(
      ['Shop', 'Town', 'Purchases', 'Cigars', 'Spent', 'Last bought'],
      [...byShop.values()]
        .sort((a, b) => b.cents - a.cents || b.cigars - a.cigars)
        .map((s) => [s.name, s.city, n(s.lots), n(s.cigars), s.priced ? money(s.cents) : '', s.last ? longDay(s.last) : '']),
      [2, 3, 4],
    );
    const use = h(
      'dl',
      { class: 'facts' },
      fact('Scans', `${n(m.scansToday)} today · ${n(m.scans30)} in 30 days · ${n(m.scansAll)} in all`),
      fact('Look-ups and suggestions', `${n(m.lookups30)} look-ups · ${n(m.suggestions30)} suggestions, in 30 days`),
      fact('App opens', `${n(m.opensToday)} today · ${n(m.opens7)} this week · ${n(m.opens30)} in 30 days · ${n(m.opensAll)} in all`),
      fact('Time in the app', `${minutes(m.minutesToday)} today · ${minutes(m.minutes7)} this week · ${minutes(m.minutes30)} in 30 days · ${minutes(m.minutesAll)} in all`),
      fact('Days they opened it', `${plural(m.days30, 'day')} of the last 30 · ${plural(m.daysAll, 'day')} in all`),
      fact('First and last seen', [m.firstSeen ? `first ${dayYearFmt.format(new Date(m.firstSeen))}` : '', m.lastSeen ? `last ${ago(m.lastSeen)}` : ''].filter(Boolean).join(' · ') || 'Not seen yet'),
      fact('Runs on', [(m.platform || '').replace(/^ios/, 'iPhone').replace(/^android/, 'Android'), m.version && `version ${m.version}`].filter(Boolean).join(', ') + (d.installs > 1 ? ` · ${n(d.installs)} phones` : '') || 'Not seen yet'),
    );
    // Only what there is: an empty slot would show as words.
    return [
      figures,
      h(
        'div',
        { class: 'detail-grid' },
        h('div', {}, h('h4', { text: `Humidors (${n((d.humidors || []).length)})` }), humidors),
        h('div', {}, h('h4', { text: 'Where they buy' }), shops),
      ),
      h(
        'div',
        { class: 'detail-grid' },
        h('div', {}, h('h4', { text: 'Scans and time in the app' }), use, h('p', { class: 'muted small', text: 'Counted since Oct 29, 2026, when the console began.' })),
        h('div', {}, h('h4', { text: 'Habits' }), habits),
      ),
      h('h4', { text: `Every purchase (${n(d.purchases.length)}), newest first` }),
      buys,
      m.sensors || (d.sensors || []).length
        ? h('h4', { text: `Sensors (${n(Math.max(m.sensors || 0, (d.sensors || []).length))}), as their phone last sent them` })
        : null,
      m.sensors || (d.sensors || []).length ? sensors : null,
      h('div', { class: 'detail-grid' }, h('div', {}, h('h4', { text: d.installs > 1 ? `Days in the app (on ${n(d.installs)} phones)` : 'Days in the app' }), days), h('div', {}, h('h4', { text: 'About' }), about)),
      h('h4', { text: `Ratings (${n(d.ratings.length)})` }),
      rated,
      d.outs.length ? h('h4', { text: 'Given, traded, lost' }) : null,
      d.outs.length ? outs : null,
      h('h4', { text: 'Emails from you' }),
      mails,
    ].filter(Boolean);
  }

  // The stored names (src/data/reasons.ts) and the words the app shows.
  const REASONS = {
    planned: 'Planned', favorite: 'A favorite', new: 'Trying something new', sale: 'On sale', coupon: 'Coupon or deal',
    impulse: 'Spur of the moment', shop: 'Shop recommended', friend: 'Friend recommended',
    review: 'Read a review', limited: 'Limited release', occasion: 'Special occasion', 'to-give': 'To give as a gift', given: 'Given to me',
  };
  const reasonWords = (r) => REASONS[r] || r;

  function fact(label, value) {
    return [h('dt', { text: label }), h('dd', { text: value })];
  }

  /** A member's Plus in a line: paying, given, lapsed, or none. */
  function plusWords(x) {
    if (!x || !x.status) return 'No';
    const until = x.expiresAt ? dayYearFmt.format(new Date(x.expiresAt)) : null;
    if (x.provider === 'gift') return x.plus ? `Yes, given${until ? ` until ${until}` : ''}` : 'A gift that has ended';
    if (x.plus) return `Yes, paying${x.environment === 'Sandbox' ? ' (sandbox)' : ''}${x.autoRenew === false ? `, cancelled, ends ${until}` : until ? `, renews ${until}` : ''}`;
    return `No: ${x.status}${until ? ` ${until}` : ''}`;
  }

  function table(heads, rows, numeric) {
    if (!rows.length) return h('p', { class: 'muted small', text: 'None.' });
    return h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { class: 'plain' },
        h('thead', {}, h('tr', {}, heads.map((t, i) => h('th', { class: numeric.includes(i) ? 'num' : null, text: t })))),
        h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c, i) => h('td', { class: numeric.includes(i) ? 'num' : null, text: c }))))),
      ),
    );
  }

  // ---- the market, emails, health, the log ----------------------------------------

  function market(mk) {
    $('shops').replaceChildren(
      ...(mk.shops.length
        ? [
            h('thead', {}, h('tr', {}, h('th', { text: 'Shop' }), h('th', { class: 'num', text: 'Members' }), h('th', { class: 'num', text: 'Cigars' }), h('th', { class: 'num', text: 'Spent' }))),
            h('tbody', {}, mk.shops.map((x) => h('tr', {}, h('td', {}, x.name, h('div', { class: 'muted small', text: [x.city, x.region].filter(Boolean).join(', ') })), h('td', { class: 'num', text: n(x.members) }), h('td', { class: 'num', text: n(x.cigars) }), h('td', { class: 'num', text: x.cents ? money(x.cents) : '' })))),
          ]
        : [h('tbody', {}, h('tr', {}, h('td', { class: 'muted', text: 'No shops yet.' })))]),
    );
    $('brands').replaceChildren(
      h('thead', {}, h('tr', {}, h('th', { text: 'Brand' }), h('th', { class: 'num', text: 'Members' }), h('th', { class: 'num', text: 'Cigars' }))),
      h('tbody', {}, mk.brands.map((x) => h('tr', {}, h('td', { text: x.brand }), h('td', { class: 'num', text: n(x.members) }), h('td', { class: 'num', text: n(x.cigars) })))),
    );
    hbars($('reasons'), Object.entries(mk.reasons).map(([k, v]) => [reasonWords(k), v]), 'purchases');
    hbars($('how'), Object.entries(mk.how).map(([k, v]) => [{ 'in-person': 'In person', shipped: 'Shipped', unsaid: 'Not said' }[k] || k, v]), 'purchases');
    hbars($('states'), Object.entries(mk.states).map(([k, v]) => [k === 'unsaid' ? 'Not said' : k, v]), 'members');
  }

  /** Bars across, longest first, each with its figure at the tip. */
  function hbars(box, pairs, unit) {
    pairs.sort((a, b) => b[1] - a[1]);
    const most = Math.max(1, ...pairs.map((p) => p[1]));
    box.replaceChildren(
      ...(pairs.length
        ? pairs.map(([label, v]) =>
            h(
              'div',
              { class: 'hbar', title: `${label}: ${plural(v, unit.replace(/s$/, ''), unit)}` },
              h('span', { class: 'hbar-label', text: label }),
              h('span', { class: 'hbar-track' }, h('span', { class: 'hbar-fill', style: { width: `${Math.max(2, (v / most) * 100)}%` } })),
              h('span', { class: 'hbar-value', text: n(v) }),
            ),
          )
        : [h('p', { class: 'muted small', text: 'Nothing yet.' })]),
    );
  }

  // Emails: ready to send or not, the settings, and every email sent with what became of it.
  function mailBox(mail, t) {
    const st = mail.settings || {};
    const check = (ok, words) => h('li', { class: ok ? 'ok' : 'todo' }, h('span', { class: 'mark', text: ok ? '✓' : '•' }), words);
    $('mail-ready').replaceChildren(
      check(mail.keySet, mail.keySet ? 'Email service connected' : 'Email service (Resend): not connected yet'),
      check(mail.webhookSet, mail.webhookSet ? 'Opens and taps reported back' : 'Opens and taps: not reported back yet (Resend webhook)'),
      check(!!(st.postal_address || '').trim(), (st.postal_address || '').trim() ? `Postal address: ${st.postal_address}` : 'Postal address: not given yet'),
    );
    $('set-from-news').value = st.from_news || '';
    $('set-from-offers').value = st.from_offers || '';
    $('set-reply-to').value = st.reply_to || '';
    $('set-postal').value = st.postal_address || '';
    $('mail-audience').replaceChildren(
      ...fact('Say yes to news', plural(t.news, 'member')),
      ...fact('Say yes to offers', plural(t.offers, 'member')),
      ...fact('Say yes to market insights', plural(t.insights, 'member')),
      ...fact('Apple relay addresses', `${n(t.relay)} of ${n(t.accounts)}: they reach people once atlantisdev.ai is registered with Apple`),
      ...fact('Never written to again', `${plural(mail.blocked, 'address', 'addresses')} (bounced, or marked as spam)`),
    );
    const pct = (part, whole) => (whole ? ` (${Math.round((part / whole) * 100)}%)` : '');
    $('campaigns').replaceChildren(
      ...(mail.campaigns.length
        ? [
            h(
              'thead',
              {},
              h(
                'tr',
                {},
                ['Sent', 'Email', 'To', 'Delivered', 'Opened', 'Tapped', 'Unsubscribed', 'Bounced or spam'].map((x, i) => h('th', { class: i > 1 ? 'num' : null, text: x })),
              ),
            ),
            h(
              'tbody',
              {},
              mail.campaigns.map((c) =>
                h(
                  'tr',
                  { class: c.test ? 'test' : null },
                  h('td', { text: `${dayFmt.format(new Date(c.created))}, ${timeFmt.format(new Date(c.created))}` }),
                  h(
                    'td',
                    {},
                    h('strong', { text: c.subject }),
                    h('div', { class: 'muted small', text: `${c.test ? 'Test · ' : ''}${c.kind === 'news' ? 'News' : 'Offers'} · ${c.audience}` }),
                    c.status === 'sending' ? h('div', { class: 'warn small', text: `Sending: ${n(c.sent)} of ${n(c.recipients)} so far` }) : null,
                    c.failed ? h('div', { class: 'error small', text: `${n(c.failed)} did not go: ${c.error}` }) : null,
                    ...(c.links || []).map((l) => h('div', { class: 'muted small link-line', text: `${linkWords(l.link)}: ${plural(l.taps, 'tap')} by ${plural(l.people, 'person', 'people')}` })),
                  ),
                  h('td', { class: 'num', text: n(c.sent) }),
                  h('td', { class: 'num', text: n(c.delivered) + pct(c.delivered, c.sent) }),
                  h('td', { class: 'num', text: n(c.opened) + pct(c.opened, c.delivered || c.sent) }),
                  h('td', { class: 'num', text: n(c.clicked) + pct(c.clicked, c.delivered || c.sent) }),
                  h('td', { class: 'num', text: n(c.unsubscribed) }),
                  h('td', { class: 'num', text: n(c.bounced + c.complained) }),
                ),
              ),
            ),
          ]
        : [h('tbody', {}, h('tr', {}, h('td', { class: 'muted', text: 'No emails sent yet. Pick a group above, then "Email these people".' })))]),
    );
  }

  /** A link as a shop's address and page, without the tags added for its statistics. */
  function linkWords(link) {
    try {
      const u = new URL(link);
      for (const k of [...u.searchParams.keys()]) if (k.toLowerCase().startsWith('utm_')) u.searchParams.delete(k);
      const rest = `${u.pathname === '/' ? '' : u.pathname}${u.search}`;
      return `${u.hostname.replace(/^www\./, '')}${rest}`.slice(0, 80);
    } catch {
      return link.slice(0, 80);
    }
  }

  $('mail-settings').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    $('settings-note').textContent = '';
    try {
      await ask({
        action: 'email-settings',
        fromNews: $('set-from-news').value,
        fromOffers: $('set-from-offers').value,
        replyTo: $('set-reply-to').value,
        postalAddress: $('set-postal').value,
      });
      $('settings-note').textContent = 'Saved.';
      refresh();
    } catch (e) {
      $('settings-note').textContent = e.message;
    }
  });

  function health(x, t) {
    $('health').replaceChildren(
      ...fact('Look-ups that failed, 7 days', n(x.failedLookups7)),
      ...fact('Scans that never finished, last day', `${n(x.unfinishedScans)} of ${n(x.scansKept)}`),
      ...fact('Average visit, 7 days', minutes(t.avgVisitSeconds7 / 60)),
    );
    $('versions').replaceChildren(
      ...(x.versions.length
        ? [
            h('thead', {}, h('tr', {}, h('th', { text: 'Phone' }), h('th', { text: 'Version' }), h('th', { class: 'num', text: 'Installs' }), h('th', { text: 'Last seen' }))),
            h('tbody', {}, x.versions.map((v) => h('tr', {}, h('td', { text: v.platform || 'Unknown' }), h('td', { text: v.version || '' }), h('td', { class: 'num', text: n(v.installs) }), h('td', { text: ago(v.lastSeen) })))),
          ]
        : [h('tbody', {}, h('tr', {}, h('td', { class: 'muted', text: 'No visits recorded yet: they start with the next app update.' })))]),
    );
  }

  const OUTCOMES = {
    ok: 'Opened',
    'no code': 'Refused: no authenticator code',
    'not an admin': 'Refused: not the console account',
    ended: 'Refused: sign-in ended or forged',
    'no sign-in': 'Refused: not signed in',
    'unknown request': 'Refused: not a question the console asks',
    'read failed': 'Signed in, but the figures could not be read',
    'auth down': 'Could not check the sign-in',
    'admins unread': 'Could not check the sign-in',
  };

  function log(rows) {
    $('log').replaceChildren(
      h('thead', {}, h('tr', {}, h('th', { text: 'When' }), h('th', { text: 'What' }), h('th', { text: 'From' }))),
      h(
        'tbody',
        {},
        rows.map((r) =>
          h(
            'tr',
            { class: r.outcome === 'ok' ? null : 'refused' },
            h('td', { text: `${dayFmt.format(new Date(r.at))}, ${timeFmt.format(new Date(r.at))}` }),
            h('td', {}, OUTCOMES[r.outcome] || r.outcome, r.email ? h('div', { class: 'muted small', text: r.email }) : null),
            h('td', {}, r.ip, h('div', { class: 'muted small', text: browserOf(r.agent) })),
          ),
        ),
      ),
    );
  }

  function browserOf(agent) {
    if (!agent) return '';
    const browser = /Edg\//.test(agent) ? 'Edge' : /Chrome\//.test(agent) ? 'Chrome' : /Firefox\//.test(agent) ? 'Firefox' : /Safari\//.test(agent) ? 'Safari' : /curl/i.test(agent) ? 'a script' : 'another browser';
    const system = /Mac OS X/.test(agent) ? 'Mac' : /Windows/.test(agent) ? 'Windows' : /iPhone|iPad/.test(agent) ? 'iPhone' : /Android/.test(agent) ? 'Android' : /Linux/.test(agent) ? 'Linux' : '';
    return system ? `${browser} on ${system}` : browser;
  }

  // ---- featured shops ---------------------------------------------------------------
  // His words, 2026-10-30: "featured shops that will always come up on top of
  // the search in there area" (071_featured_places.sql). A shop chosen from
  // Places, its days and its area; the switch hides them all while Apple
  // reviews the app.

  const STATUS_WORDS = { showing: 'Showing', waiting: 'Starts later', over: 'Ended' };
  const KIND_WORDS = { shop: 'Shop', lounge: 'Lounge', both: 'Shop and lounge' };
  let chosenPlace = null;

  const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const dayWords = (iso) => {
    const [y, m, d] = String(iso).split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  const placeWhere = (p) => [p.city, p.state].filter(Boolean).join(', ');

  function drawFeatured(out) {
    $('featured-on').checked = !!out.on;
    $('featured-today').textContent = out.on ? 'Showing in the app' : 'Hidden in the app';
    const table = $('features');
    table.replaceChildren();
    if (!out.features || out.features.length === 0) {
      table.append(h('tbody', null, h('tr', null, h('td', { class: 'muted' }, 'No shop featured yet. Find one on the right.'))));
      return;
    }
    table.append(
      h('thead', null, h('tr', null, h('th', null, 'Shop'), h('th', null, 'Days'), h('th', null, 'Area'), h('th', null, ''), h('th', null, ''))),
      h(
        'tbody',
        null,
        out.features.map((f) =>
          h(
            'tr',
            { class: f.status === 'over' ? 'muted' : null },
            h('td', null, h('strong', null, f.name), h('br'), h('span', { class: 'muted small' }, `${KIND_WORDS[f.kind] || ''} · ${placeWhere(f)}`), f.note ? h('div', { class: 'muted small' }, f.note) : null),
            h('td', null, `${dayWords(f.startsOn)} – ${dayWords(f.endsOn)}`),
            h('td', null, `${f.miles} mi`),
            h('td', null, h('span', { class: `pill ${f.status === 'showing' ? 'good' : ''}` }, STATUS_WORDS[f.status] || f.status)),
            h(
              'td',
              null,
              h('button', {
                type: 'button',
                class: 'ghost small',
                text: 'Remove',
                onclick: async () => {
                  if (!confirm(`Stop featuring ${f.name} (${dayWords(f.startsOn)} – ${dayWords(f.endsOn)})?`)) return;
                  try {
                    drawFeatured(await ask({ action: 'feature-remove', id: f.id }));
                  } catch (e) {
                    $('feature-result').textContent = e.message;
                  }
                },
              }),
            ),
          ),
        ),
      ),
    );
  }

  async function loadFeatured() {
    try {
      drawFeatured(await ask({ action: 'featured' }));
    } catch (e) {
      $('feature-result').textContent = e.message;
    }
  }

  $('featured-on').addEventListener('change', async (ev) => {
    const on = ev.target.checked;
    try {
      drawFeatured(await ask({ action: 'featured-switch', on }));
    } catch (e) {
      ev.target.checked = !on;
      $('feature-result').textContent = e.message;
    }
  });

  function choose(p) {
    chosenPlace = p;
    $('feature-chosen').textContent = p ? `Chosen: ${p.name}, ${[p.street, placeWhere(p)].filter(Boolean).join(', ')}` : 'No shop chosen yet.';
    $('feature-found').replaceChildren();
  }

  let findTimer = null;
  $('feature-find').addEventListener('input', (ev) => {
    clearTimeout(findTimer);
    const query = ev.target.value.trim();
    if (query.length < 2) {
      $('feature-found').replaceChildren();
      return;
    }
    findTimer = setTimeout(async () => {
      try {
        const out = await ask({ action: 'featured-find', query });
        $('feature-found').replaceChildren(
          ...(out.places.length
            ? out.places.map((p) =>
                h('button', { type: 'button', class: 'ghost small', onclick: () => choose(p) }, `${p.name} · ${placeWhere(p)}`),
              )
            : [h('span', { class: 'muted small' }, 'No place by that name or town. Places are added by their town’s search.')]),
        );
      } catch (e) {
        $('feature-result').textContent = e.message;
      }
    }, 300);
  });

  {
    const today = new Date();
    $('feature-starts').value = isoDay(today);
    $('feature-ends').value = isoDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 30));
  }

  $('feature-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const result = $('feature-result');
    if (!chosenPlace) {
      result.textContent = 'Find and choose the shop first.';
      return;
    }
    const startsOn = $('feature-starts').value;
    const endsOn = $('feature-ends').value;
    if (!startsOn || !endsOn || endsOn < startsOn) {
      result.textContent = 'The last day comes on or after the first.';
      return;
    }
    try {
      const out = await ask({
        action: 'feature-add',
        place: chosenPlace.id,
        startsOn,
        endsOn,
        miles: Math.round(Number($('feature-miles').value) || 30),
        note: $('feature-note').value.trim(),
      });
      drawFeatured(out);
      result.textContent = `${chosenPlace.name} is featured from ${dayWords(startsOn)} to ${dayWords(endsOn)}.`;
      choose(null);
      $('feature-find').value = '';
      $('feature-note').value = '';
    } catch (e) {
      result.textContent = e.message;
    }
  });

  // ---- starting -------------------------------------------------------------------

  async function start() {
    // Arriving from the email's link: the sign-in is in the address; take it out.
    const fromLink = /access_token=|error_description=/.test(location.hash);
    const params = new URLSearchParams(location.hash.slice(1));
    if (fromLink) history.replaceState(null, '', location.pathname);
    const { data } = await client.auth.getSession();
    if (data.session) return afterSignIn();
    askEmail();
    if (params.get('error_description')) failed(new Error(`${params.get('error_description')}. Ask for a new link.`));
  }

  client.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT' && !$('board').hidden) askEmail();
  });

  start();
})();
