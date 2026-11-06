/*
 * Cigar Locker Retail (docs/retail.md): the web app for cigar shops.
 * Tablet first. Reads go through row-level security (only the store's
 * team), every change through the Retail functions, which check the role;
 * scans and spreadsheet matching through the `retail` server function.
 * Never a consumer's data.
 */
(function () {
  'use strict';

  var C = self.RETAIL_CONFIG;
  var R = self.RetailReconcile;
  var S = self.RetailSheet;
  var P = self.RetailPhotos;
  var Codes = self.RetailCodes;
  var Pr = self.RetailPrinters;
  var O = self.RetailOutbox;
  var Hid = self.RetailHid;
  var Reg = self.RetailRegister;
  var Pick = self.RetailPick;
  // This device's own id, sent with every request so each event says which
  // tablet or phone made it (never used for permission).
  var DEVICE = (function () {
    try {
      var v = localStorage.getItem('cl-retail-device');
      if (!v) {
        v = 'd-' + O.uuid().replace(/-/g, '').slice(0, 12);
        localStorage.setItem('cl-retail-device', v);
      }
      return v;
    } catch (e) {
      return 'd-private';
    }
  })();
  var sb = self.supabase.createClient(C.url, C.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'cl-retail-auth' },
    global: { headers: { 'x-cl-device': DEVICE } },
  });
  var outbox = O.create(self.localStorage || { getItem: function () { return null; }, setItem: function () {} }, 'cl-retail-outbox');

  var main = document.getElementById('main');
  var state = { user: null, stores: null, store: null, role: null, timers: [], cache: {} };
  var RANK = { employee: 1, manager: 2, owner: 3 };
  var TYPES = ['room', 'walk_in', 'humidor', 'wall', 'cabinet', 'shelf', 'drawer', 'display', 'back_stock', 'lounge', 'other'];
  var TYPE_WORDS = { room: 'Room', walk_in: 'Walk-in humidor', humidor: 'Humidor', wall: 'Wall', cabinet: 'Cabinet', shelf: 'Shelf', drawer: 'Drawer', display: 'Display',
                     back_stock: 'Back stock', lounge: 'Lounge', other: 'Other' };

  // ---- building blocks ------------------------------------------------------

  function h(tag, props) {
    var el = document.createElement(tag);
    var p = props || {};
    Object.keys(p).forEach(function (k) {
      var v = p[k];
      if (v === undefined || v === null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style') Object.assign(el.style, v);
      else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), v);
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, kid) {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) kid.forEach(function (k) {
      add(el, k);
    });
    else el.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(String(kid)) : kid);
  }
  /** An element's contents replaced with these, nested lists flattened, nothing drawn for null. */
  function fill(el, kids) {
    el.replaceChildren();
    add(el, kids);
  }
  function show() {
    fill(main, Array.prototype.slice.call(arguments));
    main.focus({ preventScroll: true });
  }
  function n(x) {
    return Number(x || 0).toLocaleString('en-US');
  }
  function money(cents, exact) {
    if (cents === null || cents === undefined) return '—';
    var d = Number(cents) / 100;
    return '$' + d.toLocaleString('en-US', { minimumFractionDigits: exact ? 2 : 0, maximumFractionDigits: exact ? 2 : 0 });
  }
  function clock(seconds) {
    var s = Math.max(0, Math.floor(seconds));
    var hh = Math.floor(s / 3600);
    var mm = Math.floor((s % 3600) / 60);
    var ss = s % 60;
    return (hh ? hh + ':' + String(mm).padStart(2, '0') : String(mm)) + ':' + String(ss).padStart(2, '0');
  }
  function day(iso) {
    return iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  }
  function monthYear(iso) {
    return iso ? new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '';
  }
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () {
      t.hidden = true;
    }, 3600);
  }
  function errorText(e) {
    var m = (e && e.message) || String(e);
    if (/JWT|jwt expired|not authenticated/i.test(m)) return 'Sign in again.';
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'No connection. Try again when you are back online.';
    return m.replace(/^.*?ERROR:\s*/, '');
  }
  function busy(label) {
    return h('div', { class: 'reading' }, h('span', { class: 'dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), label || 'Loading');
  }
  function go(path) {
    if (location.hash === '#' + path) route();
    else location.hash = path;
  }
  function can(least) {
    return RANK[state.role] >= RANK[least];
  }
  function every(ms, f) {
    state.timers.push(setInterval(f, ms));
  }
  function stepper(value, onChange) {
    var input = h('input', { type: 'number', inputmode: 'numeric', min: '0', value: value === null || value === undefined ? '' : String(value), 'aria-label': 'Count' });
    function set(v) {
      var x = Math.max(0, Math.round(Number(v) || 0));
      input.value = String(x);
      onChange(x);
    }
    input.addEventListener('change', function () {
      if (input.value.trim() === '') return onChange(null);
      set(input.value);
    });
    return h(
      'span',
      { class: 'stepper' },
      h('button', { type: 'button', 'aria-label': 'One fewer', onclick: function () { set((Number(input.value) || 0) - 1); } }, '−'),
      input,
      h('button', { type: 'button', 'aria-label': 'One more', onclick: function () { set((Number(input.value) || 0) + 1); } }, '+'),
    );
  }
  function sheet(title, body, onClose) {
    var veil = h('div', { class: 'veil', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
    function close() {
      veil.remove();
      if (onClose) onClose();
    }
    veil.addEventListener('click', function (ev) {
      if (ev.target === veil) close();
    });
    var box = h('div', { class: 'sheet' }, h('div', { class: 'sheet-head' }, h('h2', { text: title }), h('button', { class: 'btn quiet small', type: 'button', onclick: close }, 'Close')), body);
    veil.appendChild(box);
    document.body.appendChild(veil);
    var first = box.querySelector('input, select, textarea');
    if (first) setTimeout(function () { first.focus(); }, 50);
    return close;
  }
  function field(label, input) {
    return h('label', { class: 'field' }, h('span', { text: label }), input);
  }
  function chip(text, kind) {
    return h('span', { class: 'chip ' + (kind || '') }, text);
  }

  // ---- talking to the server ----------------------------------------------------

  async function rpc(name, args) {
    var r = await sb.rpc(name, args || {});
    if (r.error) throw new Error(errorText(r.error));
    return r.data;
  }
  /**
   * A change that is one operation (an id made here): sent now, or, without
   * a connection, kept on this device and sent when it is back (the server
   * does each id once). Answers the server's answer, or {queued: true}.
   */
  async function rpcOp(name, args, label) {
    var a = Object.assign({}, args, { p_op: O.uuid() });
    try {
      return await rpc(name, a);
    } catch (e) {
      if (!O.isNetworkError(e, navigator.onLine)) throw e;
      outbox.add({ op: a.p_op, fn: name, args: a, label: label || name, store: state.store ? state.store.id : null, at: Date.now() });
      drawNet();
      return { queued: true };
    }
  }
  /** A change that needs its answer now, tried once more on a dropped connection with the same id. */
  async function rpcOnce(name, args) {
    var a = Object.assign({}, args, { p_op: O.uuid() });
    try {
      return await rpc(name, a);
    } catch (e) {
      if (!O.isNetworkError(e, navigator.onLine)) throw e;
      await new Promise(function (r) { setTimeout(r, 1500); });
      return await rpc(name, a);
    }
  }
  var flushing = false;
  async function flushOutbox() {
    if (flushing || !outbox.list().length || !navigator.onLine) return drawNet();
    flushing = true;
    drawNet();
    try {
      var r = await outbox.flush(function (it) { return rpc(it.fn, it.args); }, function () { return navigator.onLine; });
      if (r.sent) { forget(); toast(r.sent + (r.sent === 1 ? ' change' : ' changes') + ' made offline went through.'); }
      if (r.failed) toast(r.failed + (r.failed === 1 ? ' change' : ' changes') + ' made offline could not be done. See the bar.');
    } finally {
      flushing = false;
      drawNet();
    }
  }
  /** The bar's word on the connection: offline, waiting, or what could not be done. */
  function drawNet() {
    var pill = document.getElementById('bar-net');
    if (!pill) {
      var bar = document.getElementById('bar');
      if (!bar) return;
      pill = h('button', { id: 'bar-net', class: 'bar-net', type: 'button', hidden: true });
      bar.insertBefore(pill, document.getElementById('bar-me'));
    }
    var waiting = outbox.list().length;
    var failed = outbox.failed().length;
    var off = !navigator.onLine;
    pill.hidden = !off && !waiting && !failed;
    pill.className = 'bar-net' + (failed ? ' bad' : off ? ' warn' : '');
    pill.textContent = failed ? failed + ' not done' : off ? 'Offline' + (waiting ? ' · ' + waiting + ' waiting' : '') : flushing ? 'Sending ' + waiting + '…' : waiting + ' waiting';
    pill.onclick = function () {
      sheet('Changes made offline', h('div', {},
        h('p', {}, off ? 'This device has no connection. Scans and baskets are kept here and sent, in order, when it is back.' : 'Kept on this device until they go through.'),
        waiting ? h('div', { class: 'list' }, outbox.list().map(function (it) {
          return h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'name', text: it.label }), h('div', { class: 'sub', text: new Date(it.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) })), chip('Waiting'));
        })) : null,
        failed ? h('h2', { text: 'Could not be done' }) : null,
        failed ? h('div', { class: 'list' }, outbox.failed().map(function (it) {
          return h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'name', text: it.label }), h('div', { class: 'sub warn-text', text: it.words })));
        })) : null,
        h('div', { class: 'btns' },
          waiting && !off ? h('button', { class: 'btn primary', type: 'button', onclick: function () { flushOutbox(); } }, 'Send now') : null,
          failed ? h('button', { class: 'btn', type: 'button', onclick: function () { outbox.clearFailed(); drawNet(); toast('Cleared.'); } }, 'Seen: clear them') : null)));
    };
  }
  window.addEventListener('online', function () { flushOutbox(); });
  window.addEventListener('offline', drawNet);
  setInterval(flushOutbox, 20000);

  async function rows(table, cols, filter) {
    var out = [];
    for (var from = 0; from < 100000; from += 1000) {
      var q = sb.from(table).select(cols).range(from, from + 999);
      q = filter(q);
      var r = await q;
      if (r.error) throw new Error(errorText(r.error));
      out = out.concat(r.data || []);
      if (!r.data || r.data.length < 1000) break;
    }
    return out;
  }
  async function retailFn(body) {
    var s = (await sb.auth.getSession()).data.session;
    var res = await fetch(C.url + '/functions/v1/retail', {
      method: 'POST',
      headers: { apikey: C.key, Authorization: 'Bearer ' + (s ? s.access_token : C.key), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    var data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) {
      var err = new Error(data.error || 'That did not go through. Try again.');
      err.status = res.status;
      err.code = data.code;
      throw err;
    }
    return data;
  }

  // The store's map and products, read once a screen and kept for it.
  async function storeData(force) {
    var id = state.store.id;
    if (!force && state.cache.store === id && Date.now() - state.cache.at < 15000) return state.cache;
    var res = await Promise.all([
      rows('store_locations', 'id,parent_location_id,name,type,sort_order,active', function (q) {
        return q.eq('store_id', id).order('sort_order').order('name');
      }),
      rows('store_products', '*', function (q) {
        return q.eq('store_id', id).order('brand').order('line').order('vitola');
      }),
      rows('store_inventory', 'product_id,location_id,quantity', function (q) {
        return q.eq('store_id', id);
      }),
      rows('store_stock', 'product_id,location_id,kings,queens,king_units,queen_units,loose_units,units', function (q) {
        return q.eq('store_id', id);
      }),
      rows('box_instances', 'id,cl_code,state,store_product_id,location_id,original_quantity,remaining_quantity,opened_at,received_at', function (q) {
        return q.eq('store_id', id).in('state', ['sealed', 'open', 'missing', 'damaged']);
      }),
    ]);
    var locations = res[0].filter(function (l) {
      return l.active;
    });
    var byId = {};
    locations.forEach(function (l) {
      byId[l.id] = l;
    });
    var products = {};
    res[1].forEach(function (p) {
      products[p.id] = p;
    });
    // inventory: the unboxed layer (loose cigars and those not labeled yet);
    // stock: everything on hand, boxes and loose; boxes: the store's boxes.
    state.cache = { store: id, at: Date.now(), locations: locations, loc: byId, products: products, inventory: res[2], stock: res[3], boxes: res[4] };
    return state.cache;
  }
  function forget() {
    state.cache = {};
  }
  function productName(p) {
    if (!p) return 'Product';
    return [p.brand, p.line, p.vitola].filter(Boolean).join(' ') || 'Unnamed product';
  }
  function productDetail(p) {
    var size = p.size_text || (p.length_in && p.ring ? p.length_in + ' x ' + p.ring : '');
    return [size, p.box_count ? 'box of ' + p.box_count : '', p.sku ? 'SKU ' + p.sku : ''].filter(Boolean).join(' · ');
  }
  function pathOf(d, id) {
    var names = [];
    var cur = d.loc[id];
    var guard = 0;
    while (cur && guard++ < 20) {
      names.unshift(cur.name);
      cur = d.loc[cur.parent_location_id];
    }
    return names.join(' › ');
  }
  function childrenOf(d, parent) {
    return d.locations
      .filter(function (l) {
        return (l.parent_location_id || null) === (parent || null);
      })
      .sort(function (a, b) {
        return a.sort_order - b.sort_order || a.name.localeCompare(b.name, undefined, { numeric: true });
      });
  }
  /** Every place, depth first, with its depth. */
  function walk(d) {
    var out = [];
    (function visit(parent, depth) {
      childrenOf(d, parent).forEach(function (l) {
        out.push({ loc: l, depth: depth });
        visit(l.id, depth + 1);
      });
    })(null, 0);
    return out;
  }
  function unitsAt(d, locId) {
    return d.stock.reduce(function (s, i) {
      return s + (i.location_id === locId ? i.units : 0);
    }, 0);
  }

  // ---- chrome ---------------------------------------------------------------------

  var TABS = [
    { key: 'home', label: 'Dashboard', least: 'employee', path: '' },
    { key: 'first', label: 'First inventory', least: 'employee', path: '/first' },
    { key: 'out', label: 'Cigars out', least: 'employee', path: '/out' },
    { key: 'register', label: 'Register', least: 'employee', path: '/register' },
    { key: 'insights', label: 'Insights', least: 'manager', path: '/insights' },
    { key: 'count', label: 'Count', least: 'employee', path: '/count' },
    { key: 'scan', label: 'Scan', least: 'employee', path: '/scan' },
    { key: 'inventory', label: 'Inventory', least: 'employee', path: '/inventory' },
    { key: 'receive', label: 'Receive', least: 'employee', path: '/receive' },
    { key: 'label', label: 'Label boxes', least: 'employee', path: '/label' },
    { key: 'locations', label: 'Locations', least: 'manager', path: '/locations' },
    { key: 'products', label: 'Products', least: 'manager', path: '/products' },
    { key: 'import', label: 'Import', least: 'manager', path: '/import' },
    { key: 'pilot', label: 'Pilot results', least: 'manager', path: '/pilot' },
    { key: 'team', label: 'Team', least: 'manager', path: '/team' },
  ];

  function chrome(on) {
    var bar = document.getElementById('bar');
    var tabs = document.getElementById('tabs');
    bar.hidden = false;
    document.getElementById('bar-store').textContent = state.store ? state.store.name : '';
    var me = document.getElementById('bar-me');
    me.textContent = (state.store && state.store.me) || (state.user && state.user.email) || 'Me';
    me.onclick = account;
    if (!state.store) {
      tabs.hidden = true;
      return;
    }
    tabs.hidden = false;
    tabs.replaceChildren.apply(
      tabs,
      TABS.filter(function (t) {
        return can(t.least);
      }).map(function (t) {
        return h('a', { href: '#/s/' + state.store.id + t.path, class: t.key === on ? 'on' : '' }, t.label);
      }),
    );
  }
  function bare() {
    document.getElementById('bar').hidden = true;
    document.getElementById('tabs').hidden = true;
  }
  function account() {
    sheet(
      'Signed in',
      h(
        'div',
        {},
        h('p', {}, h('b', { text: (state.store && state.store.me) || '' }), h('br'), h('span', { class: 'muted', text: state.user ? state.user.email : '' })),
        state.store ? h('p', { class: 'muted' }, 'Your role at ' + state.store.name + ': ' + state.store.role) : null,
        state.stores && state.stores.length > 1 ? h('a', { class: 'btn wide', href: '#/stores' }, 'Switch store') : null,
        state.platform ? h('a', { class: 'btn wide brand', href: '#/admin' }, 'Cigar Locker network (platform admin)') : null,
        h('div', { class: 'btns' }, h('button', {
          class: 'btn wide',
          type: 'button',
          onclick: async function () {
            await sb.auth.signOut();
            state.stores = null;
            state.store = null;
            state.platform = undefined;
            forget();
            document.querySelectorAll('.veil').forEach(function (v) { v.remove(); });
            go('/');
          },
        }, 'Sign out')),
        h('p', { class: 'faint small' }, 'On a shared store tablet, sign out at the end of a shift.'),
      ),
    );
  }

  // ---- routing ----------------------------------------------------------------

  async function route() {
    state.timers.forEach(clearInterval);
    state.timers = [];
    state.hidHandler = null;
    state.typeTarget = null;
    state.registerReset = null;
    state.registerKnows = null;
    state.hidTest = null;
    document.querySelectorAll('.veil, .sticky-foot').forEach(function (v) { v.remove(); });
    var parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    try {
      if (parts[0] === 'invite') return await invite(parts[1] || '');
      var session = (await sb.auth.getSession()).data.session;
      if (!session) return signIn();
      state.user = session.user;
      if (!state.stores) state.stores = await rpc('retail_my_stores');
      if (state.platform === undefined) state.platform = await rpc('retail_platform_me').then(function (r) { return !!r.admin; }).catch(function () { return false; });
      if (parts[0] === 'admin' && state.platform) {
        state.store = null;
        state.page = 'admin';
        show(busy());
        return await networkView(parts[1]);
      }
      if (parts[0] !== 's') {
        if (state.stores.length === 1 && parts[0] !== 'stores') return go('/s/' + state.stores[0].id);
        state.store = null;
        return storePicker();
      }
      var store = state.stores.filter(function (s) {
        return s.id === parts[1];
      })[0];
      if (!store) return storePicker();
      if (!state.store || state.store.id !== store.id) forget();
      state.store = store;
      state.role = store.role;
      var page = parts[2] || 'home';
      state.page = page;
      chrome(page);
      drawNet();
      flushOutbox();
      show(busy());
      if (page === 'home') return await dashboard();
      if (page === 'count') return parts[3] ? (parts[4] ? await countPlace(parts[3], parts[4]) : await board(parts[3])) : await countStart();
      if (page === 'inventory') return await inventoryView();
      if (page === 'receive') return await receiveView();
      if (page === 'label') return await labelView();
      if (page === 'labels') return await labelsView();
      if (page === 'scan') return await scanView();
      if (page === 'first') return await firstView(parts[3]);
      if (page === 'out') return await outView();
      if (page === 'register') return await registerView();
      if (page === 'insights' && can('manager')) return await insightsView();
      if (page === 'box' && parts[3]) return await boxPage(parts[3]);
      if (page === 'locations' && can('manager')) return await locationsView();
      if (page === 'products' && can('manager')) return await productsView();
      if (page === 'import' && can('manager')) return await importView();
      if (page === 'pilot' && can('manager')) return await pilotView();
      if (page === 'team' && can('manager')) return await teamView();
      return await dashboard();
    } catch (e) {
      if (/Sign in again/.test(errorText(e))) {
        await sb.auth.signOut();
        return signIn('Your sign-in has run out. Sign in again.');
      }
      show(h('div', { class: 'card' }, h('p', { class: 'error', text: errorText(e) }), h('button', { class: 'btn', type: 'button', onclick: route }, 'Try again')));
    }
  }
  window.addEventListener('hashchange', route);

  // ---- signing in, and invites -----------------------------------------------------

  function signIn(message) {
    bare();
    var email = h('input', { class: 'input', type: 'email', autocomplete: 'username', inputmode: 'email' });
    var password = h('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
    var msg = h('p', { class: 'error', text: message || '' });
    var code = h('input', { class: 'input', placeholder: 'Invite code', autocapitalize: 'characters' });
    async function submit(ev) {
      ev.preventDefault();
      msg.textContent = '';
      var r = await sb.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
      if (r.error) {
        msg.textContent = /invalid/i.test(r.error.message) ? 'That email and password do not match.' : errorText(r.error);
        return;
      }
      state.stores = null;
      go(location.hash.indexOf('#/invite/') === 0 ? location.hash.slice(1) : '/');
    }
    show(
      h(
        'div',
        { class: 'door' },
        h('div', { class: 'mark-tile' }, 'CL'),
        h('p', { class: 'over' }, 'Cigar Locker Retail'),
        h('h1', { text: 'Sign in' }),
        h('p', { class: 'lead' }, 'Inventory for your shop: count the store by scanning its shelves.'),
        h('form', { onsubmit: submit }, field('Email', email), field('Password', password), msg, h('button', { class: 'btn primary wide', type: 'submit' }, 'Sign in')),
        h('h3', { text: 'New to the team?' }),
        h('p', { class: 'muted small' }, 'Open the invite link you were sent, or type its code.'),
        h('div', { class: 'btns' }, code, h('button', { class: 'btn', type: 'button', onclick: function () { if (code.value.trim()) go('/invite/' + code.value.trim().toUpperCase()); } }, 'Use invite')),
      ),
    );
  }

  async function invite(code) {
    bare();
    show(busy());
    var info = await rpc('retail_invite_info', { p_code: code });
    var session = (await sb.auth.getSession()).data.session;
    if (!info || !info.valid) {
      return show(h('div', { class: 'door' }, h('div', { class: 'mark-tile' }, 'CL'), h('h1', { text: 'This invite cannot be used' }),
        h('p', { class: 'lead' }, 'It has been used already or has run out. Ask the store for a new one.'), h('a', { class: 'btn', href: '#/' }, 'Sign in')));
    }
    var where = info.store + (info.city ? ', ' + info.city : '');
    var msg = h('p', { class: 'error' });
    var name = h('input', { class: 'input', autocomplete: 'name', value: info.name || '' });
    var head = [h('div', { class: 'mark-tile' }, 'CL'), h('p', { class: 'over' }, 'Cigar Locker Retail'), h('h1', { text: 'Join ' + info.store }),
      h('p', { class: 'lead' }, 'You are invited to ' + where + ' as ' + (info.role === 'owner' ? 'an owner' : 'a ' + info.role) + '.')];
    if (session) {
      return show(h('div', { class: 'door' }, head, field('Your name, as the team sees it', name), msg,
        h('button', { class: 'btn primary wide', type: 'button', onclick: async function () {
          try {
            await retailFn({ action: 'accept-invite', code: code, name: name.value.trim() });
            state.stores = null;
            go('/');
          } catch (e) { msg.textContent = errorText(e); }
        } }, 'Join as ' + session.user.email),
        h('button', { class: 'btn quiet wide', type: 'button', onclick: async function () { await sb.auth.signOut(); route(); } }, 'Use another sign-in')));
    }
    var email = h('input', { class: 'input', type: 'email', autocomplete: 'username', inputmode: 'email' });
    var password = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', minlength: '8' });
    show(h('div', { class: 'door' }, head,
      h('form', { onsubmit: async function (ev) {
        ev.preventDefault();
        msg.textContent = '';
        try {
          await retailFn({ action: 'accept-invite', code: code, name: name.value.trim(), email: email.value.trim(), password: password.value });
          var r = await sb.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
          if (r.error) throw new Error(r.error.message);
          state.stores = null;
          go('/');
        } catch (e) {
          msg.textContent = errorText(e);
          if (e.code === 'email-exists') signInHere.hidden = false;
        }
      } },
        field('Your name, as the team sees it', name), field('Email', email), field('Choose a password (8 or more letters)', password), msg,
        h('button', { class: 'btn primary wide', type: 'submit' }, 'Create my sign-in and join')),
    ));
    var signInHere = h('a', { class: 'btn wide', href: '#/', hidden: true }, 'Sign in with that email');
    main.querySelector('.door').appendChild(signInHere);
  }

  function storePicker() {
    chrome();
    state.store = null;
    document.getElementById('tabs').hidden = true;
    if (!state.stores || !state.stores.length) {
      return show(h('div', { class: 'card' }, h('h1', { text: 'No store yet' }), h('p', { class: 'lead' }, 'This sign-in is not on a store\'s team. Open the invite link the store sent you.')));
    }
    show(h('h1', { text: 'Your stores' }), state.platform ? h('a', { class: 'btn brand', href: '#/admin' }, 'Cigar Locker network') : null, h('div', { class: 'list' }, state.stores.map(function (s) {
      return h('a', { class: 'item tap', href: '#/s/' + s.id, style: { textDecoration: 'none', color: 'inherit' } },
        h('div', { class: 'grow' }, h('div', { class: 'name', text: s.name }), h('div', { class: 'sub', text: [s.city, s.state].filter(Boolean).join(', ') })), chip(s.role));
    })));
  }

  // ---- dashboard -------------------------------------------------------------------

  async function dashboard() {
    var both = await Promise.all([rpc('retail_dashboard', { p_store: state.store.id }), rpc('retail_dashboard_more', { p_store: state.store.id })]);
    var d = both[0];
    var more = both[1];
    var base = '#/s/' + state.store.id;
    var open = d.open;
    var last = d.last;
    var tiles = h('div', { class: 'tiles' },
      h('div', { class: 'tile hero' }, h('div', { class: 'label' }, 'Current inventory'), h('div', { class: 'figure' }, n(d.units) + ' cigars'),
        h('div', { class: 'sub' }, d.boxesLabeled
          ? n(d.kings) + ' sealed boxes · ' + n(d.queens) + ' open · ' + n(d.looseUnits) + ' loose'
          : n(d.productsStocked) + ' products · ' + n(d.locations) + ' places')),
      h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Inventory value at cost'), h('div', { class: 'figure' }, money(d.costCents)),
        h('div', { class: 'sub' }, d.costMissingUnits ? n(d.costMissingUnits) + ' cigars have no cost' : 'every cigar costed')),
      h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Inventory value at retail'), h('div', { class: 'figure' }, money(d.retailCents)),
        h('div', { class: 'sub' }, d.retailMissingUnits ? n(d.retailMissingUnits) + ' cigars have no price' : 'every cigar priced')),
      h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Last inventory'), h('div', { class: 'figure' }, last ? monthYear(last.completed) : '—'),
        h('div', { class: 'sub' }, last ? day(last.completed) : 'none yet')),
      h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Time to complete'), h('div', { class: 'figure' }, last ? R.duration(last.seconds) : '—'),
        h('div', { class: 'sub' }, 'goal: under 90 min')),
      h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Variances'), h('div', { class: 'figure' }, last ? n(last.summary.adjustments || 0) : '—'),
        h('div', { class: 'sub' }, 'adjusted at the last count')),
      h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Needs attention'), h('div', { class: 'figure' }, n((d.unmatched || 0) + (d.missingBoxes || 0) + (open ? (open.summary.locations - open.summary.done) : 0))),
        h('div', { class: 'sub' }, [d.unmatched ? n(d.unmatched) + ' products to match' : '', d.missingBoxes ? n(d.missingBoxes) + ' boxes missing' : '', open ? n(open.summary.locations - open.summary.done) + ' places to count' : ''].filter(Boolean).join(' · ') || 'all clear')),
    );
    var primary = open
      ? h('a', { class: 'btn primary big wide', href: base + '/count/' + open.id }, (open.status === 'paused' ? 'Resume ' : 'Continue ') + open.name)
      : h('a', { class: 'btn primary big wide', href: base + '/count' }, 'Start inventory');
    show(
      h('p', { class: 'over' }, [state.store.city, state.store.state].filter(Boolean).join(', ')),
      h('h1', { text: state.store.name }),
      tiles,
      primary,
      more.onboarding ? h('div', { class: 'card' }, h('h2', { style: { marginTop: 0 } }, 'First inventory under way'),
        h('p', {}, n(more.onboarding.done) + ' of ' + n(more.onboarding.places) + ' places complete.'),
        h('a', { class: 'btn primary', href: base + '/first' }, 'Continue the first inventory')) : null,
      !more.onboarding && !more.baselineAt && (d.units || d.products) ? h('div', { class: 'card' }, h('h2', { style: { marginTop: 0 } }, 'Next: the first inventory'),
        h('p', {}, 'Once, cabinet by cabinet: every box gets its permanent label (scan its barcode, then a blank pre-printed label), open boxes are counted, loose cigars too. The spreadsheet\'s numbers are kept beside what is found, and what is verified becomes the starting truth for perpetual inventory.'),
        h('a', { class: 'btn brand', href: base + '/first' }, 'First inventory'),
        more.blankLabels ? h('p', { class: 'muted small' }, n(more.blankLabels) + ' blank labels ready.') : null) : null,
      h('div', { class: 'btns grid' },
        h('a', { class: 'btn', href: base + '/out' }, 'Cigars out'),
        h('a', { class: 'btn', href: base + '/scan' }, 'Scan a box'),
        h('a', { class: 'btn', href: base + '/receive' }, 'Receive inventory'),
        h('a', { class: 'btn', href: base + '/inventory' }, 'Inventory'),
        can('manager') ? h('a', { class: 'btn', href: base + '/locations' }, 'Locations') : null,
        can('manager') ? h('a', { class: 'btn', href: base + '/products' }, 'Products') : null,
      ),
      !d.locations && can('manager') ? h('div', { class: 'card' }, h('h2', { text: 'Getting started' }),
        h('p', {}, '1. Map the store: rooms, walls, shelves and drawers (Locations).'), h('p', {}, '2. Bring in the inventory spreadsheet (Import).'),
        h('p', {}, '3. Start the inventory and count each place by scanning it.')) : null,
    );
  }

  // ---- starting a count, and its board -----------------------------------------------------

  async function countStart() {
    var d = await rpc('retail_dashboard', { p_store: state.store.id });
    if (d.open) return go('/s/' + state.store.id + '/count/' + d.open.id);
    if (!can('manager')) {
      return show(h('h1', { text: 'Inventory' }), h('div', { class: 'card' }, h('p', { class: 'lead' }, 'No inventory is under way. A manager starts one; then each place can be counted here.')));
    }
    var kind = 'count';
    var name = h('input', { class: 'input', value: new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) + ' inventory' });
    var seg = h('div', { class: 'seg' });
    var help = h('p', { class: 'muted small' });
    function drawSeg() {
      seg.replaceChildren(
        h('button', { type: 'button', class: kind === 'count' ? 'on' : '', onclick: function () { kind = 'count'; drawSeg(); } }, 'Inventory count'),
        h('button', { type: 'button', class: kind === 'control' ? 'on' : '', onclick: function () { kind = 'control'; drawSeg(); } }, 'Control count'),
      );
      help.textContent = kind === 'count'
        ? 'Each place is scanned, checked against the records and confirmed. Confirmed counts update the inventory.'
        : 'A hand count of chosen places that changes nothing: the pilot compares it with the scanned count, to measure accuracy.';
    }
    drawSeg();
    var msg = h('p', { class: 'error' });
    show(
      h('h1', { text: 'Start inventory' }),
      h('p', { class: 'lead' }, 'The clock starts now and stops when the inventory is completed. Pauses are left out.'),
      h('div', { class: 'card' }, field('Name', name), h('div', { class: 'field' }, seg, help), msg,
        h('button', { class: 'btn primary big wide', type: 'button', onclick: async function (ev) {
          ev.target.disabled = true;
          try {
            var sid = await rpc('retail_session_start', { p_store: state.store.id, p_name: name.value.trim(), p_kind: kind });
            go('/s/' + state.store.id + '/count/' + sid);
          } catch (e) {
            msg.textContent = errorText(e);
            ev.target.disabled = false;
          }
        } }, 'Start the clock')),
    );
  }

  function elapsedOf(s) {
    var end = s.completed_at ? Date.parse(s.completed_at) : Date.now();
    var paused = s.paused_seconds || 0;
    if (s.status === 'paused' && s.paused_at) paused += (Date.now() - Date.parse(s.paused_at)) / 1000;
    return Math.max(0, (end - Date.parse(s.started_at)) / 1000 - paused);
  }

  async function board(sid) {
    var base = '/s/' + state.store.id;
    var res = await Promise.all([
      sb.from('store_inventory_sessions').select('*').eq('id', sid).maybeSingle(),
      rows('store_session_locations', '*', function (q) { return q.eq('session_id', sid); }),
      sb.from('store_users').select('user_id,name').eq('store_id', state.store.id),
      storeData(true),
      rpc('retail_session_boxes', { p_session: sid }),
    ]);
    var s = res[0].data;
    if (!s) return show(h('p', { class: 'error', text: 'No such inventory.' }));
    var places = res[1];
    var people = {};
    (res[2].data || []).forEach(function (u) { people[u.user_id] = u.name || 'Someone'; });
    var d = res[3];
    var bx = res[4];
    var hasBoxes = bx.boxes.length > 0;
    var done = places.filter(function (p) { return p.status === 'done'; });
    var expected = places.reduce(function (t, p) { return t + (p.expected_units || 0); }, 0);
    var counted = done.reduce(function (t, p) { return t + (p.counted_units || 0); }, 0);
    var timer = h('div', { class: 'timer', text: clock(elapsedOf(s)) });
    if (s.status === 'open') every(1000, function () { timer.textContent = clock(elapsedOf(s)); });
    if (s.status === 'complete') {
      s.summary = await rpc('retail_session_summary', { p_session: sid }).catch(function () { return s.summary; }) || s.summary;
      return complete(s, places, d);
    }
    if (s.status === 'cancelled') return show(h('h1', { text: s.name }), h('p', { class: 'lead' }, 'This inventory was cancelled.'), h('a', { class: 'btn', href: '#' + base }, 'Dashboard'));
    // Others' progress comes in every 15 seconds.
    every(15000, function () { if (!document.querySelector('.veil') && !document.documentElement.classList.contains('scanning')) route(); });

    var filter = state.boardFilter || 'todo';
    var listEl = h('div', { class: 'list' });
    function drawList() {
      var shown = places
        .map(function (p) { return { p: p, path: pathOf(d, p.location_id) }; })
        .filter(function (x) { return filter === 'all' || (filter === 'done' ? x.p.status === 'done' : x.p.status !== 'done'); })
        .sort(function (a, b) { return a.path.localeCompare(b.path, undefined, { numeric: true }); });
      listEl.replaceChildren.apply(listEl, shown.length ? shown.map(function (x) {
        var p = x.p;
        var st = p.status === 'done'
          ? chip('Done · ' + n(p.counted_units) + ' of ' + n(p.expected_units) + (p.adjustments ? ' · ' + p.adjustments + ' adjusted' : ''), 'good')
          : p.status === 'counting' ? chip('Counting · ' + (people[p.claimed_by] || 'someone'), 'info') : chip('To count');
        return h('a', { class: 'item tap', href: '#' + base + '/count/' + sid + '/' + p.location_id, style: { textDecoration: 'none', color: 'inherit' } },
          h('div', { class: 'grow' }, h('div', { class: 'name', text: (d.loc[p.location_id] || {}).name || 'Place' }), h('div', { class: 'sub', text: x.path })),
          st, h('div', { class: 'qty', text: n(p.expected_units) }));
      }) : [h('div', { class: 'item' }, h('span', { class: 'muted' }, filter === 'done' ? 'Nothing counted yet.' : 'Every place is counted. Complete the inventory.'))]);
    }
    var seg = h('div', { class: 'seg' });
    function drawSeg() {
      seg.replaceChildren.apply(seg, [['todo', 'To count (' + (places.length - done.length) + ')'], ['done', 'Done (' + done.length + ')'], ['all', 'All (' + places.length + ')']].map(function (o) {
        return h('button', { type: 'button', class: filter === o[0] ? 'on' : '', onclick: function () { filter = o[0]; state.boardFilter = filter; drawSeg(); drawList(); } }, o[1]);
      }));
    }
    drawSeg();
    drawList();
    var pct = places.length ? Math.round((100 * done.length) / places.length) : 0;
    show(
      h('p', { class: 'over' }, s.kind === 'control' ? 'Control count' : 'Inventory'),
      h('h1', { text: s.name }),
      h('div', { class: 'card' },
        h('div', { style: { display: 'flex', gap: '24px', alignItems: 'flex-end', flexWrap: 'wrap' } },
          h('div', {}, h('p', { class: 'over' }, s.status === 'paused' ? 'Paused' : 'Elapsed'), timer),
          h('div', { style: { flex: '1', minWidth: '220px' } },
            h('div', { style: { display: 'flex', justifyContent: 'space-between', fontWeight: '650' } }, h('span', {}, n(done.length) + ' of ' + n(places.length) + ' places'), h('span', {}, n(counted) + ' of ' + n(expected) + ' cigars')),
            h('div', { class: 'progress' }, h('i', { style: { width: pct + '%' } })))),
        h('div', { class: 'btns' },
          s.status === 'open'
            ? h('button', { class: 'btn', type: 'button', onclick: async function () { await rpc('retail_session_set', { p_session: sid, p_action: 'pause' }); route(); } }, 'Pause')
            : h('button', { class: 'btn brand', type: 'button', onclick: async function () { await rpc('retail_session_set', { p_session: sid, p_action: 'resume' }); route(); } }, 'Resume'),
          can('manager') ? h('button', { class: 'btn primary', type: 'button', onclick: function () { completeSheet(sid, places.length - done.length, hasBoxes ? bx : null); } }, 'Complete inventory') : null,
          can('manager') ? h('button', { class: 'btn quiet danger', type: 'button', onclick: async function () {
            if (!confirm('Cancel this inventory? Counts already confirmed stay in the inventory.')) return;
            await rpc('retail_session_set', { p_session: sid, p_action: 'cancel' });
            go(base);
          } }, 'Cancel') : null),
        s.status === 'paused' ? h('p', { class: 'muted small' }, 'The clock is stopped. Resume to count.') : null),
      hasBoxes ? boxesCard(sid, s, bx, d) : null,
      hasBoxes ? h('h2', { text: 'Pass 3 · Loose cigars and unlabeled boxes, by place' }) : null,
      hasBoxes ? h('p', { class: 'muted small' }, 'Labeled boxes are counted by their labels in passes 1 and 2; here, count only what has no label.') : null,
      seg,
      h('div', { style: { height: '10px' } }),
      listEl,
    );
  }

  // ---- counting boxes: pass 1 Kings, pass 2 Queens ------------------------------------------

  /** "1 King", "3 Kings". */
  function plural(k, one, many) {
    return n(k) + ' ' + (k === 1 ? one : many || one + 's');
  }
  function signed(x) {
    return (x > 0 ? '+' : x < 0 ? '−' : '') + n(Math.abs(x));
  }

  /** Counting one Queen: a number by hand, or read from a photo (Locker Vision), then saved on the count. */
  function queenCounter(sid, box, start, onSaved, onLater) {
    var counted = start;
    var input = stepper(start, function (v) { counted = v; });
    var note = h('p', { class: 'muted small' });
    var msg = h('p', { class: 'error' });
    var source = 'hand';
    var cam = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true });
    cam.addEventListener('change', async function () {
      var f = cam.files && cam.files[0];
      cam.value = '';
      if (!f) return;
      note.replaceChildren(busy('Counting the cigars in the photo'));
      try {
        var pic = await P.shrinkPhoto(f);
        var res = await retailFn({ action: 'scan', store: state.store.id, session: sid, box: box.id, pictures: [pic] });
        var hit = (res.found || [])[0];
        if (hit && hit.count > 0) {
          counted = hit.count;
          input.querySelector('input').value = String(hit.count);
          source = 'photo';
          note.textContent = 'The photo counted ' + hit.count + (hit.seen ? ' (' + hit.seen + ')' : '') + '. Check it, then save.';
        } else {
          note.textContent = (res.note || 'The photo did not show a count.') + ' Count by hand.';
        }
      } catch (e) { note.textContent = errorText(e); }
    });
    return h('div', { class: 'scan-choice' },
      h('p', { class: 'over warn-text' }, 'Queen · count it'),
      h('div', { class: 'scan-product' }, box.product ? box.product.name : box.name), h('div', { class: 'muted small' }, box.code + ' · ' + (box.path || '')),
      h('p', {}, 'The records say ', h('b', {}, n(box.remaining !== undefined ? box.remaining : box.expected)), ' in it.'),
      field('In the box now', input), note, msg, cam,
      h('div', { class: 'btns' },
        h('button', { class: 'btn primary big', type: 'button', onclick: async function (ev) {
          if (counted === null || counted === undefined) { msg.textContent = 'How many are in it?'; return; }
          var btn = ev.currentTarget; btn.disabled = true;
          try {
            var r = await rpcOp('retail_session_box_count_op', { p_session: sid, p_box: box.id, p_counted: counted, p_source: source, p_location: state.scanAt || null }, 'Queen ' + box.code + ': ' + counted);
            if (r.queued) r = { counted: counted, variance: 0, queued: true };
            onSaved(r);
          } catch (e) { msg.textContent = errorText(e); btn.disabled = false; }
        } }, 'Save count'),
        h('button', { class: 'btn', type: 'button', onclick: function () { cam.click(); } }, 'Count by photo'),
        h('button', { class: 'btn quiet', type: 'button', onclick: onLater }, 'Later')));
  }

  function scanBoxes(sid, pass) {
    var seen = { kings: 0, queens: 0, warn: 0 };
    self.RetailScanner.open({
      title: pass === 1 ? 'Pass 1 · Kings (sealed boxes)' : 'Pass 2 · Queens (open boxes)',
      hint: pass === 1 ? 'Scan the label on every sealed box. Open boxes are noted for pass 2.' : 'Scan an open box\'s label, then count what is in it.',
      onClose: function () { route(); },
      onCode: async function (code, format, ctl) {
        if (Codes.unitCode(code)) return { tone: 'warn', words: 'That is one cigar\'s label (' + code + '). Scan the box\'s label: an open box is counted in pass 2.' };
        var r = await rpcOp('retail_session_box_scan_op', { p_session: sid, p_code: code, p_location: state.scanAt || null }, 'Count scan ' + code);
        if (r.queued) return { tone: 'warn', words: 'No connection: ' + code + ' is kept on this device and checked when it is back.' };
        var b = r.box;
        var name = b ? b.code + ' · ' + b.product.name : code;
        var moved = r.elsewhere ? ' · recorded at ' + b.path + ', so noted as moved here' : '';
        if (pass === 2 && b && b.state === 'open' && (r.result === 'queen' || r.result === 'already' || r.result === 'unexpected' || r.result === 'found')) {
          return await new Promise(function (resolve) {
            ctl.panel(queenCounter(sid, b, r.counted !== undefined && r.counted !== null ? r.counted : b.remaining, function (res) {
              seen.queens += 1;
              ctl.tally(seen.queens + ' Queens counted');
              ctl.resume();
              resolve({ tone: res.variance ? 'warn' : 'good', words: 'Counted ' + name + ': ' + n(res.counted) + (res.variance ? ' (' + signed(res.variance) + ' against the records)' : ', as the records say') });
            }, function () {
              ctl.resume();
              resolve({ tone: 'warn', words: 'Not counted yet: ' + name });
            }));
          });
        }
        if (r.result === 'verified') {
          seen.kings += 1;
          ctl.tally(seen.kings + ' Kings verified' + (seen.queens ? ' · ' + seen.queens + ' Queens' : ''));
          return { tone: moved ? 'warn' : 'good', words: 'King ✓ ' + name + moved };
        }
        if (r.result === 'already') return { tone: 'warn', words: 'Already scanned in this count: ' + name };
        if (r.result === 'queen') {
          seen.queens += 1;
          ctl.tally(seen.kings + ' Kings verified · ' + seen.queens + ' Queens for pass 2');
          return { tone: 'warn', words: 'Queen: ' + name + ' · counted in pass 2' + moved };
        }
        if (r.result === 'found') return { tone: 'warn', words: 'Found: ' + name + ' was recorded ' + b.state + '. Confirmed in the review.' };
        if (r.result === 'unexpected') return { tone: 'warn', words: 'Not in this count\'s list: ' + name + ' (' + (KIND_WORDS[b.state] || b.state) + '). Shown in the review.' };
        if (r.result === 'product') return { tone: 'bad', words: 'That is a factory barcode. Scan the box\'s Cigar Locker label; a box without one is counted with its place (pass 3), or labeled under Label boxes.' };
        return { tone: 'bad', words: r.resolved && r.resolved.otherStore ? 'That label is another store\'s.' : 'No box has the code ' + code + '.' };
      },
    });
  }

  /** The boxes card on a count's board: pass 1, pass 2, and the review. */
  function boxesCard(sid, s, bx, d) {
    var K = bx.summary.kings;
    var Q = bx.summary.queens;
    var O = bx.summary.other;
    var confirmed = bx.summary.confirmed;
    var open = s.status === 'open';
    var notSeen = bx.boxes.filter(function (b) { return b.expectedState === 'sealed' && !b.seen; });
    var queens = bx.boxes.filter(function (b) { return b.expectedState === 'open' || b.seenState === 'open'; });
    var at = placeSelect(d, state.scanAt || '', { none: 'Not set' });
    at.addEventListener('change', function () { state.scanAt = at.value || ''; });
    var kingsPct = K.expected ? Math.round((100 * K.verified) / K.expected) : 100;
    var queenTotal = Q.expected + Math.max(0, Q.toCount + Q.counted - Q.expected);
    var queensPct = queenTotal ? Math.round((100 * Q.counted) / queenTotal) : 100;
    function countSheet(row) {
      var close = sheet('Count ' + row.code, queenCounter(sid, { id: row.id, code: row.code, name: row.name, path: row.path, remaining: row.expected }, row.counted !== null ? row.counted : row.expected,
        function (r) { close(); toast(row.code + ': ' + n(r.counted) + (r.variance ? ' (' + signed(r.variance) + ')' : '')); route(); }, function () { close(); }));
    }
    var notSeenList = h('div', { class: 'list', hidden: true }, notSeen.slice(0, 300).map(function (b) {
      return h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'name', text: b.code + ' · ' + b.name }), h('div', { class: 'sub', text: b.path || '' })), h('div', { class: 'qty', text: n(b.expected) }));
    }));
    var queenList = h('div', { class: 'list', hidden: true }, queens.map(function (b) {
      var v = b.counted !== null && b.counted !== undefined ? b.counted - (b.expected || 0) : null;
      return h('div', { class: 'item' + (open && !confirmed ? ' tap' : ''), onclick: open && !confirmed ? function () { countSheet(b); } : null },
        h('div', { class: 'grow' }, h('div', { class: 'name', text: b.code + ' · ' + b.name }), h('div', { class: 'sub', text: (b.path || '') + ' · records ' + n(b.expected) })),
        b.counted === null || b.counted === undefined ? chip(b.seen ? 'To count' : 'Not scanned', 'warn') : chip(v ? signed(v) : '✓', v ? 'warn' : 'good'),
        h('div', { class: 'qty', text: b.counted === null || b.counted === undefined ? '—' : n(b.counted) }));
    }));
    return h('div', { class: 'card' },
      h('div', { class: 'pass-grid' },
        h('div', { class: 'pass' }, h('p', { class: 'over' }, 'Pass 1 · Kings, sealed'),
          h('div', { class: 'pass-fig' }, n(K.verified) + ' of ' + n(K.expected)), h('div', { class: 'progress' }, h('i', { style: { width: kingsPct + '%' } })),
          h('div', { class: 'sub' }, n(K.expected - K.verified) + ' not scanned · ' + n(K.expectedUnits) + ' cigars'),
          open && !confirmed ? h('button', { class: 'btn brand big wide', type: 'button', onclick: function () { scanBoxes(sid, 1); } }, 'Scan Kings') : null,
          notSeen.length ? h('button', { class: 'btn quiet small', type: 'button', onclick: function () { notSeenList.hidden = !notSeenList.hidden; } }, 'Not scanned yet (' + notSeen.length + ')') : null),
        h('div', { class: 'pass' }, h('p', { class: 'over' }, 'Pass 2 · Queens, open'),
          h('div', { class: 'pass-fig' }, n(Q.counted) + ' of ' + n(queenTotal)), h('div', { class: 'progress' }, h('i', { style: { width: queensPct + '%' } })),
          h('div', { class: 'sub' }, n(Q.countedUnits) + ' cigars counted · variance ' + signed(Q.variance)),
          open && !confirmed ? h('button', { class: 'btn brand big wide', type: 'button', onclick: function () { scanBoxes(sid, 2); } }, 'Count Queens') : null,
          queens.length ? h('button', { class: 'btn quiet small', type: 'button', onclick: function () { queenList.hidden = !queenList.hidden; } }, 'Every Queen (' + queens.length + ')') : null)),
      notSeenList, queenList,
      open && !confirmed ? h('div', { class: 'row-fields' }, field('Scanning in (optional: catches boxes moved from their place)', at)) : null,
      O.unexpected || O.found ? h('p', { class: 'muted small' }, [O.unexpected ? n(O.unexpected) + ' scanned that the count did not expect' : '', O.found ? n(O.found) + ' found that were recorded missing' : ''].filter(Boolean).join(' · ')) : null,
      confirmed ? h('p', { class: 'ok' }, 'Boxes reviewed and confirmed.')
        : can('manager') ? h('button', { class: 'btn', type: 'button', onclick: function () { reviewBoxes(sid, bx); } }, 'Review and confirm the boxes') : null);
  }

  /** The manager's review: what was not seen goes missing unless kept; counts and finds take effect. Nothing changes before this. */
  function reviewBoxes(sid, bx) {
    var keep = {};
    var notSeen = bx.boxes.filter(function (b) { return (b.expectedState === 'sealed' || b.expectedState === 'open') && !b.seen; });
    var variances = bx.boxes.filter(function (b) { return b.counted !== null && b.counted !== undefined && b.counted !== b.expected; });
    var others = bx.boxes.filter(function (b) { return !b.expectedState && b.seen; });
    var toCount = bx.boxes.filter(function (b) { return b.seen && b.seenState === 'open' && (b.counted === null || b.counted === undefined); });
    var msg = h('p', { class: 'error' });
    var close = sheet('Review the boxes', h('div', {},
      h('p', { class: 'muted' }, 'Nothing changes until you confirm. Then: boxes not scanned are marked missing (unless you keep them), counted Queens take their counts, boxes found and moved are put where they were seen.'),
      notSeen.length ? h('h3', { text: 'Not scanned (' + notSeen.length + ')' }) : null,
      notSeen.length ? h('div', { class: 'list' }, notSeen.map(function (b) {
        var box = h('input', { type: 'checkbox', onchange: function () { keep[b.id] = box.checked; } });
        return h('label', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'name', text: b.code + ' · ' + b.name }), h('div', { class: 'sub', text: (b.path || '') + ' · ' + n(b.expected) + ' cigars' })),
          h('span', { class: 'small' }, box, ' It is there'));
      })) : null,
      variances.length ? h('h3', { text: 'Queens counted differently (' + variances.length + ')' }) : null,
      variances.length ? h('div', { class: 'list' }, variances.map(function (b) {
        return h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'name', text: b.code + ' · ' + b.name }), h('div', { class: 'sub', text: 'records ' + n(b.expected) + ', counted ' + n(b.counted) })), chip(signed(b.counted - b.expected), 'warn'));
      })) : null,
      toCount.length ? h('p', { class: 'muted' }, n(toCount.length) + (toCount.length === 1 ? ' Queen was' : ' Queens were') + ' scanned but not counted: they keep the records\' count.') : null,
      others.length ? h('h3', { text: 'Scanned, not expected (' + others.length + ')' }) : null,
      others.length ? h('div', { class: 'list' }, others.map(function (b) {
        return h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'name', text: b.code + ' · ' + b.name }), h('div', { class: 'sub', text: (b.seenPath || b.path || '') })), boxChip(b.seenState));
      })) : null,
      msg,
      h('button', { class: 'btn primary big wide', type: 'button', onclick: async function (ev) {
        var btn = ev.currentTarget; btn.disabled = true;
        try {
          var ids = Object.keys(keep).filter(function (k) { return keep[k]; });
          var r = await rpc('retail_session_boxes_confirm', { p_session: sid, p_keep: ids });
          close();
          toast('Boxes confirmed: ' + [r.counted ? r.counted + ' counted' : '', r.missing ? r.missing + ' marked missing' : '', r.moved ? r.moved + ' moved' : '', r.found ? r.found + ' found' : ''].filter(Boolean).join(', ') + '.');
          forget();
          route();
        } catch (e) { msg.textContent = errorText(e); btn.disabled = false; }
      } }, 'Confirm the boxes')));
    return close;
  }

  function completeSheet(sid, left, bx) {
    var msg = h('p', { class: 'error' });
    if (bx && !bx.summary.confirmed) {
      return sheet('Complete inventory', h('div', {},
        h('p', { class: 'lead' }, 'First review and confirm the boxes: what was not scanned, the Queens counted, the boxes found.'),
        h('button', { class: 'btn primary wide', type: 'button', onclick: function () { document.querySelectorAll('.veil').forEach(function (v) { v.remove(); }); reviewBoxes(sid, bx); } }, 'Review the boxes')));
    }
    sheet('Complete inventory', h('div', {},
      h('p', { class: 'lead' }, left ? n(left) + ' place' + (left === 1 ? ' is' : 's are') + ' not counted. They keep their recorded counts.' : 'Every place is counted.'),
      h('p', {}, 'The clock stops and the summary is kept.'), msg,
      h('button', { class: 'btn primary wide', type: 'button', onclick: async function () {
        try {
          await rpc('retail_session_set', { p_session: sid, p_action: 'complete' });
          document.querySelectorAll('.veil').forEach(function (v) { v.remove(); });
          route();
        } catch (e) { msg.textContent = errorText(e); }
      } }, 'Complete now')));
  }

  /** The count's answer, as the reviewer set it out: Kings, Queens, the total, what needs review. */
  function boxResults(sum) {
    var K = sum.boxes.kings;
    var Q = sum.boxes.queens;
    function group(title, tiles) {
      return [h('h2', { text: title }), h('div', { class: 'tiles' }, tiles.map(function (t) {
        return h('div', { class: 'tile' }, h('div', { class: 'label' }, t[0]), h('div', { class: 'figure', style: t[2] ? { color: 'var(--' + t[2] + ')' } : null }, t[1]), t[3] ? h('div', { class: 'sub' }, t[3]) : null);
      }))];
    }
    var secs = sum.seconds || 0;
    var A = sum.accuracy || {};
    return h('div', {},
      A.expected ? group('Accuracy', [['System expected', n(A.expected)], ['Physical verified', n(A.verified)], ['Variance', signed(A.variance), A.variance ? 'warn' : 'good'],
        ['Absolute variance', n(A.absVariance), '', 'over and short alike'], ['Accuracy', A.accuracy + '%', A.accuracy >= 99.5 ? 'good' : 'warn', A.queensUncounted ? n(A.queensUncounted) + ' open boxes not counted' : '']]) : null,
      group('Kings · sealed boxes', [['Expected', n(K.expected)], ['Verified', n(K.verified), 'good'], ['Missing', n(K.missing), K.missing ? 'bad' : ''], ['Moved', n(K.moved), '', 'seen in another place']]),
      group('Queens · open boxes', [['Expected cigars', n(Q.expectedUnits)], ['Counted cigars', n(Q.countedUnits)], ['Variance', signed(Q.variance), Q.variance ? 'warn' : 'good', 'on ' + n(Q.counted) + (Q.counted === 1 ? ' Queen' : ' Queens') + ' counted']]),
      group('Total', [['Expected cigars', n(sum.total.expected)], ['Counted cigars', n(sum.total.counted)], ['Needs review', n(sum.needsReview), sum.needsReview ? 'warn' : 'good'],
        ['Time', R.duration(secs), secs <= 5400 ? 'good' : 'warn', secs <= 3600 ? 'under an hour' : secs <= 5400 ? 'under 90 minutes' : 'over 90 minutes']]));
  }

  function complete(s, places) {
    var sum = s.summary || {};
    show(
      h('p', { class: 'over' }, s.kind === 'control' ? 'Control count' : 'Inventory'),
      h('h1', { text: s.name }),
      h('div', { class: 'card', style: { textAlign: 'center' } },
        h('p', { class: 'over' }, 'Inventory complete'),
        h('div', { class: 'timer', style: { margin: '10px 0' } }, R.duration(sum.seconds || elapsedOf(s))),
        h('p', { class: 'muted' }, 'Total time · ' + day(s.started_at) + (s.completed_at ? ', ' + new Date(s.started_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + ' to ' + new Date(s.completed_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''))),
      sum.hasBoxes ? boxResults(sum) : sum.accuracy && sum.accuracy.expected ? h('div', { class: 'tiles' },
        h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Accuracy'), h('div', { class: 'figure' }, sum.accuracy.accuracy + '%'),
          h('div', { class: 'sub' }, n(sum.accuracy.verified) + ' verified of ' + n(sum.accuracy.expected) + ' expected · ' + n(sum.accuracy.absVariance) + ' off'))) : null,
      sum.hasBoxes ? h('h2', { text: 'Loose cigars, by place' }) : null,
      h('div', { class: 'tiles' },
        h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Expected units'), h('div', { class: 'figure' }, n(sum.expectedDone || sum.expected))),
        h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Counted units'), h('div', { class: 'figure' }, n(sum.counted))),
        h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Automatically matched'), h('div', { class: 'figure' }, n(sum.matched)), h('div', { class: 'sub' }, 'found by the scan with the right count')),
        h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Exceptions reviewed'), h('div', { class: 'figure' }, n(sum.exceptions))),
        h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Adjustments'), h('div', { class: 'figure' }, n(sum.adjustments))),
        h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Places counted'), h('div', { class: 'figure' }, n(sum.done) + ' of ' + n(sum.locations)), h('div', { class: 'sub' }, n(sum.scans) + ' scans · ' + n(sum.people) + ' people'))),
      h('a', { class: 'btn brand big wide', href: '#/s/' + state.store.id }, 'Dashboard'),
    );
  }

  // ---- counting one place --------------------------------------------------------------

  async function countPlace(sid, lid) {
    var base = '/s/' + state.store.id + '/count/' + sid;
    var d = await storeData(true);
    var place = d.loc[lid];
    if (!place) return show(h('p', { class: 'error', text: 'That place is not in this store.' }));
    var path = pathOf(d, lid);
    var claim;
    try {
      claim = await rpc('retail_location_claim', { p_session: sid, p_location: lid, p_force: false });
    } catch (e) {
      var taken = errorText(e);
      return show(h('h1', { text: place.name }), h('div', { class: 'card' }, h('p', { class: 'lead', text: taken }),
        can('manager') && /counting/.test(taken) ? h('button', { class: 'btn primary', type: 'button', onclick: async function () {
          await rpc('retail_location_claim', { p_session: sid, p_location: lid, p_force: true });
          route();
        } }, 'Take it over') : null, h('a', { class: 'btn', href: '#' + base }, 'Back to the list')));
    }
    var sessionKind = (await sb.from('store_inventory_sessions').select('kind').eq('id', sid).maybeSingle()).data;
    var control = sessionKind && sessionKind.kind === 'control';
    var expected = d.inventory.filter(function (i) { return i.location_id === lid && i.quantity > 0; }).map(function (i) { return { productId: i.product_id, expected: i.quantity }; });
    var info = {};
    Object.keys(d.products).forEach(function (id) {
      var p = d.products[id];
      info[id] = { name: productName(p), brand: p.brand, line: p.line, lineKey: p.line_key || '' };
    });
    var expectedUnits = expected.reduce(function (t, e) { return t + e.expected; }, 0);
    var ui = { mode: control ? 'hand' : 'start', pictures: [], thumbs: [], lines: [], scans: 0, note: '', counts: {}, error: '' };
    var stage = h('div');
    var foot = h('div', { class: 'sticky-foot' });

    function header() {
      return [
        h('p', { class: 'over' }, path.indexOf(' › ') > 0 ? path.slice(0, path.lastIndexOf(' › ')) : 'Count'),
        h('h1', { text: place.name }),
        h('p', { class: 'lead' }, n(expectedUnits) + (d.boxes.length ? ' loose or unlabeled cigars' : ' cigars') + ' expected here · ' + expected.length + ' product' + (expected.length === 1 ? '' : 's') + (claim && claim.done ? ' · counted already: confirming again replaces it' : '')),
        d.boxes.length ? h('p', { class: 'muted small' }, 'Boxes with a Cigar Locker label are counted by their labels (passes 1 and 2). Count only what has no label here.') : null,
      ];
    }

    var camera = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, onchange: function () { addPhotos(camera.files); camera.value = ''; } });
    var library = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: function () { addPhotos(library.files); library.value = ''; } });
    var video = h('input', { type: 'file', accept: 'video/*', hidden: true, onchange: function () { addVideo(video.files[0]); video.value = ''; } });

    async function addPhotos(files) {
      var list = Array.prototype.slice.call(files || []);
      ui.error = '';
      for (var i = 0; i < list.length && ui.pictures.length < P.MAX_FRAMES; i++) {
        try {
          ui.pictures.push(await P.shrinkPhoto(list[i]));
          ui.thumbs.push(URL.createObjectURL(list[i]));
        } catch (e) { ui.error = errorText(e); }
      }
      if (list.length + ui.pictures.length > P.MAX_FRAMES) ui.error = 'Up to ' + P.MAX_FRAMES + ' pictures at a time. Scan the rest of this place as another pass.';
      draw();
    }
    async function addVideo(file) {
      if (!file) return;
      ui.mode = 'reading';
      ui.readingWords = 'Taking stills from the video';
      draw();
      try {
        ui.pictures = await P.videoFrames(file);
        ui.thumbs = [];
        await read();
      } catch (e) {
        ui.mode = 'start';
        ui.error = errorText(e);
        draw();
      }
    }
    async function read() {
      if (!ui.pictures.length) return;
      ui.mode = 'reading';
      ui.readingWords = 'Reading ' + ui.pictures.length + ' picture' + (ui.pictures.length === 1 ? '' : 's');
      draw();
      var t0 = Date.now();
      try {
        var res = await retailFn({ action: 'scan', store: state.store.id, session: sid, location: lid, place: path, pictures: ui.pictures });
        ui.scans += 1;
        ui.note = res.note || '';
        ui.lines = R.reconcile({ expected: expected, found: res.found, others: res.others, products: info });
        ui.mode = 'review';
        ui.readSeconds = Math.round((Date.now() - t0) / 1000);
      } catch (e) {
        ui.mode = 'start';
        ui.error = errorText(e) + (e.code === 'resting' || e.code === 'store-limit' ? '' : '');
      }
      ui.pictures = [];
      ui.thumbs.forEach(function (u) { URL.revokeObjectURL(u); });
      ui.thumbs = [];
      draw();
    }

    function pickProduct(onPick) {
      var q = h('input', { class: 'input', placeholder: 'Brand, line, size or SKU', type: 'search' });
      var list = h('div', { class: 'list' });
      function fill() {
        var w = S.plain(q.value).split(' ').filter(Boolean);
        var all = Object.keys(d.products).map(function (id) { return d.products[id]; }).filter(function (p) {
          if (!p.active) return false;
          var hay = S.plain([p.brand, p.line, p.vitola, p.size_text, p.sku].join(' '));
          return w.every(function (x) { return hay.indexOf(x) >= 0; });
        }).slice(0, 60);
        list.replaceChildren.apply(list, all.length ? all.map(function (p) {
          return h('div', { class: 'item tap', onclick: function () { close(); onPick(p); } }, h('div', { class: 'grow' }, h('div', { class: 'name', text: productName(p) }), h('div', { class: 'sub', text: productDetail(p) })));
        }) : [h('div', { class: 'item muted' }, 'No product matches. A manager can add it under Products.')]);
      }
      q.addEventListener('input', fill);
      fill();
      var close = sheet('Which product?', h('div', {}, q, h('div', { style: { height: '10px' } }), list));
    }

    function lineCard(l) {
      var resolvedWords = l.ignored ? 'Not counted' : l.counted !== null ? 'Counted ' + n(l.counted) : '';
      var kind = l.status === 'MATCH' ? 'good' : l.status === 'EXPECTED_NOT_FOUND' || l.status === 'POSSIBLE_WRONG_PRODUCT' ? 'bad' : 'warn';
      var actions = [];
      function choose(choice) {
        ui.lines = R.choose(ui.lines, l.key, choice);
        draw(true);
      }
      var setCount = function (v) { choose({ type: 'count', value: v }); };
      if (l.status === 'COUNT_VARIANCE') {
        actions.push(h('button', { class: 'btn small', type: 'button', onclick: function () { choose({ type: 'use_detected' }); } }, 'Use ' + n(l.detected) + ' (scan)'));
        actions.push(h('button', { class: 'btn small', type: 'button', onclick: function () { choose({ type: 'keep_expected' }); } }, 'Keep ' + n(l.expected) + ' (records)'));
        actions.push(stepper(l.counted, setCount));
      } else if (l.status === 'EXPECTED_NOT_FOUND') {
        actions.push(h('button', { class: 'btn small', type: 'button', onclick: function () { choose({ type: 'not_here' }); } }, 'None here'));
        actions.push(h('span', { class: 'muted small' }, 'or count them:'));
        actions.push(stepper(l.counted, setCount));
      } else if (l.status === 'POSSIBLE_WRONG_PRODUCT') {
        var other = ui.lines.filter(function (x) { return x.key === l.pairedWith; })[0];
        if (other) actions.push(h('button', { class: 'btn small', type: 'button', onclick: function () { choose({ type: 'is_expected' }); } }, 'It is ' + other.name));
        actions.push(h('button', { class: 'btn small', type: 'button', onclick: function () { choose({ type: 'is_found' }); } }, 'It is ' + l.name));
      } else if (l.status === 'FOUND_NOT_EXPECTED') {
        actions.push(h('span', { class: 'muted small' }, 'Count it here:'));
        actions.push(stepper(l.counted !== null ? l.counted : l.detected, setCount));
        actions.push(h('button', { class: 'btn small', type: 'button', onclick: function () { choose({ type: 'ignore' }); } }, 'Not here'));
      } else if (l.status === 'NEEDS_REVIEW' && l.unlisted) {
        actions.push(h('button', { class: 'btn small', type: 'button', onclick: function () { pickProduct(function (p) { choose({ type: 'assign', productId: p.id, name: productName(p) }); }); } }, 'It is one of ours…'));
        actions.push(h('button', { class: 'btn small', type: 'button', onclick: function () { choose({ type: 'ignore' }); } }, 'Not ours · skip'));
      } else if (l.status === 'NEEDS_REVIEW') {
        actions.push(h('span', { class: 'muted small' }, 'Seen, but not countable from the photo. Count:'));
        actions.push(stepper(l.counted, setCount));
      } else {
        actions.push(h('span', { class: 'muted small' }, 'Change the count:'));
        actions.push(stepper(l.counted, setCount));
      }
      return h('div', { class: 'line-card' + (l.resolved ? ' done' : '') },
        h('div', { class: 'top' }, h('div', { class: 'grow', style: { flex: '1' } }, h('div', { class: 'name', style: { fontWeight: '700' } }, l.name), l.seen ? h('div', { class: 'seen', text: 'Seen: ' + l.seen }) : null),
          chip(R.WORDS[l.status], kind), l.resolved ? chip('✓ ' + resolvedWords, 'good') : null),
        h('div', { class: 'figs' },
          h('span', {}, 'Expected ', h('b', {}, n(l.expected))),
          l.detected !== null ? h('span', {}, 'Detected ', h('b', {}, l.detected === 0 && l.status !== 'EXPECTED_NOT_FOUND' ? '?' : n(l.detected))) : null),
        h('div', { class: 'btns', style: { alignItems: 'center', margin: '4px 0 0' } }, actions));
    }

    function summaryTiles(s) {
      return h('div', { class: 'recon' },
        h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Expected'), h('div', { class: 'figure' }, n(s.expected))),
        h('div', { class: 'tile' }, h('div', { class: 'label' }, ui.mode === 'hand' ? 'Counted' : 'Detected'), h('div', { class: 'figure' }, n(ui.mode === 'hand' ? s.counted : s.detected))),
        h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Matched'), h('div', { class: 'figure', style: { color: 'var(--good)' } }, n(s.matched))),
        h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Need review'), h('div', { class: 'figure', style: { color: s.review ? 'var(--warn)' : 'inherit' } }, n(s.review))),
        h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Missing'), h('div', { class: 'figure', style: { color: s.missing ? 'var(--bad)' : 'inherit' } }, n(s.missing))));
    }

    async function confirmCount(btn) {
      var s = R.summarize(ui.lines);
      btn.disabled = true;
      try {
        var r = await rpc('retail_location_confirm', {
          p_session: sid, p_location: lid,
          p: { lines: R.confirmLines(ui.lines), detected_units: ui.mode === 'hand' ? null : s.detected, scans: ui.scans, unmatched: R.unmatched(ui.lines) },
        });
        forget();
        toast(place.name + ': ' + n(r.counted) + ' counted of ' + n(r.expected) + ' expected' + (r.adjustments ? ', ' + r.adjustments + ' adjusted' : '') + '.');
        go(base);
      } catch (e) {
        btn.disabled = false;
        toast(errorText(e));
      }
    }

    function draw(keepScroll) {
      var y = window.scrollY;
      var body = [];
      if (ui.error) body.push(h('p', { class: 'error', text: ui.error }));
      if (ui.mode === 'start') {
        body.push(h('div', { class: 'card' },
          h('h2', { style: { marginTop: '0' } }, 'Scan this place'),
          h('p', { class: 'muted' }, 'Photograph the whole place: every box lid, label and band you can. Several photos along a long shelf are read together, each cigar counted once. Nothing changes until you confirm.'),
          ui.thumbs.length ? h('div', { class: 'thumbs' }, ui.thumbs.map(function (u) { return h('img', { src: u, alt: '' }); })) : null,
          ui.pictures.length ? h('p', { class: 'ok' }, ui.pictures.length + ' picture' + (ui.pictures.length === 1 ? '' : 's') + ' ready') : null,
          h('div', { class: 'btns grid' },
            h('button', { class: 'btn brand big', type: 'button', onclick: function () { camera.click(); } }, ui.pictures.length ? 'Take another photo' : 'Take a photo'),
            h('button', { class: 'btn big', type: 'button', onclick: function () { library.click(); } }, 'Choose photos'),
            h('button', { class: 'btn big', type: 'button', onclick: function () { video.click(); } }, 'Choose a video')),
          ui.pictures.length ? h('button', { class: 'btn primary big wide', type: 'button', onclick: read }, 'Read ' + ui.pictures.length + ' picture' + (ui.pictures.length === 1 ? '' : 's')) : null),
          h('div', { class: 'btns' }, h('button', { class: 'btn', type: 'button', onclick: function () { ui.mode = 'hand'; draw(); } }, 'Count by hand instead'),
            !expected.length ? h('button', { class: 'btn', type: 'button', onclick: function (ev) { ui.lines = []; confirmCount(ev.target); } }, 'Nothing here: confirm empty') : null),
          expected.length ? h('h2', { text: 'Expected here' }) : h('p', { class: 'muted' }, 'Nothing is recorded here.'),
          expected.length ? h('div', { class: 'list' }, expected.map(function (e) {
            var p = d.products[e.productId];
            return h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'name', text: productName(p) }), h('div', { class: 'sub', text: productDetail(p || {}) })), h('div', { class: 'qty', text: n(e.expected) }));
          })) : null);
        foot.hidden = true;
      } else if (ui.mode === 'reading') {
        body.push(h('div', { class: 'card' }, busy(ui.readingWords + '… usually 10 to 40 seconds'), h('p', { class: 'muted small' }, 'Each band and box is read against this store\'s products and the band library.')));
        foot.hidden = true;
      } else if (ui.mode === 'review') {
        var s = R.summarize(ui.lines);
        var open = ui.lines.filter(function (l) { return l.status !== 'MATCH'; });
        var matched = ui.lines.filter(function (l) { return l.status === 'MATCH'; });
        body.push(summaryTiles(s));
        if (ui.note) body.push(h('p', { class: 'muted', text: 'From the scan: ' + ui.note }));
        body.push(h('p', { class: 'faint small' }, 'Read in ' + (ui.readSeconds || 0) + ' s. ' + (s.unresolved ? s.unresolved + ' to resolve before confirming.' : 'Everything is resolved.')));
        if (open.length) body.push(h('h2', { text: 'Review (' + open.length + ')' }), open.map(lineCard));
        if (matched.length) {
          var showAll = ui.showMatched;
          body.push(h('h2', { text: 'Matched (' + matched.length + ')' }));
          body.push(showAll ? matched.map(lineCard) : h('div', { class: 'list' }, h('div', { class: 'item tap', onclick: function () { ui.showMatched = true; draw(true); } },
            h('div', { class: 'grow' }, h('div', { class: 'name' }, n(s.matchedUnits) + ' cigars matched exactly'), h('div', { class: 'sub' }, matched.map(function (m) { return m.name; }).slice(0, 4).join(', ') + (matched.length > 4 ? '…' : ''))),
            chip('Show', 'good'))));
        }
        body.push(h('div', { class: 'btns' },
          h('button', { class: 'btn', type: 'button', onclick: function () { pickProduct(function (p) {
            if (!ui.lines.some(function (l) { return l.productId === p.id; })) {
              var ex = expected.filter(function (e) { return e.productId === p.id; })[0];
              ui.lines = ui.lines.concat([{ key: 'p:' + p.id, productId: p.id, name: productName(p), expected: ex ? ex.expected : 0, detected: null, seen: 'added by hand', auto: false, counted: null, resolved: false, wrongProduct: false, status: ex ? 'NEEDS_REVIEW' : 'FOUND_NOT_EXPECTED' }]);
            }
            draw(true);
          }); } }, 'Add a product found here'),
          h('button', { class: 'btn', type: 'button', onclick: function () { ui.mode = 'start'; draw(); } }, 'Scan again'),
          h('button', { class: 'btn', type: 'button', onclick: function () { ui.mode = 'hand'; draw(); } }, 'Count by hand instead')));
        foot.hidden = false;
        foot.replaceChildren(h('div', { class: 'in' }, h('div', { class: 'grow' },
          h('b', {}, n(s.counted) + ' counted'), h('span', { class: 'muted' }, ' of ' + n(s.expected) + ' expected · ' + s.adjustments + ' adjustment' + (s.adjustments === 1 ? '' : 's'))),
          h('button', { class: 'btn primary big', type: 'button', disabled: s.unresolved > 0, onclick: function (ev) { confirmCount(ev.currentTarget); } },
            s.unresolved ? s.unresolved + ' to resolve' : control ? 'Save control count' : 'Confirm count')));
      } else if (ui.mode === 'hand') {
        ui.lines = R.handCount({ expected: expected, counts: ui.counts, products: info });
        var hs = R.summarize(ui.lines);
        body.push(summaryTiles(hs));
        body.push(h('p', { class: 'muted' }, control ? 'Control count: count every product here by hand. This changes nothing in the inventory.' : 'Count each product here by hand.'));
        // A fixed order while counting: a row never moves from under a finger.
        var steady = ui.lines.slice().sort(function (a, b) { return (b.expected > 0) - (a.expected > 0) || a.name.localeCompare(b.name); });
        body.push(h('div', { class: 'list' }, steady.map(function (l) {
          return h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'name', text: l.name }), h('div', { class: 'sub' }, 'Expected ' + n(l.expected))),
            stepper(l.counted, function (v) { ui.counts[l.productId] = v; draw(true); }));
        })));
        body.push(h('div', { class: 'btns' },
          h('button', { class: 'btn', type: 'button', onclick: function () { pickProduct(function (p) { if (ui.counts[p.id] === undefined) ui.counts[p.id] = 0; draw(true); }); } }, 'Add a product found here'),
          !control ? h('button', { class: 'btn', type: 'button', onclick: function () { ui.mode = 'start'; ui.lines = []; draw(); } }, 'Scan instead') : null));
        foot.hidden = false;
        foot.replaceChildren(h('div', { class: 'in' }, h('div', { class: 'grow' }, h('b', {}, n(hs.counted) + ' counted'), h('span', { class: 'muted' }, ' of ' + n(hs.expected) + ' expected')),
          h('button', { class: 'btn primary big', type: 'button', disabled: hs.unresolved > 0, onclick: function (ev) { confirmCount(ev.currentTarget); } },
            hs.unresolved ? hs.unresolved + ' not counted yet' : control ? 'Save control count' : 'Confirm count')));
      }
      fill(stage, body);
      if (keepScroll) window.scrollTo(0, y);
    }

    show(h('div', {}, header(), stage, camera, library, video,
      h('div', { class: 'btns' }, h('a', { class: 'btn quiet', href: '#' + base, onclick: function () { rpc('retail_location_release', { p_session: sid, p_location: lid }).catch(function () {}); } }, '‹ Back to the list'))));
    document.body.appendChild(foot);
    draw();
  }

  // ---- inventory -------------------------------------------------------------------

  async function inventoryView() {
    var d = await storeData(true);
    var base = '#/s/' + state.store.id;
    var total = d.stock.reduce(function (t, i) { return t + i.units; }, 0);
    var kings = d.stock.reduce(function (t, i) { return t + i.kings; }, 0);
    var queens = d.stock.reduce(function (t, i) { return t + i.queens; }, 0);
    var loose = d.stock.reduce(function (t, i) { return t + i.loose_units; }, 0);
    var listEl = h('div', { class: 'list' });
    walk(d).forEach(function (x) {
      var here = d.stock.filter(function (i) { return i.location_id === x.loc.id && i.units > 0; });
      var units = here.reduce(function (t, i) { return t + i.units; }, 0);
      listEl.appendChild(h('div', { class: 'item indent-' + Math.min(x.depth, 4) }, h('div', { class: 'grow' }, h('div', { class: 'name', text: x.loc.name }), h('div', { class: 'sub', text: TYPE_WORDS[x.loc.type] })), units ? h('div', { class: 'qty', text: n(units) }) : null));
      here.sort(function (a, b) { return productName(d.products[a.product_id]).localeCompare(productName(d.products[b.product_id])); }).forEach(function (i) {
        var p = d.products[i.product_id];
        listEl.appendChild(h('div', { class: 'item tap indent-' + Math.min(x.depth + 1, 4), onclick: function () { hereSheet(d, p, x.loc, i); } },
          h('div', { class: 'grow' }, h('div', { text: productName(p) }), h('div', { class: 'sub', text: [stockWords(i), productDetail(p || {})].filter(Boolean).join(' · ') })), h('div', { class: 'qty', style: { fontSize: '18px' }, text: n(i.units) })));
      });
    });
    var missing = d.boxes.filter(function (b) { return b.state === 'missing'; });
    show(h('h1', { text: 'Inventory' }),
      h('p', { class: 'lead' }, n(total) + ' cigars in ' + n(d.locations.length) + ' places' + (kings || queens ? ': ' + n(kings) + ' sealed boxes (Kings), ' + n(queens) + ' open boxes (Queens), ' + n(loose) + ' loose or not labeled yet.' : '.') + ' Tap a product to see its boxes, or to move or adjust loose cigars.'),
      missing.length ? h('div', { class: 'card' }, h('p', { class: 'error' }, n(missing.length) + (missing.length === 1 ? ' box is' : ' boxes are') + ' marked missing.'),
        h('div', { class: 'list' }, missing.slice(0, 20).map(function (b) {
          return h('a', { class: 'item tap', href: base + '/box/' + b.id, style: { textDecoration: 'none', color: 'inherit' } }, h('div', { class: 'grow' }, h('div', { class: 'name', text: b.cl_code + ' · ' + productName(d.products[b.store_product_id]) }), h('div', { class: 'sub', text: 'Last at ' + pathOf(d, b.location_id) })), boxChip(b.state));
        }))) : null,
      listEl);
  }

  /** A product at one place: its boxes (each opens its page) and its loose cigars. */
  function hereSheet(d, p, loc, s) {
    var base = '#/s/' + state.store.id;
    var boxes = d.boxes.filter(function (b) { return b.store_product_id === p.id && b.location_id === loc.id && (b.state === 'sealed' || b.state === 'open'); })
      .sort(function (a, b) { return a.state === b.state ? a.cl_code.localeCompare(b.cl_code) : a.state === 'open' ? -1 : 1; });
    var close = sheet(productName(p), h('div', {},
      h('p', { class: 'muted' }, pathOf(d, loc.id) + ' · ' + n(s.units) + ' cigars'),
      boxes.length ? h('div', { class: 'list' }, boxes.map(function (b) {
        return h('a', { class: 'item tap', href: base + '/box/' + b.id, onclick: function () { close(); }, style: { textDecoration: 'none', color: 'inherit' } },
          h('div', { class: 'grow' }, h('div', { class: 'name', text: b.cl_code }), h('div', { class: 'sub', text: b.state === 'open' ? 'opened ' + day(b.opened_at) : 'box of ' + b.original_quantity })), boxChip(b.state), h('div', { class: 'qty', text: n(boxUnits(b)) }));
      })) : null,
      s.loose_units ? h('div', { class: 'card flat' }, h('p', {}, h('b', {}, n(s.loose_units) + ' loose or not labeled yet')),
        h('div', { class: 'btns' }, h('button', { class: 'btn', type: 'button', onclick: function () { close(); stockSheet(d, p, loc, s.loose_units); } }, can('manager') ? 'Move or adjust them' : 'Move them'),
          h('a', { class: 'btn', href: base + '/label', onclick: function () { state.labelAt = loc.id; close(); } }, 'Label their boxes'))) : null));
  }

  function stockSheet(d, p, loc, qty) {
    var mode = 'move';
    var body = h('div');
    var msg = h('p', { class: 'error' });
    function placeSelect(except) {
      return h('select', { class: 'input' }, walk(d).filter(function (x) { return x.loc.id !== except; }).map(function (x) {
        return h('option', { value: x.loc.id }, ' '.repeat(x.depth * 3) + x.loc.name);
      }));
    }
    function drawBody() {
      var seg = h('div', { class: 'seg' }, h('button', { type: 'button', class: mode === 'move' ? 'on' : '', onclick: function () { mode = 'move'; drawBody(); } }, 'Move'),
        can('manager') ? h('button', { type: 'button', class: mode === 'adjust' ? 'on' : '', onclick: function () { mode = 'adjust'; drawBody(); } }, 'Adjust') : null);
      var howMany = qty;
      if (mode === 'move') {
        var to = placeSelect(loc.id);
        body.replaceChildren(seg, h('p', {}, n(qty) + ' at ' + pathOf(d, loc.id)), field('How many', stepper(qty, function (v) { howMany = v; })), field('To', to), msg,
          h('button', { class: 'btn primary wide', type: 'button', onclick: async function () {
            try {
              await rpc('retail_move', { p_store: state.store.id, p_product: p.id, p_from: loc.id, p_to: to.value, p_quantity: howMany, p_note: '' });
              done('Moved ' + n(howMany) + '.');
            } catch (e) { msg.textContent = errorText(e); }
          } }, 'Move'));
      } else {
        var kind = h('select', { class: 'input' }, [['manual_adjustment', 'Correction'], ['damaged', 'Damaged'], ['missing', 'Missing'], ['returned', 'Returned'], ['sold', 'Sold']].map(function (o) { return h('option', { value: o[0] }, o[1]); }));
        var reason = h('input', { class: 'input', placeholder: 'Why (optional)' });
        var newQty = qty;
        body.replaceChildren(seg, field('New quantity here', stepper(qty, function (v) { newQty = v; })), field('Kind', kind), field('Reason', reason), msg,
          h('button', { class: 'btn primary wide', type: 'button', onclick: async function () {
            try {
              await rpc('retail_adjust', { p_store: state.store.id, p_product: p.id, p_location: loc.id, p_kind: kind.value, p_new: newQty, p_change: null, p_reason: reason.value });
              done('Adjusted to ' + n(newQty) + '.');
            } catch (e) { msg.textContent = errorText(e); }
          } }, 'Save'));
      }
    }
    var close = sheet(productName(p), body);
    function done(words) {
      close();
      forget();
      toast(words);
      route();
    }
    drawBody();
  }

  // ---- locations ---------------------------------------------------------------------

  async function locationsView() {
    var d = await storeData(true);
    function edit(loc, parent) {
      var name = h('input', { class: 'input', value: loc ? loc.name : '', placeholder: 'Left Wall, Shelf 1, Drawer 2…' });
      var type = h('select', { class: 'input' }, TYPES.map(function (t) { return h('option', { value: t, selected: loc ? loc.type === t : t === (parent ? 'shelf' : 'humidor') }, TYPE_WORDS[t]); }));
      var howMany = 1;
      var msg = h('p', { class: 'error' });
      var close = sheet(loc ? 'Rename ' + loc.name : parent ? 'Add inside ' + parent.name : 'Add a place', h('div', {},
        field('Name', name), field('Type', type),
        !loc ? field('How many? (several are numbered: Shelf 1, Shelf 2…)', stepper(1, function (v) { howMany = Math.max(1, Math.min(40, v || 1)); })) : null,
        msg, h('button', { class: 'btn primary wide', type: 'button', onclick: async function () {
          var base = name.value.trim();
          if (!base) { msg.textContent = 'Give it a name.'; return; }
          try {
            if (loc) await rpc('retail_location_save', { p_store: state.store.id, p_id: loc.id, p_parent: loc.parent_location_id, p_name: base, p_type: type.value, p_sort: loc.sort_order });
            else for (var i = 1; i <= howMany; i++) await rpc('retail_location_save', { p_store: state.store.id, p_id: null, p_parent: parent ? parent.id : null, p_name: howMany > 1 ? base.replace(/\s*\d+$/, '') + ' ' + i : base, p_type: type.value, p_sort: null });
            close();
            forget();
            route();
          } catch (e) { msg.textContent = errorText(e); }
        } }, 'Save')));
    }
    async function moveBy(loc, dir) {
      var sibs = childrenOf(d, loc.parent_location_id);
      var i = sibs.indexOf(loc);
      var j = i + dir;
      if (j < 0 || j >= sibs.length) return;
      var a = sibs[i];
      var b = sibs[j];
      await rpc('retail_location_save', { p_store: state.store.id, p_id: a.id, p_parent: a.parent_location_id, p_name: a.name, p_type: a.type, p_sort: j });
      await rpc('retail_location_save', { p_store: state.store.id, p_id: b.id, p_parent: b.parent_location_id, p_name: b.name, p_type: b.type, p_sort: i });
      sibs.forEach(function (s, k) { if (s !== a && s !== b && s.sort_order !== k) rpc('retail_location_save', { p_store: state.store.id, p_id: s.id, p_parent: s.parent_location_id, p_name: s.name, p_type: s.type, p_sort: k }); });
      forget();
      route();
    }
    var list = walk(d).map(function (x) {
      var l = x.loc;
      var units = unitsAt(d, l.id);
      return h('div', { class: 'item indent-' + Math.min(x.depth, 4) },
        h('div', { class: 'grow' }, h('div', { class: 'name', text: l.name }), h('div', { class: 'sub' }, TYPE_WORDS[l.type] + (units ? ' · ' + n(units) + ' cigars' : ''))),
        h('button', { class: 'btn small', type: 'button', 'aria-label': 'Up', onclick: function () { moveBy(l, -1); } }, '↑'),
        h('button', { class: 'btn small', type: 'button', 'aria-label': 'Down', onclick: function () { moveBy(l, 1); } }, '↓'),
        h('button', { class: 'btn small', type: 'button', onclick: function () { edit(null, l); } }, '+ Inside'),
        h('button', { class: 'btn small', type: 'button', onclick: function () { edit(l, null); } }, 'Rename'),
        h('button', { class: 'btn small danger', type: 'button', onclick: async function () {
          if (!confirm('Remove ' + l.name + '?')) return;
          try { await rpc('retail_location_remove', { p_store: state.store.id, p_id: l.id }); forget(); route(); } catch (e) { toast(errorText(e)); }
        } }, 'Remove'));
    });
    show(h('h1', { text: 'Locations' }),
      h('p', { class: 'lead' }, 'The store\'s map: rooms and humidors, their walls and cabinets, then the shelves and drawers counted one at a time.'),
      h('div', { class: 'btns' }, h('button', { class: 'btn primary', type: 'button', onclick: function () { edit(null, null); } }, 'Add a place')),
      list.length ? h('div', { class: 'list' }, list) : h('div', { class: 'card' }, h('p', { class: 'muted' }, 'No places yet. Start with a room or humidor, then add its walls, shelves and drawers inside it.')));
  }

  // ---- products ----------------------------------------------------------------------

  async function productsView() {
    var d = await storeData(true);
    var filter = 'all';
    var q = h('input', { class: 'input', type: 'search', placeholder: 'Search brand, line, size or SKU' });
    var listEl = h('div', { class: 'list' });
    var qty = {};
    d.stock.forEach(function (i) { qty[i.product_id] = (qty[i.product_id] || 0) + i.units; });
    var seg = h('div', { class: 'seg' });
    function drawSeg() {
      seg.replaceChildren.apply(seg, [['all', 'All'], ['match', 'Needs a match'], ['cost', 'No cost'], ['price', 'No price']].map(function (o) {
        return h('button', { type: 'button', class: filter === o[0] ? 'on' : '', onclick: function () { filter = o[0]; drawSeg(); fill(); } }, o[1]);
      }));
    }
    function fill() {
      var w = S.plain(q.value).split(' ').filter(Boolean);
      var all = Object.keys(d.products).map(function (id) { return d.products[id]; }).filter(function (p) {
        if (filter === 'match' && !(p.match_status === 'possible' || p.match_status === 'unmatched')) return false;
        if (filter === 'cost' && p.cost_cents !== null) return false;
        if (filter === 'price' && p.price_cents !== null) return false;
        var hay = S.plain([p.brand, p.line, p.vitola, p.size_text, p.sku, p.upc].join(' '));
        return w.every(function (x) { return hay.indexOf(x) >= 0; });
      });
      listEl.replaceChildren.apply(listEl, all.length ? all.slice(0, 300).map(function (p) {
        var st = p.match_status === 'matched' || p.match_status === 'confirmed' ? chip('Catalogue', 'good') : p.match_status === 'possible' ? chip('Possible match', 'warn') : chip('Not matched');
        return h('div', { class: 'item tap', onclick: function () { productSheet(d, p); } },
          h('div', { class: 'grow' }, h('div', { class: 'name', text: productName(p) + (p.active ? '' : ' (inactive)') }), h('div', { class: 'sub', text: [productDetail(p), p.cost_cents !== null ? 'cost ' + money(p.cost_cents, true) : '', p.price_cents !== null ? 'price ' + money(p.price_cents, true) : ''].filter(Boolean).join(' · ') })),
          st, h('div', { class: 'qty', text: n(qty[p.id] || 0) }));
      }).concat(all.length > 300 ? [h('div', { class: 'item muted' }, 'Showing 300 of ' + n(all.length) + '. Search to narrow.')] : []) : [h('div', { class: 'item muted' }, 'No products.')]);
    }
    q.addEventListener('input', fill);
    drawSeg();
    fill();
    show(h('h1', { text: 'Products' }), h('p', { class: 'lead' }, n(Object.keys(d.products).length) + ' products. Each is tied to Cigar Locker\'s catalogue when it is matched, so scans can recognise it.'),
      h('div', { class: 'btns' }, h('button', { class: 'btn primary', type: 'button', onclick: function () { productSheet(d, null); } }, 'Add a product'), h('a', { class: 'btn', href: '#/s/' + state.store.id + '/import' }, 'Import a spreadsheet')),
      q, h('div', { style: { height: '10px' } }), seg, h('div', { style: { height: '10px' } }), listEl);
  }

  function productSheet(d, p) {
    var v = p || { brand: '', line: '', vitola: '', size_text: '', sku: '', upc: '', cost_cents: null, price_cents: null, box_count: null, active: true, match_status: 'unmatched' };
    var picked = null;
    var brand = h('input', { class: 'input', value: v.brand });
    var line = h('input', { class: 'input', value: v.line });
    var vitola = h('input', { class: 'input', value: v.vitola });
    var size = h('input', { class: 'input', value: v.size_text || (v.length_in && v.ring ? v.length_in + ' x ' + v.ring : ''), placeholder: '6 x 52' });
    var sku = h('input', { class: 'input', value: v.sku });
    var upc = h('input', { class: 'input', value: v.upc, inputmode: 'numeric' });
    var cost = h('input', { class: 'input', value: v.cost_cents !== null ? (v.cost_cents / 100).toFixed(2) : '', inputmode: 'decimal', placeholder: 'per cigar' });
    var price = h('input', { class: 'input', value: v.price_cents !== null ? (v.price_cents / 100).toFixed(2) : '', inputmode: 'decimal', placeholder: 'per cigar' });
    var box = h('input', { class: 'input', value: v.box_count || '', inputmode: 'numeric' });
    var leaf = {};
    ['wrapper', 'binder', 'filler', 'country', 'strength', 'box_config', 'supplier_name'].forEach(function (k) { leaf[k] = h('input', { class: 'input', value: v[k] || '' }); });
    leaf.box_config.placeholder = 'e.g. 25-count box, 5-pack';
    var active = h('input', { type: 'checkbox', checked: v.active !== false });
    var matchLine = h('p', { class: 'small' }, v.match_status === 'matched' || v.match_status === 'confirmed' ? 'Matched to the catalogue.' : 'Not matched to the catalogue yet.');
    var results = h('div', { class: 'list' });
    var search = h('input', { class: 'input', type: 'search', placeholder: 'Search the catalogue: brand and line' });
    var msg = h('p', { class: 'error' });
    async function find() {
      if (search.value.trim().length < 2) return;
      results.replaceChildren(busy('Searching'));
      try {
        var r = await retailFn({ action: 'catalog-search', store: state.store.id, q: search.value.trim() });
        results.replaceChildren.apply(results, r.results.length ? r.results.slice(0, 40).map(function (c) {
          return h('div', { class: 'item tap', onclick: function () {
            picked = c;
            brand.value = c.brand; line.value = c.line; if (c.vitola) vitola.value = c.vitola;
            if (c.lengthIn && c.ring) size.value = c.lengthIn + ' x ' + c.ring;
            matchLine.textContent = 'Will be matched to: ' + [c.brand, c.line, c.vitola].filter(Boolean).join(' ');
            results.replaceChildren();
          } }, h('div', { class: 'grow' }, h('div', { class: 'name', text: [c.brand, c.line, c.vitola].filter(Boolean).join(' ') }), h('div', { class: 'sub', text: c.lengthIn ? c.lengthIn + ' x ' + c.ring : '' })));
        }) : [h('div', { class: 'item muted' }, 'Nothing found. Keep it as written; it is counted all the same.')]);
      } catch (e) { results.replaceChildren(h('p', { class: 'error', text: errorText(e) })); }
    }
    search.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); find(); } });
    // Its barcodes (009): each in use with how it comes, checked or not, its scans; retired ones and corrections kept.
    var codesBox = h('div', { class: 'field' }, h('span', {}, 'Barcodes'), busy('Reading its barcodes'));
    var UNIT_SAYS = { single: 'on one cigar', box: 'on a box', pack: 'on a pack', unknown: 'package not said' };
    var SOURCE_SAYS = { register: 'linked at the register', shared: 'known at other shops', labeling: 'labeling boxes', scan: 'labeling boxes', product: 'typed on the product' };
    async function loadCodes() {
      var r;
      try { r = await rpc('retail_product_codes', { p_store: state.store.id, p_product: p.id }); }
      catch (e) { codesBox.replaceChildren(h('span', {}, 'Barcodes'), h('p', { class: 'error', text: errorText(e) })); return; }
      var rows = r.codes.map(function (c) {
        var says = UNIT_SAYS[c.unit] + (c.unitQuantity && c.unit !== 'single' ? ' of ' + c.unitQuantity : '');
        var sub = c.active
          ? [c.verified ? 'Checked' + (c.verifiedBy ? ' by ' + c.verifiedBy : '') : 'Not checked yet', n(c.scans) + (c.scans === 1 ? ' scan' : ' scans'),
             c.lastUsedAt ? 'last ' + day(c.lastUsedAt) : '', SOURCE_SAYS[c.source] || c.source].filter(Boolean).join(' · ')
          : 'Retired ' + day(c.retiredAt) + ' · ' + n(c.scans) + (c.scans === 1 ? ' scan' : ' scans');
        return h('div', { class: 'item' + (c.active ? '' : ' muted') }, h('div', { class: 'grow' }, h('div', { class: 'name', text: c.code + ' · ' + says }), h('div', { class: 'sub', text: sub })),
          c.active && can('manager') && !c.verified ? h('button', { class: 'btn small', type: 'button', onclick: async function () {
            try { await rpc('retail_code_verify', { p_store: state.store.id, p_identifier: c.id }); loadCodes(); } catch (e) { toast(errorText(e)); }
          } }, 'It is right') : null,
          c.active && can('manager') ? h('button', { class: 'btn small quiet', type: 'button', onclick: async function () {
            var why = prompt('Retire ' + c.code + '? It stops finding this cigar (kept in the history). Why?', '');
            if (why === null) return;
            try { await rpc('retail_code_retire', { p_store: state.store.id, p_identifier: c.id, p_note: why }); loadCodes(); } catch (e) { toast(errorText(e)); }
          } }, 'Retire') : null);
      });
      var fixes = r.corrections.map(function (c) {
        return h('div', { class: 'item muted' }, h('div', { class: 'grow' }, h('div', { class: 'sub', text: day(c.at) + ' · ' + c.code + ' · '
          + (c.to ? (c.from === c.to ? 'changed to ' + UNIT_SAYS[c.toUnit] : 'moved from ' + (c.fromName || 'another cigar') + ' to ' + (c.toName || 'another cigar')) : 'retired')
          + (c.by ? ' by ' + c.by : '') + (c.note ? ' · ' + c.note : '') })));
      });
      codesBox.replaceChildren.apply(codesBox, [h('span', {}, 'Barcodes'),
        rows.length ? h('div', { class: 'list' }, rows) : h('p', { class: 'muted small' }, 'None yet. Scan one at the register: an unknown barcode is linked there in a tap.'),
        fixes.length ? h('p', { class: 'over' }, 'Corrections') : null, fixes.length ? h('div', { class: 'list' }, fixes) : null].filter(Boolean));
    }
    if (p) loadCodes();
    var close = sheet(p ? productName(p) : 'Add a product', h('div', {},
      h('div', { class: 'row-fields' }, field('Brand', brand), field('Line', line), field('Size name', vitola), field('Size', size)),
      h('div', { class: 'row-fields' }, field('Cost per cigar, $', cost), field('Retail price per cigar, $', price), field('Cigars per box', box)),
      h('div', { class: 'row-fields' }, field('SKU', sku), field('UPC / barcode', upc)),
      p ? codesBox : null,
      h('div', { class: 'row-fields' }, field('Wrapper', leaf.wrapper), field('Binder', leaf.binder), field('Filler', leaf.filler)),
      h('div', { class: 'row-fields' }, field('Country', leaf.country), field('Strength', leaf.strength), field('How it comes', leaf.box_config), field('Supplier', leaf.supplier_name)),
      h('label', { class: 'field', style: { display: 'flex', gap: '10px', alignItems: 'center' } }, active, h('span', { style: { margin: 0 } }, 'Active (counted and listed)')),
      h('h3', { text: 'Catalogue match' }), matchLine, h('div', { class: 'btns' }, search, h('button', { class: 'btn', type: 'button', onclick: find }, 'Search')), results,
      msg, h('button', { class: 'btn primary wide', type: 'button', onclick: async function () {
        var sz = S.size(size.value);
        var body = {
          id: p ? p.id : '', brand: brand.value.trim(), line: line.value.trim(), vitola: vitola.value.trim(), size_text: size.value.trim(),
          length_in: sz ? String(sz.lengthIn) : '', ring: sz ? String(sz.ring) : '', sku: sku.value.trim(), upc: upc.value.trim(),
          cost_cents: S.cents(cost.value) === null ? '' : String(S.cents(cost.value)), price_cents: S.cents(price.value) === null ? '' : String(S.cents(price.value)),
          box_count: box.value.trim(), active: active.checked,
        };
        Object.keys(leaf).forEach(function (k) { body[k] = leaf[k].value.trim(); });
        if (picked) { body.cigar_id = picked.cigarId; body.line_key = picked.lineKey; body.match_status = 'confirmed'; }
        try { await rpc('retail_product_save', { p_store: state.store.id, p: body }); close(); forget(); route(); } catch (e) { msg.textContent = errorText(e); }
      } }, 'Save')));
  }

  // ---- import --------------------------------------------------------------------------

  async function importView() {
    var d = await storeData(true);
    var st = { step: 'file' };
    var stage = h('div');
    var fileIn = h('input', { type: 'file', accept: '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', hidden: true, onchange: function () { readFile(fileIn.files[0]); fileIn.value = ''; } });

    async function readFile(file) {
      if (!file) return;
      st.error = '';
      try {
        var rowsIn = /\.xlsx$/i.test(file.name) ? await S.readXLSX(await file.arrayBuffer()) : /\.xls$/i.test(file.name) ? null : S.parseCSV(await file.text());
        if (!rowsIn) throw new Error('Save it as .xlsx or .csv first (an old .xls cannot be read).');
        if (rowsIn.length < 2) throw new Error('That file has no rows to bring in.');
        st.file = file.name;
        st.rows = rowsIn;
        st.header = S.headerRow(rowsIn);
        st.headers = rowsIn[st.header].map(function (x, i) { return String(x || 'Column ' + (i + 1)); });
        st.signature = S.signature(st.headers);
        var saved = (await sb.from('store_import_mappings').select('mapping').eq('store_id', state.store.id).eq('signature', st.signature).maybeSingle()).data;
        st.mapping = saved ? saved.mapping : S.guessMapping(st.headers);
        st.fromSaved = !!saved;
        st.opts = { costPer: 'cigar', pricePer: 'cigar' };
        st.step = 'map';
      } catch (e) { st.error = errorText(e); }
      draw();
    }

    function mapStep() {
      var fields = S.FIELDS.map(function (f) {
        var sel = h('select', { class: 'input', onchange: function () { if (sel.value === '') delete st.mapping[f.key]; else st.mapping[f.key] = Number(sel.value); draw(); } },
          h('option', { value: '' }, '—'), st.headers.map(function (hd, i) { return h('option', { value: String(i), selected: st.mapping[f.key] === i }, hd); }));
        return field(f.label, sel);
      });
      var recs = S.records(st.rows, st.header, st.mapping, st.opts).filter(function (r) { return !S.isTotalRow(r); });
      var preview = recs.slice(0, 6);
      var def = h('select', { class: 'input', onchange: function () { st.defaultLocation = def.value; } }, h('option', { value: '' }, 'Choose a place…'),
        walk(d).map(function (x) { return h('option', { value: x.loc.id, selected: st.defaultLocation === x.loc.id }, ' '.repeat(x.depth * 3) + x.loc.name); }));
      var perSeg = function (key, label) {
        return h('div', { class: 'field' }, h('span', { style: { display: 'block', fontWeight: 650, marginBottom: '6px' } }, label),
          h('div', { class: 'seg' }, ['cigar', 'box'].map(function (o) { return h('button', { type: 'button', class: st.opts[key] === o ? 'on' : '', onclick: function () { st.opts[key] = o; draw(); } }, 'per ' + o); })));
      };
      return [
        h('h2', { text: st.file + ' · ' + n(recs.length) + ' rows' }),
        st.fromSaved ? h('p', { class: 'ok' }, 'This layout was brought in before: its column choices are filled in.') : h('p', { class: 'muted' }, 'Check which column holds what. The choices are kept for the next spreadsheet laid out the same way.'),
        h('div', { class: 'card' }, h('div', { class: 'row-fields' }, fields), h('div', { class: 'row-fields' }, perSeg('costPer', 'Cost is'), perSeg('pricePer', 'Retail price is'))),
        st.mapping.location == null ? h('div', { class: 'card' }, field('No location column: put every row in', def), h('p', { class: 'muted small' }, 'Or leave it and add the stock to places later; products are made either way.')) : null,
        h('h3', { text: 'The first rows, as read' }),
        h('div', { class: 'scroll-x' }, h('table', { class: 'table' }, h('tr', {}, ['Brand', 'Line', 'Name', 'Size', 'Qty', 'Cost', 'Price', 'Location'].map(function (t) { return h('th', { text: t }); })),
          preview.map(function (r) {
            return h('tr', {}, [r.brand, r.line, r.name, [r.vitola, r.length_in && r.ring ? r.length_in + ' x ' + r.ring : r.size_text].filter(Boolean).join(' '), r.quantity === null ? '' : n(r.quantity),
              r.cost_cents === null ? '' : money(r.cost_cents, true), r.price_cents === null ? '' : money(r.price_cents, true), r.location].map(function (t) { return h('td', { text: t || '' }); }));
          }))),
        h('button', { class: 'btn primary big wide', type: 'button', disabled: st.mapping.brand == null && st.mapping.name == null, onclick: function () { match(recs); } },
          st.mapping.brand == null && st.mapping.name == null ? 'Choose the brand or full-name column first' : 'Match ' + n(recs.length) + ' rows to the catalogue'),
      ];
    }

    async function match(recs) {
      st.step = 'matching';
      draw();
      try {
        var out = [];
        for (var i = 0; i < recs.length; i += 400) {
          var chunk = recs.slice(i, i + 400);
          var r = await retailFn({ action: 'match', store: state.store.id, rows: chunk.map(function (x) { return { brand: x.brand, line: x.line, name: x.name, vitola: x.vitola, lengthIn: x.length_in, ring: x.ring }; }) });
          out = out.concat(r.results);
          st.progress = Math.min(recs.length, i + 400);
          draw();
        }
        st.recs = recs.map(function (rec, k) {
          var m = out[k];
          return { rec: rec, m: m, choice: m.status === 'matched' ? m.best : null, decided: m.status !== 'possible' };
        });
        st.view = 'possible';
        st.step = 'review';
      } catch (e) { st.error = errorText(e); st.step = 'map'; }
      draw();
    }

    function reviewStep() {
      var counts = { matched: 0, possible: 0, unmatched: 0 };
      st.recs.forEach(function (x) { counts[x.m.status] += 1; });
      var seg = h('div', { class: 'seg' }, [['possible', 'Possible match'], ['matched', 'Matched'], ['unmatched', 'No match']].map(function (o) {
        return h('button', { type: 'button', class: st.view === o[0] ? 'on' : '', onclick: function () { st.view = o[0]; draw(); } }, o[1] + ' (' + n(counts[o[0]]) + ')');
      }));
      var shown = st.recs.filter(function (x) { return x.m.status === st.view; }).slice(0, 200);
      var undecided = st.recs.filter(function (x) { return x.m.status === 'possible' && !x.decided; }).length;
      var cards = shown.map(function (x) {
        var r = x.rec;
        var written = r.name || [r.brand, r.line].filter(Boolean).join(' ');
        var rowWords = [written, r.vitola, r.size_text].filter(Boolean).join(' · ') + (r.quantity !== null ? ' · qty ' + n(r.quantity) : '');
        var label = function (c) { return [c.brand, c.line, c.vitola].filter(Boolean).join(' ') + (c.lengthIn ? ' (' + c.lengthIn + ' x ' + c.ring + ')' : ''); };
        var body = [h('div', { class: 'name', text: 'Row ' + r.n + ': ' + rowWords })];
        if (x.m.status === 'matched') {
          body.push(h('p', { class: 'ok small', text: '→ ' + label(x.m.best) }));
        } else if (x.m.status === 'possible') {
          body.push(h('p', { class: 'muted small', text: x.m.why }));
          var opts = x.m.candidates.length ? x.m.candidates : x.m.best ? [x.m.best] : [];
          body.push(h('div', { class: 'btns' }, opts.slice(0, 8).map(function (c) {
            var on = x.decided && x.choice && x.choice.cigarId === c.cigarId;
            return h('button', { type: 'button', class: 'btn small' + (on ? ' brand' : ''), onclick: function () { x.choice = c; x.decided = true; draw(); } }, label(c));
          }), h('button', { type: 'button', class: 'btn small' + (x.decided && !x.choice ? ' brand' : ''), onclick: function () { x.choice = null; x.decided = true; draw(); } }, 'Keep as written')));
        } else {
          body.push(h('p', { class: 'muted small', text: x.m.why }));
        }
        return h('div', { class: 'line-card' + (x.decided ? ' done' : '') }, body);
      });
      return [
        h('h2', { text: 'Check the matches' }),
        h('p', { class: 'muted' }, 'Matched rows found their line and size. A possible match is never taken without your choice: pick the right one, or keep the row as written (it is imported and counted all the same, and can be matched later under Products).'),
        seg, h('div', { style: { height: '12px' } }),
        st.view === 'possible' && undecided ? h('div', { class: 'btns' }, h('button', { class: 'btn', type: 'button', onclick: function () {
          if (!confirm('Accept the first suggestion for all ' + undecided + ' undecided rows? Check a few first.')) return;
          st.recs.forEach(function (x) { if (x.m.status === 'possible' && !x.decided && x.m.best && x.m.best.vitola) { x.choice = x.m.best; x.decided = true; } });
          draw();
        } }, 'Accept every first suggestion'), h('button', { class: 'btn', type: 'button', onclick: function () {
          st.recs.forEach(function (x) { if (x.m.status === 'possible' && !x.decided) { x.choice = null; x.decided = true; } });
          draw();
        } }, 'Keep the rest as written')) : null,
        cards.length ? cards : h('p', { class: 'muted' }, 'None.'),
        shown.length === 200 ? h('p', { class: 'muted' }, 'Showing 200. The rest follow the same choices you make here once decided.') : null,
        h('div', { class: 'card' }, h('p', {}, n(counts.matched) + ' matched · ' + n(counts.possible) + ' possible (' + n(undecided) + ' undecided) · ' + n(counts.unmatched) + ' no match'),
          h('button', { class: 'btn primary big wide', type: 'button', disabled: undecided > 0, onclick: apply }, undecided ? 'Decide the ' + n(undecided) + ' possible matches first' : 'Bring in ' + n(st.recs.length) + ' rows')),
      ];
    }

    async function apply() {
      st.step = 'applying';
      draw();
      var payloadRows = st.recs.map(function (x) {
        var r = x.rec;
        var c = x.choice;
        var parted = x.m.parted;
        return {
          n: r.n, original: r.original,
          brand: c ? c.brand : parted ? parted.brand : r.brand,
          line: c ? c.line : parted ? parted.line : r.line,
          vitola: c && c.vitola ? c.vitola : r.vitola,
          size_text: r.size_text, length_in: c && c.lengthIn ? c.lengthIn : r.length_in, ring: c && c.ring ? c.ring : r.ring,
          quantity: r.quantity, cost_cents: r.cost_cents, price_cents: r.price_cents, sku: r.sku, upc: r.upc, box_count: r.box_count, location: r.location,
          cigar_id: c ? c.cigarId : null, line_key: c ? c.lineKey : x.m.best ? x.m.best.lineKey : null,
          match_status: c ? (x.m.status === 'matched' ? 'matched' : 'confirmed') : x.m.status === 'possible' ? 'possible' : 'unmatched',
        };
      });
      try {
        st.result = await rpc('retail_import_apply', { p_store: state.store.id, p: { file_name: st.file, signature: st.signature, mapping: st.mapping, default_location: st.defaultLocation || null, save_mapping: true, rows: payloadRows } });
        forget();
        st.step = 'done';
      } catch (e) { st.error = errorText(e); st.step = 'review'; }
      draw();
    }

    function draw() {
      var body = [];
      if (st.error) body.push(h('p', { class: 'error', text: st.error }));
      if (st.step === 'file') {
        body.push(h('div', { class: 'card' }, h('h2', { style: { marginTop: 0 } }, 'Bring in the inventory spreadsheet'),
          h('p', { class: 'muted' }, 'Excel (.xlsx) or CSV. Any layout: you choose which column is which, once. Every row is kept as it was, for the record.'),
          h('button', { class: 'btn primary big', type: 'button', onclick: function () { fileIn.click(); } }, 'Choose the file')));
      } else if (st.step === 'map') body.push(mapStep());
      else if (st.step === 'matching') body.push(h('div', { class: 'card' }, busy('Matching against Cigar Locker\'s catalogue' + (st.progress ? ' · ' + n(st.progress) + ' rows' : ''))));
      else if (st.step === 'review') body.push(reviewStep());
      else if (st.step === 'applying') body.push(h('div', { class: 'card' }, busy('Bringing in ' + n(st.recs.length) + ' rows')));
      else if (st.step === 'done') {
        var r = st.result;
        body.push(h('div', { class: 'card' }, h('h2', { style: { marginTop: 0 } }, 'Brought in'),
          h('div', { class: 'tiles' },
            h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Rows'), h('div', { class: 'figure' }, n(r.rows))),
            h('div', { class: 'tile' }, h('div', { class: 'label' }, 'New products'), h('div', { class: 'figure' }, n(r.new))),
            h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Existing products'), h('div', { class: 'figure' }, n(r.matched))),
            h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Cigars recorded'), h('div', { class: 'figure' }, n(r.units)))),
          h('div', { class: 'btns' }, h('a', { class: 'btn primary', href: '#/s/' + state.store.id + '/inventory' }, 'See the inventory'), h('a', { class: 'btn', href: '#/s/' + state.store.id + '/products' }, 'Products'))));
      }
      fill(stage, body);
    }
    show(h('h1', { text: 'Import' }), stage, fileIn);
    draw();
  }

  // ---- receiving ------------------------------------------------------------------------

  async function receiveLoose(d, seg) {
    var product = null;
    var qty = 0;
    var where = h('select', { class: 'input' }, walk(d).map(function (x) { return h('option', { value: x.loc.id, selected: state.receiveAt === x.loc.id }, ' '.repeat(x.depth * 3) + x.loc.name); }));
    where.addEventListener('change', function () { state.receiveAt = where.value; });
    var cost = h('input', { class: 'input', inputmode: 'decimal', placeholder: 'per cigar (optional)' });
    var note = h('input', { class: 'input', placeholder: 'optional' });
    var del = deliveryFields();
    var chosen = h('div', { class: 'card flat' }, h('p', { class: 'muted' }, 'No product chosen.'));
    var msg = h('p', { class: 'error' });
    var qtyBox = stepper(0, function (v) { qty = v || 0; });
    function pick(p) {
      product = p;
      chosen.replaceChildren(h('div', { class: 'name', style: { fontWeight: 700 } }, productName(p)), h('div', { class: 'muted small', text: productDetail(p) }));
      if (p.cost_cents !== null && !cost.value) cost.value = (p.cost_cents / 100).toFixed(2);
    }
    var recent = (await sb.from('store_inventory_events').select('product_id,location_id,change,at').eq('store_id', state.store.id).eq('kind', 'received').order('at', { ascending: false }).limit(15)).data || [];
    var q = h('input', { class: 'input', type: 'search', placeholder: 'Find the product: brand, line, size or SKU' });
    var results = h('div', { class: 'list' });
    q.addEventListener('input', function () {
      var w = S.plain(q.value).split(' ').filter(Boolean);
      if (!w.length) return results.replaceChildren();
      var all = Object.keys(d.products).map(function (id) { return d.products[id]; }).filter(function (p) {
        var hay = S.plain([p.brand, p.line, p.vitola, p.size_text, p.sku, p.upc].join(' '));
        return p.active && w.every(function (x) { return hay.indexOf(x) >= 0; });
      }).slice(0, 12);
      results.replaceChildren.apply(results, all.map(function (p) { return h('div', { class: 'item tap', onclick: function () { pick(p); results.replaceChildren(); q.value = ''; } }, h('div', { class: 'grow' }, h('div', { class: 'name', text: productName(p) }), h('div', { class: 'sub', text: productDetail(p) }))); }));
    });
    show(h('h1', { text: 'Receive inventory' }), h('p', { class: 'lead' }, 'Loose cigars coming in, not in a box: the product, how many, what they cost and where they go.'),
      seg, h('div', { style: { height: '12px' } }),
      h('div', { class: 'card' }, field('Product', q), results, chosen,
        h('div', { class: 'row-fields' }, field('How many cigars', qtyBox), field('Cost per cigar, $', cost)), field('Put them in', where), del.node, field('Note', note), msg,
        h('button', { class: 'btn primary big wide', type: 'button', onclick: async function (ev) {
          if (!product) { msg.textContent = 'Choose the product.'; return; }
          if (!qty) { msg.textContent = 'How many came in?'; return; }
          ev.target.disabled = true;
          try {
            var rc = await del.receipt();
            if (rc) await rpc('retail_receive_on', { p_store: state.store.id, p_receipt: rc, p_product: product.id, p_location: where.value, p_quantity: qty, p_cost_cents: S.cents(cost.value), p_note: note.value });
            else await rpc('retail_receive', { p_store: state.store.id, p_product: product.id, p_location: where.value, p_quantity: qty, p_cost_cents: S.cents(cost.value), p_note: note.value });
            toast('Received ' + n(qty) + ' ' + productName(product) + '.');
            forget();
            route();
          } catch (e) { msg.textContent = errorText(e); ev.target.disabled = false; }
        } }, 'Receive')),
      recent.length ? h('h2', { text: 'Received lately' }) : null,
      recent.length ? h('div', { class: 'list' }, recent.map(function (r) {
        return h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'name', text: productName(d.products[r.product_id]) }), h('div', { class: 'sub', text: day(r.at) + ' · ' + pathOf(d, r.location_id) })), h('div', { class: 'qty', text: '+' + n(r.change) }));
      })) : null);
  }

  // ---- boxes: Kings, Queens and their labels -----------------------------------------------
  //
  // A box is one physical box for life, named by its Cigar Locker code (its
  // QR label holds that code and nothing else). Sealed it is a King (verified
  // by a scan, not counted), open a Queen (its cigars counted). Factory codes
  // say what product a box is, never which box: a code this store has not
  // confirmed is only ever a possible match, chosen by a person.

  var KIND_WORDS = { sealed: 'King · sealed', open: 'Queen · open', empty: 'Empty', damaged: 'Damaged', missing: 'Missing', archived: 'Archived' };
  var KIND_TONE = { sealed: 'info', open: 'warn', empty: '', damaged: 'bad', missing: 'bad', archived: '' };
  function boxChip(state) {
    return chip(KIND_WORDS[state] || state, KIND_TONE[state] || '');
  }
  function boxUnits(b) {
    return b.state === 'sealed' ? b.original_quantity : b.state === 'open' ? b.remaining_quantity : 0;
  }
  /** "2 Kings · Queen of 19 · 3 loose" for a product at a place. */
  function stockWords(s) {
    var parts = [];
    if (s.kings) parts.push(s.kings + (s.kings === 1 ? ' King' : ' Kings') + ' (' + n(s.king_units) + ')');
    if (s.queens) parts.push(s.queens + (s.queens === 1 ? ' Queen' : ' Queens') + ' (' + n(s.queen_units) + ')');
    if (s.loose_units) parts.push(n(s.loose_units) + ' loose');
    return parts.join(' · ');
  }
  function placeSelect(d, chosen, opts) {
    var o = opts || {};
    var sel = h('select', { class: 'input' }, o.none ? h('option', { value: '' }, o.none) : null,
      walk(d).map(function (x) { return h('option', { value: x.loc.id, selected: chosen === x.loc.id }, ' '.repeat(x.depth * 3) + x.loc.name); }));
    return sel;
  }

  // The labels waiting to be printed, kept in this browser per store, so a
  // reload loses none.
  function queueKey() {
    return 'cl-retail-labels:' + state.store.id;
  }
  function labelQueue() {
    try {
      var v = JSON.parse(localStorage.getItem(queueKey()) || '[]');
      return Array.isArray(v) ? v : [];
    } catch (e) {
      return [];
    }
  }
  function setLabelQueue(list) {
    try {
      localStorage.setItem(queueKey(), JSON.stringify(list.slice(0, 2000)));
    } catch (e) {
      /* private browsing: the list lives as long as the page */
    }
    state.labelsMemo = list;
  }
  function queueLabels(boxes, name) {
    var have = {};
    var q = labelQueue();
    q.forEach(function (x) { have[x.code] = true; });
    boxes.forEach(function (b) { if (!have[b.code]) q.push({ kind: 'box', id: b.id, code: b.code, name: name }); });
    setLabelQueue(q);
    return q.length;
  }

  /** A QR of a box code, drawn as SVG elements (no markup strings). */
  function qrNode(code) {
    var NS = 'http://www.w3.org/2000/svg';
    var m = self.toQR(code, 3);
    var side = Codes.sideOf(m);
    var all = side + 8;
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + all + ' ' + all);
    svg.setAttribute('shape-rendering', 'crispEdges');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'QR code ' + code);
    var bg = document.createElementNS(NS, 'rect');
    bg.setAttribute('width', all);
    bg.setAttribute('height', all);
    bg.setAttribute('fill', '#fff');
    var path = document.createElementNS(NS, 'path');
    path.setAttribute('transform', 'translate(4 4)');
    path.setAttribute('fill', '#000');
    path.setAttribute('d', Codes.qrPath(m));
    svg.append(bg, path);
    return svg;
  }
  /** One label, by template: a box's ('box'), one cigar's ('unit'), or one cigar's as a paper band ('collar'). */
  function labelNode(l, template) {
    if (template === 'unit' || template === 'collar') {
      var words = h('div', { class: 'lbl-words' }, h('div', { class: 'lbl-name' }, l.name || ''),
        h('div', { class: 'lbl-meta' }, l.price ? h('b', {}, l.price) : null, h('span', {}, l.code)));
      return h('div', { class: 'lbl ' + template }, h('div', { class: 'lbl-qr' }, qrNode(l.code)), words,
        template === 'collar' ? h('div', { class: 'lbl-wrap' }, 'wrap beside the band · tape paper to paper') : null);
    }
    return h('div', { class: 'lbl' }, h('div', { class: 'lbl-qr' }, qrNode(l.code)),
      h('div', { class: 'lbl-words' }, h('div', { class: 'lbl-brand' }, 'CIGAR LOCKER'), h('div', { class: 'lbl-code' }, l.code),
        h('div', { class: 'lbl-name' }, l.kind === 'blank' ? 'No. ' + l.no : Codes.labelName(l.name))));
  }

  /**
   * What a scanned factory code is, for this store, asked in the scanner's
   * panel when it is not plain: several of the store's products, a possible
   * match from other stores, or unknown. Never silently accepted. Answers the
   * store product (its row) or null.
   */
  async function identify(ctx, code, format, ctl) {
    var r = await rpc('retail_code_resolve', { p_store: state.store.id, p_code: code });
    if (r.kind === 'box') return { box: r };
    var type = Codes.typeOf(format, code);
    if (r.status === 'matched' && r.candidates.length === 1) return { product: ctx.d.products[r.candidates[0].id] || null, status: 'matched' };
    tone('warn');
    return await new Promise(function (resolve) {
      var body = h('div', { class: 'scan-choice' });
      function done(v) { resolve(v); }
      async function learn(productId, boxCount) {
        await rpc('retail_code_confirm', { p_store: state.store.id, p_code: code, p_product: productId, p_type: type, p_box_quantity: boxCount || null, p_source: 'scan' });
        ctx.d = await storeData(true);
        return ctx.d.products[productId];
      }
      async function makeProduct(fields) {
        var pid = await rpc('retail_product_save', { p_store: state.store.id, p: fields });
        return pid;
      }
      function drawUnknown(words) {
        var q = h('input', { class: 'input', type: 'search', placeholder: 'Brand, line or size' });
        var list = h('div', { class: 'list' });
        var cat = h('div', { class: 'list' });
        var msg = h('p', { class: 'error' });
        function local() {
          var w = S.plain(q.value).split(' ').filter(Boolean);
          var all = Object.keys(ctx.d.products).map(function (id) { return ctx.d.products[id]; }).filter(function (p) {
            if (!p.active) return false;
            var hay = S.plain([p.brand, p.line, p.vitola, p.size_text, p.sku].join(' '));
            return w.length && w.every(function (x) { return hay.indexOf(x) >= 0; });
          }).slice(0, 8);
          list.replaceChildren.apply(list, all.map(function (p) {
            return h('div', { class: 'item tap', onclick: async function () {
              try { done({ product: await learn(p.id, null), status: 'confirmed' }); } catch (e) { msg.textContent = errorText(e); }
            } }, h('div', { class: 'grow' }, h('div', { class: 'name', text: productName(p) }), h('div', { class: 'sub', text: productDetail(p) })), chip('This one', 'good'));
          }));
        }
        async function catalogue() {
          if (q.value.trim().length < 2) return;
          cat.replaceChildren(busy('Searching the catalogue'));
          try {
            var res = await retailFn({ action: 'catalog-search', store: state.store.id, q: q.value.trim() });
            cat.replaceChildren.apply(cat, res.results.slice(0, 12).map(function (c) {
              return h('div', { class: 'item tap', onclick: async function () {
                try {
                  var pid = await makeProduct({ brand: c.brand, line: c.line, vitola: c.vitola || '', cigar_id: c.cigarId, line_key: c.lineKey, length_in: c.lengthIn ? String(c.lengthIn) : '', ring: c.ring ? String(c.ring) : '', match_status: 'confirmed' });
                  done({ product: await learn(pid, null), status: 'new' });
                } catch (e) { msg.textContent = errorText(e); }
              } }, h('div', { class: 'grow' }, h('div', { class: 'name', text: [c.brand, c.line, c.vitola].filter(Boolean).join(' ') }), h('div', { class: 'sub', text: c.lengthIn ? c.lengthIn + ' x ' + c.ring + ' · add as a new product' : 'add as a new product' })));
            }).concat(res.results.length ? [] : [h('div', { class: 'item muted' }, 'Not in the catalogue.')]));
          } catch (e) { cat.replaceChildren(h('p', { class: 'error', text: errorText(e) })); }
        }
        q.addEventListener('input', local);
        q.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); catalogue(); } });
        body.replaceChildren(
          h('p', { class: 'over' }, words || 'Unknown code'), h('p', { class: 'scan-code' }, code),
          h('p', {}, 'Which product is this box? Find it among the store\'s products; once chosen, this code is known here.'),
          q, list, h('div', { class: 'btns' }, h('button', { class: 'btn small', type: 'button', onclick: catalogue }, 'Search the catalogue'),
            h('button', { class: 'btn small quiet', type: 'button', onclick: function () { done(null); } }, 'Skip this box')),
          cat, msg);
      }
      if (r.status === 'matched') {
        body.append(h('p', { class: 'over' }, 'Matched · which one?'), h('p', { class: 'scan-code' }, code),
          h('div', { class: 'list' }, r.candidates.map(function (c) {
            return h('div', { class: 'item tap', onclick: async function () {
              try { done({ product: await learn(c.id, null), status: 'confirmed' }); } catch (e) { toast(errorText(e)); }
            } },
              h('div', { class: 'grow' }, h('div', { class: 'name', text: c.name }), h('div', { class: 'sub', text: c.boxCount ? 'box of ' + c.boxCount : '' })));
          })), h('button', { class: 'btn small quiet', type: 'button', onclick: function () { done(null); } }, 'Skip this box'));
      } else if (r.status === 'possible') {
        var msg = h('p', { class: 'error' });
        body.append(h('p', { class: 'over warn-text' }, 'Possible match · check it'), h('p', { class: 'scan-code' }, code),
          h('p', {}, 'Other stores using Cigar Locker have confirmed this code as:'),
          h('div', { class: 'list' }, r.candidates.map(function (c) {
            return h('div', { class: 'item tap', onclick: async function () {
              try {
                var pid = c.product ? c.product.id : await makeProduct({ brand: c.brand, line: c.line, vitola: c.vitola || '', cigar_id: c.cigarId, box_count: c.boxCount ? String(c.boxCount) : '', match_status: 'confirmed' });
                done({ product: await learn(pid, c.product ? null : c.boxCount), status: 'confirmed' });
              } catch (e) { msg.textContent = errorText(e); }
            } }, h('div', { class: 'grow' }, h('div', { class: 'name', text: c.name || c.cigarId }), h('div', { class: 'sub', text: [c.boxCount ? 'box of ' + c.boxCount : '', c.stores + (c.stores === 1 ? ' store says so' : ' stores say so'), c.product ? 'in your products' : 'new to your products'].filter(Boolean).join(' · ') })),
              chip('Yes, this', 'good'));
          })), msg,
          h('div', { class: 'btns' }, h('button', { class: 'btn small', type: 'button', onclick: function () { drawUnknown('Not that · which product?'); } }, 'None of these'),
            h('button', { class: 'btn small quiet', type: 'button', onclick: function () { done(null); } }, 'Skip this box')));
      } else {
        drawUnknown();
      }
      ctl.panel(body);
    });
  }
  function tone(kind) {
    if (self.RetailScanner) self.RetailScanner.tone(kind);
  }

  /** One product's boxes: the box size and how many. Every box is made and labeled as a King first. */
  function boxesPanel(p, opts, onGo, onSkip) {
    var o = opts || {};
    var per = p.box_count || null;
    var count = 1;
    var cost = h('input', { class: 'input', inputmode: 'decimal', placeholder: p.cost_cents !== null && p.cost_cents !== undefined ? (p.cost_cents / 100).toFixed(2) : 'optional' });
    var msg = h('p', { class: 'error' });
    var go = h('button', { class: 'btn primary big wide', type: 'button' });
    function words() {
      go.textContent = (o.mode === 'received' ? 'Receive ' : 'Label ') + count + (count === 1 ? ' box' : ' boxes') + ' · ' + count + (count === 1 ? ' King label' : ' King labels');
    }
    words();
    go.addEventListener('click', async function () {
      msg.textContent = '';
      if (!per) { msg.textContent = 'How many cigars in a full box?'; return; }
      go.disabled = true;
      try {
        await onGo({ count: count, per: per, cost: S.cents(cost.value) });
      } catch (e) {
        msg.textContent = errorText(e);
        go.disabled = false;
      }
    });
    return h('div', { class: 'scan-choice' },
      h('p', { class: 'over good-text' }, o.status === 'matched' ? 'Matched' : o.status === 'new' ? 'Added to your products' : 'Confirmed'),
      h('div', { class: 'scan-product' }, productName(p)), h('div', { class: 'muted small' }, productDetail(p)),
      h('div', { class: 'row-fields' }, field('Cigars in a full box', stepper(per, function (v) { per = v || null; })),
        field('How many boxes ' + (o.mode === 'received' ? 'came in' : 'like this here'), stepper(1, function (v) { count = Math.max(1, Math.min(200, v || 1)); words(); })),
        o.mode === 'received' ? field('Cost per cigar, $', cost) : null),
      h('p', { class: 'muted small' }, 'Each box gets its own permanent label as a King (sealed). Next you say if any is already open.'),
      msg, go,
      h('button', { class: 'btn small quiet', type: 'button', onclick: onSkip }, 'Not now'));
  }

  /**
   * After the King labels are made: "Is this box currently sealed or open?"
   * Sealed stays a King. Open: MOVE TO QUEEN, the same box and label, with
   * how many cigars are in it now (its baseline), the day it was opened only
   * if the store knows it, then cigar labels for those cigars if wanted.
   */
  function sealedOrOpen(boxes, p, per, onDone) {
    var list = h('div', { class: 'list' });
    var wrap = h('div', { class: 'scan-choice' });
    var queens = 0;
    function row(b) {
      var holder = h('div', { class: 'item', style: { flexWrap: 'wrap' } });
      function draw(stateWords, extra) {
        fill(holder, [h('div', { class: 'grow' }, h('div', { class: 'name', text: b.code }), h('div', { class: 'sub', text: stateWords })), extra]);
      }
      function asKing() {
        draw('King · sealed · ' + per + ' cigars', h('button', { class: 'btn small', type: 'button', onclick: moveToQueen }, 'Move to Queen'));
      }
      function moveToQueen() {
        var count = null;
        var when = h('input', { class: 'input', type: 'date', max: new Date().toISOString().slice(0, 10) });
        var msg = h('p', { class: 'error' });
        draw('Already open', h('div', { style: { flexBasis: '100%' } },
          field('How many cigars are in this box now?', stepper(null, function (v) { count = v; })),
          field('Opened on (only if you know it)', when), msg,
          h('div', { class: 'btns' }, h('button', { class: 'btn brand', type: 'button', onclick: async function (ev) {
            if (!(count >= 1 && count <= per)) { msg.textContent = 'From 1 to ' + per + '.'; return; }
            var btn = ev.currentTarget; btn.disabled = true;
            try {
              var r = await rpc('retail_box_baseline_open', { p_store: state.store.id, p_box: b.id, p_count: count, p_opened_on: when.value || null });
              queens += 1;
              forget();
              draw('Queen · open · ' + r.box.remaining + ' of ' + per + ' · opened ' + (r.box.openedAt ? day(r.box.openedAt) : 'before tracking'),
                h('button', { class: 'btn small', type: 'button', onclick: async function (e2) {
                  var btn2 = e2.currentTarget; btn2.disabled = true;
                  try {
                    var u = await rpc('retail_box_units_make', { p_store: state.store.id, p_box: b.id, p_count: null });
                    queueUnits(u.units, u.product);
                    btn2.textContent = u.units.length + ' cigar labels to print';
                  } catch (e) { btn2.textContent = errorText(e); }
                } }, 'Print ' + r.box.remaining + ' cigar labels'));
            } catch (e) { msg.textContent = errorText(e); btn.disabled = false; }
          } }, 'Move to Queen'), h('button', { class: 'btn quiet', type: 'button', onclick: asKing }, 'It is sealed'))));
      }
      asKing();
      return holder;
    }
    boxes.forEach(function (b) { list.appendChild(row(b)); });
    fill(wrap, [
      h('p', { class: 'over good-text' }, boxes.length === 1 ? 'King label made' : boxes.length + ' King labels made'),
      h('div', { class: 'scan-product' }, productName(p)),
      h('p', {}, 'Put each label on its box (they wait on the list to print). Is any of these boxes already open?'),
      list,
      h('button', { class: 'btn primary big wide', type: 'button', onclick: function () { onDone(queens); } }, 'Done · next box'),
    ]);
    return wrap;
  }

  /**
   * The delivery's supplier and invoice or PO, both optional: filled in, the
   * boxes and cigars received are kept against that delivery (one opened the
   * first time and kept while the two stay the same).
   */
  function deliveryFields() {
    var o0 = state.delivery || {};
    var supplier = h('input', { class: 'input', placeholder: 'Distributor or maker (optional)', value: o0.supplier || '' });
    var reference = h('input', { class: 'input', placeholder: 'Invoice or PO (optional)', value: o0.reference || '' });
    return {
      node: h('div', { class: 'row-fields' }, field('Supplier', supplier), field('Invoice / PO', reference)),
      receipt: async function () {
        var sup = supplier.value.trim();
        var ref = reference.value.trim();
        if (!sup && !ref) return null;
        var cur = state.delivery;
        if (cur && cur.store === state.store.id && cur.supplier === sup && cur.reference === ref && cur.id) return cur.id;
        var r = await rpc('retail_receipt_open', { p_store: state.store.id, p_supplier: sup, p_reference: ref, p_note: '' });
        state.delivery = { store: state.store.id, supplier: sup, reference: ref, id: r.id };
        return r.id;
      },
    };
  }

  /** Pre-printed labels, or labels made as boxes are scanned: the choice, remembered, and the words for it. */
  function labelModeSeg(blank) {
    if (state.preprinted === undefined) state.preprinted = blank > 0;
    return h('div', { class: 'field' }, h('div', { class: 'seg' },
      h('button', { type: 'button', class: state.preprinted ? 'on' : '', onclick: function () { state.preprinted = true; route(); } }, 'Pre-printed labels (' + n(blank) + ' blank)'),
      h('button', { type: 'button', class: state.preprinted ? '' : 'on', onclick: function () { state.preprinted = false; route(); } }, 'Make labels as I go')),
      h('p', { class: 'muted small' }, state.preprinted
        ? 'Scan the box\'s barcode, then the blank label you stick on it: they are bound for good. Print blank labels under Labels.'
        : 'Each box scanned gets a new label, printed after.'));
  }

  /**
   * Receiving or labeling by scanning: one scanner, box after box. With
   * opts.preprinted, each box is its barcode then the blank pre-printed label
   * put on it (bound for good), then one decision: sealed or open. Without,
   * labels are made as boxes are scanned and printed after.
   */
  async function boxesByScan(mode, whereId, onEach, opts) {
    var o = opts || {};
    var ctx = { d: await storeData(true) };
    var made = 0;
    var labels = 0;
    var pending = null;
    var Scanner = self.RetailScanner;
    var hint = o.preprinted ? 'Scan the box\'s barcode, then the blank label you put on it.' : 'Point the camera at the box\'s barcode or QR code.';
    function count() {
      ctl0.tally(made + (made === 1 ? ' box ' : ' boxes ') + (mode === 'received' ? 'received' : 'labeled') + (o.preprinted ? '' : ' · ' + labels + (labels === 1 ? ' label' : ' labels') + ' to print'));
    }
    var ctl0 = Scanner.open({
      title: (o.onboarding ? 'First inventory · ' : mode === 'received' ? 'Receive boxes · ' : 'Label boxes · ') + pathOf(ctx.d, whereId),
      hint: hint,
      onClose: function () { forget(); route(); },
      onCode: async function (code, format, ctl) {
        if (Codes.unitCode(code)) return { tone: 'warn', words: 'That is one cigar\'s label. Scan the box\'s barcode.' };
        if (Codes.boxCode(code)) {
          var known = await rpc('retail_code_resolve', { p_store: state.store.id, p_code: code });
          if (known.kind === 'label') {
            if (!known.blank) return { tone: 'bad', words: 'Label No. ' + known.no + ' was voided. Use the next one.' };
            if (!o.preprinted) return { tone: 'warn', words: 'A blank pre-printed label (No. ' + known.no + '). Choose Pre-printed labels to use them.' };
            if (!pending) return { tone: 'warn', words: 'A blank label (No. ' + known.no + '). Scan the box\'s barcode first, then this label.' };
            var pp = pending;
            pending = null;
            var r0 = o.receipt && mode === 'received'
              ? await rpcOnce('retail_boxes_receive', { p_store: state.store.id, p_receipt: o.receipt, p_product: pp.p.id, p_location: whereId, p_count: 1,
                                                        p_box_quantity: pp.per, p_cost_cents: null, p_label: code })
              : await rpcOnce('retail_boxes_create', {
                p_store: state.store.id, p_product: pp.p.id, p_location: whereId, p_count: 1, p_box_quantity: pp.per,
                p_mode: mode, p_open_remaining: null, p_cost_cents: null, p_note: '', p_label: code,
              });
            made += 1;
            count();
            if (onEach) onEach(r0);
            tone('good');
            return await new Promise(function (resolve) {
              ctl.panel(kingOrQueen(r0.boxes[0], pp.p, pp.per, function (what) {
                ctl.resume();
                ctl.say(hint);
                resolve({ tone: r0.beyondList ? 'warn' : 'good',
                  words: (what === 'queen' ? 'Queen: ' : 'King: ') + productName(pp.p) + ' · ' + code + (r0.beyondList ? ' · ' + n(r0.beyondList) + ' more than the records had' : '') });
              }));
            });
          }
          return { tone: 'warn', words: known.box ? 'Already labeled: ' + code + ', ' + known.box.product.name + ', ' + known.box.path : 'That is a Cigar Locker label, not a factory code.' };
        }
        ctl.say('Looking up ' + code + '…');
        var it = await identify(ctx, code, format, ctl);
        if (!it || !it.product) {
          ctl.resume();
          return { tone: 'warn', words: 'Skipped ' + code + '.' };
        }
        var p = it.product;
        tone('good');
        if (o.preprinted) {
          if (p.box_count) {
            pending = { p: p, per: p.box_count };
            ctl.say('Now scan the blank label you put on this box.');
            return { tone: 'good', words: productName(p) + ' · ' + p.box_count + ' a box · now its label' };
          }
          return await new Promise(function (resolve) {
            var per = null;
            var m0 = h('p', { class: 'error' });
            ctl.panel(h('div', { class: 'scan-choice' }, h('p', { class: 'over good-text' }, 'Matched'), h('div', { class: 'scan-product' }, productName(p)),
              field('Cigars in a full box', stepper(null, function (v) { per = v; })), m0,
              h('div', { class: 'btns' },
                h('button', { class: 'btn primary big', type: 'button', onclick: function () {
                  if (!(per >= 1 && per <= 500)) { m0.textContent = 'How many in a full box?'; return; }
                  pending = { p: p, per: per };
                  ctl.resume();
                  ctl.say('Now scan the blank label you put on this box.');
                  resolve({ tone: 'good', words: productName(p) + ' · now its label' });
                } }, 'Next: scan its label'),
                h('button', { class: 'btn quiet', type: 'button', onclick: function () { ctl.resume(); resolve({ tone: 'warn', words: 'Skipped.' }); } }, 'Not now'))));
          });
        }
        return await new Promise(function (resolve) {
          ctl.panel(boxesPanel(p, { mode: mode, status: it.status }, async function (c) {
            var r = o.receipt && mode === 'received'
              ? await rpcOnce('retail_boxes_receive', { p_store: state.store.id, p_receipt: o.receipt, p_product: p.id, p_location: whereId, p_count: c.count,
                                                        p_box_quantity: c.per, p_cost_cents: c.cost, p_label: null })
              : await rpc('retail_boxes_create', {
                p_store: state.store.id, p_product: p.id, p_location: whereId, p_count: c.count, p_box_quantity: c.per,
                p_mode: mode, p_open_remaining: null, p_cost_cents: mode === 'received' ? c.cost : null, p_note: '',
              });
            made += r.boxes.length;
            labels = queueLabels(r.boxes, productName(p));
            count();
            if (onEach) onEach(r);
            ctl.panel(sealedOrOpen(r.boxes, p, c.per, function (queens) {
              ctl.resume();
              resolve({ tone: r.beyondList ? 'warn' : 'good',
                words: r.boxes.length + (r.boxes.length === 1 ? ' box: ' : ' boxes: ') + productName(p) + ' · ' + r.boxes.map(function (b) { return b.code; }).join(', ')
                  + (queens ? ' · ' + queens + (queens === 1 ? ' moved to Queen' : ' moved to Queens') : '')
                  + (r.beyondList ? ' · ' + n(r.beyondList) + ' cigars more than the records had here' : '') });
            }));
          }, function () {
            ctl.resume();
            resolve({ tone: 'warn', words: 'Not labeled.' });
          }));
        });
      },
    });
  }

  // ---- receiving: boxes by scanning, and loose cigars --------------------------------------

  async function receiveView() {
    var d = await storeData(true);
    var mode = state.receiveMode || 'boxes';
    var base = '#/s/' + state.store.id;
    var seg = h('div', { class: 'seg' },
      h('button', { type: 'button', class: mode === 'boxes' ? 'on' : '', onclick: function () { state.receiveMode = 'boxes'; route(); } }, 'Boxes, by barcode'),
      h('button', { type: 'button', class: mode === 'loose' ? 'on' : '', onclick: function () { state.receiveMode = 'loose'; route(); } }, 'Loose cigars'));
    if (mode === 'loose') return receiveLoose(d, seg);
    if (!d.locations.length) return show(h('h1', { text: 'Receive inventory' }), seg, h('div', { class: 'card' }, h('p', {}, 'Add the store\'s places first (Locations).')));
    var where = placeSelect(d, state.receiveAt || d.locations[0].id);
    where.addEventListener('change', function () { state.receiveAt = where.value; });
    var recent = (await sb.from('store_box_events').select('box_instance_id,store_product_id,to_location_id,at').eq('store_id', state.store.id).eq('kind', 'received').order('at', { ascending: false }).limit(40)).data || [];
    var waiting = labelQueue().length;
    var more = await rpc('retail_dashboard_more', { p_store: state.store.id });
    var del = deliveryFields();
    var deliveries = await rpc('retail_receipts', { p_store: state.store.id, p_limit: 8 }).catch(function () { return []; });
    show(h('h1', { text: 'Receive inventory' }),
      h('p', { class: 'lead' }, 'Scan each new box\'s barcode: the product is found, you say how many boxes, and each gets its own Cigar Locker label.'),
      seg, h('div', { style: { height: '12px' } }),
      h('div', { class: 'card' }, field('Put them in', where), del.node, labelModeSeg(more.blankLabels),
        h('button', { class: 'btn primary big wide', type: 'button', onclick: async function () {
          state.receiveAt = where.value;
          try {
            var rc = await del.receipt();
            boxesByScan('received', where.value, null, { preprinted: state.preprinted, receipt: rc });
          } catch (e) { toast(errorText(e)); }
        } }, 'Scan boxes'),
        h('p', { class: 'muted small' }, 'A code this store has not confirmed is never taken on its own: you choose the product once, and it is known from then on.')),
      waiting ? h('a', { class: 'btn brand wide', href: base + '/labels' }, 'Print ' + n(waiting) + (waiting === 1 ? ' label' : ' labels')) : null,
      deliveries.length ? h('h2', { text: 'Deliveries' }) : null,
      deliveries.length ? h('div', { class: 'list' }, deliveries.map(function (r) {
        return h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'name', text: (r.supplier || 'Supplier not given') + (r.reference ? ' · ' + r.reference : '') }),
          h('div', { class: 'sub', text: day(r.at) + (r.by ? ' · ' + r.by : '') + ' · ' + n(r.boxes) + (r.boxes === 1 ? ' box' : ' boxes') + ' · ' + n(r.cigars) + ' cigars' })),
          h('div', { class: 'qty', text: r.costCents ? money(r.costCents) : '' }));
      })) : null,
      recent.length ? h('h2', { text: 'Boxes received lately' }) : null,
      recent.length ? h('div', { class: 'list' }, groupRecent(recent).map(function (g) {
        return h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'name', text: productName(d.products[g.product]) }), h('div', { class: 'sub', text: day(g.at) + ' · ' + pathOf(d, g.where) })), h('div', { class: 'qty', text: '+' + n(g.boxes) }));
      })) : null);
  }
  function groupRecent(list) {
    var out = [];
    list.forEach(function (e) {
      var last = out[out.length - 1];
      if (last && last.product === e.store_product_id && last.where === e.to_location_id && Math.abs(Date.parse(last.at) - Date.parse(e.at)) < 120000) last.boxes += 1;
      else out.push({ product: e.store_product_id, where: e.to_location_id, at: e.at, boxes: 1 });
    });
    return out.slice(0, 15);
  }

  // ---- labeling the boxes already in the store ----------------------------------------------

  async function labelView() {
    var d = await storeData(true);
    var base = '#/s/' + state.store.id;
    if (!d.locations.length) return show(h('h1', { text: 'Label boxes' }), h('div', { class: 'card' }, h('p', {}, 'Add the store\'s places first (Locations).')));
    var where = placeSelect(d, state.labelAt || d.locations[0].id);
    where.addEventListener('change', function () { state.labelAt = where.value; });
    var labeled = d.boxes.length;
    var waiting = labelQueue().length;
    var more = await rpc('retail_dashboard_more', { p_store: state.store.id });
    function byHand() {
      state.labelAt = where.value;
      var q = h('input', { class: 'input', type: 'search', placeholder: 'Brand, line, size or SKU' });
      var list = h('div', { class: 'list' });
      var holder = h('div');
      function fillList() {
        var w = S.plain(q.value).split(' ').filter(Boolean);
        var all = Object.keys(d.products).map(function (id) { return d.products[id]; }).filter(function (p) {
          var hay = S.plain([p.brand, p.line, p.vitola, p.size_text, p.sku].join(' '));
          return p.active && w.every(function (x) { return hay.indexOf(x) >= 0; });
        }).slice(0, 40);
        list.replaceChildren.apply(list, all.map(function (p) {
          return h('div', { class: 'item tap', onclick: function () {
            holder.replaceChildren(boxesPanel(p, { mode: 'labeled', status: 'confirmed' }, async function (c) {
              var r = await rpc('retail_boxes_create', { p_store: state.store.id, p_product: p.id, p_location: where.value, p_count: c.count, p_box_quantity: c.per, p_mode: 'labeled', p_open_remaining: null, p_cost_cents: null, p_note: '' });
              queueLabels(r.boxes, productName(p));
              list.replaceChildren();
              holder.replaceChildren(sealedOrOpen(r.boxes, p, c.per, function () {
                close();
                toast(r.boxes.length + (r.boxes.length === 1 ? ' box labeled: ' : ' boxes labeled: ') + r.boxes.map(function (b) { return b.code; }).join(', '));
                forget();
                route();
              }));
            }, function () { holder.replaceChildren(); }));
          } }, h('div', { class: 'grow' }, h('div', { class: 'name', text: productName(p) }), h('div', { class: 'sub', text: productDetail(p) })));
        }));
      }
      q.addEventListener('input', fillList);
      fillList();
      var close = sheet('A box with no barcode', h('div', {}, q, h('div', { style: { height: '10px' } }), list, holder));
    }
    show(h('h1', { text: 'Label boxes' }),
      h('p', { class: 'lead' }, 'Give every box on the shelves its own permanent Cigar Locker label, once. Scan the box\'s barcode: it is made as a King with its label; if it is already open, Move to Queen and count what is in it. After this, an inventory is a walk with the scanner.'),
      h('div', { class: 'tiles' },
        h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Boxes labeled'), h('div', { class: 'figure' }, n(labeled))),
        h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Labels to print'), h('div', { class: 'figure' }, n(waiting)))),
      more.onboarding ? h('div', { class: 'card' }, h('p', {}, 'The first inventory is under way: label boxes place by place there, so each place can be marked complete.'),
        h('a', { class: 'btn brand', href: base + '/first' }, 'First inventory')) : null,
      h('div', { class: 'card' }, field('Labeling in', where), labelModeSeg(more.blankLabels),
        h('button', { class: 'btn primary big wide', type: 'button', onclick: function () { state.labelAt = where.value; boxesByScan('labeled', where.value, null, { preprinted: state.preprinted }); } }, 'Scan boxes here'),
        h('div', { class: 'btns' }, h('button', { class: 'btn', type: 'button', onclick: byHand }, 'A box with no barcode')),
        h('p', { class: 'muted small' }, 'Labeling moves a box\'s cigars from the spreadsheet\'s count into the box, so nothing is counted twice. Put the label where it does not cover the maker\'s codes or stamps.')),
      waiting ? h('a', { class: 'btn brand big wide', href: base + '/labels' }, 'Print ' + n(waiting) + (waiting === 1 ? ' label' : ' labels')) : null);
  }

  // ---- printing labels ----------------------------------------------------------------------
  //
  // A print job (RetailPrinters): the stock, its template, the labels. The
  // device's Print is the one printer today; a label printer's own language
  // would take the same job.

  var pageRule = null;
  function setPageSize(mediaKey) {
    var sheetEl = document.styleSheets[0];
    try {
      if (pageRule !== null) sheetEl.deleteRule(pageRule);
      pageRule = sheetEl.insertRule(Pr.pageRule(mediaKey), sheetEl.cssRules.length);
    } catch (e) {
      pageRule = null;
    }
  }
  function jobPages(j) {
    var m = Pr.MEDIA[j.media];
    var pages = [];
    Pr.place(j).forEach(function (s, i) {
      if (!pages[s.page]) pages[s.page] = h('div', { class: 'label-page lp-' + j.template, style: { width: m.page[0] + 'in', height: m.page[1] + 'in' } });
      var node = labelNode(j.labels[i], j.template);
      Object.assign(node.style, { left: s.x + 'in', top: s.y + 'in', width: m.label[0] + 'in', height: m.label[1] + 'in' });
      pages[s.page].appendChild(node);
    });
    return pages.filter(Boolean);
  }

  async function labelsView() {
    var all = labelQueue();
    var kinds = { box: all.filter(function (l) { return l.kind !== 'unit'; }), unit: all.filter(function (l) { return l.kind === 'unit'; }) };
    var kind = state.labelKind && kinds[state.labelKind].length ? state.labelKind : kinds.box.length || !kinds.unit.length ? 'box' : 'unit';
    var skip = 0;
    var pagesEl = h('div', { class: 'label-pages' });
    var area = h('div');
    function mediaKey() {
      var chosen = (state.labelMedia || {})[kind];
      return Pr.mediaFor(kind).indexOf(chosen) >= 0 ? chosen : Pr.mediaFor(kind)[0];
    }
    function draw() {
      var list = kinds[kind];
      var key = mediaKey();
      var m = Pr.MEDIA[key];
      setPageSize(key);
      var j = Pr.job(key, list, skip);
      pagesEl.replaceChildren.apply(pagesEl, jobPages(j));
      var kindSeg = h('div', { class: 'seg' }, ['box', 'unit'].map(function (k) {
        return h('button', { type: 'button', class: kind === k ? 'on' : '', onclick: function () { kind = k; state.labelKind = k; skip = 0; draw(); } },
          (k === 'box' ? 'Box labels' : 'Cigar labels') + ' (' + kinds[k].length + ')');
      }));
      var stockSeg = h('div', { class: 'seg' }, Pr.mediaFor(kind).map(function (k) {
        return h('button', { type: 'button', class: k === key ? 'on' : '', onclick: function () { state.labelMedia = Object.assign({}, state.labelMedia, (function () { var o = {}; o[kind] = k; return o; })()); skip = 0; draw(); } }, Pr.MEDIA[k].name);
      }));
      var per = m.across * m.down;
      fill(area, [
        h('div', { class: 'field' }, kindSeg),
        list.length ? h('div', { class: 'card' },
          h('p', { class: 'over' }, 'Label stock'), h('div', { class: 'field' }, stockSeg),
          per > 1 ? field('Sheet partly used? Start at label number', stepper(skip + 1, function (v) { skip = Math.max(0, Math.min(per - 1, (v || 1) - 1)); draw(); })) : null,
          h('p', { class: 'muted small' }, Pr.TEMPLATES[m.template].care),
          h('div', { class: 'btns' }, h('button', { class: 'btn primary big', type: 'button', onclick: function () {
            var batches = {};
            list.forEach(function (l) { if (l.batch) batches[l.batch] = true; });
            Object.keys(batches).forEach(function (b) { rpc('retail_label_batch_printed', { p_store: state.store.id, p_batch: b }).catch(function () {}); });
            window.print();
          } }, 'Print ' + n(list.length) + (list.length === 1 ? ' label' : ' labels')),
            h('button', { class: 'btn', type: 'button', onclick: function () {
              if (!confirm('Clear these ' + list.length + ' from the list? Do this once they are printed. They can be printed again from the box\'s page.')) return;
              setLabelQueue(all.filter(function (l) { return kind === 'unit' ? l.kind !== 'unit' : l.kind === 'unit'; }));
              route();
            } }, 'Printed: clear them')),
          h('p', { class: 'muted small' }, 'Printer: ' + Pr.PRINTERS[0].name + '. Print at 100% (actual size), no margins. On an iPad: Share, then Print.'))
          : h('p', { class: 'muted' }, kind === 'unit' ? 'No cigar labels waiting. They are made from an open box\'s page.' : 'No box labels waiting.'),
      ]);
      pagesEl.parentElement && (pagesEl.parentElement.hidden = !list.length);
    }
    var blank = await rpc('retail_labels_blank', { p_store: state.store.id, p_batch: null });
    function queueBlank(list, batch) {
      var have = {};
      var q = labelQueue();
      q.forEach(function (x) { have[x.code] = true; });
      list.forEach(function (l) { if (!have[l.code]) q.push({ kind: 'blank', code: l.code, no: l.no, batch: batch, name: '' }); });
      setLabelQueue(q);
      state.labelKind = 'box';
    }
    var howMany = 300;
    var bmsg = h('p', { class: 'error' });
    var blankCard = h('div', { class: 'card' },
      h('h2', { style: { marginTop: 0 } }, 'Pre-printed box labels'),
      h('p', {}, n(blank.blank) + ' blank, ready to put on boxes · ' + n(blank.bound) + ' on boxes.'),
      h('p', { class: 'muted small' }, 'Printed ahead, before anyone starts: each is a unique code on no box yet. Scanning a box\'s barcode and then a blank label binds the label to that box for good. Numbered on the sheet for people; the code itself holds nothing else.'),
      can('manager') ? h('div', { class: 'row-fields' }, field('How many to make', stepper(howMany, function (v) { howMany = Math.max(1, Math.min(1000, v || 1)); })),
        h('button', { class: 'btn brand', type: 'button', onclick: async function (ev) {
          var btn = ev.currentTarget;
          btn.disabled = true;
          try {
            var r = await rpc('retail_label_batch', { p_store: state.store.id, p_count: howMany });
            queueBlank(r.labels, r.batch);
            toast(n(r.labels.length) + ' blank labels made: Nos. ' + r.labels[0].no + ' to ' + r.labels[r.labels.length - 1].no + '.');
            route();
          } catch (e) { bmsg.textContent = errorText(e); btn.disabled = false; }
        } }, 'Make blank labels')) : null,
      bmsg,
      blank.batches.length ? h('div', { class: 'list' }, blank.batches.map(function (b) {
        return h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'name', text: 'Nos. ' + b.from + ' to ' + b.to }), h('div', { class: 'sub', text: day(b.at) + ' · ' + n(b.blank) + ' still blank' + (b.printed ? ' · printed' : '') })),
          b.blank ? h('button', { class: 'btn small', type: 'button', onclick: async function () {
            var r = await rpc('retail_labels_blank', { p_store: state.store.id, p_batch: b.id });
            queueBlank(r.labels, b.id);
            route();
          } }, 'Print the blank ones') : null);
      })) : null);
    show(h('div', { class: 'no-print' }, h('h1', { text: 'Labels to print' }),
      h('p', { class: 'lead' }, all.length ? 'In the order they were made. Each code holds only its own Cigar Locker code: no price, count or place.' : 'No labels waiting. Box labels come from receiving and labeling boxes; cigar labels from an open box\'s page.'),
      area, blankCard),
      h('div', { class: 'scroll-x label-preview' }, pagesEl));
    draw();
  }

  // ---- a box's page, and scanning to find one -------------------------------------------------

  var UNIT_WORDS = { available: 'On a cigar', sold: 'Sold', void: 'Void', damaged: 'Damaged', missing: 'Missing', comped: 'Comp', sample: 'Sample', gifted: 'Gift', other: 'Other' };
  var UNIT_TONE = { available: 'good', sold: '', void: '', damaged: 'bad', missing: 'bad', comped: '', sample: '', gifted: '', other: '' };

  /** Labels made for a Queen's cigars go on the list to print. */
  function queueUnits(units, product) {
    var have = {};
    var q = labelQueue();
    q.forEach(function (x) { have[x.code] = true; });
    var short = Codes.shortName(product || {});
    var price = Pr.priceWords(product ? (product.priceCents !== undefined ? product.priceCents : product.price_cents) : null);
    units.forEach(function (u) { if (!have[u.token]) q.push({ kind: 'unit', id: u.id, code: u.token, name: short, price: price }); });
    setLabelQueue(q);
    return q.length;
  }

  /** "Make labels for its cigars?": one for each cigar in the box without one. */
  async function makeUnitLabels(boxId, howMany) {
    var r = await rpc('retail_box_units_make', { p_store: state.store.id, p_box: boxId, p_count: howMany || null });
    queueUnits(r.units, r.product);
    state.labelKind = 'unit';
    toast(r.units.length + ' cigar labels made: ' + r.units[0].token + (r.units.length > 1 ? ' to ' + r.units[r.units.length - 1].token : '') + '.');
    go('/s/' + state.store.id + '/labels');
  }

  async function boxPage(boxId) {
    var base = '#/s/' + state.store.id;
    var d = await storeData(true);
    var b = await rpc('retail_box', { p_store: state.store.id, p_box: boxId });
    var units = b.state === 'open' || b.state === 'empty' ? await rpc('retail_box_units', { p_store: state.store.id, p_box: boxId }) : null;
    var p = b.product || {};
    var msg = h('p', { class: 'error' });
    async function act(name, args, words) {
      msg.textContent = '';
      try {
        await rpc(name, Object.assign({ p_store: state.store.id, p_box: boxId }, args || {}));
        forget();
        if (words) toast(words);
        route();
      } catch (e) { msg.textContent = errorText(e); }
    }
    function openBox() {
      var body = h('div');
      var close = sheet('Open this King?', body);
      async function open(anyway) {
        try {
          var r = await rpc('retail_box_open', { p_store: state.store.id, p_box: boxId, p_anyway: anyway });
          if (r.warning) return warn(r);
          forget();
          offer(r.opened);
        } catch (e) { fill(body, [h('p', { class: 'error', text: errorText(e) })]); }
      }
      function warn(r) {
        if (r.warning === 'older_king') {
          var old = r.older[0];
          return fill(body, [
            h('p', { class: 'over warn-text' }, 'An older King is waiting'),
            h('p', { class: 'lead' }, 'Oldest first: ' + old.code + ' has waited ' + n(old.ageDays) + ' days' + (old.path ? ', in ' + old.path : '') + '. This one, ' + n(r.ageDays) + '.'),
            r.older.length > 1 ? h('p', { class: 'muted small' }, n(r.older.length) + ' older Kings of this cigar in all.') : null,
            h('div', { class: 'btns' },
              h('a', { class: 'btn primary', href: base + '/box/' + old.id, onclick: function () { close(); } }, 'Open the oldest instead'),
              h('button', { class: 'btn', type: 'button', onclick: function () { open(true); } }, 'Open this one anyway')),
            h('p', { class: 'muted small' }, 'A suggestion only. Opening this one is recorded, with who chose it.'),
          ]);
        }
        fill(body, [
          h('p', { class: 'over warn-text' }, 'An active Queen already exists'),
          h('p', { class: 'lead' }, 'Current remaining quantity: ' + n(r.remaining) + (r.queens.length > 1 ? ' in ' + r.queens.length + ' open boxes' : '')),
          h('div', { class: 'list' }, r.queens.map(function (q) {
            return h('a', { class: 'item tap', href: base + '/box/' + q.id, onclick: function () { close(); }, style: { textDecoration: 'none', color: 'inherit' } },
              h('div', { class: 'grow' }, h('div', { class: 'name', text: q.code }), h('div', { class: 'sub', text: q.path || '' })), h('div', { class: 'qty', text: n(q.remaining) }));
          })),
          h('p', {}, 'Some stores keep open boxes of one cigar in two places on purpose.'),
          r.older.length ? h('p', { class: 'muted small' }, 'An older King of it is waiting too: ' + r.older[0].code + ', ' + n(r.older[0].ageDays) + ' days.') : null,
          h('div', { class: 'btns' }, h('button', { class: 'btn primary', type: 'button', onclick: function () { open(true); } }, 'Open another anyway'),
            h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel')),
          h('p', { class: 'muted small' }, 'Opening another anyway is recorded, with who chose it.'),
        ]);
      }
      function offer(q) {
        fill(body, [
          h('p', { class: 'over good-text' }, 'Opened'),
          h('p', { class: 'lead' }, q.code + ' is a Queen of ' + n(q.remaining) + '.'),
          h('p', {}, 'Print a label for each cigar? Each gets its own code, so a cigar scanned out at the counter leaves this box and the count, once.'),
          h('div', { class: 'btns' }, h('button', { class: 'btn primary', type: 'button', onclick: async function (ev) {
            var btn = ev.currentTarget; btn.disabled = true;
            try { close(); await makeUnitLabels(boxId); } catch (e) { toast(errorText(e)); route(); }
          } }, 'Make ' + n(q.remaining) + ' cigar labels'),
            h('button', { class: 'btn', type: 'button', onclick: function () { close(); route(); } }, 'Not now')),
        ]);
      }
      fill(body, [
        h('p', { class: 'lead' }, p.name + ' · ' + b.code),
        h('p', {}, 'It becomes a Queen: from now on its cigars are counted, not the box. The store\'s total does not change.'),
        h('button', { class: 'btn primary big wide', type: 'button', onclick: function () { open(false); } }, 'Open box'),
      ]);
    }
    function moveToQueen() {
      var count = null;
      var when = h('input', { class: 'input', type: 'date', max: new Date().toISOString().slice(0, 10) });
      var m3 = h('p', { class: 'error' });
      var body = h('div');
      var close = sheet('Move to Queen', body);
      fill(body, [
        h('p', { class: 'lead' }, b.code + ' was already open when it was labeled.'),
        h('p', {}, 'The same box and label become a Queen. Its opening day stays unknown unless you know it.'),
        field('How many cigars are in this box now?', stepper(null, function (v) { count = v; })),
        field('Opened on (only if you know it)', when), m3,
        h('button', { class: 'btn primary big wide', type: 'button', onclick: async function (ev) {
          if (!(count >= 1 && count <= b.original)) { m3.textContent = 'From 1 to ' + b.original + '.'; return; }
          var btn = ev.currentTarget; btn.disabled = true;
          try {
            var r = await rpc('retail_box_baseline_open', { p_store: state.store.id, p_box: boxId, p_count: count, p_opened_on: when.value || null });
            forget();
            fill(body, [
              h('p', { class: 'over good-text' }, 'Moved to Queen'),
              h('p', { class: 'lead' }, b.code + ' is a Queen of ' + n(r.box.remaining) + '.'),
              h('p', {}, 'Print a label for each of its ' + n(r.box.remaining) + ' cigars?'),
              h('div', { class: 'btns' }, h('button', { class: 'btn primary', type: 'button', onclick: async function () {
                try { close(); await makeUnitLabels(boxId); } catch (e) { toast(errorText(e)); route(); }
              } }, 'Print ' + n(r.box.remaining) + ' cigar labels'),
                h('button', { class: 'btn', type: 'button', onclick: function () { close(); route(); } }, 'Not now')),
            ]);
          } catch (e) { m3.textContent = errorText(e); btn.disabled = false; }
        } }, 'Move to Queen'),
      ]);
    }
    function takeOut() {
      var howMany = 1;
      var why = h('select', { class: 'input' }, [['sold', 'Sold'], ['lounge', 'Lounge'], ['sample', 'Sample or gift'], ['damaged', 'Damaged cigar']].map(function (o) { return h('option', { value: o[0] }, o[1]); }));
      sheet('Cigars out of ' + b.code, h('div', {},
        b.state === 'sealed' ? h('p', { class: 'muted' }, 'The box is opened first: it becomes a Queen.') : null,
        units && units.available ? h('p', { class: 'muted' }, 'Its cigars have labels: scanning a cigar\'s label (Scan, Cigars out by their labels) takes that very cigar out.') : null,
        field('How many', stepper(1, function (v) { howMany = v || 0; })), field('Why', why),
        h('button', { class: 'btn primary wide', type: 'button', onclick: function () { act('retail_box_take', { p_quantity: howMany, p_reason: why.value }, howMany + ' out of ' + b.code + '.'); } }, 'Take them out')));
    }
    function countIt() {
      var counted = b.remaining;
      sheet('Count ' + b.code, h('div', {}, h('p', { class: 'muted' }, 'The records say ' + b.remaining + '. Count what is in the box now.'),
        field('In the box', stepper(b.remaining, function (v) { counted = v; })),
        h('button', { class: 'btn primary wide', type: 'button', onclick: function () { act('retail_box_count', { p_counted: counted, p_note: '' }, b.code + ': ' + counted + ' in the box.'); } }, 'Save the count')));
    }
    function moveIt() {
      var to = placeSelect(d, b.location);
      sheet('Move ' + b.code, h('div', {}, field('To', to),
        h('button', { class: 'btn primary wide', type: 'button', onclick: function () { act('retail_box_move', { p_location: to.value }, b.code + ' moved.'); } }, 'Move')));
    }
    function markIt(st, words) {
      if (!confirm(words)) return;
      act('retail_box_mark', { p_state: st, p_reason: '' }, b.code + ': ' + (KIND_WORDS[st] || 'found') + '.');
    }
    function unitSheet(u) {
      var m2 = h('p', { class: 'error' });
      async function mark(status, reissue, reason) {
        try {
          var r = await rpc('retail_unit_mark', { p_store: state.store.id, p_unit: u.id, p_status: status, p_reason: reason || '', p_reissue: !!reissue });
          close();
          forget();
          if (r.reissued) {
            queueUnits([r.reissued], { brand: p.brand, line: p.line, vitola: p.vitola, priceCents: p.priceCents });
            state.labelKind = 'unit';
            toast(u.token + ' voided; ' + r.reissued.token + ' is ready to print.');
            return go('/s/' + state.store.id + '/labels');
          }
          toast(u.token + ': ' + (UNIT_WORDS[r.result] || r.result) + '.');
          route();
        } catch (e) { m2.textContent = errorText(e); }
      }
      var close = sheet('Cigar label ' + u.token, h('div', {},
        h('p', {}, chip(UNIT_WORDS[u.status], UNIT_TONE[u.status]), ' ', u.statusAt ? day(u.statusAt) + (u.reason ? ' · ' + u.reason : '') : 'Number ' + u.seq + ' of this box'),
        u.status === 'available' ? h('div', { class: 'btns' },
          h('button', { class: 'btn', type: 'button', onclick: async function () {
            try {
              var r = await rpc('retail_unit_sell', { p_store: state.store.id, p_token: u.token, p_reason: 'sold' });
              close(); forget(); toast(r.words || u.token + ': sold.'); route();
            } catch (e) { m2.textContent = errorText(e); }
          } }, 'Sold'),
          h('button', { class: 'btn', type: 'button', onclick: function () { mark('damaged', false, 'damaged'); } }, 'Damaged'),
          h('button', { class: 'btn', type: 'button', onclick: function () { mark('missing', false, 'missing'); } }, 'Missing'),
          h('button', { class: 'btn', type: 'button', onclick: function () { mark('void', true, 'label reprinted'); } }, 'Label lost or spoiled: print a new one')) : null,
        u.status === 'available' ? h('p', { class: 'muted small' }, 'For a comp, a sample or a gift, use Cigars out: scan it, then confirm.') : null,
        u.status !== 'available' && u.status !== 'void' && can('manager') ? h('button', { class: 'btn', type: 'button', onclick: function () { mark('available', false, 'back in the box'); } }, 'Back in its box (a mistake or a return)') : null,
        m2));
    }
    function unitsCard() {
      if (!units) return null;
      var without = Math.max(0, units.remaining - units.available);
      var extra = units.available - units.remaining;
      var list = h('div', { class: 'list', hidden: true }, units.units.map(function (u) {
        return h('div', { class: 'item tap', onclick: function () { unitSheet(u); } },
          h('div', { class: 'grow' }, h('div', { class: 'name', text: u.token }), h('div', { class: 'sub', text: 'Number ' + u.seq + (u.statusAt ? ' · ' + day(u.statusAt) : '') })), chip(UNIT_WORDS[u.status], UNIT_TONE[u.status]));
      }));
      return h('div', { class: 'card' },
        h('h2', { style: { marginTop: 0 } }, 'Cigar labels'),
        units.units.length
          ? h('p', {}, n(units.available) + ' on cigars · ' + n(units.sold) + ' sold' + (units.other ? ' · ' + n(units.other) + ' void, damaged or missing' : ''))
          : h('p', { class: 'muted' }, 'Its cigars have no labels of their own, and need none: a cigar with the maker\'s barcode on its cellophane or tube is scanned by that at the counter, and leaves the oldest open box. Labels of our own are an option for cigars without one.'),
        extra > 0 ? h('p', { class: 'warn-text' }, n(extra) + (extra === 1 ? ' label is' : ' labels are') + ' on the list for cigars no longer in the box. Scan them out, or mark them missing.') : null,
        h('div', { class: 'btns' },
          b.state === 'open' && without ? h('button', { class: 'btn brand', type: 'button', onclick: function () { makeUnitLabels(boxId).catch(function (e) { msg.textContent = errorText(e); }); } },
            units.units.length ? 'Make labels for the ' + n(without) + ' without one' : 'Make ' + n(without) + ' cigar labels') : null,
          units.available ? h('button', { class: 'btn', type: 'button', onclick: async function () {
            var again = await rpc('retail_box_unit_labels', { p_store: state.store.id, p_box: boxId });
            queueUnits(again, { brand: p.brand, line: p.line, vitola: p.vitola, priceCents: p.priceCents });
            state.labelKind = 'unit';
            go('/s/' + state.store.id + '/labels');
          } }, 'Print the ' + n(units.available) + ' again') : null,
          units.units.length ? h('button', { class: 'btn quiet', type: 'button', onclick: function () { list.hidden = !list.hidden; } }, 'Every label (' + units.units.length + ')') : null),
        list,
        h('p', { class: 'muted small' }, Pr.TEMPLATES.unit.care + ' A cigar without cellophane takes a paper band instead (Labels, Paper bands).'));
    }
    var live = b.state === 'sealed' || b.state === 'open';
    var HISTORY = { received: 'Received', labeled: 'Labeled', opened: 'Opened', counted: 'Counted', sold: 'Sold', taken: 'Taken out', moved: 'Moved', damaged: 'Damaged',
      missing: 'Marked missing', found: 'Found', emptied: 'Emptied', archived: 'Archived', corrected: 'Corrected', unit_labels: 'Cigar labels made',
      baseline_opened: 'Moved to Queen', 
      unit_sold: 'A cigar sold by its label', unit_damaged: 'A cigar damaged', unit_missing: 'A cigar missing', unit_void: 'A cigar label voided', unit_returned: 'A cigar back in the box',
      unit_comped: 'A cigar comped', unit_sample: 'A cigar as a sample', unit_gifted: 'A cigar given', unit_other: 'A cigar out (other)' };
    show(
      h('p', { class: 'over' }, b.path || 'No place'),
      h('h1', { text: p.name || 'Box' }),
      h('div', { class: 'box-head' }, h('div', { class: 'box-qr' }, qrNode(b.code)), h('div', {}, h('div', { class: 'box-code' }, b.code), boxChip(b.state),
        h('p', { class: 'muted small' }, productDetail({ size_text: '', box_count: b.original, sku: p.sku })))),
      h('div', { class: 'tiles' },
        h('div', { class: 'tile' }, h('div', { class: 'label' }, b.state === 'sealed' ? 'Sealed' : 'In the box'), h('div', { class: 'figure' }, n(b.state === 'sealed' ? b.original : b.remaining)), h('div', { class: 'sub' }, 'of ' + n(b.original) + ' when full')),
        h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Where'), h('div', { class: 'figure', style: { fontSize: '22px' } }, b.path || '—')),
        h('div', { class: 'tile' }, h('div', { class: 'label' }, b.openedAt || b.openedBeforeTracking ? 'Opened' : b.receivedAt ? 'Received' : 'Labeled'),
          h('div', { class: 'figure', style: { fontSize: '22px' } }, b.openedAt ? day(b.openedAt) : b.openedBeforeTracking ? 'Before tracking' : day(b.receivedAt || b.labeledAt)),
          h('div', { class: 'sub' }, 'first seen ' + day(b.firstSeenAt) + (b.baseline !== null && b.baseline !== undefined ? ' with ' + n(b.baseline) + ' in it' : '')))),
      b.state === 'sealed' ? h('button', { class: 'btn primary big wide', type: 'button', onclick: openBox }, 'Open box') : null,
      b.canBaseline ? h('button', { class: 'btn wide', type: 'button', onclick: moveToQueen }, 'Already open when labeled? Move to Queen') : null,
      msg,
      unitsCard(),
      h('div', { class: 'btns grid' },
        live ? h('button', { class: 'btn', type: 'button', onclick: takeOut }, 'Cigars out') : null,
        b.state === 'open' ? h('button', { class: 'btn', type: 'button', onclick: countIt }, 'Count it') : null,
        live ? h('button', { class: 'btn', type: 'button', onclick: moveIt }, 'Move') : null,
        h('button', { class: 'btn', type: 'button', onclick: function () { queueLabels([{ id: b.id, code: b.code }], p.name); state.labelKind = 'box'; go('/s/' + state.store.id + '/labels'); } }, 'Print its label'),
        live ? h('button', { class: 'btn danger', type: 'button', onclick: function () { markIt('damaged', 'Mark ' + b.code + ' damaged? Its cigars leave the count.'); } }, 'Damaged') : null,
        live ? h('button', { class: 'btn danger', type: 'button', onclick: function () { markIt('missing', 'Mark ' + b.code + ' missing? Its cigars leave the count until it is found.'); } }, 'Missing') : null,
        !live && b.state !== 'empty' && can('manager') ? h('button', { class: 'btn brand', type: 'button', onclick: function () { markIt('found', 'Found ' + b.code + '? It comes back into the count.'); } }, 'Found it') : null),
      h('h2', { text: 'History' }),
      h('div', { class: 'list' }, b.history.map(function (e) {
        var what = HISTORY[e.kind] || e.kind;
        return h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'name', text: what + (e.reason ? ' · ' + e.reason : '') }),
          h('div', { class: 'sub', text: [day(e.at), e.by, e.kind === 'moved' ? 'to ' + e.place : ''].filter(Boolean).join(' · ') })),
          h('div', { class: 'qty', text: e.change ? (e.change > 0 ? '+' : '') + n(e.change) : n(e.remaining) }));
      })),
      h('div', { class: 'btns' }, h('a', { class: 'btn quiet', href: base + '/scan' }, 'Scan another box')));
  }

  /** What a cigar label's scan says, in the scanner. */
  function sellWords(r) {
    var u = r.unit;
    var name = u && u.product ? u.product.name : '';
    if (r.result === 'sold') return { tone: 'good', words: 'Sold: ' + name + ' · ' + u.token + ' · ' + r.box.code + ' now ' + n(r.box.remaining) + ' left' };
    if (r.result === 'already_sold') return { tone: 'bad', words: r.words };
    return { tone: r.result === 'review' ? 'warn' : 'bad', words: r.words || (u ? u.token + ': ' + (UNIT_WORDS[u.status] || u.status) : 'Not changed.') };
  }

  async function scanView() {
    var base = '/s/' + state.store.id;
    var d = await storeData(true);
    function openScanner() {
      self.RetailScanner.open({
        title: 'Scan a box',
        hint: 'A Cigar Locker label opens its box. A factory barcode shows where that product is.',
        onCode: async function (code, format, ctl) {
          var r = await rpc('retail_code_resolve', { p_store: state.store.id, p_code: code });
          if (r.kind === 'unit' && r.unit) {
            var u = r.unit;
            ctl.panel(h('div', { class: 'scan-choice' }, h('p', { class: 'over' }, 'One cigar\'s label'),
              h('div', { class: 'scan-product' }, u.product.name), h('p', { class: 'muted small' }, u.token + ' · from ' + r.box.code + ' (' + n(r.box.remaining) + ' left) · ' + (r.box.path || '')),
              h('p', {}, chip(UNIT_WORDS[u.status], UNIT_TONE[u.status]), u.statusAt ? ' ' + day(u.statusAt) : ''),
              h('div', { class: 'btns' },
                u.status === 'available' ? h('button', { class: 'btn primary', type: 'button', onclick: async function () {
                  try {
                    var pk = await rpc('retail_out_peek', { p_store: state.store.id, p_code: u.token });
                    if (!pk.ok) { ctl.resume(); return ctl.flash('bad', pk.words); }
                    var l = basket();
                    if (!l.some(function (x) { return x.type === 'unit' && x.token === u.token; })) { l.push(pk.item); setBasket(l); }
                    ctl.resume();
                    ctl.flash('good', 'In the Cigars out basket: ' + basketCount(l) + ' to confirm');
                  } catch (e) { ctl.resume(); ctl.flash('bad', errorText(e)); }
                } }, 'Add to Cigars out') : null,
                h('a', { class: 'btn', href: '#' + base + '/box/' + r.box.id, onclick: function () { ctl.close(); } }, 'Its box'),
                h('button', { class: 'btn quiet', type: 'button', onclick: function () { ctl.resume(); } }, 'Scan another'))));
            return { tone: u.status === 'available' ? 'good' : 'warn', words: u.token };
          }
          if (r.kind === 'unit') return { tone: 'bad', words: r.otherStore ? 'That cigar label is another store\'s.' : 'No cigar has the label ' + code + '.' };
          if (r.kind === 'box' && r.box) {
            ctl.close();
            go(base + '/box/' + r.box.id);
            return { tone: 'good', words: code };
          }
          if (r.kind === 'box') return { tone: 'bad', words: r.otherStore ? 'That label is another store\'s.' : 'No box has the code ' + code + '.' };
          if (r.status !== 'matched') return { tone: 'warn', words: (r.status === 'possible' ? 'Not confirmed here yet: ' : 'Unknown code: ') + code + '. Use Receive or Label boxes to tie it to a product.' };
          var ids = r.candidates.map(function (c) { return c.id; });
          var here = d.boxes.filter(function (b) { return ids.indexOf(b.store_product_id) >= 0 && (b.state === 'sealed' || b.state === 'open'); });
          var loose = d.inventory.filter(function (i) { return ids.indexOf(i.product_id) >= 0 && i.quantity > 0; });
          ctl.panel(h('div', { class: 'scan-choice' }, h('p', { class: 'over good-text' }, 'Matched'), h('div', { class: 'scan-product' }, r.candidates.map(function (c) { return c.name; }).join(' / ')),
            h('div', { class: 'list' }, here.map(function (b) {
              return h('a', { class: 'item tap', href: '#' + base + '/box/' + b.id, onclick: function () { ctl.close(); } },
                h('div', { class: 'grow' }, h('div', { class: 'name', text: b.cl_code }), h('div', { class: 'sub', text: pathOf(d, b.location_id) })), boxChip(b.state), h('div', { class: 'qty', text: n(boxUnits(b)) }));
            }).concat(loose.map(function (i) {
              return h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'name', text: 'Loose or unlabeled' }), h('div', { class: 'sub', text: pathOf(d, i.location_id) })), h('div', { class: 'qty', text: n(i.quantity) }));
            })).concat(here.length || loose.length ? [] : [h('div', { class: 'item muted' }, 'None in the store now.')])),
            h('button', { class: 'btn wide', type: 'button', onclick: function () { ctl.resume(); } }, 'Scan another')));
          return { tone: 'good', words: code };
        },
      });
    }
    show(h('h1', { text: 'Scan' }), h('p', { class: 'lead' }, 'Scan a box\'s Cigar Locker label to open its page: open it, take cigars out, count it or move it. A cigar\'s own label shows that cigar.'),
      h('div', { class: 'btns grid' },
        h('button', { class: 'btn primary big', type: 'button', onclick: openScanner }, 'Open the scanner'),
        h('a', { class: 'btn big', href: '#' + base + '/out' }, 'Cigars out')),
      h('p', { class: 'muted small' }, 'Cigars out: scan each cigar (or an open box), then confirm them together as sold, damaged, a comp, a sample, a gift, missing or other. Nothing changes before you confirm.'),
      d.boxes.length ? null : h('div', { class: 'card' }, h('p', {}, 'No box is labeled yet. Start with Label boxes.'), h('a', { class: 'btn', href: '#' + base + '/label' }, 'Label boxes')));
  }

  // ---- the first inventory (onboarding) -------------------------------------------------------
  //
  // Once, before perpetual inventory: the old spreadsheet kept as LEGACY
  // EXPECTED, then cabinet by cabinet every box labeled a King (open ones
  // moved to Queen and counted), the loose cigars counted, the cabinet marked
  // complete. What was verified becomes the starting truth.

  var CAB_WORDS = { pending: 'To do', counting: 'Working', done: 'Complete' };
  var CAB_TONE = { pending: '', counting: 'info', done: 'good' };

  async function firstView(locId) {
    var base = '#/s/' + state.store.id;
    var more = await rpc('retail_dashboard_more', { p_store: state.store.id });
    var sid = more.onboarding ? more.onboarding.id : null;
    if (!sid && more.baselineSession) {
      var fin = await rpc('retail_onboarding', { p_session: more.baselineSession });
      return show(h('p', { class: 'over' }, 'First inventory · complete'), h('h1', { text: fin.name }),
        h('p', { class: 'lead' }, 'Completed ' + day(fin.completed) + '. What was verified is the starting truth: from then on every cigar in or out is an event.'),
        onbReport(fin.report), h('a', { class: 'btn brand big wide', href: base }, 'Dashboard'));
    }
    if (!sid) return onbStart(more);
    if (locId) return cabinetView(sid, locId);
    var o = await rpc('retail_onboarding', { p_session: sid });
    var started = Date.now() - (o.seconds || 0) * 1000;
    var timer = h('div', { class: 'timer', text: clock(o.seconds || 0) });
    if (o.status === 'open') every(1000, function () { timer.textContent = clock((Date.now() - started) / 1000); });
    every(20000, function () { if (!document.querySelector('.veil') && !document.documentElement.classList.contains('scanning')) route(); });
    var rep = o.report;
    var left = o.places - o.done;
    var pct = o.places ? Math.round((100 * o.done) / o.places) : 0;
    show(
      h('p', { class: 'over' }, 'First inventory'),
      h('h1', { text: o.name }),
      h('div', { class: 'card' },
        h('div', { style: { display: 'flex', gap: '24px', alignItems: 'flex-end', flexWrap: 'wrap' } },
          h('div', {}, h('p', { class: 'over' }, o.status === 'paused' ? 'Paused' : 'Elapsed'), timer),
          h('div', { style: { flex: '1', minWidth: '220px' } },
            h('div', { style: { display: 'flex', justifyContent: 'space-between', fontWeight: '650' } }, h('span', {}, n(o.done) + ' of ' + n(o.places) + ' places complete'), h('span', {}, n(rep.boxes) + ' boxes labeled')),
            h('div', { class: 'progress' }, h('i', { style: { width: pct + '%' } })))),
        h('div', { class: 'btns' },
          o.status === 'open'
            ? h('button', { class: 'btn', type: 'button', onclick: async function () { await rpc('retail_onboarding_set', { p_session: sid, p_action: 'pause' }); route(); } }, 'Pause')
            : h('button', { class: 'btn brand', type: 'button', onclick: async function () { await rpc('retail_onboarding_set', { p_session: sid, p_action: 'resume' }); route(); } }, 'Resume'),
          can('manager') ? h('button', { class: 'btn primary', type: 'button', disabled: left > 0, onclick: function () { finishFirst(sid, rep); } },
            left > 0 ? left + (left === 1 ? ' place' : ' places') + ' to complete' : 'Complete the first inventory') : null,
          can('manager') ? h('button', { class: 'btn quiet danger', type: 'button', onclick: async function () {
            if (!confirm('Cancel the first inventory? Boxes labeled so far keep their labels.')) return;
            await rpc('retail_onboarding_set', { p_session: sid, p_action: 'cancel' });
            go('/s/' + state.store.id);
          } }, 'Cancel') : null)),
      h('div', { class: 'tiles' },
        h('div', { class: 'tile' }, h('div', { class: 'label' }, 'The spreadsheet said'), h('div', { class: 'figure' }, n(rep.legacy)), h('div', { class: 'sub' }, 'legacy expected, kept apart')),
        h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Verified so far'), h('div', { class: 'figure' }, n(rep.verified)), h('div', { class: 'sub' }, plural(rep.kings, 'King') + ' · ' + plural(rep.queens, 'Queen'))),
        h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Products to match'), h('div', { class: 'figure', style: rep.unmatched ? { color: 'var(--warn)' } : null }, n(rep.unmatched)), h('div', { class: 'sub' }, 'labeled but not matched to the catalogue'))),
      h('h2', { text: 'Cabinet by cabinet' }),
      h('p', { class: 'muted small' }, 'Open a place, scan each box\'s barcode then the blank label you put on it, say sealed or open, count the loose cigars, and mark it complete. Several people can work different places at once.'),
      h('div', { class: 'list' }, o.cabinets.map(function (c) {
        var bits = [n(c.boxes) + (c.boxes === 1 ? ' box' : ' boxes')];
        if (c.queens) bits.push(n(c.queens) + (c.queens === 1 ? ' Queen' : ' Queens') + ' (' + n(c.queenUnits) + ')');
        if (c.looseUnits) bits.push(n(c.looseUnits) + ' loose');
        if (c.review) bits.push(n(c.review) + ' to match');
        if (c.status === 'done' && c.seconds) bits.push(R.duration(c.seconds));
        return h('a', { class: 'item tap', href: base + '/first/' + c.location, style: { textDecoration: 'none', color: 'inherit' } },
          h('div', { class: 'grow' }, h('div', { class: 'name', text: c.path }), h('div', { class: 'sub', text: bits.join(' · ') + (c.reopens ? ' · reopened ' + c.reopens + '×' : '') })),
          chip(CAB_WORDS[c.status] + (c.status === 'counting' && c.by ? ' · ' + c.by : ''), CAB_TONE[c.status]),
          h('div', { class: 'qty', text: n(c.kingUnits + c.queenUnits + c.looseUnits) }));
      })),
      h('p', { class: 'muted small' }, 'The figure on the right is what has been verified in each place.'));
  }

  async function onbStart(more) {
    var base = '#/s/' + state.store.id;
    var d = await rpc('retail_dashboard', { p_store: state.store.id });
    function step(ok, title, words, link, linkWords) {
      return h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'name', text: title }), h('div', { class: 'sub', text: words })),
        chip(ok ? 'Done' : 'To do', ok ? 'good' : ''), link && can('manager') ? h('a', { class: 'btn small', href: base + link }, linkWords) : null);
    }
    var msg = h('p', { class: 'error' });
    show(h('p', { class: 'over' }, 'Once, before perpetual inventory'), h('h1', { text: 'First inventory' }),
      h('p', { class: 'lead' }, 'Every box in the store gets its permanent label, cabinet by cabinet; open boxes are counted; loose cigars are counted. The spreadsheet\'s numbers are kept beside what is found, never forced onto it, and what is verified becomes the starting truth.'),
      h('h2', { text: 'Before you start' }),
      h('div', { class: 'list' },
        step(d.products > 0, '1. Bring in the spreadsheet', n(d.products) + ' products · ' + n(d.units) + ' cigars on the records', '/import', 'Import'),
        step(d.products > 0 && !d.unmatched, '2. Match the products', d.unmatched ? n(d.unmatched) + ' still to match or confirm' : 'every product matched', '/products', 'Products'),
        step(d.locations > 0, '3. Map the places', n(d.locations) + ' rooms, cabinets and shelves', '/locations', 'Locations'),
        step(more.blankLabels > 0, '4. Print blank box labels', n(more.blankLabels) + ' blank labels ready (one for each box, and some spare)', '/labels', 'Labels')),
      can('manager')
        ? h('div', { class: 'card' }, msg, h('button', { class: 'btn primary big wide', type: 'button', disabled: !d.locations, onclick: async function (ev) {
          var btn = ev.currentTarget;
          btn.disabled = true;
          try { await rpc('retail_onboarding_start', { p_store: state.store.id, p_name: 'First inventory' }); route(); }
          catch (e) { msg.textContent = errorText(e); btn.disabled = false; }
        } }, 'Begin the first inventory'), h('p', { class: 'muted small' }, 'The clock starts now. The spreadsheet\'s numbers are kept at this moment as the legacy expected inventory.'))
        : h('div', { class: 'card' }, h('p', {}, 'A manager begins it; then each place is done here.')));
  }

  function looseKey(sid, locId) {
    return 'cl-retail-loose:' + sid + ':' + locId;
  }

  async function cabinetView(sid, locId) {
    var base = '#/s/' + state.store.id;
    var d = await storeData(true);
    var place = d.loc[locId];
    if (!place) return show(h('p', { class: 'error', text: 'That place is not in this store.' }));
    var c;
    try {
      c = await rpc('retail_cabinet_open', { p_session: sid, p_location: locId });
    } catch (e) {
      return show(h('h1', { text: place.name }), h('div', { class: 'card' }, h('p', { class: 'lead', text: errorText(e) }), h('a', { class: 'btn', href: base + '/first' }, 'Back to the places')));
    }
    var done = c.status === 'done';
    var loose = [];
    try { loose = JSON.parse(localStorage.getItem(looseKey(sid, locId)) || '[]'); } catch (e) { loose = []; }
    function keep() { try { localStorage.setItem(looseKey(sid, locId), JSON.stringify(loose)); } catch (e) { /* page only */ } }
    var boxesHere = d.boxes.filter(function (b) { return b.location_id === locId && (b.state === 'sealed' || b.state === 'open'); });
    var looseList = h('div', { class: 'list' });
    function drawLoose() {
      looseList.replaceChildren.apply(looseList, loose.length ? loose.map(function (x, i) {
        return h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'name', text: productName(d.products[x.product_id]) })),
          stepper(x.counted, function (v) { x.counted = Math.max(0, v || 0); keep(); }),
          h('button', { class: 'btn small quiet', type: 'button', 'aria-label': 'Remove', onclick: function () { loose.splice(i, 1); keep(); drawLoose(); } }, '×'));
      }) : [h('div', { class: 'item muted' }, 'None counted yet.')]);
    }
    drawLoose();
    function addLoose() {
      var q = h('input', { class: 'input', type: 'search', placeholder: 'Brand, line, size or SKU' });
      var list = h('div', { class: 'list' });
      function fillList() {
        var w = S.plain(q.value).split(' ').filter(Boolean);
        var all = Object.keys(d.products).map(function (id) { return d.products[id]; }).filter(function (p) {
          var hay = S.plain([p.brand, p.line, p.vitola, p.size_text, p.sku].join(' '));
          return p.active && w.every(function (x) { return hay.indexOf(x) >= 0; });
        }).slice(0, 40);
        list.replaceChildren.apply(list, all.map(function (p) {
          return h('div', { class: 'item tap', onclick: function () {
            var have = loose.filter(function (x) { return x.product_id === p.id; })[0];
            if (have) have.counted += 1; else loose.push({ product_id: p.id, counted: 1 });
            keep(); drawLoose(); close();
          } }, h('div', { class: 'grow' }, h('div', { class: 'name', text: productName(p) }), h('div', { class: 'sub', text: productDetail(p) })));
        }));
      }
      q.addEventListener('input', fillList);
      fillList();
      var close = sheet('Loose cigars here', h('div', {}, h('p', { class: 'muted small' }, 'Cigars here with no box: singles, a bundle, cigars out of their box.'), q, h('div', { style: { height: '10px' } }), list));
    }
    function markComplete() {
      var units = loose.reduce(function (t, x) { return t + (x.counted || 0); }, 0);
      var msg = h('p', { class: 'error' });
      var close = sheet('Mark ' + place.name + ' complete?', h('div', {},
        h('p', { class: 'lead' }, n(c.boxes) + (c.boxes === 1 ? ' box' : ' boxes') + ' labeled here (' + plural(c.kings, 'King') + ', ' + plural(c.queens, 'Queen') + ') and ' + n(units) + ' loose ' + (units === 1 ? 'cigar' : 'cigars') + '.'),
        h('p', {}, 'Once complete, this place is frozen: nothing more is labeled into it until a manager reopens it. Its loose cigars on the records become the ones counted here.'),
        msg,
        h('button', { class: 'btn primary big wide', type: 'button', onclick: async function (ev) {
          var btn = ev.currentTarget;
          btn.disabled = true;
          try {
            await rpc('retail_cabinet_complete', { p_session: sid, p_location: locId, p_loose: loose.filter(function (x) { return x.counted > 0; }) });
            try { localStorage.removeItem(looseKey(sid, locId)); } catch (e) { /* fine */ }
            close(); forget(); toast(place.name + ' marked complete.');
            go('/s/' + state.store.id + '/first');
          } catch (e) { msg.textContent = errorText(e); btn.disabled = false; }
        } }, 'Mark complete')));
    }
    function reopen() {
      var why = h('input', { class: 'input', placeholder: 'For example: a box was missed' });
      var msg = h('p', { class: 'error' });
      var close = sheet('Reopen ' + place.name, h('div', {}, field('Why', why), msg,
        h('button', { class: 'btn primary wide', type: 'button', onclick: async function () {
          try { await rpc('retail_cabinet_reopen', { p_session: sid, p_location: locId, p_reason: why.value.trim() }); close(); forget(); route(); }
          catch (e) { msg.textContent = errorText(e); }
        } }, 'Reopen')));
    }
    var path = pathOf(d, locId);
    show(
      h('p', { class: 'over' }, 'First inventory' + (path.indexOf(' › ') > 0 ? ' · ' + path.slice(0, path.lastIndexOf(' › ')) : '')),
      h('h1', { text: place.name }),
      h('p', {}, chip(CAB_WORDS[c.status], CAB_TONE[c.status]), c.reopens ? ' Reopened ' + c.reopens + '× · ' + c.reopenReason : ''),
      h('div', { class: 'tiles' },
        h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Boxes labeled'), h('div', { class: 'figure' }, n(c.boxes)), h('div', { class: 'sub' }, plural(c.kings, 'King') + ' · ' + plural(c.queens, 'Queen'))),
        h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Queen cigars counted'), h('div', { class: 'figure' }, n(c.queenUnits))),
        h('div', { class: 'tile' }, h('div', { class: 'label' }, 'The spreadsheet said here'), h('div', { class: 'figure' }, n(c.legacy))),
        c.review ? h('div', { class: 'tile' }, h('div', { class: 'label' }, 'To match'), h('div', { class: 'figure', style: { color: 'var(--warn)' } }, n(c.review)), h('div', { class: 'sub' }, 'products labeled but not matched')) : null),
      done
        ? h('div', { class: 'card' }, h('p', { class: 'lead' }, 'Complete' + (c.by ? ' · ' + c.by : '') + (c.seconds ? ' · ' + R.duration(c.seconds) : '') + '. ' + n(c.looseUnits) + ' loose cigars counted.'),
          h('p', { class: 'muted' }, 'This place is frozen. A manager can reopen it, with the reason recorded.'),
          can('manager') ? h('button', { class: 'btn', type: 'button', onclick: reopen }, 'Reopen this place') : null)
        : h('div', { class: 'card' },
          h('button', { class: 'btn primary big wide', type: 'button', onclick: function () { boxesByScan('labeled', locId, null, { preprinted: true, onboarding: sid }); } }, 'Scan boxes here'),
          h('p', { class: 'muted small' }, 'Scan a box\'s barcode, then the next blank label as you put it on: the box is a King. Then say sealed or open; an open one is moved to Queen with its cigars counted.')),
      done ? null : h('h2', { text: 'Loose cigars here' }),
      done ? null : looseList,
      done ? null : h('div', { class: 'btns' }, h('button', { class: 'btn', type: 'button', onclick: addLoose }, 'Add loose cigars')),
      done ? null : h('button', { class: 'btn brand big wide', type: 'button', onclick: markComplete }, 'Mark this place complete'),
      boxesHere.length ? h('h2', { text: 'Boxes here' }) : null,
      boxesHere.length ? h('div', { class: 'list' }, boxesHere.map(function (b) {
        return h('a', { class: 'item tap', href: base + '/box/' + b.id, style: { textDecoration: 'none', color: 'inherit' } },
          h('div', { class: 'grow' }, h('div', { class: 'name', text: productName(d.products[b.store_product_id]) }), h('div', { class: 'sub', text: b.cl_code })), boxChip(b.state), h('div', { class: 'qty', text: n(boxUnits(b)) }));
      })) : null,
      h('div', { class: 'btns' }, h('a', { class: 'btn quiet', href: base + '/first' }, 'All places')));
  }

  function finishFirst(sid, rep) {
    var msg = h('p', { class: 'error' });
    var close = sheet('Complete the first inventory?', h('div', {},
      h('p', { class: 'lead' }, 'Verified: ' + n(rep.verified) + ' cigars. The spreadsheet said ' + n(rep.legacy) + '.'),
      h('p', {}, 'What was verified becomes the store\'s starting inventory. From then on every cigar in or out is an event.'),
      msg,
      h('button', { class: 'btn primary big wide', type: 'button', onclick: async function (ev) {
        var btn = ev.currentTarget;
        btn.disabled = true;
        try { await rpc('retail_onboarding_complete', { p_session: sid }); close(); forget(); route(); }
        catch (e) { msg.textContent = errorText(e); btn.disabled = false; }
      } }, 'Complete')));
  }

  /** The first inventory's report: the spreadsheet against what was verified. */
  function onbReport(rep) {
    function tile(label, figure, sub, color) {
      return h('div', { class: 'tile' }, h('div', { class: 'label' }, label), h('div', { class: 'figure', style: color ? { color: 'var(--' + color + ')' } : null }, figure), sub ? h('div', { class: 'sub' }, sub) : null);
    }
    return h('div', {},
      h('div', { class: 'tiles' },
        tile('Legacy spreadsheet', n(rep.legacy), 'what it said'),
        tile('Verified physical', n(rep.verified), 'found and labeled', 'good'),
        tile('Variance', signed(rep.variance), 'verified less the spreadsheet', rep.variance ? 'warn' : 'good'),
        tile('Absolute variance', n(rep.absVariance), 'every difference, over and short'),
        tile('Spreadsheet accuracy', rep.accuracy === null || rep.accuracy === undefined ? '—' : rep.accuracy + '%', n(rep.productsDifferent) + ' of ' + n(rep.products) + ' products differ')),
      h('div', { class: 'tiles' },
        tile('Boxes labeled', n(rep.boxes), plural(rep.kings, 'King') + ' · ' + plural(rep.queens, 'Queen')),
        tile('Found open', n(rep.queensFoundOpen), 'moved to Queen and counted'),
        tile('Cigar labels', n(rep.cigarLabels)),
        tile('Products to match', n(rep.unmatched), '', rep.unmatched ? 'warn' : ''),
        tile('Time', R.duration(rep.seconds || 0), (rep.seconds || 0) <= 5400 ? 'under 90 minutes' : '')),
      rep.differences.length ? h('h2', { text: 'Where the spreadsheet differs' }) : null,
      rep.differences.length ? h('div', { class: 'scroll-x' }, h('table', { class: 'table' },
        h('tr', {}, h('th', {}, 'Product'), h('th', { class: 'n' }, 'Spreadsheet'), h('th', { class: 'n' }, 'Verified'), h('th', { class: 'n' }, 'Difference'), h('th', {}, 'Found as')),
        rep.differences.slice(0, 300).map(function (x) {
          var how = [x.kings ? x.kings + ' King' + (x.kings === 1 ? '' : 's') : '', x.queens ? x.queens + ' Queen' + (x.queens === 1 ? '' : 's') : '', x.loose ? x.loose + ' loose' : ''].filter(Boolean).join(' · ') || 'none found';
          return h('tr', {}, h('td', { text: x.name }), h('td', { class: 'n', text: n(x.legacy) }), h('td', { class: 'n', text: n(x.verified) }), h('td', { class: 'n', text: signed(x.variance) }), h('td', { text: how }));
        }))) : h('p', { class: 'muted' }, 'The spreadsheet and the shelves agree.'));
  }

  // ---- a box bound to a pre-printed label: sealed or open -------------------------------------

  /** One decision after a label is bound: sealed (a King, done) or open (Move to Queen, counted). */
  function kingOrQueen(box, p, per, onDone) {
    var wrap = h('div', { class: 'scan-choice' });
    function first() {
      fill(wrap, [
        h('p', { class: 'over good-text' }, 'Label on · ' + box.code + (box.no ? ' · No. ' + box.no : '')),
        h('div', { class: 'scan-product' }, productName(p)),
        h('p', { class: 'lead' }, 'Is this box sealed or open?'),
        h('div', { class: 'btns grid' },
          h('button', { class: 'btn primary big', type: 'button', onclick: function () { onDone('king'); } }, 'Sealed · King'),
          h('button', { class: 'btn big', type: 'button', onclick: queen }, 'Open · Move to Queen')),
      ]);
    }
    function queen() {
      var count = null;
      var when = h('input', { class: 'input', type: 'date', max: new Date().toISOString().slice(0, 10) });
      var msg = h('p', { class: 'error' });
      fill(wrap, [
        h('p', { class: 'over warn-text' }, 'Move to Queen · ' + box.code),
        h('div', { class: 'scan-product' }, productName(p)),
        field('How many cigars are in this box now?', stepper(null, function (v) { count = v; })),
        field('Opened on (only if you know it)', when), msg,
        h('div', { class: 'btns' },
          h('button', { class: 'btn primary big', type: 'button', onclick: async function (ev) {
            if (!(count >= 1 && count <= per)) { msg.textContent = 'From 1 to ' + per + '.'; return; }
            var btn = ev.currentTarget;
            btn.disabled = true;
            try {
              var r = await rpc('retail_box_baseline_open', { p_store: state.store.id, p_box: box.id, p_count: count, p_opened_on: when.value || null });
              forget();
              fill(wrap, [
                h('p', { class: 'over good-text' }, 'Queen · ' + box.code),
                h('div', { class: 'scan-product' }, productName(p)),
                h('p', { class: 'lead' }, n(r.box.remaining) + ' cigars in it, opened ' + (r.box.openedAt ? day(r.box.openedAt) : 'before tracking') + '.'),
                h('div', { class: 'btns' },
                  h('button', { class: 'btn', type: 'button', onclick: async function (e2) {
                    var b2 = e2.currentTarget;
                    b2.disabled = true;
                    try {
                      var u = await rpc('retail_box_units_make', { p_store: state.store.id, p_box: box.id, p_count: null });
                      queueUnits(u.units, u.product);
                      b2.textContent = u.units.length + ' cigar labels to print';
                    } catch (e) { b2.textContent = errorText(e); }
                  } }, 'Print ' + n(r.box.remaining) + ' cigar labels'),
                  h('button', { class: 'btn primary big', type: 'button', onclick: function () { onDone('queen'); } }, 'Done · next box')),
              ]);
            } catch (e) { msg.textContent = errorText(e); btn.disabled = false; }
          } }, 'Save · Queen'),
          h('button', { class: 'btn quiet', type: 'button', onclick: first }, 'Back')),
      ]);
    }
    first();
    return wrap;
  }

  // ---- cigars out: scan, add, confirm ---------------------------------------------------------
  //
  // Each scan adds to a basket on this device; nothing changes until the
  // basket is confirmed, all at once, as sold, damaged, a comp, a sample, a
  // gift, missing or other. An abandoned basket changes nothing.

  var DISPOSITIONS = [['sold', 'Sold'], ['damaged', 'Damaged'], ['comp', 'Comp'], ['sample', 'Sample'], ['gift', 'Gift'], ['missing', 'Missing'], ['other', 'Other']];
  function basketKey() {
    return 'cl-retail-basket:' + state.store.id;
  }
  function basket() {
    try {
      var v = JSON.parse(localStorage.getItem(basketKey()) || 'null');
      if (Array.isArray(v)) return v;
    } catch (e) { /* below */ }
    return state.basketMemo && state.basketMemo.store === state.store.id ? state.basketMemo.list.slice() : [];
  }
  function setBasket(list) {
    state.basketMemo = { store: state.store.id, list: list.slice() };
    try { localStorage.setItem(basketKey(), JSON.stringify(list)); } catch (e) { /* the page keeps it */ }
  }
  function basketCount(list) {
    return list.reduce(function (t, x) { return t + (x.type === 'unit' ? 1 : x.quantity || 0); }, 0);
  }
  function basketWords(list) {
    var k = basketCount(list);
    return k + (k === 1 ? ' cigar' : ' cigars') + ' in the basket · nothing changes until you confirm';
  }

  function outScanner() {
    self.RetailScanner.open({
      title: 'Cigars out · scan to add',
      hint: 'Scan each cigar\'s own label, or an open box\'s label and say how many. Nothing changes until you confirm.',
      onClose: function () { route(); },
      onCode: async function (code, format, ctl) {
        var list = basket();
        if (Codes.unitCode(code) && list.some(function (x) { return x.type === 'unit' && x.token === code; })) return { tone: 'warn', words: 'Already in the basket: ' + code };
        var r = await rpc('retail_out_peek', { p_store: state.store.id, p_code: code });
        if (!r.ok) {
          if (r.result === 'already_sold' || r.result === 'not_available') rpc('retail_out_review_seen', { p_store: state.store.id, p_token: code, p_result: r.result }).catch(function () {});
          return { tone: 'bad', words: r.words };
        }
        var it = r.item;
        if (it.type === 'unit') {
          list.push(it);
          setBasket(list);
          ctl.tally(basketWords(list));
          return { tone: 'good', words: 'Added: ' + it.name + ' · ' + it.token };
        }
        return await new Promise(function (resolve) {
          var q = 1;
          ctl.panel(h('div', { class: 'scan-choice' },
            h('p', { class: 'over' }, 'Open box · ' + it.boxCode), h('div', { class: 'scan-product' }, it.name), h('p', { class: 'muted small' }, n(it.remaining) + ' in it'),
            field('How many out of it', stepper(1, function (v) { q = Math.max(1, Math.min(it.remaining, v || 1)); })),
            h('div', { class: 'btns' },
              h('button', { class: 'btn primary big', type: 'button', onclick: function () {
                var l2 = basket();
                var same = l2.filter(function (x) { return x.type === 'box' && x.box === it.box; })[0];
                if (same) same.quantity += q; else l2.push(Object.assign({}, it, { quantity: q }));
                setBasket(l2);
                ctl.tally(basketWords(l2));
                ctl.resume();
                resolve({ tone: 'good', words: 'Added: ' + q + ' · ' + it.name });
              } }, 'Add'),
              h('button', { class: 'btn quiet', type: 'button', onclick: function () { ctl.resume(); resolve({ tone: 'warn', words: 'Not added.' }); } }, 'Cancel'))));
        });
      },
    }).tally(basketWords(basket()));
  }

  async function outView() {
    var list = basket();
    var disp = state.outDisp || 'sold';
    var note = h('input', { class: 'input', placeholder: 'Optional; needed for Other', value: state.outNote || '' });
    note.addEventListener('input', function () { state.outNote = note.value; });
    var msg = h('p', { class: 'error' });
    var k = basketCount(list);
    var words = (DISPOSITIONS.filter(function (x) { return x[0] === disp; })[0] || [])[1];
    async function confirmIt(ev) {
      msg.textContent = '';
      if (disp === 'other' && !note.value.trim()) { msg.textContent = 'Say what happened to them.'; return; }
      var btn = ev.currentTarget;
      btn.disabled = true;
      var items = list.map(function (x) { return x.type === 'unit' ? { type: 'unit', token: x.token } : { type: 'box', box: x.box, quantity: x.quantity }; });
      try {
        var r = await rpcOp('retail_out_confirm', { p_store: state.store.id, p_disposition: disp, p_items: items, p_note: note.value.trim() }, 'Cigars out: ' + k + ' · ' + words);
        if (r.queued) {
          setBasket([]); state.outNote = ''; state.outDisp = 'sold';
          toast('No connection: kept on this device and sent when it is back.');
          return route();
        }
        if (!r.ok) {
          msg.textContent = (r.item ? 'Line ' + r.item + ': ' : '') + r.words + ' Nothing was changed.';
          btn.disabled = false;
          return;
        }
        setBasket([]); state.outNote = ''; state.outDisp = 'sold';
        forget();
        tone('good');
        toast(n(r.cigars) + (r.cigars === 1 ? ' cigar' : ' cigars') + ' out · ' + words + (r.repeat ? ' (already done)' : '') + '.');
        route();
      } catch (e) { msg.textContent = errorText(e); btn.disabled = false; }
    }
    show(h('h1', { text: 'Cigars out' }),
      h('p', { class: 'lead' }, 'Scan, add, next. Nothing leaves the inventory until you confirm; a basket left unconfirmed changes nothing.'),
      h('button', { class: 'btn primary big wide', type: 'button', onclick: outScanner }, list.length ? 'Scan more' : 'Scan cigars'),
      list.length ? h('h2', { text: 'The basket · ' + k + (k === 1 ? ' cigar' : ' cigars') }) : null,
      list.length ? h('div', { class: 'list' }, list.map(function (x, i) {
        return h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'name', text: x.name }),
          h('div', { class: 'sub', text: x.type === 'unit' ? x.token + ' · from ' + x.boxCode : 'from open box ' + x.boxCode })),
          x.type === 'box' ? stepper(x.quantity, function (v) { var l = basket(); var y = l[i]; if (y) { y.quantity = Math.max(1, v || 1); setBasket(l); } }) : h('div', { class: 'qty', text: '1' }),
          h('button', { class: 'btn small quiet', type: 'button', 'aria-label': 'Take out of the basket', onclick: function () { var l = basket(); l.splice(i, 1); setBasket(l); route(); } }, '×'));
      })) : h('div', { class: 'card' }, h('p', { class: 'muted' }, 'The basket is empty. Scan a cigar\'s label, or an open box\'s label for cigars without one.')),
      list.length ? h('div', { class: 'card' },
        h('p', { class: 'over' }, 'What happened to them'),
        h('div', { class: 'seg disp' }, DISPOSITIONS.map(function (o) {
          return h('button', { type: 'button', class: disp === o[0] ? 'on' : '', onclick: function () { state.outDisp = o[0]; route(); } }, o[1]);
        })),
        field('Note', note), msg,
        h('button', { class: 'btn primary big wide', type: 'button', onclick: confirmIt }, 'Confirm ' + k + (k === 1 ? ' cigar' : ' cigars') + ' · ' + words),
        h('button', { class: 'btn quiet small', type: 'button', onclick: function () { if (confirm('Empty the basket? Nothing was changed by it.')) { setBasket([]); route(); } } }, 'Empty the basket')) : null,
      h('p', { class: 'muted small' }, 'Records what happened to each cigar, with who and when. It takes no price or payment.'));
  }

  // ---- a dedicated scanner, on every screen -----------------------------------------------------
  //
  // A scanner set up as a keyboard (USB or Bluetooth; any maker) types what it
  // reads and Enter. RetailHid tells its fast bursts from a person typing. A
  // read goes to: the setup sheet's test while it is open; the camera scanner
  // while that is open; the screen that asked for reads (the register);
  // else it opens what was scanned. Typing in a box is never taken.

  function hidSettings() {
    try { return Hid.settings(JSON.parse(localStorage.getItem('cl-retail-hid') || '{}')); } catch (e) { return Hid.settings({}); }
  }
  function setHidSettings(v) {
    try { localStorage.setItem('cl-retail-hid', JSON.stringify(v)); } catch (e) { /* page only */ }
    hidReader = Hid.create(v);
  }
  var hidReader = Hid.create(hidSettings());
  function editable(t) {
    return !!t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
  }
  // A box marked data-scan (the register's search) takes typing and scans
  // alike: what a scan typed into it is taken back out, and the scan goes on
  // to the register. On the register, typing with nothing focused goes into
  // its search (state.typeTarget).
  var hidLast = -1;
  var hidSnap = null;
  function hidUndoTyping() {
    if (hidSnap && hidSnap.el.isConnected && hidSnap.el.value !== hidSnap.value) {
      hidSnap.el.value = hidSnap.value;
      hidSnap.el.dispatchEvent(new Event('input'));
    }
    hidSnap = null;
  }
  /**
   * In a box where people type too, a burst is a scan only when it looks like
   * one: no spaces, and either a scanner's pace (keys 20 ms apart or less) or
   * a code the register knows. A person typing "tabtor" fast is not a scan.
   */
  function scanInBox(scan) {
    if (/\s/.test(scan.code)) return false;
    var g = (scan.gaps || []).slice().sort(function (a, b) { return a - b; });
    var median = g.length ? g[g.length >> 1] : 0;
    return median <= 20 || !!(state.registerKnows && state.registerKnows(scan.code));
  }
  function overlayOpen() {
    return !!document.querySelector('.veil') || !!(self.RetailScanner && self.RetailScanner.active());
  }
  document.addEventListener('keydown', function (ev) {
    if (!state.store || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    var t = ev.target;
    var scanBox = t && t.getAttribute && t.getAttribute('data-scan') === '1' ? t : null;
    if (editable(t) && !scanBox) { hidReader.reset(); return; }
    var now = ev.timeStamp || performance.now();
    var box = scanBox || (state.typeTarget && state.typeTarget.isConnected && !overlayOpen() ? state.typeTarget : null);
    if (box && ev.key.length === 1 && (!hidReader.pending() || now - hidLast > hidReader.settings.maxGapMs)) hidSnap = { el: box, value: box.value };
    hidLast = now;
    var r = hidReader.key(ev.key, now);
    if (r && r.scan && scanBox && !scanInBox(r.scan)) {
      // A quick typist, not a scanner: the search's own Enter takes it.
      hidSnap = null;
      return;
    }
    if (r && r.scan) {
      ev.preventDefault();
      ev.stopPropagation();
      hidUndoTyping();
      routeScan(r.scan.code, r.scan);
      return;
    }
    if (r && r.burst && !scanBox && (ev.key === ' ' || ev.key === 'Enter')) { ev.preventDefault(); return; }
    if (!scanBox && box && !editable(t)) {
      if (ev.key.length === 1 && ev.key !== ' ') {
        ev.preventDefault();
        box.focus();
        box.value += ev.key;
        box.dispatchEvent(new Event('input'));
      } else if (ev.key === 'Escape' && state.registerReset) {
        state.registerReset();
      }
    }
  }, true);
  setInterval(function () {
    if (!hidReader.pending()) return;
    var r = hidReader.idle(performance.now());
    if (r && r.scan) { hidUndoTyping(); routeScan(r.scan.code, r.scan); }
  }, 40);

  function routeScan(code, meta) {
    state.lastHidAt = Date.now();
    if (state.hidTest) return state.hidTest(code, meta);
    var cam = self.RetailScanner && self.RetailScanner.active();
    if (cam) return cam.feed(code);
    if (state.hidHandler) return state.hidHandler(code, meta);
    lookupScan(code);
  }

  /** A read on any other screen: open its box, or say what it is. */
  async function lookupScan(code) {
    try {
      var r = await rpc('retail_code_resolve', { p_store: state.store.id, p_code: code });
      var known = ((r.kind === 'unit' || r.kind === 'box') && r.box) || (r.kind === 'product' && r.candidates.length);
      logScan(code, known ? 'good' : r.kind === 'label' ? 'warn' : 'bad', known ? 'found' : r.otherStore ? 'WRONG STORE' : r.kind === 'label' ? 'blank label' : 'UNKNOWN CODE', 'scanner');
      if ((r.kind === 'unit' || r.kind === 'box') && r.box) {
        tone('good');
        if (r.unit) toast(r.unit.token + ': ' + (UNIT_WORDS[r.unit.status] || r.unit.status) + ' · ' + r.unit.product.name);
        return go('/s/' + state.store.id + '/box/' + r.box.id);
      }
      if (r.kind === 'label') { tone('warn'); return toast('A blank box label (No. ' + r.no + '): on no box yet.'); }
      if (r.kind === 'product' && r.candidates.length) {
        tone(r.status === 'matched' ? 'good' : 'warn');
        return toast((r.status === 'matched' ? '' : 'Not confirmed here yet: ') + r.candidates.map(function (c) { return c.name; }).join(' / '));
      }
      tone('bad');
      toast(r.otherStore ? 'WRONG STORE: that label is another store\'s.' : 'UNKNOWN CODE · ' + code);
    } catch (e) { tone('bad'); toast(errorText(e)); }
  }

  // ---- the register --------------------------------------------------------------------------
  //
  // Always ready for the next scan: no button to press, nothing to focus. A
  // scan is looked up here (RetailRegister, on the register's own copy of the
  // store's codes), added to the sale at once with a beep, and checked with
  // the server behind it. Nothing leaves the inventory until Complete sale,
  // all at once. Payment is taken outside Cigar Locker.

  function regKey(what) {
    return 'cl-retail-' + what + ':' + state.store.id;
  }
  function loadJson(key, dflt) {
    try { var v = JSON.parse(localStorage.getItem(key) || 'null'); return v === null ? dflt : v; } catch (e) { return dflt; }
  }
  function saveJson(key, v) {
    try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* page only */ }
  }
  function registerName() {
    try { return localStorage.getItem('cl-retail-register-name') || 'Register'; } catch (e) { return 'Register'; }
  }

  async function registerView() {
    var cacheRaw = null;
    var offlineNote = '';
    try {
      cacheRaw = await rpc('retail_register_cache', { p_store: state.store.id });
      saveJson(regKey('regcache'), cacheRaw);
    } catch (e) {
      cacheRaw = loadJson(regKey('regcache'), null);
      if (!cacheRaw) throw e;
      offlineNote = 'No connection: working from this register\'s list of ' + new Date(cacheRaw.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + '.';
    }
    var ix = Reg.index(cacheRaw);
    var items = Pick.items(ix);
    var sale = loadJson(regKey('sale'), null);
    if (!sale || !sale.id || !Array.isArray(sale.lines)) sale = Reg.newSale(O.uuid());
    var reviews = {};
    var lastKey = null;
    function useCache(c) {
      cacheRaw = c;
      ix = Reg.index(c);
      items = Pick.items(ix);
      saveJson(regKey('regcache'), c);
    }

    var banner = h('div', { class: 'reg-banner idle', role: 'status', 'aria-live': 'polite' }, 'Ready: scan a barcode, search or tap');
    var linesEl = h('div', { class: 'reg-lines' });
    var totalEl = h('div', { class: 'reg-total' });
    var completeBtn = h('button', { class: 'btn primary big wide', type: 'button' });
    var msg = h('p', { class: 'error' });
    var recentEl = h('div', { class: 'list' });
    var saleEl = null;

    function keep() { saveJson(regKey('sale'), sale); }
    var quiet = false;
    var reading = null;
    function say(toneName, words) {
      banner.className = 'reg-banner ' + toneName;
      banner.textContent = words;
      if (toneName !== 'idle' && !quiet) tone(toneName);
      // Each scan's outcome kept once (the server's later word on it too, as its own).
      if (toneName !== 'idle' && reading) {
        logScan(reading.code, toneName, words, reading.input);
        reading = null;
      }
    }
    function lineSub(l) {
      if (l.kind === 'unit') return l.token + ' · from ' + l.boxCode;
      if (l.kind === 'king') return 'Whole box ' + l.boxCode;
      if (l.kind === 'queen') return (l.chosen ? 'Chosen from open box ' : 'From open box ') + l.boxCode;
      if (l.override) return 'Manager override · ' + (l.note || '');
      var opens = openBoxes(l.product);
      var how = l.by === 'hand' ? 'Chosen by hand' : 'By its factory code';
      return how + (ix.rule === 'fifo' && opens.length ? ' · oldest open box first' : '');
    }
    function openBoxes(pid) {
      var it = items.filter(function (x) { return x.id === pid; })[0];
      return it ? it.open.filter(function (b) { return b.remaining - b.labeled > 0; }) : [];
    }
    function draw() {
      var t = Reg.totals(sale);
      linesEl.replaceChildren.apply(linesEl, sale.lines.length ? sale.lines.slice().reverse().map(function (l) {
        var each = l.price === null || l.price === undefined ? 'no price' : money(l.price, true);
        var sub = h('div', { class: 'sub', text: reviews[l.key] || lineSub(l) });
        // A cigar chosen by hand comes from the oldest open box unless the cashier picks another.
        if (!reviews[l.key] && l.kind === 'product' && !l.override && ix.rule === 'fifo' && openBoxes(l.product).length > 1) {
          sub.appendChild(document.createTextNode(' · '));
          sub.appendChild(h('button', { class: 'linklike', type: 'button', onclick: function (ev) { ev.currentTarget.blur(); chooseBox(l); } }, 'Another box'));
        }
        return h('div', { class: 'reg-line' + (l.key === lastKey ? ' fresh' : '') + (reviews[l.key] ? ' review' : '') },
          h('div', { class: 'grow' }, h('div', { class: 'name', text: l.name }), sub),
          l.kind === 'queen' || l.kind === 'product'
            ? stepper(l.quantity, function (v) { sale = Reg.setQuantity(sale, l.key, v); keep(); drawTotals(); drawPick(); })
            : h('div', { class: 'qty', text: n(l.quantity) }),
          h('div', { class: 'reg-price' }, h('div', {}, l.price === null || l.price === undefined ? '—' : money(l.price * l.quantity, true)), h('div', { class: 'sub' }, each + (l.quantity > 1 ? ' each' : ''))),
          h('button', { class: 'btn small quiet', type: 'button', 'aria-label': 'Take ' + l.name + ' off the sale', onclick: function (ev) {
            ev.currentTarget.blur();
            sale = Reg.remove(sale, l.key);
            delete reviews[l.key];
            keep(); draw(); drawPick();
          } }, '×'));
      }) : [h('div', { class: 'reg-empty' }, 'Scan a cigar\'s barcode, search, or tap a brand.')]);
      drawTotals(t);
    }
    function drawTotals(t0) {
      var t = t0 || Reg.totals(sale);
      var held = Object.keys(reviews).filter(function (k) { return sale.lines.some(function (l) { return l.key === k; }); }).length;
      totalEl.replaceChildren(h('span', {}, n(t.cigars) + (t.cigars === 1 ? ' cigar' : ' cigars') + ' · ' + n(t.lines) + (t.lines === 1 ? ' line' : ' lines')),
        h('b', {}, money(t.cents, true) + (t.pricedAll ? '' : ' + unpriced')));
      completeBtn.disabled = !sale.lines.length || held > 0;
      completeBtn.textContent = held ? held + (held === 1 ? ' line needs review' : ' lines need review') : 'Complete sale · ' + n(t.cigars) + (t.cigars === 1 ? ' cigar' : ' cigars');
    }
    function chooseBox(l) {
      var list = h('div', { class: 'list' });
      var close = sheet('Which open box?', h('div', {},
        h('p', { class: 'muted small' }, 'The store takes the oldest open box first. Choose another when the cigar comes from it.'), list));
      openBoxes(l.product).forEach(function (b, i) {
        list.appendChild(h('button', { class: 'item tap', type: 'button', onclick: function () {
          sale = Reg.toQueen(sale, l.key, b.id, ix);
          var q = sale.lines.filter(function (x) { return x.kind === 'queen' && x.box === b.id; })[0];
          if (q && !q.entry) q.entry = l.entry || 'browse';
          keep(); draw(); close();
          say('good', l.name + ' · from open box ' + b.code);
        } }, h('div', { class: 'grow' }, h('div', { class: 'name', text: b.code + (i === 0 ? ' · oldest' : '') }),
          h('div', { class: 'sub', text: (b.remaining - b.labeled) + ' without labels · opened ' + (b.opened ? new Date(b.opened).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—') }))));
      });
    }

    /** A scanned code into the sale: at once from this register's list; checked with the server behind it. */
    async function onScan(code, meta) {
      var input = quiet ? 'camera' : meta && meta.typed ? 'typed' : meta ? 'scanner' : 'typed';
      reading = { code: code, input: input };
      var hit = Reg.resolve(ix, code, Codes);
      if (hit.kind === 'ask') {
        say('idle', 'Checking ' + hit.code + '…');
        var r;
        try { r = await rpc('retail_code_resolve', { p_store: state.store.id, p_code: hit.code }); }
        catch (e) { return say('bad', O.isNetworkError(e, navigator.onLine) ? 'UNKNOWN CODE · ' + hit.code + ' (no connection to check it)' : errorText(e)); }
        var w = Reg.serverWords(r);
        if (!w.add) return say(w.tone, w.words);
        // Made since this register's list was read: take it in and go on.
        if (r.kind === 'unit') {
          ix.units[r.unit.token] = { token: r.unit.token, id: r.unit.id, box: r.box.id };
          ix.boxById[r.box.id] = ix.boxById[r.box.id] || { id: r.box.id, code: r.box.code, state: r.box.state, remaining: r.box.remaining, original: r.box.original, product: r.box.product.id, labeled: 1 };
        } else {
          ix.boxes[r.box.code] = ix.boxById[r.box.id] = { id: r.box.id, code: r.box.code, state: r.box.state, remaining: r.box.remaining, original: r.box.original, product: r.box.product.id, labeled: 0 };
        }
        if (!ix.products[r.box.product.id]) ix.products[r.box.product.id] = { id: r.box.product.id, name: r.box.product.name, price: r.box.product.priceCents };
        hit = Reg.resolve(ix, code, Codes);
      }
      // A factory barcode this register does not know: the server may (linked at
      // another register, or known at other shops); else it is linked here, once.
      if (hit.kind === 'unknown' && !Codes.ownCode(code)) {
        hit = await askServer(code, input);
        if (!hit) return;
      }
      var res = Reg.scan(sale, hit, ix);
      if (res.status === 'added') {
        took(res, input, code);
        say('good', '✓ ' + res.words + priceWords(res));
        if (hit.kind === 'unit') check(hit.code, res.key);
        return;
      }
      if (res.status === 'box-code') {
        say('warn', res.words);
        boxCodeButtons(hit, code, input);
        return;
      }
      if (res.status === 'duplicate' && hit.kind === 'unit') {
        say('warn', res.words);
        if (can('manager')) {
          banner.appendChild(h('button', { class: 'btn small', type: 'button', onclick: function (ev) {
            ev.currentTarget.blur();
            sale = Reg.override(sale, hit.code, ix);
            lastKey = sale.lines[sale.lines.length - 1].key;
            keep(); draw(); drawPick();
            say('warn', 'Manager override: one more ' + hit.product.name + ', taken by the store\'s rule and recorded.');
          } }, 'Override: it is a second cigar'));
        }
        return;
      }
      say(res.tone, res.words);
    }
    function priceWords(res) {
      return res.price === null || res.price === undefined ? '' : ' · ' + money(res.price * (res.quantity || 1), true);
    }
    /** A line just added: kept, drawn, and marked with how it went in and the barcode it was read by (the first, when it grows). */
    function took(res, entry, code) {
      sale = res.sale;
      lastKey = res.key;
      sale.lines.forEach(function (l) {
        if (l.key !== res.key) return;
        if (!l.entry) l.entry = entry;
        if (!l.code && code && !Codes.ownCode(code)) l.code = String(code).trim();
      });
      keep();
      draw();
      drawPick();
    }
    // ---- factory barcodes: unknown here, known elsewhere, a box's ------------------------------------

    function canLink() {
      return can('manager') || ix.mapRole !== 'manager';
    }
    function unitWords(unit, quantity) {
      return unit === 'box' ? ' (a box' + (quantity ? ' of ' + quantity : '') + ')' : unit === 'pack' ? ' (a pack' + (quantity ? ' of ' + quantity : '') + ')' : '';
    }
    function bannerButton(words, onTap, primary) {
      banner.appendChild(h('button', { class: 'btn small' + (primary ? ' primary' : ''), type: 'button', onclick: function (ev) { ev.currentTarget.blur(); onTap(); } }, words));
    }
    /** Asks the server about a barcode this register does not know. Answers a hit to add, or null (the banner says why). */
    async function askServer(code, input) {
      var r = null;
      var offline = false;
      say('idle', 'Looking up ' + code + '…');
      try { r = await rpc('retail_code_resolve', { p_store: state.store.id, p_code: code }); }
      catch (e) {
        offline = O.isNetworkError(e, navigator.onLine);
        if (!offline) { say('bad', errorText(e)); return null; }
      }
      if (r && r.kind === 'product' && r.status === 'matched' && r.candidates.length === 1 && ix.products[r.candidates[0].id]) {
        var c = r.candidates[0];
        if (c.identifier) Reg.addMapping(ix, { code: code, product: c.id, unit: c.unit, unitQuantity: c.unitQuantity, verified: c.verified, id: c.identifier });
        else (ix.byUpc[Reg.normDigits(code)] = [c.id]);
        return Reg.resolve(ix, code, Codes);
      }
      if (r && r.kind === 'product' && r.status === 'matched' && r.candidates.length > 1) {
        say('bad', 'PRODUCT NEEDS REVIEW: ' + code + ' names ' + r.candidates.length + ' cigars here (' + r.candidates.map(function (x) { return x.name; }).join(', ') + '). A manager corrects it on the cigar\'s page in Products.');
        return null;
      }
      if (r && r.kind === 'product' && r.status === 'possible') {
        var known = r.candidates.filter(function (x) { return x.product && ix.products[x.product.id]; })[0];
        if (known) {
          var p = ix.products[known.product.id];
          say('warn', 'KNOWN AT OTHER SHOPS · ' + code + ' is ' + p.name + unitWords(known.unit, known.unitQuantity) + '. Is it?');
          if (canLink()) {
            bannerButton('Yes, link it', function () {
              saveMapping(code, p.id, known.unit && known.unit !== 'unknown' ? known.unit : 'single', known.unitQuantity, 'shared', input);
            }, true);
            bannerButton('No, choose the cigar', function () { startLinking(code, input); });
          }
          return null;
        }
      }
      if (r && r.kind === 'box' && r.box) {
        say('bad', code + ' is the serial on box ' + r.box.code + '. Scan the box\'s Cigar Locker label.');
        return null;
      }
      say('bad', 'UNKNOWN BARCODE · ' + code + (offline ? ' (no connection to look it up)' : ''));
      if (!offline && canLink()) bannerButton('Link it to a cigar', function () { startLinking(code, input); }, true);
      else if (!offline) banner.appendChild(h('span', { class: 'small' }, 'A manager links new barcodes at this store.'));
      return null;
    }
    /** A box's barcode at the register: a whole box goes by its own label; one cigar on request. */
    function boxCodeButtons(hit, code, input) {
      bannerButton('Add one cigar', function () {
        var r2 = Reg.scan(sale, Object.assign({}, hit, { single: true }), ix);
        if (r2.status === 'added') { took(r2, input, code); say('good', '✓ ' + r2.words + priceWords(r2)); }
        else say(r2.tone, r2.words);
      }, true);
      if (can('manager')) bannerButton('It is on single cigars', function () { saveMapping(code, hit.product.id, 'single', 1, 'register', input); });
    }

    // Linking: the search and the tiles choose the cigar; the next tap opens the link, not the sale.
    var linking = null;
    function startLinking(code, input) {
      reset(false);
      linking = { code: String(code).trim(), input: input || 'scanner' };
      drawPick();
      say('idle', 'Linking ' + linking.code + ': find the cigar it is on, then tap it.');
      if (fine) search.focus({ preventScroll: true });
    }
    function linkingStrip() {
      if (!linking) return null;
      return h('div', { class: 'reg-linking' },
        h('div', { class: 'grow' }, h('div', { class: 'name' }, 'Link barcode ', h('b', {}, linking.code)),
          h('div', { class: 'sub' }, 'Search or tap through the brands to the cigar it is on.')),
        h('button', { class: 'btn small', type: 'button', onclick: function (ev) { ev.currentTarget.blur(); linking = null; drawPick(); say('idle', 'Ready: scan, search or tap'); } }, 'Cancel'));
    }
    function linkSheet(it) {
      var code = linking.code;
      var input = linking.input;
      var unit = 'single';
      var qty = it.product.boxCount || null;
      var seg = h('div', { class: 'seg' });
      var qtyField = field('Cigars in it', stepper(qty, function (v) { qty = v; }));
      function drawSeg() {
        seg.replaceChildren.apply(seg, [['single', 'One cigar'], ['box', 'A box'], ['pack', 'A pack']].map(function (o) {
          return h('button', { type: 'button', class: unit === o[0] ? 'on' : '', onclick: function () { unit = o[0]; drawSeg(); } }, o[1]);
        }));
        qtyField.hidden = unit === 'single';
      }
      drawSeg();
      var msg = h('p', { class: 'error' });
      var close = sheet('Link this barcode', h('div', {},
        h('p', { class: 'reg-linkcode' }, code),
        h('p', {}, 'is on ', h('b', {}, it.name), it.size ? ' · ' + it.size : ''),
        h('div', { class: 'field' }, h('span', {}, 'It is printed on'), seg),
        qtyField,
        h('p', { class: 'muted small' }, 'From now on this barcode finds this cigar at once, at every register here. '
          + (can('manager') ? 'Saved by a manager, it is also offered to other Cigar Locker shops.' : 'A manager checks it later.')),
        msg,
        h('button', { class: 'btn primary wide', type: 'button', onclick: async function (ev) {
          if (unit !== 'single' && !(qty >= (unit === 'pack' ? 2 : 1))) { msg.textContent = 'How many cigars in the ' + unit + '?'; return; }
          ev.currentTarget.disabled = true;
          close();
          await saveMapping(code, it.id, unit, unit === 'single' ? 1 : qty, 'register', input);
        } }, 'Save mapping')));
    }
    /** Saves a mapping, takes it into this register's list at once, and adds the cigar when the code is on one. */
    async function saveMapping(code, pid, unit, qty, source, input) {
      var r;
      say('idle', 'Saving…');
      try {
        r = await rpc('retail_code_map', { p_store: state.store.id, p_code: code, p_product: pid, p_unit: unit, p_quantity: qty || null,
                                            p_type: null, p_source: source || 'register', p_note: '' });
      } catch (e) { say('bad', errorText(e)); return; }
      var m = r.mapping;
      Reg.addMapping(ix, m);
      cacheRaw.codes = (cacheRaw.codes || []).filter(function (x) { return x[0] !== m.norm; }).concat([[m.norm, m.product, m.unit, m.unitQuantity, m.verified, m.id]]);
      saveJson(regKey('regcache'), cacheRaw);
      linking = null;
      reset(false);
      var name = (ix.products[pid] || {}).name || 'the cigar';
      var hit = Reg.resolve(ix, code, Codes);
      var res = Reg.scan(sale, hit, ix);
      if (res.status === 'added') {
        took(res, input || 'scanner', code);
        say('good', '✓ Linked and added · ' + res.words + priceWords(res));
        logScan(code, 'good', 'linked · ' + name, input || 'scanner');
      } else if (res.status === 'box-code') {
        say('good', 'Linked: ' + code + ' is the barcode on a box' + (m.unitQuantity ? ' of ' + m.unitQuantity : '') + ' of ' + name + '. To sell a whole box, scan its Cigar Locker label.');
        boxCodeButtons(hit, code, input);
      } else {
        say(res.tone, 'Linked: ' + code + ' is ' + name + '. ' + res.words);
      }
    }

    /** The server's word on a labeled cigar just added (sold at another register meanwhile?). */
    function check(token, key) {
      rpc('retail_code_resolve', { p_store: state.store.id, p_code: token }).then(function (r) {
        var w = Reg.serverWords(r);
        if (w.add) return;
        reviews[key] = w.words;
        draw();
        say('bad', w.words);
      }).catch(function () { /* offline: the server checks it at Complete sale */ });
    }

    // ---- choosing by hand: the search, the tiles, the lists ----------------------------------------

    var path = { brand: null, line: null, version: null, auto: {} };
    var homeTab = localStorage.getItem('cl-retail-reghome') || 'brands';
    var brandSort = localStorage.getItem('cl-retail-brandsort') || 'sold';
    var arrange = false;
    var hi = -1;
    var shown = [];
    var localSold = loadJson(regKey('recent'), {});
    var search = h('input', { class: 'input reg-search', type: 'search', 'data-scan': '1', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
      enterkeyhint: 'go', placeholder: 'Search: brand, line, size, SKU, or a code', 'aria-label': 'Search this store\'s cigars' });
    var clearBtn = h('button', { class: 'reg-clear', type: 'button', 'aria-label': 'Clear the search' }, '×');
    var crumbsEl = h('div', { class: 'reg-crumbs' });
    var pickEl = h('div', { class: 'reg-pickbody' });
    var arrangeBtn = can('manager') ? h('button', { class: 'btn small', type: 'button' }, 'Arrange') : null;
    var fine = window.matchMedia && window.matchMedia('(pointer: fine)').matches;

    function inSaleOf(pid) {
      return sale.lines.reduce(function (s, l) { return s + (l.product === pid ? l.quantity : 0); }, 0);
    }
    function variantBtn(it, opts) {
      var o = opts || {};
      var free = Reg.freeFor(ix, sale, it.id);
      var left = it.onHand - inSaleOf(it.id);
      var pinned = Pick.isPinned(ix.pins, 'product', it.id);
      var title = o.full ? it.name : it.vitola || it.size || it.name;
      var stock = it.onHand ? n(Math.max(0, left)) + ' on hand' : 'None on hand';
      // The oldest open box, less what this sale already takes from it (by the rule, or chosen).
      var fromOldest = it.queen ? sale.lines.reduce(function (s0, l) {
        return s0 + ((l.kind === 'product' && l.product === it.id) || (l.kind === 'queen' && l.boxCode === it.queen.code) ? l.quantity : 0);
      }, 0) : 0;
      var queen = it.queen && ix.rule === 'fifo' ? 'Open box: ' + n(Math.max(0, it.queen.remaining - fromOldest)) + ' left' : it.sealed && !it.open.length ? 'Sealed boxes only' : '';
      var b = h('button', { class: 'reg-var' + (free <= 0 ? ' dim' : '') + (o.hi ? ' hi' : '') + (arrange && pinned ? ' pinned' : ''), type: 'button',
        'data-product': it.id, 'aria-label': it.name + (it.price === null ? '' : ', ' + money(it.price, true)) + ', ' + stock },
        h('div', { class: 'v-top' }, h('span', { class: 'v-name', text: title }), it.low ? h('span', { class: 'chip warn', text: 'Low' }) : null,
          arrange ? h('span', { class: 'v-pin', text: pinned ? '★' : '☆' }) : null),
        o.full || !it.size || it.size === title ? (o.full && it.size ? h('div', { class: 'v-size', text: it.size }) : null) : h('div', { class: 'v-size', text: it.size }),
        h('div', { class: 'v-foot' }, h('b', { text: it.price === null || it.price === undefined ? 'No price' : money(it.price, true) }),
          h('span', { class: 'v-stock', text: stock + (queen ? ' · ' + queen : '') })));
      b.addEventListener('click', function (ev) {
        ev.currentTarget.blur();
        if (arrange) return pin('product', it.id, null, !pinned);
        add(it, o.entry || 'browse', 1);
      });
      return b;
    }
    function tile(name, sub, onTap, extra) {
      return h('button', { class: 'reg-tile' + (extra && extra.cls ? ' ' + extra.cls : ''), type: 'button', onclick: function (ev) { ev.currentTarget.blur(); onTap(); } },
        h('span', { class: 't-name', text: name }), sub ? h('span', { class: 't-sub', text: sub }) : null, extra && extra.star ? h('span', { class: 't-star', text: extra.star }) : null);
    }
    function grid(nodes, cls) {
      return h('div', { class: cls || 'reg-grid' }, nodes);
    }
    // A pin shows at once; the server's list follows (the newest request's answer only).
    var pinSeq = 0;
    async function pin(kind, product, brand, on) {
      var before = ix.pins.slice();
      var same = function (p) { return p.kind === kind && (kind === 'product' ? p.product === product : Pick.plain(p.brand) === Pick.plain(brand)); };
      var last = ix.pins.filter(function (p) { return p.kind === kind; }).reduce(function (m, p) { return Math.max(m, p.position); }, 0);
      ix.pins = on ? ix.pins.filter(function (p) { return !same(p); }).concat([{ kind: kind, product: product || null, brand: brand || '', position: last + 1 }])
        : ix.pins.filter(function (p) { return !same(p); });
      say('good', (on ? 'Pinned to the register\'s home: ' : 'Taken off the register\'s home: ') + (brand || (ix.products[product] || {}).name || ''));
      drawPick();
      var mine = ++pinSeq;
      try {
        var pins = await rpc('retail_register_pin', { p_store: state.store.id, p_kind: kind, p_product: product, p_brand: brand, p_on: on });
        if (mine !== pinSeq) return;
        cacheRaw.pins = pins;
        ix.pins = pins.map(function (x) { return { kind: x[0], product: x[1] || null, brand: x[2] || '', position: Number(x[3] || 0) }; });
        saveJson(regKey('regcache'), cacheRaw);
      } catch (e) {
        if (mine === pinSeq) ix.pins = before;
        say('bad', errorText(e));
      }
      drawPick();
    }

    /** One cigar (or qty) chosen by hand, into the sale; then back to the start. */
    function add(it, entry, qty) {
      if (linking) return linkSheet(it);
      var res = null;
      var added = 0;
      for (var i = 0; i < (qty || 1); i++) {
        res = Reg.scan(sale, { kind: 'product', product: it.product, by: 'hand' }, ix);
        if (res.status !== 'added') break;
        took(res, entry);
        added++;
      }
      if (!added) {
        say(res.tone, it.sealed && !it.open.length && ix.rule === 'fifo'
          ? 'No ' + it.name + ' open: open a box, or scan the box\'s label to sell it whole.'
          : res.words);
      } else {
        var where = it.open.length && ix.rule === 'fifo' ? ' · from the oldest open box' : '';
        say(added < qty ? 'warn' : 'good', '✓ ' + (added > 1 ? added + ' × ' : '') + it.name + where + (added < qty ? ' · only ' + added + ' could be added: ' + res.words : ''));
      }
      reset(true);
    }
    /** Back to where a sale starts: the search empty, the brands showing. */
    function reset(afterAdd) {
      var hadFocus = document.activeElement === search;
      search.value = '';
      path = { brand: null, line: null, version: null, auto: {} };
      hi = -1;
      linking = null;
      drawPick();
      if (hadFocus || (afterAdd && fine)) search.focus({ preventScroll: true });
    }
    state.registerReset = function () { reset(false); };

    function fillPick() {
      pickEl.replaceChildren.apply(pickEl, [linkingStrip()].concat(Array.prototype.slice.call(arguments)).filter(Boolean));
    }
    function drawPick() {
      var q = Pick.parse(search.value);
      clearBtn.hidden = !search.value;
      if (q.tokens.length) return drawResults(q);
      shown = [];
      var st = Pick.step(items, path, brandSort, ix.pins);
      path = st.path;
      drawCrumbs(st);
      if (st.level === 'brands') return drawHome(st.options);
      if (st.level === 'lines' || st.level === 'versions') {
        pickEl.replaceChildren(grid(st.options.map(function (g) {
          return tile(g.name, n(g.count) + (g.count === 1 ? ' size' : ' sizes'), function () {
            if (st.level === 'lines') path = { brand: path.brand, line: g.key, version: null, auto: {} };
            else path = { brand: path.brand, line: path.line, version: g.key, auto: { line: path.auto.line } };
            drawPick();
          });
        }), 'reg-grid tiles'));
        return;
      }
      pickEl.replaceChildren(grid(st.options.map(function (it) { return variantBtn(it, { entry: 'browse' }); }), 'reg-grid vars'));
    }
    function drawCrumbs(st) {
      if (st.level === 'brands') { crumbsEl.replaceChildren(); crumbsEl.hidden = true; return; }
      crumbsEl.hidden = false;
      var parts = [h('button', { class: 'btn small reg-back', type: 'button', onclick: function (ev) { ev.currentTarget.blur(); path = Pick.back(path); drawPick(); } }, '‹ Back'),
        h('button', { class: 'crumb', type: 'button', onclick: function () { path = Pick.upTo(path, 'home'); drawPick(); } }, 'All brands')];
      st.crumbs.forEach(function (c, i) {
        parts.push(h('span', { class: 'sep', text: '›' }));
        var last = i === st.crumbs.length - 1 && st.level === 'sizes';
        parts.push(c.auto || last ? h('span', { class: 'crumb here', text: c.name })
          : h('button', { class: 'crumb', type: 'button', onclick: function () { path = Pick.upTo(path, c.level); drawPick(); } }, c.name));
      });
      crumbsEl.replaceChildren.apply(crumbsEl, parts);
    }
    function drawHome(brandGroups) {
      var favs = Pick.favorites(items, ix.pins);
      var seg = h('div', { class: 'seg' }, [['brands', 'Brands'], ['recent', 'Recent'], ['most', 'Most sold']].map(function (o) {
        return h('button', { type: 'button', class: homeTab === o[0] ? 'on' : '', onclick: function () { homeTab = o[0]; try { localStorage.setItem('cl-retail-reghome', o[0]); } catch (e) { /* page only */ } drawPick(); } }, o[1]);
      }));
      var body;
      if (homeTab === 'recent' || homeTab === 'most') {
        var list = homeTab === 'recent' ? Pick.recent(items, localSold, 16) : Pick.mostSold(items, 16);
        body = list.length ? grid(list.map(function (it) { return variantBtn(it, { full: true, entry: homeTab === 'recent' ? 'recent' : 'most_sold' }); }), 'reg-grid vars')
          : h('p', { class: 'muted reg-none' }, homeTab === 'recent' ? 'Nothing sold yet: cigars appear here as they sell.' : 'No sales in the last 90 days yet.');
      } else {
        var sortSeg = h('div', { class: 'seg small' }, [['sold', 'Most sold'], ['pinned', 'Pinned'], ['alpha', 'A–Z']].map(function (o) {
          return h('button', { type: 'button', class: brandSort === o[0] ? 'on' : '', onclick: function () { brandSort = o[0]; try { localStorage.setItem('cl-retail-brandsort', o[0]); } catch (e) { /* page only */ } drawPick(); } }, o[1]);
        }));
        body = h('div', {}, h('div', { class: 'reg-sortrow' }, h('span', { class: 'muted small' }, 'Brands on hand'), sortSeg),
          brandGroups.length ? grid(brandGroups.map(function (g) {
            var star = g.pinned !== null ? '★' : arrange ? '☆' : '';
            var t = tile(g.name, n(g.count) + (g.count === 1 ? ' size' : ' sizes'), function () {
              if (arrange) return pin('brand', null, g.name, g.pinned === null);
              path = { brand: g.key, line: null, version: null, auto: {} };
              drawPick();
            }, { star: star, cls: 'brand' });
            return t;
          }), 'reg-grid tiles') : h('p', { class: 'muted reg-none' }, 'No cigars on hand yet. Receive or count them, and their brands appear here.'));
      }
      fillPick(
        favs.length ? h('div', { class: 'reg-favs' }, h('p', { class: 'over' }, 'Favorites'), grid(favs.map(function (it) { return variantBtn(it, { full: true, entry: 'favorite' }); }), 'reg-grid vars')) : null,
        arrange ? h('p', { class: 'info-text small' }, 'Arranging: tap a brand or a cigar to pin it to this home, or to take it off. Pinned brands lead when sorted by Pinned.') : null,
        seg, body);
    }
    function drawResults(q) {
      crumbsEl.hidden = true;
      var results = Pick.search(items, q, { recent: localSold });
      var on = results.filter(function (r) { return r.stocked; }).slice(0, 24);
      var off = results.filter(function (r) { return !r.stocked; }).slice(0, 6);
      shown = on.map(function (r) { return r.item; });
      if (hi >= shown.length) hi = shown.length - 1;
      var sole = Pick.sole(results);
      var head = on.length
        ? h('p', { class: 'muted small reg-hint' }, sole ? 'Enter adds ' + (q.qty > 1 ? q.qty + ' × ' : '') + sole.item.name + '.' : n(on.length) + (on.length === 1 ? ' cigar' : ' cigars') + ' on hand. ↑ ↓ to choose, Enter to add.')
        : h('div', { class: 'reg-none' }, h('p', { class: 'muted' }, 'Nothing on hand matches “' + q.text + '”.'),
          h('button', { class: 'btn small', type: 'button', onclick: function (ev) { ev.currentTarget.blur(); demandSheet('register', null, q.text); } }, 'Note it as asked for'));
      fillPick(head,
        on.length ? grid(on.map(function (r, i) { return variantBtn(r.item, { full: true, entry: 'search', hi: i === hi || (hi < 0 && sole && r === sole) }); }), 'reg-grid vars') : null,
        off.length ? h('p', { class: 'over' }, 'Not on hand') : null,
        // Linking a barcode, a cigar with none on hand can be chosen too.
        off.length && linking ? grid(off.map(function (r) { return variantBtn(r.item, { full: true, entry: 'search' }); }), 'reg-grid vars') : null,
        off.length && !linking ? h('div', { class: 'list' }, off.map(function (r) {
          return h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'name', text: r.item.name }), h('div', { class: 'sub', text: 'None on hand' + (r.item.price === null ? '' : ' · ' + money(r.item.price, true)) })));
        })) : null);
    }

    search.addEventListener('input', function () { hi = -1; drawPick(); });
    search.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        if (!shown.length) return;
        ev.preventDefault();
        hi = ev.key === 'ArrowDown' ? Math.min(shown.length - 1, hi + 1) : Math.max(0, hi - 1);
        drawPick();
        var el = pickEl.querySelector('.reg-var.hi');
        if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        reset(false);
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        enter();
      }
    });
    clearBtn.addEventListener('click', function () { reset(false); search.focus(); });
    /** Enter in the search: a code typed is a scan; else the cigar chosen, or the only one that fits. */
    function enter() {
      var text = search.value.trim();
      if (!text) return;
      var q = Pick.parse(text);
      if (!/\s/.test(text)) {
        var hit = Reg.resolve(ix, text, Codes);
        // A code (or a barcode's digits typed) is a scan, known or not.
        if (hit.kind !== 'unknown' || /^[0-9]{8,14}$/.test(text)) {
          reset(false);
          return onScan(text, { typed: true });
        }
      }
      var results = Pick.search(items, q, { recent: localSold });
      var pick = hi >= 0 && shown[hi] ? shown[hi] : (Pick.sole(results) || {}).item;
      if (pick) return add(pick, 'search', q.qty);
      var on = results.filter(function (r) { return r.stocked; });
      if (!on.length) return say('bad', 'Nothing on hand matches “' + q.text + '”.');
      hi = 0;
      drawPick();
      say('warn', n(on.length) + ' cigars match. ↑ ↓ to choose, then Enter.');
    }
    if (arrangeBtn) {
      arrangeBtn.addEventListener('click', function (ev) {
        ev.currentTarget.blur();
        arrange = !arrange;
        arrangeBtn.textContent = arrange ? 'Done arranging' : 'Arrange';
        arrangeBtn.classList.toggle('primary', arrange);
        drawPick();
      });
    }

    async function complete(ev) {
      if (ev) ev.currentTarget.blur();
      msg.textContent = '';
      if (!sale.lines.length) return;
      var t = Reg.totals(sale);
      var args = { p_store: state.store.id, p_sale: sale.id, p_register: registerName(), p_lines: Reg.forServer(sale), p_started: sale.started,
                   p_payment_provider: '', p_payment_ref: '', p_note: '' };
      completeBtn.disabled = true;
      var done = sale;
      try {
        var r = await rpc('retail_register_complete', args);
        if (!r.ok) {
          var l = r.line ? sale.lines[r.line - 1] : null;
          if (l) reviews[l.key] = r.words;
          draw();
          say('bad', (l ? l.name + ': ' : '') + r.words + ' Nothing was sold. Take that line off, or scan it again.');
          return;
        }
        Reg.afterSale(ix, done);
        say('good', 'Sale complete · ' + n(r.cigars) + (r.cigars === 1 ? ' cigar' : ' cigars') + (r.totalCents ? ' · ' + money(r.totalCents, true) : '') + (r.repeat ? ' (already done)' : ''));
      } catch (e) {
        if (!O.isNetworkError(e, navigator.onLine)) { msg.textContent = errorText(e); drawTotals(); return; }
        // Completed at the counter with no connection: kept here and sent once when it is back.
        outbox.add({ op: done.id, fn: 'retail_register_complete', args: args, label: 'Sale · ' + t.cigars + (t.cigars === 1 ? ' cigar' : ' cigars'), store: state.store.id, at: Date.now() });
        Reg.afterSale(ix, done);
        drawNet();
        say('warn', 'Sale kept on this register (no connection): sent once when it is back.');
      }
      // What this sale's scans counted goes to the server now, not at the next quarter minute.
      flushScanLog();
      localSold = Pick.noteSold(localSold, done.lines.map(function (x) { return x.product; }));
      saveJson(regKey('recent'), localSold);
      items = Pick.items(ix);
      sale = Reg.newSale(O.uuid());
      reviews = {};
      lastKey = null;
      keep();
      draw();
      reset(false);
      refreshRecent();
      rpc('retail_register_cache', { p_store: state.store.id }).then(function (c) { useCache(c); drawPick(); }).catch(function () {});
    }
    completeBtn.addEventListener('click', complete);

    function cancel(ev) {
      if (ev) ev.currentTarget.blur();
      if (sale.lines.length && !confirm('Cancel this sale? Nothing was taken out of the inventory by it.')) return;
      sale = Reg.newSale(O.uuid());
      reviews = {};
      keep();
      draw();
      reset(false);
      say('idle', 'Sale cancelled. Ready: scan a barcode, search or tap');
    }
    function camera(ev) {
      if (ev) ev.currentTarget.blur();
      state.registerCamera = true;
      self.RetailScanner.open({
        title: 'Register · ' + registerName(),
        hint: 'A cigar\'s barcode, a box\'s Cigar Locker label, or a cigar\'s own label. Each adds to the sale.',
        onClose: function () { state.registerCamera = false; draw(); },
        onCode: async function (code) {
          // The camera's own flash beeps once for it.
          quiet = true;
          try { await onScan(code); } finally { quiet = false; }
          return { tone: /bad/.test(banner.className) ? 'bad' : /warn/.test(banner.className) ? 'warn' : 'good', words: banner.textContent };
        },
      });
    }
    async function refreshRecent() {
      try {
        var list = await rpc('retail_sales_recent', { p_store: state.store.id, p_limit: 8 });
        recentEl.replaceChildren.apply(recentEl, list.length ? list.map(function (s) {
          return h('div', { class: 'item' }, h('div', { class: 'grow' },
            h('div', { class: 'name', text: new Date(s.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + ' · ' + n(s.cigars) + (s.cigars === 1 ? ' cigar' : ' cigars') }),
            h('div', { class: 'sub', text: [s.register, s.by].filter(Boolean).join(' · ') + ' · ' + (s.lines || []).map(function (l) { return (l.quantity > 1 ? l.quantity + ' × ' : '') + l.name; }).join(', ') })),
            h('div', { class: 'qty', text: s.totalCents ? money(s.totalCents, true) : '' }));
        }) : [h('div', { class: 'item muted' }, 'No sale completed yet.')]);
      } catch (e) { /* offline */ }
    }

    state.hidHandler = onScan;
    state.typeTarget = search;
    state.registerKnows = function (code) { return Reg.resolve(ix, code, Codes).kind !== 'unknown'; };
    draw();
    drawPick();
    show(
      h('div', { class: 'reg-head' }, h('div', {}, h('p', { class: 'over' }, 'Register'), h('h1', { text: registerName() })),
        h('div', { class: 'btns' },
          h('button', { class: 'btn small', type: 'button', onclick: camera }, 'Camera'),
          h('button', { class: 'btn small', type: 'button', onclick: function (ev) { ev.currentTarget.blur(); demandSheet('register'); } }, 'Asked for, not stocked'),
          arrangeBtn,
          h('button', { class: 'btn small', type: 'button', onclick: function (ev) { ev.currentTarget.blur(); scannerSetup(); } }, 'Scanner setup'))),
      offlineNote ? h('p', { class: 'warn-text small' }, offlineNote) : null,
      h('div', { class: 'reg-wrap' },
        banner,
        h('section', { class: 'reg-pick', 'aria-label': 'Find a cigar' },
          h('div', { class: 'reg-searchrow' }, search, clearBtn),
          crumbsEl,
          pickEl),
        saleEl = h('section', { class: 'reg-sale', 'aria-label': 'The sale' },
          linesEl,
          totalEl,
          msg,
          h('div', { class: 'btns' }, completeBtn),
          h('div', { class: 'btns' }, h('button', { class: 'btn quiet', type: 'button', onclick: cancel }, 'Cancel sale')),
          h('p', { class: 'muted small' }, 'Take payment as you do today, then Complete sale: only then do the cigars leave the inventory, all at once. Cigar Locker takes no payment.'))),
      h('h2', { text: 'Recent sales' }),
      recentEl);
    // Beside the tiles (a tablet across, a desk), what was just added sits on top of the
    // sale, which stays in view; on a narrow screen it sticks above the tiles.
    var wide = window.matchMedia ? window.matchMedia('(min-width: 740px)') : { matches: true };
    function placeBanner() {
      if (wide.matches) saleEl.insertBefore(banner, saleEl.firstChild);
      else saleEl.parentNode.insertBefore(banner, saleEl.parentNode.firstChild);
    }
    placeBanner();
    if (wide.addEventListener) wide.addEventListener('change', placeBanner);
    if (fine) search.focus({ preventScroll: true });
    refreshRecent();
    every(30000, function () {
      rpc('retail_register_cache', { p_store: state.store.id }).then(function (c) {
        useCache(c);
        // Redrawn only while nothing is being typed, so the list never jumps under a finger.
        if (!search.value) drawPick();
      }).catch(function () {});
    });
  }

  /** Setting up a scanner on this device: what it sends, a test, the register's name, the factory-code rule. */
  function scannerSetup() {
    var cfg = hidSettings();
    var name = h('input', { class: 'input', value: registerName(), maxlength: '60' });
    var prefix = h('input', { class: 'input', value: cfg.prefix, maxlength: '8', placeholder: 'none' });
    var suffix = h('input', { class: 'input', value: cfg.suffix, maxlength: '8', placeholder: 'none' });
    var gap = cfg.maxGapMs;
    var term = cfg.terminator;
    var termSeg = h('div', { class: 'seg' });
    function drawTerm() {
      termSeg.replaceChildren.apply(termSeg, [['Enter', 'Enter'], ['Tab', 'Tab'], ['none', 'Nothing (a pause)']].map(function (o) {
        return h('button', { type: 'button', class: term === o[0] ? 'on' : '', onclick: function () { term = o[0]; drawTerm(); } }, o[1]);
      }));
    }
    drawTerm();
    var test = h('div', { class: 'reg-test', tabindex: '0' }, 'Tap here, then scan any code.');
    var rule = null;
    var mapRole = null;
    var ruleSeg = h('div', { class: 'seg' });
    var ruleMsg = h('p', { class: 'muted small' });
    var roleSeg = h('div', { class: 'seg' });
    var roleMsg = h('p', { class: 'muted small' });
    function drawRole() {
      roleSeg.replaceChildren.apply(roleSeg, [['employee', 'Anyone at the register'], ['manager', 'Managers only']].map(function (o) {
        return h('button', { type: 'button', class: mapRole === o[0] ? 'on' : '', disabled: !can('manager'), onclick: async function () {
          try { mapRole = await rpc('retail_code_mapping_role_set', { p_store: state.store.id, p_role: o[0] }); drawRole(); } catch (e) { roleMsg.textContent = errorText(e); }
        } }, o[1]);
      }));
      roleMsg.textContent = mapRole === 'manager'
        ? 'A barcode the store does not know yet waits for a manager to link it.'
        : 'Anyone at the register links a barcode the store does not know yet; a manager checks it later on the cigar\'s page in Products.';
    }
    async function drawRule() {
      if (rule === null) {
        try { var c = await rpc('retail_register_cache', { p_store: state.store.id }); rule = c.rule; mapRole = c.mapRole || 'employee'; }
        catch (e) { rule = 'fifo'; mapRole = 'employee'; }
        drawRole();
      }
      ruleSeg.replaceChildren.apply(ruleSeg, [['fifo', 'The open box opened first, then loose'], ['labels', 'Only loose cigars']].map(function (o) {
        return h('button', { type: 'button', class: rule === o[0] ? 'on' : '', disabled: !can('manager'), onclick: async function () {
          try { rule = await rpc('retail_register_rule_set', { p_store: state.store.id, p_rule: o[0] }); drawRule(); } catch (e) { ruleMsg.textContent = errorText(e); }
        } }, o[1]);
      }));
      ruleMsg.textContent = rule === 'labels'
        ? 'A barcode on a cigar or box takes only loose cigars: an open box\'s cigars leave only by their own labels.'
        : 'A barcode takes cigars without their own label from the open box opened first, then loose ones. A labeled cigar is never taken at random.';
    }
    drawRule();
    state.hidTest = function (code, meta) {
      var fast = meta.gaps.length ? Math.max.apply(null, meta.gaps) : 0;
      test.replaceChildren(h('b', {}, code), h('div', { class: 'muted small' }, meta.chars + ' characters in ' + meta.ms + ' ms · slowest gap ' + fast + ' ms · read as a scanner'));
      tone('good');
    };
    function save() {
      setHidSettings(Hid.settings({ terminator: term, prefix: prefix.value, suffix: suffix.value, maxGapMs: gap, minLength: cfg.minLength, idleMs: cfg.idleMs }));
      try { localStorage.setItem('cl-retail-register-name', name.value.trim().slice(0, 60) || 'Register'); } catch (e) { /* page only */ }
      close();
      route();
    }
    var close = sheet('Scanner setup', h('div', {},
      h('p', {}, 'Any barcode scanner set up as a keyboard works (USB, or Bluetooth paired as a keyboard): Zebra, Honeywell, Socket and others. Set it to send Enter after each code, US keyboard layout.'),
      test,
      field('This register\'s name', name),
      h('div', { class: 'field' }, h('span', {}, 'After each code the scanner sends'), termSeg),
      h('div', { class: 'row-fields' }, field('Prefix to take off', prefix), field('Suffix to take off', suffix)),
      field('A scanner types each key within (ms)', stepper(gap, function (v) { gap = Math.max(5, Math.min(300, v || 50)); })),
      h('p', { class: 'muted small' }, 'Raise it if a Bluetooth scanner\'s reads are missed; a person typing is slower than this, so typing is never taken for a scan.'),
      h('div', { class: 'field' }, h('span', {}, 'A barcode (not a cigar\'s own label) takes'), ruleSeg, ruleMsg),
      h('div', { class: 'field' }, h('span', {}, 'Who may link a new barcode to a cigar'), roleSeg, roleMsg),
      h('div', { class: 'btns' }, h('button', { class: 'btn primary', type: 'button', onclick: save }, 'Save'))), function () { state.hidTest = null; });
    setTimeout(function () { test.focus(); }, 50);
  }

  // ---- every scan, kept (retail_scan_log) ------------------------------------------------------
  //
  // Each code read on any screen, by camera, scanner or typing, with how it
  // went, kept on this device and sent in batches (each with its own id, so a
  // batch sent twice is kept once). The server keeps no code that could carry
  // personal details (an ID card's barcode read by mistake).

  function scanLogKey() {
    return 'cl-retail-scanlog';
  }
  function logScan(code, tone, words, input) {
    if (!state.store) return;
    var list = loadJson(scanLogKey(), []);
    list.push({ store: state.store.id, id: O.uuid(), code: String(code || '').slice(0, 200), outcome: tone === 'good' ? 'ok' : tone === 'warn' ? 'warn' : 'error',
                result: String(words || '').slice(0, 160), context: state.page || '', input: input || '', at: new Date().toISOString() });
    saveJson(scanLogKey(), list.slice(-2000));
    if (list.length >= 50) flushScanLog();
  }
  var scanLogBusy = false;
  async function flushScanLog() {
    if (scanLogBusy || !navigator.onLine) return;
    var list = loadJson(scanLogKey(), []);
    if (!list.length) return;
    scanLogBusy = true;
    try {
      var byStore = {};
      list.slice(0, 500).forEach(function (e) { (byStore[e.store] = byStore[e.store] || []).push(e); });
      var sent = {};
      for (var st in byStore) {
        try {
          await rpc('retail_scan_log', { p_store: st, p_events: byStore[st] });
          byStore[st].forEach(function (e) { sent[e.id] = true; });
        } catch (e) {
          if (O.isNetworkError(e, navigator.onLine)) break;
          // Refused (no longer on that store's team): not kept here forever.
          byStore[st].forEach(function (x) { sent[x.id] = true; });
        }
      }
      saveJson(scanLogKey(), loadJson(scanLogKey(), []).filter(function (e) { return !sent[e.id]; }));
    } finally {
      scanLogBusy = false;
    }
  }
  setInterval(flushScanLog, 15000);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flushScanLog(); });
  if (self.RetailScanner) {
    self.RetailScanner.onRead = function (code, format, res, input) {
      if (state.registerCamera) return; // the register keeps its own
      logScan(code, res ? res.tone : 'good', res ? res.words : '', input);
    };
  }

  // ---- demand the sales cannot show ------------------------------------------------------------

  /** "A customer asked for a cigar we do not have": the cigar, how many, and what kind of ask. */
  function demandSheet(context, after, prefill) {
    var what = h('input', { class: 'input', placeholder: 'Brand, line and size', value: prefill || '' });
    var howMany = null;
    var kind = 'requested_not_stocked';
    var seg = h('div', { class: 'seg' });
    function drawSeg() {
      seg.replaceChildren.apply(seg, [['requested_not_stocked', 'Asked for'], ['special_order', 'Special order'], ['waitlist', 'Waitlist']].map(function (o) {
        return h('button', { type: 'button', class: kind === o[0] ? 'on' : '', onclick: function () { kind = o[0]; drawSeg(); } }, o[1]);
      }));
    }
    drawSeg();
    var msg = h('p', { class: 'error' });
    var close = sheet('Asked for, not stocked', h('div', {},
      h('p', { class: 'muted small' }, 'What a customer wanted that the shelves did not have. The cigar, not who asked.'),
      field('What', what), h('div', { class: 'row-fields' }, field('How many', stepper(null, function (v) { howMany = v; })), h('div', { class: 'field' }, h('span', {}, 'Kind'), seg)),
      msg,
      h('button', { class: 'btn primary wide', type: 'button', onclick: async function () {
        if (!what.value.trim()) { msg.textContent = 'What was asked for?'; return; }
        var args = { p_store: state.store.id, p_kind: kind, p_text: what.value.trim(), p_product: null, p_quantity: howMany || null,
                     p_customer: null, p_context: context || '', p_client: O.uuid() };
        try {
          try {
            await rpc('retail_demand_note', args);
          } catch (e) {
            if (!O.isNetworkError(e, navigator.onLine)) throw e;
            // No connection: kept here and sent once (its own id) when it is back.
            outbox.add({ op: args.p_client, fn: 'retail_demand_note', args: args, label: 'Asked for: ' + args.p_text, store: state.store.id, at: Date.now() });
            drawNet();
          }
          close();
          toast('Noted: ' + what.value.trim() + '.');
          if (after) after();
        } catch (e) { msg.textContent = errorText(e); }
      } }, 'Note it')));
  }

  // ---- the store's own intelligence (managers) ----------------------------------------------------

  var STATUS_WORDS = { fast: 'Fast mover', slow: 'Slow', dead: 'Not moving', low: 'Running low', new: 'New', steady: 'Steady' };
  var STATUS_TONE = { fast: 'good', slow: 'warn', dead: 'bad', low: 'warn', new: 'info', steady: '' };
  function intelTile(label, figure, sub, color) {
    return h('div', { class: 'tile' }, h('div', { class: 'label' }, label), h('div', { class: 'figure', style: color ? { color: 'var(--' + color + ')' } : null }, figure), sub ? h('div', { class: 'sub' }, sub) : null);
  }
  function productTable(prods, sortKey) {
    var cols = [['name', 'Product'], ['units', 'On hand'], ['sold', 'Sold, 90 days'], ['perDay', 'A day'], ['daysOfSupply', 'Days of supply'],
                ['oldestKingDays', 'Oldest King, days'], ['daysOpenToEmpty', 'Queen open to empty, days'], ['marginPct', 'Margin'], ['status', '']];
    var list = prods.slice();
    var key = sortKey || 'sold';
    list.sort(function (a, b) {
      var x = a[key], y = b[key];
      if (key === 'name' || key === 'status') return String(x || '').localeCompare(String(y || ''));
      return (y === null || y === undefined ? -1e12 : y) - (x === null || x === undefined ? -1e12 : x);
    });
    return h('div', { class: 'scroll-x' }, h('table', { class: 'table' },
      h('tr', {}, cols.map(function (c) { return h('th', { class: c[0] === 'name' || c[0] === 'status' ? '' : 'n' }, c[1]); })),
      list.slice(0, 300).map(function (p) {
        return h('tr', {}, h('td', { text: p.name }), h('td', { class: 'n', text: n(p.units) + (p.kings || p.queens ? ' · ' + [p.kings ? plural(p.kings, 'King') : '', p.queens ? plural(p.queens, 'Queen') : ''].filter(Boolean).join(', ') : '') }),
          h('td', { class: 'n', text: n(p.sold) }), h('td', { class: 'n', text: p.perDay ? String(p.perDay) : '—' }),
          h('td', { class: 'n', text: p.daysOfSupply === null || p.daysOfSupply === undefined ? '—' : n(p.daysOfSupply) }),
          h('td', { class: 'n', text: p.oldestKingDays === null || p.oldestKingDays === undefined ? '—' : n(p.oldestKingDays) }),
          h('td', { class: 'n', text: p.daysOpenToEmpty === null || p.daysOpenToEmpty === undefined ? '—' : String(p.daysOpenToEmpty) }),
          h('td', { class: 'n', text: p.marginPct === null || p.marginPct === undefined ? '—' : p.marginPct + '%' }),
          h('td', {}, chip(STATUS_WORDS[p.status] || p.status, STATUS_TONE[p.status] || '')));
      })));
  }
  function miniList(items, sub) {
    return items.length ? h('div', { class: 'list' }, items.map(function (p) {
      return h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'name', text: p.name || p.what }), h('div', { class: 'sub', text: sub(p) })));
    })) : h('p', { class: 'muted' }, 'None.');
  }
  function intelBody(I, prods, readOnly) {
    var S30 = I.sales || {};
    var acc = I.accuracy || {};
    var sortSel = h('select', { class: 'input' }, [['sold', 'Most sold'], ['units', 'Most on hand'], ['daysOfSupply', 'Most days of supply'], ['oldestKingDays', 'Oldest King'], ['marginPct', 'Highest margin'], ['name', 'A to Z']].map(function (o) {
      return h('option', { value: o[0] }, o[1]);
    }));
    var table = h('div', {}, productTable(prods, 'sold'));
    sortSel.addEventListener('change', function () { table.replaceChildren(productTable(prods, sortSel.value)); });
    return [
      h('h2', { text: 'The last 30 days' }),
      h('div', { class: 'tiles' },
        intelTile('Revenue', money(S30.revenueCents || 0), n(S30.transactions || 0) + ' sales'),
        intelTile('Average ticket', S30.avgTicketCents ? money(S30.avgTicketCents, true) : '—'),
        intelTile('Gross margin', I.margin && I.margin.pct !== null && I.margin.pct !== undefined ? I.margin.pct + '%' : '—', I.margin && I.margin.linesWithoutCost ? n(I.margin.linesWithoutCost) + ' lines without a cost' : 'at each box\'s own cost'),
        intelTile('Scans', n((I.scans30 || {}).total || 0), plural((I.scans30 || {}).errors || 0, 'error') + ' · ' + plural((I.scans30 || {}).unknownCodes || 0, 'unknown code'))),
      h('h2', { text: 'Stock' }),
      h('div', { class: 'tiles' },
        intelTile('On hand', n(I.stock.units) + ' cigars', n(I.stock.products) + ' products'),
        intelTile('Value at cost', money(I.stock.valueCents), money(I.stock.retailCents) + ' at retail'),
        intelTile('Kings · Queens', n(I.stock.kings) + ' · ' + n(I.stock.queens), I.productsWithTwoQueens ? n(I.productsWithTwoQueens) + ' products with two open boxes' : 'one open box a product'),
        intelTile('Aged Kings', n(I.agedKings), I.oldestKing ? 'oldest ' + I.oldestKing.code + ', ' + n(I.oldestKing.days) + ' days' : 'sealed over 180 days', I.agedKings ? 'warn' : ''),
        intelTile('Last count', acc.accuracy !== null && acc.accuracy !== undefined ? acc.accuracy + '%' : '—', acc.expected ? n(acc.absVariance) + ' off of ' + n(acc.expected) : 'accuracy'),
        intelTile('Shrinkage, 90 days', n((I.shrink90 || {}).cigars || 0) + ' cigars', money((I.shrink90 || {}).costCents || 0) + ' at cost', (I.shrink90 || {}).cigars ? 'warn' : ''),
        intelTile('Customers', n((I.customers || {}).total || 0), n((I.customers || {}).new30 || 0) + ' new in 30 days')),
      h('div', { class: 'grid2' },
        h('div', {}, h('h3', { text: 'Fast movers' }), miniList(I.fast, function (p) { return n(p.sold) + ' sold in 90 days · ' + n(p.units) + ' on hand'; })),
        h('div', {}, h('h3', { text: 'Not moving' }), miniList(I.dead, function (p) { return n(p.units) + ' on hand · ' + (p.valueCents ? money(p.valueCents) + ' at cost · ' : '') + 'none sold in 90 days'; })),
        h('div', {}, h('h3', { text: 'Running low' }), miniList(I.low, function (p) { return n(p.units) + ' left · about ' + (p.daysOfSupply === null ? '—' : n(p.daysOfSupply)) + ' days'; })),
        h('div', {}, h('h3', { text: 'Asked for, not stocked' }), miniList(I.asked, function (a) { return a.times + (a.times === 1 ? ' time' : ' times') + (a.quantity ? ' · ' + a.quantity + ' cigars' : '') + ' · last ' + day(a.last); }))),
      h('h2', { text: 'Every product' }),
      h('div', { class: 'btns' }, sortSel),
      table,
      h('p', { class: 'muted small' }, 'From what is recorded, nothing guessed: a day is sold in the last 90 days over 90; days of supply is what is on hand over that; margin is the price over the cost now. Not moving: on hand, none sold in 90 days, here over 60.'),
      h('h2', { text: 'Activity by person, 90 days' }),
      h('p', { class: 'muted small' }, 'Counts for training and auditing, not a verdict on anyone.'),
      I.people.length ? h('div', { class: 'scroll-x' }, h('table', { class: 'table' },
        h('tr', {}, ['Person', 'Events', 'Sales', 'Scans', 'Scan errors', 'Deliveries', 'Places counted', 'Kings opened', 'Adjustments', 'Exceptions', 'Overrides'].map(function (c, i) { return h('th', { class: i ? 'n' : '' }, c); })),
        I.people.map(function (x) {
          return h('tr', {}, h('td', { text: x.name + ' · ' + x.role }), [x.events, x.sales, x.scans, x.scanErrors, x.deliveries, x.placesCounted, x.kingsOpened, x.adjustments, x.exceptions, x.overrides].map(function (v) { return h('td', { class: 'n', text: n(v) }); }));
        }))) : null,
      readOnly ? null : h('div', { class: 'btns' }, h('button', { class: 'btn', type: 'button', onclick: function () { demandSheet('insights', route); } }, 'Note something asked for')),
    ];
  }

  async function insightsView() {
    var res = await Promise.all([rpc('retail_store_intel', { p_store: state.store.id }), rpc('retail_product_intel', { p_store: state.store.id, p_days: 90 })]);
    show(h('h1', { text: 'Insights' }), h('p', { class: 'lead' }, 'What this store\'s own records say: what moves, what does not, what is running low, what customers asked for, and how the inventory holds up.'),
      intelBody(res[0], res[1], false));
  }

  // ---- the store's profile (owners) --------------------------------------------------------------

  async function profileCard() {
    var pr = await rpc('retail_store_profile', { p_store: state.store.id });
    var input = function (v, ph) { return h('input', { class: 'input', value: v === null || v === undefined ? '' : String(v), placeholder: ph || '' }); };
    var market = input(pr.market, 'e.g. Tampa Bay');
    var region = input(pr.region, 'e.g. Southeast');
    var registers = input(pr.registers, '0');
    var area = input(pr.squareFeet, 'optional');
    var hours = input(pr.hours && pr.hours.text, 'e.g. Mon–Sat 10–9, Sun 12–6');
    var type = h('select', { class: 'input' }, [['retail', 'A shop'], ['retail_lounge', 'A shop with a lounge'], ['lounge', 'A lounge'], ['online', 'Online'], ['other', 'Other']].map(function (o) {
      return h('option', { value: o[0], selected: pr.storeType === o[0] }, o[1]);
    }));
    var msg = h('p', { class: 'error' });
    return h('div', { class: 'card' },
      h('h2', { style: { marginTop: 0 } }, 'Store profile'),
      h('p', { class: 'muted small' }, n(pr.employees) + ' people · ' + n(pr.places) + ' places · ' + n(pr.humidors) + ' humidors and walk-ins · ' + n(pr.cabinets) + ' cabinets · with Cigar Locker since ' + day(pr.joinedAt)),
      h('div', { class: 'row-fields' }, field('Kind of store', type), field('Market', market), field('Region', region)),
      h('div', { class: 'row-fields' }, field('Registers', registers), field('Square feet', area), field('Hours', hours)),
      msg,
      can('owner') ? h('button', { class: 'btn primary', type: 'button', onclick: async function () {
        try {
          await rpc('retail_store_profile_save', { p_store: state.store.id, p: { store_type: type.value, market: market.value, region: region.value, registers: registers.value.trim(),
            square_feet: area.value.trim().replace(/[^0-9]/g, ''), has_lounge: type.value === 'retail_lounge' || type.value === 'lounge', hours: { text: hours.value.trim() } } });
          toast('Store profile saved.');
        } catch (e) { msg.textContent = errorText(e); }
      } }, 'Save the profile') : h('p', { class: 'muted small' }, 'The owner keeps it up to date.'));
  }

  // ---- Cigar Locker's network (Platform Admin only) ----------------------------------------------

  async function networkView(storeId) {
    bare();
    document.getElementById('bar').hidden = false;
    document.getElementById('bar-store').textContent = 'Cigar Locker network';
    if (storeId) return networkStore(storeId);
    var N = await rpc('retail_network');
    var T = N.totals;
    show(h('p', { class: 'over' }, 'Platform admin · read only · every view is kept'), h('h1', { text: 'Cigar Locker Retail network' }),
      h('div', { class: 'tiles' },
        intelTile('Stores', n(T.stores), n(T.active) + ' active'),
        intelTile('Cigars on hand', n(T.units), n(T.kings) + ' Kings · ' + n(T.queens) + ' Queens'),
        intelTile('Inventory at cost', money(T.costCents)),
        intelTile('Boxes labeled', n(T.boxes)),
        intelTile('Average accuracy', T.avgAccuracy === null || T.avgAccuracy === undefined ? '—' : T.avgAccuracy + '%', T.avgCountSeconds ? 'last counts, ' + R.duration(T.avgCountSeconds) + ' on average' : 'at each store\'s last count'),
        intelTile('Scans, 30 days', n(T.scans30), plural(T.scanErrors30, 'error') + ' · ' + plural(T.unknownCodes30, 'unknown code')),
        intelTile('Sales, 30 days', n(T.sales30), money(T.sales30Cents)),
        intelTile('Unmatched products', n(T.unmatched), '', T.unmatched ? 'warn' : ''),
        intelTile('Customers', n(T.customers))),
      h('h2', { text: 'Stores' }),
      h('div', { class: 'scroll-x' }, h('table', { class: 'table' },
        h('tr', {}, ['Store', 'On hand', 'Kings · Queens', 'At cost', 'Last count', 'Scans 30d', 'Errors', 'Sales 30d', 'Unmatched', 'Last activity'].map(function (c, i) { return h('th', { class: i ? 'n' : '' }, c); })),
        N.stores.map(function (s) {
          var lc = s.lastCount;
          return h('tr', {}, h('td', {}, h('a', { href: '#/admin/' + s.id }, s.name), h('div', { class: 'sub muted small' }, [s.city, s.state].filter(Boolean).join(', ') + (s.active ? '' : ' · inactive'))),
            h('td', { class: 'n', text: n(s.units) }), h('td', { class: 'n', text: n(s.kings) + ' · ' + n(s.queens) }), h('td', { class: 'n', text: money(s.costCents) }),
            h('td', { class: 'n', text: lc ? (lc.accuracy !== null && lc.accuracy !== undefined ? lc.accuracy + '% · ' : '') + R.duration(lc.seconds || 0) : '—' }),
            h('td', { class: 'n', text: n(s.scans30) }), h('td', { class: 'n', text: n(s.scanErrors30) }), h('td', { class: 'n', text: n(s.sales30) }),
            h('td', { class: 'n', text: n(s.unmatched) }), h('td', { class: 'n', text: s.lastActivity ? day(s.lastActivity) : '—' }));
        }))),
      h('p', { class: 'muted small' }, 'Cigar Locker\'s own view. A store\'s people see only their store; no store ever sees another\'s.'));
  }
  async function networkStore(storeId) {
    var S0 = await rpc('retail_network_store', { p_store: storeId });
    var pr = S0.profile;
    var d = S0.dashboard;
    show(h('p', { class: 'over' }, h('a', { href: '#/admin' }, 'Network'), ' › ' + pr.name + ' · read only'),
      h('h1', { text: pr.name }),
      h('p', { class: 'lead' }, [pr.city, pr.state].filter(Boolean).join(', ') + ' · ' + [pr.market, pr.region].filter(Boolean).join(', ') + ' · ' + n(pr.employees) + ' people · ' + n(pr.places) + ' places · joined ' + day(pr.joinedAt)),
      h('div', { class: 'tiles' },
        intelTile('On hand', n(d.units) + ' cigars', n(d.kings) + ' Kings · ' + n(d.queens) + ' Queens · ' + n(d.looseUnits) + ' loose'),
        intelTile('Boxes labeled', n(d.boxesLabeled)),
        intelTile('Unmatched products', n(d.unmatched)),
        intelTile('Missing boxes', n(d.missingBoxes))),
      intelBody(S0.intel, S0.products, true),
      S0.receipts.length ? h('h2', { text: 'Deliveries' }) : null,
      S0.receipts.length ? h('div', { class: 'list' }, S0.receipts.map(function (r) {
        return h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'name', text: (r.supplier || 'Supplier not given') + (r.reference ? ' · ' + r.reference : '') }), h('div', { class: 'sub', text: day(r.at) + ' · ' + n(r.boxes) + ' boxes · ' + n(r.cigars) + ' cigars' })), h('div', { class: 'qty', text: money(r.costCents) }));
      })) : null);
  }

  // ---- team -----------------------------------------------------------------------------

  async function teamView() {
    var t = await rpc('retail_team', { p_store: state.store.id });
    var link = function (code) { return location.origin + location.pathname + '#/invite/' + code; };
    function inviteSheet() {
      var name = h('input', { class: 'input', placeholder: 'Their name' });
      var role = h('select', { class: 'input' }, h('option', { value: 'employee' }, 'Employee: counts and receives'), can('owner') ? h('option', { value: 'manager' }, 'Manager: also the map, products, imports and adjustments') : null, can('owner') ? h('option', { value: 'owner' }, 'Owner: everything, and the team') : null);
      var out = h('div');
      var close = sheet('Invite someone', h('div', {}, field('Name', name), field('Role', role), out, h('button', { class: 'btn primary wide', type: 'button', onclick: async function (ev) {
        try {
          var code = await rpc('retail_invite_create', { p_store: state.store.id, p_role: role.value, p_name: name.value.trim() });
          var url = link(code);
          ev.target.hidden = true;
          out.replaceChildren(h('p', {}, 'Send them this link. It works once, for a week:'), h('input', { class: 'input', value: url, readonly: true, onclick: function (e) { e.target.select(); } }),
            h('div', { class: 'btns' }, h('button', { class: 'btn brand', type: 'button', onclick: async function () { try { await navigator.clipboard.writeText(url); toast('Link copied.'); } catch (e) { toast('Select the link and copy it.'); } } }, 'Copy link'),
              h('button', { class: 'btn', type: 'button', onclick: function () { close(); route(); } }, 'Done')));
        } catch (e) { out.replaceChildren(h('p', { class: 'error', text: errorText(e) })); }
      } }, 'Make the invite link')));
    }
    var profile = await profileCard();
    show(h('h1', { text: 'Team' }), profile, h('div', { class: 'btns' }, h('button', { class: 'btn primary', type: 'button', onclick: inviteSheet }, 'Invite someone')),
      h('div', { class: 'list' }, t.people.map(function (p) {
        return h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'name', text: p.name || p.email }), h('div', { class: 'sub', text: p.email + (p.active ? '' : ' · turned off') })), chip(p.role, p.role === 'owner' ? 'info' : ''),
          can('owner') && p.user !== state.user.id ? h('button', { class: 'btn small', type: 'button', onclick: async function () {
            try { await rpc('retail_team_set', { p_store: state.store.id, p_user: p.user, p_role: p.role, p_active: !p.active }); route(); } catch (e) { toast(errorText(e)); }
          } }, p.active ? 'Turn off' : 'Turn on') : null);
      })),
      t.invites.length ? h('h2', { text: 'Invites not used yet' }) : null,
      t.invites.length ? h('div', { class: 'list' }, t.invites.map(function (i) {
        return h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'name', text: (i.name || 'Invite') + ' · ' + i.role }), h('div', { class: 'sub', text: link(i.code) })), h('span', { class: 'faint small' }, 'until ' + day(i.expires)));
      })) : null);
  }

  // ---- pilot results ----------------------------------------------------------------------

  async function pilotView() {
    var res = await Promise.all([rpc('retail_pilot', { p_store: state.store.id }), rpc('retail_kpis', { p_store: state.store.id })]);
    var p = res[0];
    var K = res[1];
    var counts = p.sessions.filter(function (s) { return s.kind === 'count'; });
    var L = p.lines || {};
    var pct = function (a, b) { return b ? Math.round((100 * a) / b) + '%' : '—'; };
    var cost = ((p.scans.inputTokens || 0) * 4 + (p.scans.outputTokens || 0) * 20) / 1e6;
    var ob = K.onboarding;
    var og = K.ongoing || {};
    function kt(label, figure, sub, color) {
      return h('div', { class: 'tile' }, h('div', { class: 'label' }, label), h('div', { class: 'figure', style: color ? { color: 'var(--' + color + ')' } : null }, figure), sub ? h('div', { class: 'sub' }, sub) : null);
    }
    var proof = K.counts.filter(function (c) { return c.status === 'complete'; });
    var lastC = proof[proof.length - 1];
    show(h('h1', { text: 'Pilot results' }), h('p', { class: 'lead' }, 'The proof: from about 8 hours to under 90 minutes, then under 60, with every cigar in or out an event.'),
      h('h2', { text: 'The first inventory' }),
      ob ? h('div', { class: 'tiles' },
        kt('Status', ob.status === 'complete' ? 'Complete' : 'Under way', ob.completed ? day(ob.completed) : 'begun ' + day(ob.started)),
        kt('Time', R.duration(ob.seconds || 0)),
        kt('Boxes labeled', n(ob.report.boxes), plural(ob.report.kings, 'King') + ' · ' + plural(ob.report.queens, 'Queen')),
        kt('Cigar labels', n(ob.report.cigarLabels)),
        kt('Products unmatched', n(ob.report.unmatched), '', ob.report.unmatched ? 'warn' : ''),
        kt('Spreadsheet accuracy', ob.report.accuracy === null || ob.report.accuracy === undefined ? '—' : ob.report.accuracy + '%', n(ob.report.legacy) + ' said · ' + n(ob.report.verified) + ' verified'))
        : h('p', { class: 'muted' }, 'Not begun (First inventory).'),
      h('h2', { text: K.baselineAt ? 'Since the first inventory' : 'Everything so far' }),
      h('div', { class: 'tiles' },
        kt('Sales scans', n(og.salesScans), n(og.cigarsSold) + ' cigars'),
        kt('Exceptions', n(og.exceptions), 'damaged, comp, sample, gift, lost, adjusted'),
        kt('Kings opened', n(og.kingsOpened)),
        kt('Queens emptied', n(og.queensDepleted)),
        kt('Boxes received', n(og.receiving)),
        kt('Rescans reviewed', n(K.rescans), 'a label already out, scanned again'),
        kt('Overrides', n(og.overrides), 'went ahead past a warning, recorded'),
        kt('Put back', n(og.returns), 'a mistake or a return')),
      h('h2', { text: 'Each inventory: time and accuracy' }),
      K.counts.length ? h('div', { class: 'scroll-x' }, h('table', { class: 'table' },
        h('tr', {}, h('th', {}, 'Inventory'), h('th', { class: 'n' }, 'Total'), h('th', { class: 'n' }, 'Kings'), h('th', { class: 'n' }, 'Queens'), h('th', { class: 'n' }, 'Expected'), h('th', { class: 'n' }, 'Verified'), h('th', { class: 'n' }, 'Abs. variance'), h('th', { class: 'n' }, 'Accuracy'), h('th', { class: 'n' }, 'To review')),
        K.counts.map(function (c) {
          var a = c.accuracy || {};
          return h('tr', {}, h('td', { text: c.name + (c.status !== 'complete' ? ' (' + c.status + ')' : '') }), h('td', { class: 'n', text: R.duration(c.seconds || 0) }),
            h('td', { class: 'n', text: c.kingSeconds ? R.duration(c.kingSeconds) : '—' }), h('td', { class: 'n', text: c.queenSeconds ? R.duration(c.queenSeconds) : '—' }),
            h('td', { class: 'n', text: n(a.expected) }), h('td', { class: 'n', text: n(a.verified) }), h('td', { class: 'n', text: n(a.absVariance) }),
            h('td', { class: 'n', text: a.accuracy === null || a.accuracy === undefined ? '—' : a.accuracy + '%' }), h('td', { class: 'n', text: n(c.discrepancies) }));
        }))) : h('p', { class: 'muted' }, 'No inventory yet.'),
      lastC ? h('p', { class: 'muted small' }, 'Latest: ' + R.duration(lastC.seconds || 0) + ((lastC.seconds || 0) <= 3600 ? ', under an hour.' : (lastC.seconds || 0) <= 5400 ? ', under 90 minutes.' : '.')) : null,
      K.missingByPlace.length ? h('h3', { text: 'Recorded lost, by place' }) : null,
      K.missingByPlace.length ? h('div', { class: 'list' }, K.missingByPlace.map(function (m) { return h('div', { class: 'item' }, h('div', { class: 'grow', text: m.path || 'No place' }), h('div', { class: 'qty', text: n(m.cigars) })); })) : null,
      h('h3', { text: 'Activity by person' }),
      h('p', { class: 'muted small' }, 'For the manager: what each person recorded, as counts. Not a verdict on anyone.'),
      K.people.length ? h('div', { class: 'scroll-x' }, h('table', { class: 'table' },
        h('tr', {}, h('th', {}, 'Person'), h('th', { class: 'n' }, 'Events'), h('th', { class: 'n' }, 'Sold'), h('th', { class: 'n' }, 'Exceptions'), h('th', { class: 'n' }, 'Adjustments'), h('th', { class: 'n' }, 'Overrides')),
        K.people.map(function (x) {
          return h('tr', {}, h('td', { text: x.name }), h('td', { class: 'n', text: n(x.events) }), h('td', { class: 'n', text: n(x.sold) }), h('td', { class: 'n', text: n(x.exceptions) }), h('td', { class: 'n', text: n(x.adjustments) }), h('td', { class: 'n', text: n(x.overrides) }));
        }))) : h('p', { class: 'muted' }, 'Nothing yet.'),
      h('h2', { text: 'The scanning pilot' }),
      h('h2', { text: '1. Time to count the store (goal: under 90 minutes)' }),
      counts.length ? h('div', { class: 'list' }, counts.map(function (s) {
        var sec = s.summary.seconds || 0;
        return h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'name', text: s.name }), h('div', { class: 'sub', text: day(s.started) + ' · ' + n(s.summary.done) + ' of ' + n(s.summary.locations) + ' places · ' + n(s.summary.counted) + ' cigars · ' + n(s.summary.scans) + ' scans' })),
          chip(s.status === 'complete' ? (sec <= 5400 ? 'Under 90 min' : 'Over 90 min') : s.status, s.status === 'complete' ? (sec <= 5400 ? 'good' : 'warn') : ''), h('div', { class: 'qty', text: R.duration(sec) }));
      })) : h('p', { class: 'muted' }, 'No count yet.'),
      h('h2', { text: '2–3. Identification and how much needed a person' }),
      h('p', { class: 'muted' }, 'In the ' + n((p.places || {}).scanned) + ' places counted with a scan' + ((p.places || {}).byHand ? '; ' + n(p.places.byHand) + ' more were counted by hand.' : '.')),
      h('div', { class: 'tiles' },
        h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Products found by the scan'), h('div', { class: 'figure' }, pct(L.auto, L.total)), h('div', { class: 'sub' }, n(L.auto) + ' of ' + n(L.total) + ' counted lines')),
        h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Found with the right count'), h('div', { class: 'figure' }, pct(L.autoExact, L.total)), h('div', { class: 'sub' }, 'no change needed')),
        h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Confirmed by hand'), h('div', { class: 'figure' }, n(L.manual)), h('div', { class: 'sub' }, 'lines the scan did not find')),
        h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Wrong product named'), h('div', { class: 'figure' }, n(L.wrongProduct)), h('div', { class: 'sub' }, 'look-alike lines and sizes'))),
      h('h2', { text: '4. Count accuracy on what the scan found' }),
      h('div', { class: 'tiles' },
        h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Scan counted'), h('div', { class: 'figure' }, n(L.detectedUnitsOnAuto))),
        h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Confirmed'), h('div', { class: 'figure' }, n(L.countedUnitsOnAuto)), h('div', { class: 'sub' }, L.countedUnitsOnAuto ? pct(Math.min(L.detectedUnitsOnAuto, L.countedUnitsOnAuto), Math.max(L.detectedUnitsOnAuto, L.countedUnitsOnAuto)) + ' agreement' : ''))),
      h('h2', { text: 'Scans' }),
      h('div', { class: 'tiles' },
        h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Scans'), h('div', { class: 'figure' }, n(p.scans.count)), h('div', { class: 'sub' }, n(p.scans.photos) + ' pictures · ' + n(p.scans.failed) + ' failed')),
        h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Average read'), h('div', { class: 'figure' }, p.scans.avgMs ? Math.round(p.scans.avgMs / 1000) + ' s' : '—')),
        h('div', { class: 'tile' }, h('div', { class: 'label' }, 'AI cost so far'), h('div', { class: 'figure' }, '$' + cost.toFixed(2)), h('div', { class: 'sub' }, 'estimated from tokens'))),
      h('h2', { text: '6. What the scan missed most' }),
      p.missed.length ? h('div', { class: 'list' }, p.missed.map(function (m) { return h('div', { class: 'item' }, h('div', { class: 'grow', text: m.name || 'Product' }), h('div', { class: 'qty', text: n(m.times) })); })) : h('p', { class: 'muted' }, 'Nothing yet.'),
      h('h3', { text: 'Read on shelves but not among the store\'s products' }),
      p.unmatched.length ? h('div', { class: 'list' }, p.unmatched.map(function (m) { return h('div', { class: 'item' }, h('div', { class: 'grow', text: m.name }), h('div', { class: 'qty', text: n(m.times) })); })) : h('p', { class: 'muted' }, 'Nothing yet.'),
      h('h2', { text: '7. Against a control count (by hand)' }),
      p.control.length ? h('div', { class: 'scroll-x' }, h('table', { class: 'table' }, h('tr', {}, h('th', {}, 'Place'), h('th', { class: 'n' }, 'Count'), h('th', { class: 'n' }, 'Control'), h('th', { class: 'n' }, 'Difference')),
        p.control.map(function (c) { return h('tr', {}, h('td', { text: c.location }), h('td', { class: 'n', text: n(c.counted) }), h('td', { class: 'n', text: n(c.control) }), h('td', { class: 'n', text: (c.difference > 0 ? '+' : '') + n(c.difference) })); })))
        : h('p', { class: 'muted' }, 'Start a control count (Count, then Control count) and count a few places by hand after the scanned count.'),
    );
  }

  // ---- start ------------------------------------------------------------------------------

  sb.auth.onAuthStateChange(function (event) {
    if (event === 'SIGNED_OUT') {
      state.stores = null;
      state.store = null;
    }
  });
  route();
})();
