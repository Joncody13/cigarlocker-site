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
  var sb = self.supabase.createClient(C.url, C.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'cl-retail-auth' },
  });

  var main = document.getElementById('main');
  var state = { user: null, stores: null, store: null, role: null, timers: [], cache: {} };
  var RANK = { employee: 1, manager: 2, owner: 3 };
  var TYPES = ['room', 'humidor', 'wall', 'cabinet', 'shelf', 'drawer', 'display', 'other'];
  var TYPE_WORDS = { room: 'Room', humidor: 'Humidor', wall: 'Wall', cabinet: 'Cabinet', shelf: 'Shelf', drawer: 'Drawer', display: 'Display', other: 'Other' };

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
    state.cache = { store: id, at: Date.now(), locations: locations, loc: byId, products: products, inventory: res[2] };
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
    return d.inventory.reduce(function (s, i) {
      return s + (i.location_id === locId ? i.quantity : 0);
    }, 0);
  }

  // ---- chrome ---------------------------------------------------------------------

  var TABS = [
    { key: 'home', label: 'Dashboard', least: 'employee', path: '' },
    { key: 'count', label: 'Count', least: 'employee', path: '/count' },
    { key: 'inventory', label: 'Inventory', least: 'employee', path: '/inventory' },
    { key: 'receive', label: 'Receive', least: 'employee', path: '/receive' },
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
        h('div', { class: 'btns' }, h('button', {
          class: 'btn wide',
          type: 'button',
          onclick: async function () {
            await sb.auth.signOut();
            state.stores = null;
            state.store = null;
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
    document.querySelectorAll('.veil, .sticky-foot').forEach(function (v) { v.remove(); });
    var parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    try {
      if (parts[0] === 'invite') return await invite(parts[1] || '');
      var session = (await sb.auth.getSession()).data.session;
      if (!session) return signIn();
      state.user = session.user;
      if (!state.stores) state.stores = await rpc('retail_my_stores');
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
      chrome(page);
      show(busy());
      if (page === 'home') return await dashboard();
      if (page === 'count') return parts[3] ? (parts[4] ? await countPlace(parts[3], parts[4]) : await board(parts[3])) : await countStart();
      if (page === 'inventory') return await inventoryView();
      if (page === 'receive') return await receiveView();
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
    show(h('h1', { text: 'Your stores' }), h('div', { class: 'list' }, state.stores.map(function (s) {
      return h('a', { class: 'item tap', href: '#/s/' + s.id, style: { textDecoration: 'none', color: 'inherit' } },
        h('div', { class: 'grow' }, h('div', { class: 'name', text: s.name }), h('div', { class: 'sub', text: [s.city, s.state].filter(Boolean).join(', ') })), chip(s.role));
    })));
  }

  // ---- dashboard -------------------------------------------------------------------

  async function dashboard() {
    var d = await rpc('retail_dashboard', { p_store: state.store.id });
    var base = '#/s/' + state.store.id;
    var open = d.open;
    var last = d.last;
    var tiles = h('div', { class: 'tiles' },
      h('div', { class: 'tile hero' }, h('div', { class: 'label' }, 'Current inventory'), h('div', { class: 'figure' }, n(d.units) + ' cigars'),
        h('div', { class: 'sub' }, n(d.productsStocked) + ' products · ' + n(d.locations) + ' places')),
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
      h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Needs attention'), h('div', { class: 'figure' }, n((d.unmatched || 0) + (open ? (open.summary.locations - open.summary.done) : 0))),
        h('div', { class: 'sub' }, [d.unmatched ? n(d.unmatched) + ' products to match' : '', open ? n(open.summary.locations - open.summary.done) + ' places to count' : ''].filter(Boolean).join(' · ') || 'all clear')),
    );
    var primary = open
      ? h('a', { class: 'btn primary big wide', href: base + '/count/' + open.id }, (open.status === 'paused' ? 'Resume ' : 'Continue ') + open.name)
      : h('a', { class: 'btn primary big wide', href: base + '/count' }, 'Start inventory');
    show(
      h('p', { class: 'over' }, [state.store.city, state.store.state].filter(Boolean).join(', ')),
      h('h1', { text: state.store.name }),
      tiles,
      primary,
      h('div', { class: 'btns grid' },
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
    ]);
    var s = res[0].data;
    if (!s) return show(h('p', { class: 'error', text: 'No such inventory.' }));
    var places = res[1];
    var people = {};
    (res[2].data || []).forEach(function (u) { people[u.user_id] = u.name || 'Someone'; });
    var d = res[3];
    var done = places.filter(function (p) { return p.status === 'done'; });
    var expected = places.reduce(function (t, p) { return t + (p.expected_units || 0); }, 0);
    var counted = done.reduce(function (t, p) { return t + (p.counted_units || 0); }, 0);
    var timer = h('div', { class: 'timer', text: clock(elapsedOf(s)) });
    if (s.status === 'open') every(1000, function () { timer.textContent = clock(elapsedOf(s)); });
    if (s.status === 'complete') return complete(s, places, d);
    if (s.status === 'cancelled') return show(h('h1', { text: s.name }), h('p', { class: 'lead' }, 'This inventory was cancelled.'), h('a', { class: 'btn', href: '#' + base }, 'Dashboard'));
    // Others' progress comes in every 15 seconds.
    every(15000, function () { if (!document.querySelector('.veil')) route(); });

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
          can('manager') ? h('button', { class: 'btn primary', type: 'button', onclick: function () { completeSheet(sid, places.length - done.length); } }, 'Complete inventory') : null,
          can('manager') ? h('button', { class: 'btn quiet danger', type: 'button', onclick: async function () {
            if (!confirm('Cancel this inventory? Counts already confirmed stay in the inventory.')) return;
            await rpc('retail_session_set', { p_session: sid, p_action: 'cancel' });
            go(base);
          } }, 'Cancel') : null),
        s.status === 'paused' ? h('p', { class: 'muted small' }, 'The clock is stopped. Resume to count.') : null),
      seg,
      h('div', { style: { height: '10px' } }),
      listEl,
    );
  }

  function completeSheet(sid, left) {
    var msg = h('p', { class: 'error' });
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

  function complete(s, places) {
    var sum = s.summary || {};
    show(
      h('p', { class: 'over' }, s.kind === 'control' ? 'Control count' : 'Inventory'),
      h('h1', { text: s.name }),
      h('div', { class: 'card', style: { textAlign: 'center' } },
        h('p', { class: 'over' }, 'Inventory complete'),
        h('div', { class: 'timer', style: { margin: '10px 0' } }, R.duration(sum.seconds || elapsedOf(s))),
        h('p', { class: 'muted' }, 'Total time · ' + day(s.started_at) + (s.completed_at ? ', ' + new Date(s.started_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + ' to ' + new Date(s.completed_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''))),
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
        h('p', { class: 'lead' }, n(expectedUnits) + ' cigars expected here · ' + expected.length + ' product' + (expected.length === 1 ? '' : 's') + (claim && claim.done ? ' · counted already: confirming again replaces it' : '')),
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
    var total = d.inventory.reduce(function (t, i) { return t + i.quantity; }, 0);
    var listEl = h('div', { class: 'list' });
    walk(d).forEach(function (x) {
      var here = d.inventory.filter(function (i) { return i.location_id === x.loc.id && i.quantity > 0; });
      var units = here.reduce(function (t, i) { return t + i.quantity; }, 0);
      listEl.appendChild(h('div', { class: 'item indent-' + Math.min(x.depth, 4) }, h('div', { class: 'grow' }, h('div', { class: 'name', text: x.loc.name }), h('div', { class: 'sub', text: TYPE_WORDS[x.loc.type] })), units ? h('div', { class: 'qty', text: n(units) }) : null));
      here.sort(function (a, b) { return productName(d.products[a.product_id]).localeCompare(productName(d.products[b.product_id])); }).forEach(function (i) {
        var p = d.products[i.product_id];
        listEl.appendChild(h('div', { class: 'item tap indent-' + Math.min(x.depth + 1, 4), onclick: function () { stockSheet(d, p, x.loc, i.quantity); } },
          h('div', { class: 'grow' }, h('div', { text: productName(p) }), h('div', { class: 'sub', text: productDetail(p || {}) })), h('div', { class: 'qty', style: { fontSize: '18px' }, text: n(i.quantity) })));
      });
    });
    show(h('h1', { text: 'Inventory' }), h('p', { class: 'lead' }, n(total) + ' cigars in ' + n(d.locations.length) + ' places. Tap a product to move it' + (can('manager') ? ' or adjust it.' : '.')), listEl);
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
    d.inventory.forEach(function (i) { qty[i.product_id] = (qty[i.product_id] || 0) + i.quantity; });
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
    var close = sheet(p ? productName(p) : 'Add a product', h('div', {},
      h('div', { class: 'row-fields' }, field('Brand', brand), field('Line', line), field('Size name', vitola), field('Size', size)),
      h('div', { class: 'row-fields' }, field('Cost per cigar, $', cost), field('Retail price per cigar, $', price), field('Cigars per box', box)),
      h('div', { class: 'row-fields' }, field('SKU', sku), field('UPC / barcode', upc)),
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

  async function receiveView() {
    var d = await storeData(true);
    var product = null;
    var qty = 0;
    var where = h('select', { class: 'input' }, walk(d).map(function (x) { return h('option', { value: x.loc.id, selected: state.receiveAt === x.loc.id }, ' '.repeat(x.depth * 3) + x.loc.name); }));
    where.addEventListener('change', function () { state.receiveAt = where.value; });
    var cost = h('input', { class: 'input', inputmode: 'decimal', placeholder: 'per cigar (optional)' });
    var note = h('input', { class: 'input', placeholder: 'Invoice or note (optional)' });
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
    show(h('h1', { text: 'Receive inventory' }), h('p', { class: 'lead' }, 'Stock coming in: the product, how many cigars, what they cost and where they go.'),
      h('div', { class: 'card' }, field('Product', q), results, chosen,
        h('div', { class: 'row-fields' }, field('How many cigars', qtyBox), field('Cost per cigar, $', cost)), field('Put them in', where), field('Note', note), msg,
        h('button', { class: 'btn primary big wide', type: 'button', onclick: async function (ev) {
          if (!product) { msg.textContent = 'Choose the product.'; return; }
          if (!qty) { msg.textContent = 'How many came in?'; return; }
          ev.target.disabled = true;
          try {
            await rpc('retail_receive', { p_store: state.store.id, p_product: product.id, p_location: where.value, p_quantity: qty, p_cost_cents: S.cents(cost.value), p_note: note.value });
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
    show(h('h1', { text: 'Team' }), h('div', { class: 'btns' }, h('button', { class: 'btn primary', type: 'button', onclick: inviteSheet }, 'Invite someone')),
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
    var p = await rpc('retail_pilot', { p_store: state.store.id });
    var counts = p.sessions.filter(function (s) { return s.kind === 'count'; });
    var L = p.lines || {};
    var pct = function (a, b) { return b ? Math.round((100 * a) / b) + '%' : '—'; };
    var cost = ((p.scans.inputTokens || 0) * 4 + (p.scans.outputTokens || 0) * 20) / 1e6;
    show(h('h1', { text: 'Pilot results' }), h('p', { class: 'lead' }, 'What the counts so far say about the pilot\'s questions.'),
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
