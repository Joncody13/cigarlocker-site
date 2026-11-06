/*
 * Cigar Locker Retail: expected against found, for one place in the store
 * (docs/retail.md, the reconciliation engine). Pure: the app and the tests
 * run the same code. Nothing here changes stock: the employee resolves the
 * exceptions, then the server records the confirmed counts.
 *
 * Statuses:
 *   MATCH                   found with the same count the records expect
 *   COUNT_VARIANCE          found, with another count
 *   POSSIBLE_WRONG_PRODUCT  a product not expected here was found while a
 *                           close relative (same line, or same brand and line
 *                           words) expected here was not: perhaps mistaken
 *   EXPECTED_NOT_FOUND      expected here, not seen
 *   FOUND_NOT_EXPECTED      one of the store's products, not expected here
 *   NEEDS_REVIEW            seen but not countable (count 0), or read and not
 *                           one of the store's products
 */
(function (root, make) {
  if (typeof module === 'object' && module.exports) module.exports = make();
  else root.RetailReconcile = make();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STATUS = {
    MATCH: 'MATCH',
    COUNT_VARIANCE: 'COUNT_VARIANCE',
    POSSIBLE_WRONG_PRODUCT: 'POSSIBLE_WRONG_PRODUCT',
    EXPECTED_NOT_FOUND: 'EXPECTED_NOT_FOUND',
    FOUND_NOT_EXPECTED: 'FOUND_NOT_EXPECTED',
    NEEDS_REVIEW: 'NEEDS_REVIEW',
  };

  var WORDS = {
    MATCH: 'Match',
    COUNT_VARIANCE: 'Count variance',
    POSSIBLE_WRONG_PRODUCT: 'Possible wrong product',
    EXPECTED_NOT_FOUND: 'Expected but not found',
    FOUND_NOT_EXPECTED: 'Found but not expected',
    NEEDS_REVIEW: 'Needs review',
  };

  function plain(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  /** Two products of one line (sizes or wrappers of it): the same line key, else the same brand and line words. */
  function relatives(a, b) {
    if (!a || !b) return false;
    if (a.lineKey && b.lineKey) return a.lineKey === b.lineKey;
    return plain(a.brand) === plain(b.brand) && plain(a.line) === plain(b.line) && plain(a.brand) !== '';
  }

  function whole(n) {
    return typeof n === 'number' && isFinite(n) && n >= 0 ? Math.round(n) : null;
  }

  /**
   * The lines for a place from a scan.
   * expected: [{productId, expected}] (what the records hold here, > 0)
   * found:    [{id, seen, count, box}] (store products the scan saw; count 0 = could not tell)
   * others:   [{name, brand, line, size, count, box}] (read, not the store's)
   * products: {id: {name, brand, line, lineKey}} (every store product)
   */
  function reconcile(input) {
    var products = input.products || {};
    var expected = (input.expected || []).filter(function (e) {
      return e && e.productId && whole(e.expected) > 0;
    });
    var found = input.found || [];
    var others = input.others || [];
    var byId = {};
    found.forEach(function (f) {
      if (f && f.id && !byId[f.id]) byId[f.id] = f;
    });
    var lines = [];
    var expectedIds = {};
    expected.forEach(function (e) {
      expectedIds[e.productId] = true;
      var f = byId[e.productId];
      var p = products[e.productId] || {};
      var line = {
        key: 'p:' + e.productId,
        productId: e.productId,
        name: p.name || 'Product',
        expected: whole(e.expected),
        detected: f ? whole(f.count) : 0,
        seen: f ? f.seen || '' : '',
        auto: !!f,
        counted: null,
        resolved: false,
        wrongProduct: false,
      };
      if (!f) line.status = STATUS.EXPECTED_NOT_FOUND;
      else if (!f.count) line.status = STATUS.NEEDS_REVIEW;
      else if (f.count === line.expected) {
        line.status = STATUS.MATCH;
        line.counted = line.expected;
        line.resolved = true;
      } else line.status = STATUS.COUNT_VARIANCE;
      lines.push(line);
    });
    found.forEach(function (f) {
      if (!f || !f.id || expectedIds[f.id] || byId[f.id] !== f) return;
      var p = products[f.id] || {};
      var missingRelative = lines.filter(function (l) {
        return l.status === STATUS.EXPECTED_NOT_FOUND && relatives(products[l.productId], p) && !l.pairedWith;
      })[0];
      var line = {
        key: 'p:' + f.id,
        productId: f.id,
        name: p.name || 'Product',
        expected: 0,
        detected: whole(f.count),
        seen: f.seen || '',
        auto: true,
        counted: null,
        resolved: false,
        wrongProduct: false,
        status: missingRelative ? STATUS.POSSIBLE_WRONG_PRODUCT : f.count ? STATUS.FOUND_NOT_EXPECTED : STATUS.NEEDS_REVIEW,
      };
      if (missingRelative) {
        line.pairedWith = missingRelative.key;
        missingRelative.pairedWith = line.key;
      }
      lines.push(line);
    });
    others.forEach(function (o, i) {
      if (!o || !o.name) return;
      lines.push({
        key: 'o:' + i,
        productId: null,
        name: o.name,
        brand: o.brand || '',
        line: o.line || '',
        size: o.size || '',
        expected: 0,
        detected: whole(o.count),
        seen: o.box ? 'in a box' : '',
        auto: false,
        counted: null,
        resolved: false,
        wrongProduct: false,
        unlisted: true,
        status: STATUS.NEEDS_REVIEW,
      });
    });
    return order(lines);
  }

  /** A hand count: the counts typed, against what was expected. */
  function handCount(input) {
    var products = input.products || {};
    var counts = input.counts || {};
    var lines = [];
    var seen = {};
    (input.expected || []).forEach(function (e) {
      if (!e || !e.productId || seen[e.productId]) return;
      seen[e.productId] = true;
      var c = whole(counts[e.productId]);
      var exp = whole(e.expected) || 0;
      lines.push({
        key: 'p:' + e.productId,
        productId: e.productId,
        name: (products[e.productId] || {}).name || 'Product',
        expected: exp,
        detected: null,
        seen: '',
        auto: false,
        counted: c,
        resolved: c !== null,
        wrongProduct: false,
        status: c === null ? STATUS.NEEDS_REVIEW : c === exp ? STATUS.MATCH : c === 0 ? STATUS.EXPECTED_NOT_FOUND : STATUS.COUNT_VARIANCE,
      });
    });
    Object.keys(counts).forEach(function (id) {
      if (seen[id]) return;
      var c = whole(counts[id]);
      if (c === null) return;
      lines.push({
        key: 'p:' + id,
        productId: id,
        name: (products[id] || {}).name || 'Product',
        expected: 0,
        detected: null,
        seen: '',
        auto: false,
        counted: c,
        resolved: true,
        wrongProduct: false,
        status: c === 0 ? STATUS.MATCH : STATUS.FOUND_NOT_EXPECTED,
      });
    });
    return order(lines);
  }

  var RANK = { NEEDS_REVIEW: 0, POSSIBLE_WRONG_PRODUCT: 1, EXPECTED_NOT_FOUND: 2, COUNT_VARIANCE: 3, FOUND_NOT_EXPECTED: 4, MATCH: 5 };

  /** Exceptions first (the most to look at first), matches last, by name within. */
  function order(lines) {
    return lines.slice().sort(function (a, b) {
      return RANK[a.status] - RANK[b.status] || String(a.name).localeCompare(String(b.name));
    });
  }

  function find(lines, key) {
    for (var i = 0; i < lines.length; i++) if (lines[i].key === key) return lines[i];
    return null;
  }

  /**
   * A choice made on one line, returning new lines:
   *   {type: 'count', value}        the count, typed
   *   {type: 'use_detected'}        what the scan counted
   *   {type: 'keep_expected'}       what the records said
   *   {type: 'not_here'}            none here (0)
   *   {type: 'ignore'}              not counted (an unlisted read, or not the store's)
   *   {type: 'is_expected'}         a possible wrong product is in fact the expected one beside it
   *   {type: 'is_found'}            it is the product the scan named, after all
   *   {type: 'assign', productId, name}   an unlisted read is one of the store's products
   */
  function choose(lines, key, choice) {
    var next = lines.map(function (l) {
      return Object.assign({}, l);
    });
    var l = find(next, key);
    if (!l) return next;
    var t = choice && choice.type;
    if (t === 'count') {
      l.counted = whole(Number(choice.value));
      l.resolved = l.counted !== null;
    } else if (t === 'use_detected') {
      l.counted = l.detected || 0;
      l.resolved = true;
    } else if (t === 'keep_expected') {
      l.counted = l.expected;
      l.resolved = true;
    } else if (t === 'not_here') {
      l.counted = 0;
      l.resolved = true;
    } else if (t === 'ignore') {
      l.counted = null;
      l.ignored = true;
      l.resolved = true;
    } else if (t === 'is_expected' && l.pairedWith) {
      var other = find(next, l.pairedWith);
      if (other) {
        other.counted = l.detected || other.expected;
        other.resolved = true;
        other.wrongProduct = true;
        other.detected = l.detected;
      }
      l.counted = null;
      l.ignored = true;
      l.resolved = true;
    } else if (t === 'is_found') {
      l.counted = l.detected || 0;
      l.resolved = l.detected > 0;
      if (!l.resolved) l.counted = null;
      l.status = l.detected ? STATUS.FOUND_NOT_EXPECTED : STATUS.NEEDS_REVIEW;
      var p = l.pairedWith && find(next, l.pairedWith);
      if (p) delete p.pairedWith;
      delete l.pairedWith;
    } else if (t === 'assign' && choice.productId) {
      var same = next.filter(function (x) {
        return x.productId === choice.productId && x !== l;
      })[0];
      if (same) {
        // Read under another name: it is this one, the scan named it wrong.
        same.detected = (same.detected || 0) + (l.detected || 0);
        same.wrongProduct = true;
        l.ignored = true;
        l.resolved = true;
        l.counted = null;
      } else {
        l.productId = choice.productId;
        l.name = choice.name || l.name;
        l.unlisted = false;
        l.wrongProduct = true;
        l.counted = l.detected || null;
        l.resolved = l.counted !== null;
      }
    }
    return next;
  }

  /** The place's figures as they stand. */
  function summarize(lines) {
    var s = { expected: 0, detected: 0, unlisted: 0, counted: 0, matched: 0, matchedUnits: 0, review: 0, missing: 0, unresolved: 0, adjustments: 0, lines: 0 };
    lines.forEach(function (l) {
      if (l.ignored && !l.productId) return;
      s.lines += 1;
      s.expected += l.expected || 0;
      // Detected counts the store's own products; a read that is not one of them is "unlisted".
      if (l.productId) s.detected += l.detected || 0;
      else s.unlisted += 1;
      if (l.status === STATUS.MATCH) {
        s.matched += 1;
        s.matchedUnits += l.expected || 0;
      } else if (!l.ignored) s.review += 1;
      if (l.status === STATUS.EXPECTED_NOT_FOUND) s.missing += 1;
      if (!l.resolved) s.unresolved += 1;
      if (l.resolved && !l.ignored && l.counted !== null) {
        s.counted += l.counted;
        if (l.counted !== (l.expected || 0)) s.adjustments += 1;
      }
    });
    return s;
  }

  /** What the server is sent on confirming: every product counted here. */
  function confirmLines(lines) {
    return lines
      .filter(function (l) {
        return l.productId && l.resolved && !l.ignored && l.counted !== null;
      })
      .map(function (l) {
        return {
          product_id: l.productId,
          name: l.name,
          expected: l.expected || 0,
          detected: l.detected,
          counted: l.counted,
          status: l.status,
          auto: !!l.auto && !l.wrongProduct,
          wrong_product: !!l.wrongProduct,
        };
      });
  }

  /** What was read and not placed, for the pilot's record. */
  function unmatched(lines) {
    return lines
      .filter(function (l) {
        return l.unlisted;
      })
      .map(function (l) {
        return { name: l.name, count: l.detected || 0, ignored: !!l.ignored };
      });
  }

  /** "1 h 24 min", "38 min", "45 s". */
  function duration(seconds) {
    var s = Math.max(0, Math.round(seconds || 0));
    if (s < 60) return s + ' s';
    var m = Math.round(s / 60);
    if (m < 60) return m + ' min';
    return Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
  }

  return { STATUS: STATUS, WORDS: WORDS, reconcile: reconcile, handCount: handCount, choose: choose, summarize: summarize, confirmLines: confirmLines, unmatched: unmatched, duration: duration, relatives: relatives };
});
