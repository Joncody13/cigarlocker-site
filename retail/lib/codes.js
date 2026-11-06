/*
 * Cigar Locker Retail: codes and labels (docs/retail.md, "Boxes").
 *
 * A box's own code is "CL-" and six of 30 letters and digits never mistaken
 * for one another, the only thing its QR label holds. Factory codes (UPC,
 * EAN, makers' QR codes) name a product, never a box. The guard keeps one
 * code from being taken twice while it stays in front of the camera. The QR
 * itself is drawn from a module matrix (vendor/toqr.js) as one SVG path.
 * Pure: runs in the browser and under the tests.
 */
(function (root, make) {
  if (typeof module === 'object' && module.exports) module.exports = make();
  else root.RetailCodes = make();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BOX = /^CL-[2-9A-HJKMNP-TV-Z]{6}$/;

  /** A Cigar Locker box code, read in any case, or null. */
  function boxCode(s) {
    var v = String(s || '').trim().toUpperCase();
    return BOX.test(v) ? v : null;
  }

  /** As the server matches a code: spaces gone, a UPC-A as its EAN-13. */
  function norm(s) {
    var v = String(s || '').replace(/[\r\n\t]+/g, ' ').trim();
    if (/^[0-9]{12}$/.test(v)) return '0' + v;
    if (/^[0-9 ]+$/.test(v)) return v.replace(/ /g, '');
    return v;
  }

  /** The kind of code, from what the camera's reader said it was. */
  function typeOf(format, value) {
    if (boxCode(value)) return 'CIGAR_LOCKER_QR';
    var f = String(format || '').toLowerCase();
    var v = String(value || '').trim();
    if (f === 'upc_a' || f === 'upc_e') return 'UPC';
    if (f === 'ean_13') return /^0[0-9]{12}$/.test(v) ? 'UPC' : 'EAN';
    if (f === 'ean_8') return 'EAN';
    if (f === 'qr_code' || f === 'micro_qr_code' || f === 'rm_qr_code') return 'QR';
    if (!f) {
      if (/^[0-9]{12}$/.test(v) || /^[0-9]{8}$/.test(v)) return 'UPC';
      if (/^[0-9]{13}$/.test(v)) return 'EAN';
    }
    return 'OTHER';
  }

  /** The kinds the camera looks for. */
  var FORMATS = ['qr_code', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'data_matrix'];

  /**
   * One scanning session's memory of the codes it took. check(value, now),
   * for every code the camera sees, every frame:
   *   'new'   never taken in this session
   *   'held'  taken already and still in front of the camera (seen within
   *           gapMs): never taken twice
   *   'again' taken before, gone from view, and back: a deliberate rescan,
   *           or the next box of the same product
   * A taken code seen again stays held for as long as it stays in view.
   * take(value, now) marks one taken; forget(value) lets it count as new.
   */
  function guard(gapMs) {
    var gap = gapMs || 900;
    var last = new Map();
    return {
      check: function (value, now) {
        var t = typeof now === 'number' ? now : Date.now();
        var prev = last.get(value);
        if (prev === undefined) return 'new';
        last.set(value, t);
        return t - prev < gap ? 'held' : 'again';
      },
      take: function (value, now) {
        last.set(value, typeof now === 'number' ? now : Date.now());
      },
      forget: function (value) {
        last.delete(value);
      },
      size: function () {
        return last.size;
      },
    };
  }

  /** The side of a square QR module matrix (toqr gives it flat). */
  function sideOf(matrix) {
    var s = Math.round(Math.sqrt(matrix.length));
    if (s * s !== matrix.length || s < 21) throw new Error('Not a QR matrix.');
    return s;
  }

  /** The dark modules as one SVG path in module units, each run of a row as one rectangle. */
  function qrPath(matrix) {
    var s = sideOf(matrix);
    var d = '';
    for (var y = 0; y < s; y++) {
      var x = 0;
      while (x < s) {
        if (!matrix[y * s + x]) {
          x++;
          continue;
        }
        var start = x;
        while (x < s && matrix[y * s + x]) x++;
        d += 'M' + start + ' ' + y + 'h' + (x - start) + 'v1h-' + (x - start) + 'z';
      }
    }
    return d;
  }

  /** An SVG of the QR with its quiet zone of four modules, scaled to fit. */
  function qrSvg(matrix, title) {
    var s = sideOf(matrix);
    var q = 4;
    var all = s + 2 * q;
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + all + ' ' + all + '" shape-rendering="crispEdges" role="img" aria-label="' + escapeXml(title || 'QR code') + '">' +
      '<rect width="' + all + '" height="' + all + '" fill="#fff"/>' +
      '<path transform="translate(' + q + ' ' + q + ')" fill="#000" d="' + qrPath(matrix) + '"/></svg>'
    );
  }

  function escapeXml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /**
   * Label stock, in inches. 'sheet' is a letter sheet of 30 address labels
   * (Avery 5160 and its likes: 2 5/8 x 1, three across, ten down); 'roll' one
   * 2 x 1 label a page, for a label printer.
   */
  var LAYOUTS = {
    sheet: { page: [8.5, 11], label: [2.625, 1], across: 3, down: 10, top: 0.5, left: 0.1875, gapX: 0.125, gapY: 0, name: 'Sheet of 30 (Avery 5160)' },
    roll: { page: [2, 1], label: [2, 1], across: 1, down: 1, top: 0, left: 0, gapX: 0, gapY: 0, name: 'Label printer, 2 x 1 in' },
  };

  /** Labels placed on pages: [{page, x, y}] in inches, in order, skipping the first `skip` spots (a sheet partly used). */
  function place(count, layoutKey, skip) {
    var L = LAYOUTS[layoutKey] || LAYOUTS.sheet;
    var per = L.across * L.down;
    var out = [];
    var start = Math.max(0, Math.min(per - 1, skip || 0));
    for (var i = 0; i < count; i++) {
      var k = start + i;
      var page = Math.floor(k / per);
      var spot = k % per;
      var col = spot % L.across;
      var row = Math.floor(spot / L.across);
      out.push({ page: page, x: L.left + col * (L.label[0] + L.gapX), y: L.top + row * (L.label[1] + L.gapY) });
    }
    return out;
  }

  /** A product's name cut to fit a label's two short lines. */
  function labelName(name, max) {
    var m = max || 44;
    var s = String(name || '').replace(/\s+/g, ' ').trim();
    if (s.length <= m) return s;
    var cut = s.slice(0, m - 1);
    var sp = cut.lastIndexOf(' ');
    return (sp > m * 0.6 ? cut.slice(0, sp) : cut) + '…';
  }

  return { boxCode: boxCode, norm: norm, typeOf: typeOf, FORMATS: FORMATS, guard: guard, sideOf: sideOf, qrPath: qrPath, qrSvg: qrSvg, LAYOUTS: LAYOUTS, place: place, labelName: labelName };
});
