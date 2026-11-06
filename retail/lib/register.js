/*
 * Cigar Locker Retail: the register's lookups and its sale (docs/retail.md,
 * "The register").
 *
 * A scan is looked up on the register itself, in what the server last sent
 * (retail_register_cache), so it never waits for the network: a cigar's own
 * label (CLS-), a box's (CLB-), or a factory code (UPC, EAN, a maker's QR, a
 * SKU). It only adds to the sale held on this register; nothing leaves the
 * inventory until the sale is completed on the server, all of it at once,
 * where every line is checked again. A code the register does not know (a
 * cigar label sold, voided or another store's) is asked of the server.
 *
 * Pure: the codes library is passed in; runs in the browser and under tests.
 */
(function (root, make) {
  if (typeof module === 'object' && module.exports) module.exports = make();
  else root.RetailRegister = make();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** The server's compact cache, as lookups. */
  function index(raw) {
    var r = raw || {};
    var ix = { at: r.at || null, rule: r.rule === 'labels' ? 'labels' : 'fifo', products: {}, byCode: {}, boxes: {}, boxById: {}, units: {}, loose: {}, pins: [] };
    var num = function (v) { return v === null || v === undefined || v === '' ? null : Number(v); };
    (r.products || []).forEach(function (p) {
      // 006's seven, then 008's: brand, line, size name, size text, wrapper, length, ring, sold in 90 days, last sold, reorder level.
      ix.products[p[0]] = { id: p[0], name: p[1] || 'Cigar', price: num(p[2]), upc: p[3] || '', sku: p[4] || '', boxCount: p[5], match: p[6],
        brand: p[7] || '', line: p[8] || '', vitola: p[9] || '', sizeText: p[10] || '', wrapper: p[11] || '', length: num(p[12]), ring: num(p[13]),
        sold: Number(p[14] || 0), lastSold: p[15] || null, reorder: num(p[16]) };
    });
    (r.pins || []).forEach(function (x) { ix.pins.push({ kind: x[0], product: x[1] || null, brand: x[2] || '', position: Number(x[3] || 0) }); });
    function code(v, pid) {
      if (!v) return;
      (ix.byCode[v] = ix.byCode[v] || []).indexOf(pid) < 0 && ix.byCode[v].push(pid);
    }
    Object.keys(ix.products).forEach(function (id) {
      var p = ix.products[id];
      if (p.upc) code(normDigits(p.upc), id);
      if (p.sku) code('sku:' + p.sku.toUpperCase(), id);
    });
    (r.codes || []).forEach(function (c) { code(c[0], c[1]); });
    (r.boxes || []).forEach(function (b) {
      var box = { id: b[0], code: b[1], state: b[2], remaining: Number(b[3]), original: Number(b[4]), product: b[5], labeled: Number(b[6] || 0), opened: b[7] || null };
      ix.boxes[box.code] = box;
      ix.boxById[box.id] = box;
    });
    (r.units || []).forEach(function (u) { ix.units[u[0]] = { token: u[0], id: u[1], box: u[2] }; });
    (r.loose || []).forEach(function (l) { ix.loose[l[0]] = Number(l[1]); });
    return ix;
  }

  /** As the server matches a code: a UPC-A as its EAN-13, spaces out. */
  function normDigits(s) {
    var v = String(s || '').replace(/[\r\n\t]+/g, ' ').trim();
    if (/^[0-9]{12}$/.test(v)) return '0' + v;
    if (/^[0-9 ]+$/.test(v)) return v.replace(/ /g, '');
    return v;
  }

  /**
   * What a scanned code is, on this register:
   *   unit / box / product    found here
   *   ambiguous               a factory code naming several products
   *   ask                     one of Cigar Locker's own codes this register does not
   *                           hold (sold, voided, another store's, or just made): ask the server
   *   unknown                 nothing here or anywhere this register knows
   */
  function resolve(ix, raw, Codes) {
    var text = String(raw || '').trim();
    var own = Codes.ownCode(text);
    if (own && Codes.unitCode(own)) {
      var u = ix.units[own];
      if (!u) return { kind: 'ask', code: own };
      var ub = ix.boxById[u.box];
      return { kind: 'unit', code: own, unit: u, box: ub || null, product: ub ? ix.products[ub.product] : null };
    }
    if (own) {
      var b = ix.boxes[own];
      if (!b) return { kind: 'ask', code: own };
      return { kind: 'box', code: own, box: b, product: ix.products[b.product] || null };
    }
    var v = normDigits(text);
    var ids = (ix.byCode[v] || []).slice();
    (ix.byCode['sku:' + text.toUpperCase()] || []).forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); });
    ids = ids.filter(function (id) { return ix.products[id]; });
    if (ids.length === 1) return { kind: 'product', code: text, product: ix.products[ids[0]] };
    if (ids.length > 1) return { kind: 'ambiguous', code: text, products: ids.map(function (id) { return ix.products[id]; }) };
    return { kind: 'unknown', code: text };
  }

  function newSale(id, now) {
    return { id: id, started: new Date(now || Date.now()).toISOString(), lines: [] };
  }

  /** Cigars of a product that a factory code may take, by the rule, less what the sale already takes. */
  function freeFor(ix, sale, pid) {
    var free = 0;
    if (ix.rule === 'fifo') {
      Object.keys(ix.boxById).forEach(function (id) {
        var b = ix.boxById[id];
        if (b.product === pid && b.state === 'open') free += Math.max(0, b.remaining - b.labeled);
      });
    }
    free += ix.loose[pid] || 0;
    sale.lines.forEach(function (l) {
      if (l.product === pid && (l.kind === 'product' || (l.kind === 'queen' && ix.rule === 'fifo'))) free -= l.quantity;
    });
    return free;
  }
  function labeledOpen(ix, pid) {
    return Object.keys(ix.boxById).some(function (id) { var b = ix.boxById[id]; return b.product === pid && b.state === 'open' && b.labeled > 0; });
  }
  function sealedOf(ix, pid) {
    return Object.keys(ix.boxById).some(function (id) { var b = ix.boxById[id]; return b.product === pid && b.state === 'sealed'; });
  }

  /**
   * A scan into the sale. Answers {sale, tone, words, status, key}: the sale
   * as it is now (unchanged when nothing was added), 'good', 'warn' or 'bad',
   * the words to show, and the line it touched.
   */
  function scan(sale, hit, ix) {
    var lines = sale.lines.slice();
    var out = function (tone, status, words, key) {
      return { sale: { id: sale.id, started: sale.started, lines: lines }, tone: tone, status: status, words: words, key: key || null };
    };
    var p = hit.product;
    if (hit.kind === 'unit') {
      if (lines.some(function (l) { return l.kind === 'unit' && l.token === hit.code; })) {
        return out('warn', 'duplicate', 'THIS CIGAR IS ALREADY IN THE SALE · ' + hit.code, 'u:' + hit.code);
      }
      if (!p) return out('bad', 'review', 'PRODUCT NEEDS REVIEW: ' + hit.code + ' has no product on this register. Ask a manager.');
      lines.push({ key: 'u:' + hit.code, kind: 'unit', token: hit.code, unit: hit.unit.id, box: hit.box.id, boxCode: hit.box.code, product: p.id, name: p.name, price: p.price, quantity: 1 });
      return out('good', 'added', p.name + ' · ' + hit.code, 'u:' + hit.code);
    }
    if (hit.kind === 'box') {
      var b = hit.box;
      if (!p) return out('bad', 'review', 'PRODUCT NEEDS REVIEW: ' + b.code + ' has no product on this register.');
      if (b.state === 'sealed') {
        if (lines.some(function (l) { return l.kind === 'king' && l.box === b.id; })) return out('warn', 'duplicate', 'THIS BOX IS ALREADY IN THE SALE · ' + b.code, 'k:' + b.id);
        lines.push({ key: 'k:' + b.id, kind: 'king', box: b.id, boxCode: b.code, product: p.id, name: p.name, price: p.price, quantity: b.original });
        return out('good', 'added', 'Whole box · ' + p.name + ' · ' + b.original + ' cigars', 'k:' + b.id);
      }
      if (b.state !== 'open') return out('bad', 'review', b.code + ' is recorded ' + b.state + '.');
      var inSale = lines.filter(function (l) { return l.kind === 'queen' && l.box === b.id; })[0];
      var free = b.remaining - b.labeled - (inSale ? inSale.quantity : 0);
      if (free <= 0) {
        return out('bad', 'needs-label', b.labeled ? 'PRODUCT NEEDS REVIEW: ' + b.code + '\'s cigars carry their own labels. Scan the cigar.' : b.code + ' has no more cigars on the records.');
      }
      if (inSale) {
        lines = lines.map(function (l) { return l === inSale ? Object.assign({}, l, { quantity: l.quantity + 1 }) : l; });
      } else {
        lines.push({ key: 'q:' + b.id, kind: 'queen', box: b.id, boxCode: b.code, product: p.id, name: p.name, price: p.price, quantity: 1 });
      }
      return out('good', 'added', p.name + ' · from open box ' + b.code, 'q:' + b.id);
    }
    if (hit.kind === 'product') {
      if (freeFor(ix, sale, p.id) <= 0) {
        if (labeledOpen(ix, p.id)) return out('bad', 'needs-label', 'PRODUCT NEEDS REVIEW: ' + p.name + ' carries its own labels. Scan the cigar\'s label.');
        if (sealedOf(ix, p.id)) return out('bad', 'needs-label', 'PRODUCT NEEDS REVIEW: no ' + p.name + ' open. Open a box, or scan the box\'s label to sell it whole.');
        return out('bad', 'review', 'PRODUCT NEEDS REVIEW: no ' + p.name + ' on the records.');
      }
      var have = lines.filter(function (l) { return l.kind === 'product' && l.product === p.id && !l.override; })[0];
      if (have) lines = lines.map(function (l) { return l === have ? Object.assign({}, l, { quantity: l.quantity + 1 }) : l; });
      else lines.push({ key: 'p:' + p.id, kind: 'product', product: p.id, name: p.name, price: p.price, quantity: 1, by: hit.by === 'hand' ? 'hand' : 'code' });
      return out('good', 'added', p.name + (hit.by === 'hand' ? '' : ' · by its factory code'), 'p:' + p.id);
    }
    if (hit.kind === 'ambiguous') {
      return out('bad', 'review', 'PRODUCT NEEDS REVIEW: ' + hit.code + ' names ' + hit.products.length + ' products (' + hit.products.map(function (x) { return x.name; }).join(', ') + '). Scan the cigar\'s own label.');
    }
    return out('bad', 'unknown', 'UNKNOWN CODE · ' + hit.code);
  }

  /** A manager's deliberate override of a duplicate cigar label: one more of that cigar, taken by the rule, marked. */
  function override(sale, token, ix) {
    var l = sale.lines.filter(function (x) { return x.kind === 'unit' && x.token === token; })[0];
    if (!l) return sale;
    var key = 'o:' + token + ':' + sale.lines.filter(function (x) { return x.override; }).length;
    return { id: sale.id, started: sale.started, lines: sale.lines.concat([{ key: key, kind: 'product', product: l.product, name: l.name, price: l.price, quantity: 1, override: true, note: 'second cigar labeled ' + token }]) };
  }

  /**
   * A cigar chosen by hand from one open box rather than by the store's rule
   * (the oldest open box first): as many of the line as that box can give,
   * the rest left to the rule.
   */
  function toQueen(sale, key, boxId, ix) {
    var l = sale.lines.filter(function (x) { return x.key === key && x.kind === 'product' && !x.override; })[0];
    var b = ix.boxById[boxId];
    if (!l || !b || b.product !== l.product || b.state !== 'open') return sale;
    var have = sale.lines.filter(function (x) { return x.kind === 'queen' && x.box === b.id; })[0];
    var free = b.remaining - b.labeled - (have ? have.quantity : 0);
    var take = Math.min(l.quantity, Math.max(0, free));
    if (!take) return sale;
    var lines = [];
    sale.lines.forEach(function (x) {
      if (x === l) {
        if (l.quantity > take) lines.push(Object.assign({}, l, { quantity: l.quantity - take }));
        if (!have) lines.push({ key: 'q:' + b.id, kind: 'queen', box: b.id, boxCode: b.code, product: l.product, name: l.name, price: l.price, quantity: take, chosen: true });
      } else if (x === have) {
        lines.push(Object.assign({}, x, { quantity: x.quantity + take }));
      } else {
        lines.push(x);
      }
    });
    return { id: sale.id, started: sale.started, lines: lines };
  }

  /** The server's word on one of Cigar Locker's own codes this register did not hold. */
  function serverWords(r) {
    if (!r) return { tone: 'bad', words: 'UNKNOWN CODE' };
    if (r.kind === 'label') return { tone: 'bad', words: 'A BLANK BOX LABEL (No. ' + r.no + '): on no box yet.' };
    if (r.otherStore) return { tone: 'bad', words: 'WRONG STORE · ' + r.code + ' is another store\'s.' };
    if (r.unknown || (!r.unit && !r.box)) return { tone: 'bad', words: 'UNKNOWN CODE · ' + (r.code || '') };
    if (r.kind === 'unit') {
      var u = r.unit;
      var when = u.statusAt ? ' ' + new Date(u.statusAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
      var who = u.by ? ' by ' + u.by : '';
      if (u.status === 'available') return { tone: 'good', add: true };
      if (u.status === 'sold') return { tone: 'bad', words: 'ALREADY SOLD — REVIEW ITEM · ' + u.token + ' sold' + when + who + '.' };
      if (u.status === 'void') return { tone: 'bad', words: 'VOID TOKEN · ' + u.token + ' was voided' + when + '. Use the cigar\'s new label.' };
      if (u.status === 'damaged') return { tone: 'bad', words: 'DAMAGED TOKEN · ' + u.token + ' was recorded damaged' + when + who + '.' };
      if (u.status === 'missing') return { tone: 'bad', words: 'MISSING TOKEN · ' + u.token + ' was recorded missing' + when + who + '.' };
      return { tone: 'bad', words: 'ALREADY OUT — REVIEW ITEM · ' + u.token + ' was recorded ' + ({ comped: 'a comp', gifted: 'a gift', sample: 'a sample' }[u.status] || u.status) + when + who + '.' };
    }
    if (r.kind === 'box' && r.box) return { tone: 'good', add: true };
    return { tone: 'bad', words: 'UNKNOWN CODE' };
  }

  /** The lines as the server takes them. */
  function forServer(sale) {
    // entry: how the line went in (the scanner, the search, the tiles...), kept with it (008).
    return sale.lines.map(function (l) {
      var e = l.override ? 'override' : l.entry || '';
      if (l.kind === 'unit') return { kind: 'unit', token: l.token, entry: e };
      if (l.kind === 'king') return { kind: 'king', box: l.box, entry: e };
      if (l.kind === 'queen') return { kind: 'queen', box: l.box, quantity: l.quantity, entry: e };
      return { kind: 'product', product: l.product, quantity: l.quantity, override: !!l.override, entry: e };
    });
  }

  function totals(sale) {
    var cigars = 0;
    var cents = 0;
    var priced = true;
    sale.lines.forEach(function (l) {
      cigars += l.quantity;
      if (l.price === null || l.price === undefined) priced = false;
      else cents += l.price * l.quantity;
    });
    return { cigars: cigars, cents: cents, pricedAll: priced, lines: sale.lines.length };
  }

  function remove(sale, key) {
    return { id: sale.id, started: sale.started, lines: sale.lines.filter(function (l) { return l.key !== key; }) };
  }
  function setQuantity(sale, key, q) {
    return { id: sale.id, started: sale.started, lines: sale.lines.map(function (l) { return l.key === key && l.kind !== 'unit' && l.kind !== 'king' ? Object.assign({}, l, { quantity: Math.max(1, Math.round(q) || 1) }) : l; }) };
  }

  /** After a sale is completed: the register's own list follows at once (the server's comes after). */
  function afterSale(ix, sale) {
    sale.lines.forEach(function (l) {
      if (l.kind === 'unit') {
        delete ix.units[l.token];
        var b = ix.boxById[l.box];
        if (b) { b.remaining -= 1; b.labeled = Math.max(0, b.labeled - 1); }
      } else if (l.kind === 'king') {
        var k = ix.boxById[l.box];
        if (k) k.state = 'empty';
      } else if (l.kind === 'queen') {
        var q = ix.boxById[l.box];
        if (q) q.remaining -= l.quantity;
      } else {
        var need = l.quantity;
        if (ix.rule === 'fifo') {
          Object.keys(ix.boxById).forEach(function (id) {
            var x = ix.boxById[id];
            if (need > 0 && x.product === l.product && x.state === 'open') {
              var t = Math.min(need, Math.max(0, x.remaining - x.labeled));
              x.remaining -= t;
              need -= t;
            }
          });
        }
        if (need > 0) ix.loose[l.product] = Math.max(0, (ix.loose[l.product] || 0) - need);
      }
    });
    return ix;
  }

  return { index: index, normDigits: normDigits, resolve: resolve, newSale: newSale, scan: scan, override: override, serverWords: serverWords,
    forServer: forServer, totals: totals, remove: remove, setQuantity: setQuantity, afterSale: afterSale, freeFor: freeFor, toQueen: toQueen };
});
