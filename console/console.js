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
    $('secret').textContent = made.totp.secret;
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
    await refresh();
    clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, REFRESH_MINUTES * 60000);
  }

  async function refresh() {
    $('board').classList.add('loading');
    try {
      snapshot = await ask({ action: 'snapshot' });
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

  $('refresh').addEventListener('click', refresh);

  // ---- the board ----------------------------------------------------------------

  let people = new Map();

  function who(id, install) {
    if (!id) return install ? `Someone not signed in (install ${install})` : 'Someone not signed in';
    const m = people.get(id);
    if (!m) return 'A member';
    return m.name || (m.username ? `@${m.username}` : '') || m.displayName || m.email || 'A member';
  }

  function render(d) {
    today = d.today;
    people = new Map(d.members.map((m) => [m.id, m]));
    $('updated').textContent = `Updated ${timeFmt.format(new Date(d.at))}`;
    tiles(d.totals);
    barChart($('chart-active'), d.daily, 'active', (v) => plural(v, 'person', 'people'));
    barChart($('chart-scans'), d.daily, 'scans', (v) => plural(v, 'scan'));
    feed(d.feed);
    members(d.members);
    market(d.market);
    emails(d.totals);
    health(d.health, d.totals);
    log(d.log);
  }

  function tile(label, value, note) {
    return h('div', { class: 'tile' }, h('div', { class: 'tile-label', text: label }), h('div', { class: 'tile-value', text: value }), note ? h('div', { class: 'tile-note', text: note }) : null);
  }

  function tiles(t) {
    $('tiles').replaceChildren(
      tile('Members', n(t.accounts), `${n(t.joined7)} new this week · ${n(t.finished)} finished sign-up`),
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
    { key: 'shop', label: 'Buys most at', sort: (m) => m.topShop.toLowerCase() },
    { key: 'mail', label: 'Emails', sort: (m) => (m.news ? 2 : 0) + (m.offers ? 1 : 0) },
  ];

  let sortBy = 'joined';
  let sortDown = true;
  let open = null;

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

  const formatPhone = (p) => {
    const d = p.replace(/\D/g, '').slice(-10);
    return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p;
  };

  function members(list) {
    const q = $('member-search').value.trim().toLowerCase();
    const shown = list.filter((m) =>
      !q || [m.name, m.username, m.displayName, m.email, m.phone, m.city, m.state, m.zip, m.street].join(' ').toLowerCase().includes(q),
    );
    const col = COLUMNS.find((c) => c.key === sortBy) || COLUMNS[4];
    shown.sort((a, b) => {
      const x = col.sort(a);
      const y = col.sort(b);
      const order = x < y ? -1 : x > y ? 1 : 0;
      return sortDown ? -order : order;
    });
    $('member-count').textContent = q ? `${n(shown.length)} of ${plural(list.length, 'member')}` : plural(list.length, 'member');
    $('members').tHead.replaceChildren(
      h(
        'tr',
        {},
        COLUMNS.map((c) =>
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
                members(list);
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
            class: open === m.id ? 'member open' : 'member',
            tabindex: 0,
            'aria-expanded': open === m.id ? 'true' : 'false',
            onclick: () => toggle(m.id, list),
            onkeydown: (ev) => (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), toggle(m.id, list)),
          },
          COLUMNS.map((col) => h('td', { class: col.num ? 'num' : null }, c[col.key])),
        ),
      );
      if (open === m.id) body.push(h('tr', { class: 'detail-row' }, h('td', { colspan: COLUMNS.length }, detailBox(m))));
    }
    if (!shown.length) body.push(h('tr', {}, h('td', { colspan: COLUMNS.length, class: 'muted', text: q ? 'No member matches.' : 'No members yet.' })));
    $('members').tBodies[0].replaceChildren(...body);
  }

  $('member-search').addEventListener('input', () => snapshot && members(snapshot.members));

  function toggle(id, list) {
    open = open === id ? null : id;
    members(list);
  }

  const details = new Map();

  function detailBox(m) {
    const box = h('div', { class: 'detail' }, h('p', { class: 'muted', text: 'Reading…' }));
    const known = details.get(m.id);
    if (known) box.replaceChildren(...detail(m, known));
    else
      ask({ action: 'member', id: m.id })
        .then((d) => {
          details.set(m.id, d);
          box.replaceChildren(...detail(m, d));
        })
        .catch((e) => box.replaceChildren(h('p', { class: 'error', text: e.message })));
    return box;
  }

  function detail(m, d) {
    const about = h(
      'dl',
      { class: 'facts' },
      fact('Email', m.email + (m.relay ? ' (Apple relay: reaches them once the domain is registered with Apple)' : '')),
      fact('Phone', m.phone ? formatPhone(m.phone) : 'Not given'),
      fact('Address', [m.street, m.city, [m.state, m.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ') || 'Not given'),
      fact('Born', m.birthDate ? `${longDay(m.birthDate)} (${m.age})` : 'Not given'),
      fact('Signs in with', m.provider === 'apple' ? 'Apple' : m.provider || 'Unknown'),
      fact('Joined', `${dayYearFmt.format(new Date(m.joined))}${m.lastSignIn ? ` · last signed in ${ago(m.lastSignIn)}` : ''}`),
      fact('Phone it runs on', [m.platform, m.version].filter(Boolean).join(', ') || 'Not seen yet'),
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
    // Only what there is: an empty slot would show as words.
    return [
      h('div', { class: 'detail-grid' }, h('div', {}, h('h4', { text: 'About' }), about), h('div', {}, h('h4', { text: d.installs > 1 ? `Days in the app (on ${n(d.installs)} phones)` : 'Days in the app' }), days)),
      h('h4', { text: `Purchases (${n(d.purchases.length)})` }),
      buys,
      h('h4', { text: `Ratings (${n(d.ratings.length)})` }),
      rated,
      d.outs.length ? h('h4', { text: 'Given, traded, lost' }) : null,
      d.outs.length ? outs : null,
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

  function emails(t) {
    $('emails').replaceChildren(
      ...fact('News from Cigar Locker', `${plural(t.news, 'member')} say yes`),
      ...fact('Offers from local shops', `${plural(t.offers, 'member')} say yes`),
      ...fact('Market insights', `${plural(t.insights, 'member')} say yes`),
      ...fact('Apple relay addresses', `${n(t.relay)} of ${n(t.accounts)}: they reach people once atlantisdev.ai is registered with Apple`),
      ...fact('Sending', 'Not set up yet. Promotions, and whether each is opened, start once the email service (Resend) is connected.'),
    );
  }

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
