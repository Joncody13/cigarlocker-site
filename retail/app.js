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
      if (page === 'label') return await labelView();
      if (page === 'labels') return await labelsView();
      if (page === 'scan') return await scanView();
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
      d.units && !d.boxesLabeled ? h('div', { class: 'card' }, h('h2', { style: { marginTop: 0 } }, 'Next: label the boxes'),
        h('p', {}, 'Give each box on the shelves its own Cigar Locker label, once: scan its barcode, say sealed or open, print. From then on an inventory is a walk with the scanner: sealed boxes are verified with one scan each, only open ones are counted.'),
        h('a', { class: 'btn brand', href: base + '/label' }, 'Label boxes')) : null,
      h('div', { class: 'btns grid' },
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
    if (s.status === 'complete') return complete(s, places, d);
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
          ev.currentTarget.disabled = true;
          try {
            var r = await rpc('retail_session_box_count', { p_session: sid, p_box: box.id, p_counted: counted, p_source: source, p_location: state.scanAt || null });
            onSaved(r);
          } catch (e) { msg.textContent = errorText(e); ev.currentTarget.disabled = false; }
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
        var r = await rpc('retail_session_box_scan', { p_session: sid, p_code: code, p_location: state.scanAt || null });
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
        ev.currentTarget.disabled = true;
        try {
          var ids = Object.keys(keep).filter(function (k) { return keep[k]; });
          var r = await rpc('retail_session_boxes_confirm', { p_session: sid, p_keep: ids });
          close();
          toast('Boxes confirmed: ' + [r.counted ? r.counted + ' counted' : '', r.missing ? r.missing + ' marked missing' : '', r.moved ? r.moved + ' moved' : '', r.found ? r.found + ' found' : ''].filter(Boolean).join(', ') + '.');
          forget();
          route();
        } catch (e) { msg.textContent = errorText(e); ev.currentTarget.disabled = false; }
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
    return h('div', {},
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
      sum.hasBoxes ? boxResults(sum) : null,
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

  async function receiveLoose(d, seg) {
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
    show(h('h1', { text: 'Receive inventory' }), h('p', { class: 'lead' }, 'Loose cigars coming in, not in a box: the product, how many, what they cost and where they go.'),
      seg, h('div', { style: { height: '12px' } }),
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
    boxes.forEach(function (b) { if (!have[b.code]) q.push({ id: b.id, code: b.code, name: name }); });
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
  function labelNode(l) {
    return h('div', { class: 'lbl' }, h('div', { class: 'lbl-qr' }, qrNode(l.code)),
      h('div', { class: 'lbl-words' }, h('div', { class: 'lbl-brand' }, 'CIGAR LOCKER'), h('div', { class: 'lbl-code' }, l.code), h('div', { class: 'lbl-name' }, Codes.labelName(l.name))));
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

  /** The decision for one product's boxes: how many, sealed or open, and the box size. */
  function boxesPanel(p, opts, onGo, onSkip) {
    var o = opts || {};
    var per = p.box_count || null;
    var count = 1;
    var open = false;
    var left = null;
    var cost = h('input', { class: 'input', inputmode: 'decimal', placeholder: p.cost_cents !== null && p.cost_cents !== undefined ? (p.cost_cents / 100).toFixed(2) : 'optional' });
    var msg = h('p', { class: 'error' });
    var openArea = h('div');
    var go = h('button', { class: 'btn primary big wide', type: 'button' });
    function words() {
      go.textContent = o.mode === 'received'
        ? 'Receive ' + count + (count === 1 ? ' box' : ' boxes') + ' · ' + count + (count === 1 ? ' label' : ' labels')
        : open ? 'Label this open box' : 'Label ' + count + (count === 1 ? ' sealed box' : ' sealed boxes');
    }
    function drawOpen() {
      openArea.replaceChildren(o.mode === 'labeled'
        ? h('div', { class: 'seg' },
            h('button', { type: 'button', class: open ? '' : 'on', onclick: function () { open = false; drawOpen(); words(); } }, 'Sealed (King)'),
            h('button', { type: 'button', class: open ? 'on' : '', onclick: function () { open = true; count = 1; drawOpen(); words(); } }, 'Open (Queen)'))
        : null,
        open ? field('Cigars left in it', stepper(left, function (v) { left = v; })) : field('How many boxes ' + (o.mode === 'received' ? 'came in' : 'like this here'), stepper(1, function (v) { count = Math.max(1, Math.min(200, v || 1)); words(); })));
    }
    drawOpen();
    words();
    go.addEventListener('click', async function () {
      msg.textContent = '';
      if (!per) { msg.textContent = 'How many cigars in a full box?'; return; }
      if (open && !(left >= 1 && left <= per)) { msg.textContent = 'How many are left in it? From 1 to ' + per + '.'; return; }
      go.disabled = true;
      try {
        await onGo({ count: open ? 1 : count, per: per, open: open ? left : null, cost: S.cents(cost.value) });
      } catch (e) {
        msg.textContent = errorText(e);
        go.disabled = false;
      }
    });
    return h('div', { class: 'scan-choice' },
      h('p', { class: 'over good-text' }, o.status === 'matched' ? 'Matched' : o.status === 'new' ? 'Added to your products' : 'Confirmed'),
      h('div', { class: 'scan-product' }, productName(p)), h('div', { class: 'muted small' }, productDetail(p)),
      h('div', { class: 'row-fields' }, field('Cigars in a full box', stepper(per, function (v) { per = v || null; })),
        o.mode === 'received' ? field('Cost per cigar, $', cost) : null),
      openArea, msg, go,
      h('button', { class: 'btn small quiet', type: 'button', onclick: onSkip }, 'Not now'));
  }

  /** Receiving or labeling by scanning: one scanner, box after box. */
  async function boxesByScan(mode, whereId, onEach) {
    var ctx = { d: await storeData(true) };
    var made = 0;
    var labels = 0;
    var Scanner = self.RetailScanner;
    Scanner.open({
      title: (mode === 'received' ? 'Receive boxes · ' : 'Label boxes · ') + pathOf(ctx.d, whereId),
      hint: 'Point the camera at the box\'s barcode or QR code.',
      onClose: function () { forget(); route(); },
      onCode: async function (code, format, ctl) {
        if (Codes.boxCode(code)) {
          var known = await rpc('retail_code_resolve', { p_store: state.store.id, p_code: code });
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
        return await new Promise(function (resolve) {
          ctl.panel(boxesPanel(p, { mode: mode, status: it.status }, async function (c) {
            var r = await rpc('retail_boxes_create', {
              p_store: state.store.id, p_product: p.id, p_location: whereId, p_count: c.count, p_box_quantity: c.per,
              p_mode: mode, p_open_remaining: c.open, p_cost_cents: mode === 'received' ? c.cost : null, p_note: '',
            });
            made += r.boxes.length;
            labels = queueLabels(r.boxes, productName(p));
            ctl.tally((mode === 'received' ? made + ' boxes received' : made + ' boxes labeled') + ' · ' + labels + ' labels to print');
            ctl.resume();
            if (onEach) onEach(r);
            resolve({ tone: r.beyondList ? 'warn' : 'good',
              words: (c.open !== null ? 'Queen labeled: ' : r.boxes.length + (r.boxes.length === 1 ? ' box: ' : ' boxes: ')) + productName(p) + ' · ' + r.boxes.map(function (b) { return b.code; }).join(', ')
                + (r.beyondList ? ' · ' + n(r.beyondList) + ' cigars more than the records had here' : '') });
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
    show(h('h1', { text: 'Receive inventory' }),
      h('p', { class: 'lead' }, 'Scan each new box\'s barcode: the product is found, you say how many boxes, and each gets its own Cigar Locker label.'),
      seg, h('div', { style: { height: '12px' } }),
      h('div', { class: 'card' }, field('Put them in', where),
        h('button', { class: 'btn primary big wide', type: 'button', onclick: function () { state.receiveAt = where.value; boxesByScan('received', where.value); } }, 'Scan boxes'),
        h('p', { class: 'muted small' }, 'A code this store has not confirmed is never taken on its own: you choose the product once, and it is known from then on.')),
      waiting ? h('a', { class: 'btn brand wide', href: base + '/labels' }, 'Print ' + n(waiting) + (waiting === 1 ? ' label' : ' labels')) : null,
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
              var r = await rpc('retail_boxes_create', { p_store: state.store.id, p_product: p.id, p_location: where.value, p_count: c.count, p_box_quantity: c.per, p_mode: 'labeled', p_open_remaining: c.open, p_cost_cents: null, p_note: '' });
              queueLabels(r.boxes, productName(p));
              close();
              toast(r.boxes.length + (r.boxes.length === 1 ? ' box labeled: ' : ' boxes labeled: ') + r.boxes.map(function (b) { return b.code; }).join(', '));
              forget();
              route();
            }, function () { holder.replaceChildren(); }));
          } }, h('div', { class: 'grow' }, h('div', { class: 'name', text: productName(p) }), h('div', { class: 'sub', text: productDetail(p) })));
        }));
      }
      q.addEventListener('input', fillList);
      fillList();
      var close = sheet('A box with no barcode', h('div', {}, q, h('div', { style: { height: '10px' } }), list, holder));
    }
    show(h('h1', { text: 'Label boxes' }),
      h('p', { class: 'lead' }, 'Give every box on the shelves its own Cigar Locker label, once. Scan the box\'s barcode, say if it is sealed or open, and its label joins the list to print. After this, an inventory is a walk with the scanner.'),
      h('div', { class: 'tiles' },
        h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Boxes labeled'), h('div', { class: 'figure' }, n(labeled))),
        h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Labels to print'), h('div', { class: 'figure' }, n(waiting)))),
      h('div', { class: 'card' }, field('Labeling in', where),
        h('button', { class: 'btn primary big wide', type: 'button', onclick: function () { state.labelAt = where.value; boxesByScan('labeled', where.value); } }, 'Scan boxes here'),
        h('div', { class: 'btns' }, h('button', { class: 'btn', type: 'button', onclick: byHand }, 'A box with no barcode')),
        h('p', { class: 'muted small' }, 'Labeling moves a box\'s cigars from the spreadsheet\'s count into the box, so nothing is counted twice. Put the label where it does not cover the maker\'s codes or stamps.')),
      waiting ? h('a', { class: 'btn brand big wide', href: base + '/labels' }, 'Print ' + n(waiting) + (waiting === 1 ? ' label' : ' labels')) : null);
  }

  // ---- printing labels ----------------------------------------------------------------------

  var pageRule = null;
  function setPageSize(layout) {
    var sheetEl = document.styleSheets[0];
    try {
      if (pageRule !== null) sheetEl.deleteRule(pageRule);
      var L = Codes.LAYOUTS[layout];
      pageRule = sheetEl.insertRule('@page { size: ' + L.page[0] + 'in ' + L.page[1] + 'in; margin: 0; }', sheetEl.cssRules.length);
    } catch (e) {
      pageRule = null;
    }
  }

  async function labelsView() {
    var list = labelQueue();
    var layout = state.labelLayout || 'sheet';
    var skip = 0;
    var pagesEl = h('div', { class: 'label-pages' });
    function draw() {
      setPageSize(layout);
      var L = Codes.LAYOUTS[layout];
      var spots = Codes.place(list.length, layout, layout === 'sheet' ? skip : 0);
      var pages = [];
      spots.forEach(function (s, i) {
        if (!pages[s.page]) pages[s.page] = h('div', { class: 'label-page lp-' + layout, style: { width: L.page[0] + 'in', height: L.page[1] + 'in' } });
        var node = labelNode(list[i]);
        Object.assign(node.style, { left: s.x + 'in', top: s.y + 'in', width: L.label[0] + 'in', height: L.label[1] + 'in' });
        pages[s.page].appendChild(node);
      });
      pagesEl.replaceChildren.apply(pagesEl, pages.filter(Boolean));
    }
    var seg = h('div', { class: 'seg' }, Object.keys(Codes.LAYOUTS).map(function (k) {
      return h('button', { type: 'button', class: layout === k ? 'on' : '', onclick: function (ev) {
        layout = k;
        state.labelLayout = k;
        seg.querySelectorAll('button').forEach(function (b) { b.classList.remove('on'); });
        ev.currentTarget.classList.add('on');
        skipField.hidden = k !== 'sheet';
        draw();
      } }, Codes.LAYOUTS[k].name);
    }));
    var skipField = field('Sheet partly used? Start at label number', stepper(1, function (v) { skip = Math.max(0, Math.min(29, (v || 1) - 1)); draw(); }));
    skipField.hidden = layout !== 'sheet';
    show(h('div', { class: 'no-print' }, h('h1', { text: 'Labels to print' }),
      list.length
        ? h('p', { class: 'lead' }, n(list.length) + (list.length === 1 ? ' label' : ' labels') + ', in the order the boxes were scanned. Each holds only its box\'s Cigar Locker code.')
        : h('p', { class: 'lead' }, 'No labels waiting. Labels are added as boxes are received or labeled, or from a box\'s page.'),
      list.length ? h('div', { class: 'card' }, h('div', { class: 'field' }, seg), skipField,
        h('div', { class: 'btns' }, h('button', { class: 'btn primary big', type: 'button', onclick: function () { window.print(); } }, 'Print'),
          h('button', { class: 'btn', type: 'button', onclick: function () {
            if (!confirm('Clear the list? Do this once the labels are printed. A box\'s label can be printed again from its page.')) return;
            setLabelQueue([]);
            route();
          } }, 'Printed: clear the list')),
        h('p', { class: 'muted small' }, 'Print at 100% (actual size), no margins. On an iPad: Share, then Print.')) : null),
      list.length ? h('div', { class: 'scroll-x label-preview' }, pagesEl) : null);
    if (list.length) draw();
  }

  // ---- a box's page, and scanning to find one -------------------------------------------------

  async function boxPage(boxId) {
    var base = '#/s/' + state.store.id;
    var d = await storeData(true);
    var b = await rpc('retail_box', { p_store: state.store.id, p_box: boxId });
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
      sheet('Open this King?', h('div', {},
        h('p', { class: 'lead' }, p.name + ' · ' + b.code),
        h('p', {}, 'It becomes a Queen: from now on its cigars are counted, not the box. The store\'s total does not change.'),
        h('button', { class: 'btn primary big wide', type: 'button', onclick: function () { act('retail_box_open', null, b.code + ' is open: a Queen of ' + b.remaining + '.'); } }, 'Open box'),
      ));
    }
    function takeOut() {
      var howMany = 1;
      var why = h('select', { class: 'input' }, [['sold', 'Sold'], ['lounge', 'Lounge'], ['sample', 'Sample or gift'], ['damaged', 'Damaged cigar']].map(function (o) { return h('option', { value: o[0] }, o[1]); }));
      sheet('Cigars out of ' + b.code, h('div', {},
        b.state === 'sealed' ? h('p', { class: 'muted' }, 'The box is opened first: it becomes a Queen.') : null,
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
    var live = b.state === 'sealed' || b.state === 'open';
    show(
      h('p', { class: 'over' }, b.path || 'No place'),
      h('h1', { text: p.name || 'Box' }),
      h('div', { class: 'box-head' }, h('div', { class: 'box-qr' }, qrNode(b.code)), h('div', {}, h('div', { class: 'box-code' }, b.code), boxChip(b.state),
        h('p', { class: 'muted small' }, productDetail({ size_text: '', box_count: b.original, sku: p.sku })))),
      h('div', { class: 'tiles' },
        h('div', { class: 'tile' }, h('div', { class: 'label' }, b.state === 'sealed' ? 'Sealed' : 'In the box'), h('div', { class: 'figure' }, n(b.state === 'sealed' ? b.original : b.remaining)), h('div', { class: 'sub' }, 'of ' + n(b.original) + ' when full')),
        h('div', { class: 'tile' }, h('div', { class: 'label' }, 'Where'), h('div', { class: 'figure', style: { fontSize: '22px' } }, b.path || '—')),
        h('div', { class: 'tile' }, h('div', { class: 'label' }, b.openedAt ? 'Opened' : b.receivedAt ? 'Received' : 'Labeled'), h('div', { class: 'figure', style: { fontSize: '22px' } }, day(b.openedAt || b.receivedAt || b.labeledAt)))),
      b.state === 'sealed' ? h('button', { class: 'btn primary big wide', type: 'button', onclick: openBox }, 'Open box') : null,
      msg,
      h('div', { class: 'btns grid' },
        live ? h('button', { class: 'btn', type: 'button', onclick: takeOut }, 'Cigars out') : null,
        b.state === 'open' ? h('button', { class: 'btn', type: 'button', onclick: countIt }, 'Count it') : null,
        live ? h('button', { class: 'btn', type: 'button', onclick: moveIt }, 'Move') : null,
        h('button', { class: 'btn', type: 'button', onclick: function () { queueLabels([{ id: b.id, code: b.code }], p.name); go('/s/' + state.store.id + '/labels'); } }, 'Print its label'),
        live ? h('button', { class: 'btn danger', type: 'button', onclick: function () { markIt('damaged', 'Mark ' + b.code + ' damaged? Its cigars leave the count.'); } }, 'Damaged') : null,
        live ? h('button', { class: 'btn danger', type: 'button', onclick: function () { markIt('missing', 'Mark ' + b.code + ' missing? Its cigars leave the count until it is found.'); } }, 'Missing') : null,
        !live && b.state !== 'empty' && can('manager') ? h('button', { class: 'btn brand', type: 'button', onclick: function () { markIt('found', 'Found ' + b.code + '? It comes back into the count.'); } }, 'Found it') : null),
      h('h2', { text: 'History' }),
      h('div', { class: 'list' }, b.history.map(function (e) {
        var what = { received: 'Received', labeled: 'Labeled', opened: 'Opened', counted: 'Counted', sold: 'Sold', taken: 'Taken out', moved: 'Moved', damaged: 'Damaged',
          missing: 'Marked missing', found: 'Found', emptied: 'Emptied', archived: 'Archived', corrected: 'Corrected' }[e.kind] || e.kind;
        return h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'name', text: what + (e.reason ? ' · ' + e.reason : '') }),
          h('div', { class: 'sub', text: [day(e.at), e.by, e.kind === 'moved' ? 'to ' + e.place : ''].filter(Boolean).join(' · ') })),
          h('div', { class: 'qty', text: e.change ? (e.change > 0 ? '+' : '') + n(e.change) : n(e.remaining) }));
      })),
      h('div', { class: 'btns' }, h('a', { class: 'btn quiet', href: base + '/scan' }, 'Scan another box')));
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
    show(h('h1', { text: 'Scan' }), h('p', { class: 'lead' }, 'Scan a box\'s Cigar Locker label to open its page: open it, take cigars out, count it or move it.'),
      h('button', { class: 'btn primary big wide', type: 'button', onclick: openScanner }, 'Open the scanner'),
      d.boxes.length ? null : h('div', { class: 'card' }, h('p', {}, 'No box is labeled yet. Start with Label boxes.'), h('a', { class: 'btn', href: '#' + base + '/label' }, 'Label boxes')));
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
