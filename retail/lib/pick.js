/*
 * Cigar Locker Retail: choosing cigars at the register by hand (docs/retail.md,
 * "Choosing by hand at the register").
 *
 * Beside the scanner, a cashier finds a cigar by typing a few letters ("fou",
 * "tab tor", "pad 64 mad"), or by tapping a brand, its line, the wrapper when
 * the line comes in more than one, then the size. Everything here works on
 * the register's own copy of the store's list (RetailRegister.index), so
 * nothing waits for the network; only the store's own cigars are searched,
 * those on hand first.
 *
 * Pure: runs in the browser and under the tests.
 */
(function (root, make) {
  if (typeof module === 'object' && module.exports) module.exports = make();
  else root.RetailPick = make();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Lower case, no accents, '#4' as 'no 4', letters apart from digits ('pb99' is 'pb 99'), only letters and digits. */
  function plain(s) {
    var v = String(s || '').toLowerCase();
    if (v.normalize) v = v.normalize('NFD').replace(/[̀-ͯ]/g, '');
    // A decimal point stays ("6.5"); every other mark is a space ("A.J." is "a j").
    return v.replace(/#\s*/g, ' no ').replace(/(\d)\.(\d)/g, '$1\u0001$2').replace(/([a-z])([0-9])/g, '$1 $2').replace(/([0-9])([a-z])/g, '$1 $2')
      .replace(/[^a-z0-9\u0001]+/g, ' ').replace(/\u0001/g, '.').replace(/\s+/g, ' ').trim();
  }
  function words(s) {
    var p = plain(s);
    return p ? p.split(' ') : [];
  }

  // Wrapper words: what tells one version of a line from another ("Melanio" and "Melanio Maduro").
  var SHADES = ['san andres', 'sun grown', 'maduro', 'natural', 'connecticut', 'habano', 'oscuro', 'claro', 'colorado', 'sumatra', 'corojo',
    'criollo', 'cameroon', 'broadleaf', 'rosado', 'candela', 'shade', 'negro', 'ct', 'sg'];
  // Shorthand a cashier types that is not a start of the word.
  var ALIASES = { ct: ['connecticut'], conn: ['connecticut'], sg: ['sun', 'grown'], sa: ['san', 'andres'], dbl: ['double'], pc: ['petit', 'corona'],
    dc: ['double', 'corona'], torp: ['torpedo'], chur: ['churchill'], rob: ['robusto'], gor: ['gordo'], lanc: ['lancero'], bel: ['belicoso'] };

  function title(s) {
    return String(s || '').replace(/\b([a-z])/g, function (m) { return m.toUpperCase(); });
  }

  /**
   * A line as its family and version: "Serie V Melanio Maduro" is Serie V
   * Melanio, Maduro; a line with no wrapper word takes the product's wrapper's
   * ("Ecuador Sumatra" is Sumatra), else none.
   */
  function splitLine(line, wrapper) {
    var raw = String(line || '').trim();
    var p = ' ' + plain(raw) + ' ';
    var found = [];
    SHADES.forEach(function (s) {
      if (p.indexOf(' ' + s + ' ') >= 0) {
        found.push({ at: p.indexOf(' ' + s + ' '), s: s });
        p = p.replace(' ' + s + ' ', ' ');
      }
    });
    var base = p.replace(/\s+/g, ' ').trim();
    var version = '';
    if (found.length && base) {
      found.sort(function (a, b) { return a.at - b.at; });
      version = found.map(function (f) { return f.s === 'ct' ? 'Connecticut' : f.s === 'sg' ? 'Sun Grown' : title(f.s); }).join(' ');
      // Keep the family as it was written: the line's own words, less the wrapper's.
      var drop = {};
      found.forEach(function (f) { f.s.split(' ').forEach(function (w) { drop[w] = true; }); });
      base = raw.split(/\s+/).filter(function (w) { return !drop[plain(w)]; }).join(' ').replace(/^[\s\-–·,/]+|[\s\-–·,/]+$/g, '');
    } else {
      base = raw;
      var wp = ' ' + plain(wrapper) + ' ';
      var hit = SHADES.filter(function (s) { return wp.indexOf(' ' + s + ' ') >= 0; })[0];
      version = hit ? (hit === 'ct' ? 'Connecticut' : hit === 'sg' ? 'Sun Grown' : title(hit)) : String(wrapper || '').trim();
    }
    return { base: base, version: version };
  }

  /** The register's index as cigars to choose from: on hand, open boxes (the oldest first), how each sells. */
  function items(ix) {
    var byProduct = {};
    Object.keys(ix.boxById || {}).forEach(function (id) {
      var b = ix.boxById[id];
      (byProduct[b.product] = byProduct[b.product] || []).push(b);
    });
    var out = [];
    Object.keys(ix.products || {}).forEach(function (id) {
      var p = ix.products[id];
      var boxes = byProduct[id] || [];
      var open = boxes.filter(function (b) { return b.state === 'open' && b.remaining > 0; })
        .sort(function (a, b) { return (a.opened || '9').localeCompare(b.opened || '9') || a.code.localeCompare(b.code); });
      var sealed = boxes.filter(function (b) { return b.state === 'sealed'; });
      var loose = (ix.loose || {})[id] || 0;
      var inOpen = open.reduce(function (s, b) { return s + b.remaining; }, 0);
      var inSealed = sealed.reduce(function (s, b) { return s + b.remaining; }, 0);
      var unlabeled = open.reduce(function (s, b) { return s + Math.max(0, b.remaining - b.labeled); }, 0);
      var onHand = inOpen + inSealed + loose;
      var split = splitLine(p.line, p.wrapper);
      var brand = (p.brand || '').trim() || (p.name || 'Cigar').split(' ')[0];
      var size = p.length && p.ring ? fmtLen(p.length) + ' × ' + p.ring : (p.sizeText || '');
      var it = {
        id: id, product: p, name: p.name, brand: brand, brandKey: plain(brand), line: p.line || '', family: split.base, familyKey: plain(split.base),
        version: split.version, versionKey: plain(split.version), vitola: p.vitola || '', size: size, wrapper: p.wrapper || '',
        length: p.length, ring: p.ring, price: p.price, sku: p.sku || '', upc: p.upc || '', sold: p.sold || 0,
        lastSold: p.lastSold ? Date.parse(p.lastSold) || 0 : 0, reorder: p.reorder,
        onHand: onHand, loose: loose, sealed: sealed.length, open: open,
        // What a tap can take: cigars without their own label (the store's rule decides which), or loose ones.
        singles: (ix.rule === 'fifo' ? unlabeled : 0) + loose,
        queen: open.length ? { code: open[0].code, remaining: open[0].remaining } : null,
      };
      it.low = onHand > 0 && (it.reorder !== null && it.reorder !== undefined ? onHand <= it.reorder : onHand <= 5 && !sealed.length);
      it.hay = haystack(it);
      out.push(it);
    });
    return out;
  }
  function fmtLen(x) {
    var n = Number(x);
    var whole = Math.floor(n);
    var frac = n - whole;
    var eighths = Math.round(frac * 8);
    if (!eighths) return String(whole);
    if (eighths === 8) return String(whole + 1);
    var map = { 1: '⅛', 2: '¼', 3: '⅜', 4: '½', 5: '⅝', 6: '¾', 7: '⅞' };
    return whole + map[eighths];
  }

  // What a product is searched by, field by field.
  function haystack(it) {
    var fields = [
      { f: 'brand', w: words(it.brand) },
      { f: 'line', w: words(it.line) },
      { f: 'vitola', w: words(it.vitola) },
      { f: 'size', w: words(it.product.sizeText) },
      { f: 'wrapper', w: words(it.wrapper) },
    ];
    return { fields: fields, sku: plain(it.sku).replace(/ /g, ''), upc: String(it.upc || '').replace(/\D/g, ''), all: plain([it.brand, it.line, it.vitola].join(' ')) };
  }

  /** A query as tokens: words, sizes ("6x52", "6 x 52", "6.5x52") and a quantity ("3x tab tor", "3* pad"). */
  function parse(q) {
    var s = String(q || '').trim();
    var qty = 1;
    var m = /^(\d{1,3})\s*[x*×]\s+([a-z#].*)$/i.exec(s) || /^(\d{1,3})\s*\*\s*(.+)$/.exec(s);
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= 200) {
      qty = Number(m[1]);
      s = m[2];
    }
    var tokens = [];
    var raw = plain(s.replace(/(\d)\s*[x×]\s*(\d)/gi, '$1x$2')).split(' ').filter(Boolean);
    // plain() parts "6x52" into "6 x 52"; read it back as a size.
    for (var i = 0; i < raw.length; i++) {
      if (/^\d+(\.\d+)?$/.test(raw[i]) && raw[i + 1] === 'x' && /^\d+$/.test(raw[i + 2] || '')) {
        tokens.push({ size: { len: Number(raw[i]), ring: Number(raw[i + 2]) }, text: raw[i] + 'x' + raw[i + 2] });
        i += 2;
      } else if (raw[i] === 'x' || (raw[i] === 'no' && /^\d/.test(raw[i + 1] || ''))) {
        // "x" between figures, "No." before one ("#4", "No. 4" and "4" are one).
        continue;
      } else {
        tokens.push({ text: raw[i] });
      }
    }
    return { qty: qty, tokens: tokens, text: s };
  }

  function lev1(a, b) {
    // Within one edit (a letter changed, added, dropped, or two swapped).
    if (a === b) return true;
    var la = a.length;
    var lb = b.length;
    if (Math.abs(la - lb) > 1) return false;
    var i = 0;
    while (i < la && i < lb && a[i] === b[i]) i++;
    if (la === lb) return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
    return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
  }

  /**
   * How well one token fits a product: {score, sure} or null. sure is 2 for
   * an exact word, initials, a shorthand or the size; 1 for the start of a
   * word; 0 for a weaker fit (inside a word, a typing slip).
   */
  function fit(tok, it) {
    var best = null;
    function take(score, sure) {
      if (!best || score > best.score || (score === best.score && sure > best.sure)) best = { score: score, sure: sure };
    }
    if (tok.size) {
      var len = Number(it.length);
      var ring = Number(it.ring);
      if (ring === tok.size.ring && Math.abs(len - tok.size.len) < 0.13) take(12, 2);
      else if (ring === tok.size.ring) take(5, 0);
      return best;
    }
    var t = tok.text;
    var digits = /^\d+$/.test(t);
    var hay = it.hay;
    if (hay.sku && t.replace(/ /g, '') === hay.sku) take(14, 2);
    else if (hay.sku && t.length >= 3 && hay.sku.indexOf(t) === 0) take(7, 1);
    if (digits && t.length >= 4 && hay.upc) {
      if (hay.upc === t || hay.upc.replace(/^0+/, '') === t.replace(/^0+/, '')) take(14, 2);
      else if (hay.upc.indexOf(t) >= 0) take(6, 1);
    }
    if (digits && (Number(t) === Number(it.ring) || Number(t) === Number(it.length))) take(6, 1);
    var alias = ALIASES[t];
    hay.fields.forEach(function (fld) {
      var ws = fld.w;
      var weight = fld.f === 'wrapper' ? 0.8 : fld.f === 'size' ? 0.9 : 1;
      for (var i = 0; i < ws.length; i++) {
        var w = ws[i];
        if (w === t) take(10 * weight, 2);
        else if (w.indexOf(t) === 0) take((6 + 3 * t.length / w.length) * weight, 1);
        else if (digits && /^\d+$/.test(w) && t.length >= 2 && w.slice(-t.length) === t) take(7 * weight, 2); // "64" is 1964
        else if (!digits && t.length >= 3 && w.indexOf(t) > 0) take(3 * weight, 0);
        else if (!digits && t.length >= 4 && w.length >= 4 && (lev1(t, w.slice(0, t.length)) || lev1(t, w.slice(0, t.length + 1)) || lev1(t, w.slice(0, t.length - 1)))) take(3 * weight, 0);
        if (alias && alias.indexOf(w) >= 0) take(8 * weight, 2);
        // Initials across neighbouring words: "af" is Arturo Fuente, "lp" Liga Privada, "ajf" A.J. Fernandez.
        if (!digits && t.length >= 2 && t.length <= 5 && i + t.length <= ws.length) {
          var ini = '';
          for (var j = 0; j < t.length; j++) ini += ws[i + j][0];
          if (ini === t) take(8 * weight, 2);
        }
        // Words run together: "opusx", "liga9".
        if (!digits && t.length >= 4 && i + 1 < ws.length && (w + ws[i + 1]).indexOf(t) === 0 && w.length < t.length) take(6 * weight, 1);
      }
    });
    return best;
  }

  /**
   * The store's cigars for what was typed, best first: those on hand ahead of
   * the rest, then how well they fit, an open box to take from, sold lately,
   * how often they sell. Each answer: {item, score, sure, stocked}.
   */
  function search(list, query, opts) {
    var q = typeof query === 'string' ? parse(query) : query;
    if (!q.tokens.length) return [];
    var now = (opts && opts.now) || Date.now();
    var recent = (opts && opts.recent) || {};
    var phrase = plain(q.text);
    var sku = phrase.replace(/ /g, '');
    var out = [];
    list.forEach(function (it) {
      var score = 0;
      var sure = 2;
      // The whole of what was typed is this cigar's SKU ("TAB-T").
      if (sku.length >= 3 && it.hay.sku === sku) {
        out.push({ item: it, score: 40, sure: 2, rank: 46, stocked: it.onHand > 0 });
        return;
      }
      for (var i = 0; i < q.tokens.length; i++) {
        var f = fit(q.tokens[i], it);
        if (!f) return;
        score += f.score;
        sure = Math.min(sure, f.sure);
      }
      if (phrase.length >= 3 && it.hay.all.indexOf(phrase) >= 0) score += 4;
      var stocked = it.onHand > 0;
      var last = Math.max(it.lastSold || 0, recent[it.id] || 0);
      var rank = score + (sure === 2 ? 6 : 0) + (it.singles > 0 && it.open.length ? 3 : 0) + (last && now - last < 14 * 864e5 ? 3 : 0) + Math.log(1 + it.sold) / Math.LN2 * 1.5;
      out.push({ item: it, score: score, sure: sure, rank: rank, stocked: stocked });
    });
    out.sort(function (a, b) {
      return (b.stocked - a.stocked) || (b.rank - a.rank) || (b.item.sold - a.item.sold) || a.item.name.localeCompare(b.item.name);
    });
    return out;
  }

  /**
   * The one answer Enter may add without asking, or null: the only cigar on
   * hand that fits, or the only one on hand that fits surely (every word an
   * exact word, initials or the size) when the others fit only by a start.
   */
  function sole(results) {
    var stocked = results.filter(function (r) { return r.stocked; });
    if (stocked.length === 1) return stocked[0];
    if (!stocked.length) return null;
    var surest = stocked.reduce(function (m, r) { return Math.max(m, r.sure); }, 0);
    var top = stocked.filter(function (r) { return r.sure === surest; });
    if (surest === 2 && top.length === 1) return top[0];
    return null;
  }

  // ---- browsing: brand, line, wrapper, size ------------------------------------------------------

  function stocked(list) {
    return list.filter(function (it) { return it.onHand > 0; });
  }
  function groupBy(list, key, name) {
    var m = {};
    var order = [];
    list.forEach(function (it) {
      var k = it[key];
      if (!m[k]) { m[k] = { key: k, names: {}, items: [], sold: 0, onHand: 0 }; order.push(k); }
      var g = m[k];
      g.items.push(it);
      g.sold += it.sold;
      g.onHand += it.onHand;
      var nm = name(it);
      g.names[nm] = (g.names[nm] || 0) + 1;
    });
    return order.map(function (k) {
      var g = m[k];
      g.name = Object.keys(g.names).sort(function (a, b) { return g.names[b] - g.names[a] || a.localeCompare(b); })[0];
      delete g.names;
      return g;
    });
  }
  var byName = function (a, b) { return a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }); };

  /** Brands with cigars on hand, as tiles: by how they sell ('sold'), pinned first ('pinned'), or A to Z ('alpha'). */
  function brands(list, sort, pins) {
    var pinned = {};
    (pins || []).forEach(function (p) { if (p.kind === 'brand') pinned[plain(p.brand)] = p.position; });
    var gs = groupBy(stocked(list), 'brandKey', function (it) { return it.brand; });
    gs.forEach(function (g) { g.pinned = pinned[g.key] === undefined ? null : pinned[g.key]; g.count = g.items.length; });
    gs.sort(function (a, b) {
      if (sort === 'alpha') return byName(a, b);
      if (sort === 'pinned') {
        var pa = a.pinned === null ? Infinity : a.pinned;
        var pb = b.pinned === null ? Infinity : b.pinned;
        if (pa !== pb) return pa - pb;
      }
      return b.sold - a.sold || byName(a, b);
    });
    return gs;
  }
  function lines(list, brandKey) {
    var gs = groupBy(stocked(list).filter(function (it) { return it.brandKey === brandKey; }), 'familyKey', function (it) { return it.family || it.brand; });
    gs.forEach(function (g) { g.count = g.items.length; });
    return gs.sort(byName);
  }
  function versions(list, brandKey, familyKey) {
    var gs = groupBy(stocked(list).filter(function (it) { return it.brandKey === brandKey && it.familyKey === familyKey; }), 'versionKey', function (it) { return it.version || 'Natural'; });
    gs.forEach(function (g) { g.count = g.items.length; });
    return gs.sort(byName);
  }
  function sizes(list, brandKey, familyKey, versionKey) {
    return stocked(list).filter(function (it) { return it.brandKey === brandKey && it.familyKey === familyKey && it.versionKey === versionKey; })
      .sort(function (a, b) {
        var la = Number(a.length) || 99;
        var lb = Number(b.length) || 99;
        return la - lb || (Number(a.ring) || 0) - (Number(b.ring) || 0) || a.name.localeCompare(b.name, 'en', { numeric: true });
      });
  }

  /**
   * Where browsing stands. path: {brand, line, version, auto: {line, version}}.
   * A level with one choice is taken by itself (and marked auto, so Back
   * skips it). Answers {level, options, path, crumbs}.
   */
  function step(list, path, sort, pins) {
    var p = { brand: path.brand || null, line: path.line || null, version: path.version || null, auto: Object.assign({}, path.auto || {}) };
    if (!p.brand) return { level: 'brands', options: brands(list, sort, pins), path: p, crumbs: [] };
    var ls = lines(list, p.brand);
    if (!ls.length) return step(list, {}, sort, pins);
    var brandName = ls[0].items[0].brand;
    var crumbs = [{ level: 'brand', name: brandName }];
    if (!p.line || !ls.some(function (l) { return l.key === p.line; })) {
      if (ls.length !== 1) return { level: 'lines', options: ls, path: { brand: p.brand, line: null, version: null, auto: {} }, crumbs: crumbs };
      p.line = ls[0].key;
      p.auto.line = true;
    }
    var line = ls.filter(function (l) { return l.key === p.line; })[0];
    crumbs.push({ level: 'line', name: line.name, auto: !!p.auto.line });
    var vs = versions(list, p.brand, p.line);
    if (p.version === null || !vs.some(function (v) { return v.key === p.version; })) {
      if (vs.length !== 1) return { level: 'versions', options: vs, path: { brand: p.brand, line: p.line, version: null, auto: { line: p.auto.line } }, crumbs: crumbs };
      p.version = vs[0].key;
      p.auto.version = true;
    }
    var v = vs.filter(function (x) { return x.key === p.version; })[0];
    if (vs.length > 1) crumbs.push({ level: 'version', name: v.name, auto: !!p.auto.version });
    return { level: 'sizes', options: sizes(list, p.brand, p.line, p.version), path: p, crumbs: crumbs };
  }

  /** Back one choice: the last one made by hand, with whatever was taken by itself after it. */
  function back(path) {
    var p = { brand: path.brand || null, line: path.line || null, version: path.version || null, auto: Object.assign({}, path.auto || {}) };
    var order = ['version', 'line', 'brand'];
    for (var i = 0; i < order.length; i++) {
      var k = order[i];
      if (p[k] !== null && !(p.auto && p.auto[k])) {
        for (var j = 0; j <= i; j++) { p[order[j]] = null; delete p.auto[order[j]]; }
        return p;
      }
    }
    return { brand: null, line: null, version: null, auto: {} };
  }
  /** Back to a crumb: that level's choice kept, everything after it cleared. */
  function upTo(path, level) {
    var p = { brand: path.brand, line: null, version: null, auto: {} };
    if (level === 'line' || level === 'version') { p.line = path.line; if (path.auto && path.auto.line) p.auto.line = true; }
    if (level === 'version') { p.version = path.version; if (path.auto && path.auto.version) p.auto.version = true; }
    return level === 'home' ? { brand: null, line: null, version: null, auto: {} } : p;
  }

  // ---- quick lists ---------------------------------------------------------------------------------

  /** Sold lately: here (this register's sales) or anywhere in the store, newest first. */
  function recent(list, local, n) {
    var l = local || {};
    return stocked(list).filter(function (it) { return it.lastSold || l[it.id]; })
      .sort(function (a, b) { return Math.max(b.lastSold, l[b.id] || 0) - Math.max(a.lastSold, l[a.id] || 0); }).slice(0, n || 12);
  }
  function mostSold(list, n) {
    return stocked(list).filter(function (it) { return it.sold > 0; }).sort(function (a, b) { return b.sold - a.sold || byName(a, b); }).slice(0, n || 12);
  }
  /** The cigars a manager pinned, in their order (those not on hand too, so they are not lost). */
  function favorites(list, pins) {
    var byId = {};
    list.forEach(function (it) { byId[it.id] = it; });
    return (pins || []).filter(function (p) { return p.kind === 'product' && byId[p.product]; })
      .sort(function (a, b) { return a.position - b.position; }).map(function (p) { return byId[p.product]; });
  }
  function isPinned(pins, kind, key) {
    return (pins || []).some(function (p) { return p.kind === kind && (kind === 'product' ? p.product === key : plain(p.brand) === key); });
  }

  /** The cigars local to this register's recent sales, newest kept: {product id: ms}. */
  function noteSold(local, productIds, now) {
    var l = Object.assign({}, local || {});
    (productIds || []).forEach(function (id) { l[id] = now || Date.now(); });
    var keep = Object.keys(l).sort(function (a, b) { return l[b] - l[a]; }).slice(0, 40);
    var out = {};
    keep.forEach(function (k) { out[k] = l[k]; });
    return out;
  }

  return { plain: plain, words: words, splitLine: splitLine, items: items, parse: parse, fit: fit, search: search, sole: sole,
    brands: brands, lines: lines, versions: versions, sizes: sizes, step: step, back: back, upTo: upTo,
    recent: recent, mostSold: mostSold, favorites: favorites, isPinned: isPinned, noteSold: noteSold, fmtLen: fmtLen };
});
