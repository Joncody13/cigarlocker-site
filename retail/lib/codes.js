/*
 * Cigar Locker Retail: codes and labels (docs/retail.md, "Boxes", "Cigar labels").
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
  var UNIT = /^CLS-[2-9A-HJKMNP-TV-Z]{7}$/;

  /** A Cigar Locker box code, read in any case, or null. */
  function boxCode(s) {
    var v = String(s || '').trim().toUpperCase();
    return BOX.test(v) ? v : null;
  }

  /** One cigar's Cigar Locker label (CLS- and seven), read in any case, or null. */
  function unitCode(s) {
    var v = String(s || '').trim().toUpperCase();
    return UNIT.test(v) ? v : null;
  }

  /** Either of Cigar Locker's own codes, as written on the label; else null. */
  function ownCode(s) {
    return boxCode(s) || unitCode(s);
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
    if (ownCode(value)) return 'CIGAR_LOCKER_QR';
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

  /** A product's name cut to fit a label's two short lines. */
  function labelName(name, max) {
    var m = max || 44;
    var s = String(name || '').replace(/\s+/g, ' ').trim();
    if (s.length <= m) return s;
    var cut = s.slice(0, m - 1);
    var sp = cut.lastIndexOf(' ');
    return (sp > m * 0.6 ? cut.slice(0, sp) : cut) + '…';
  }

  /**
   * A short name for a cigar's small label (two short lines): brand, line
   * and size; the brand left off first when it must be shorter, then
   * "Anniversary" shortened, then cut at a word; never more than max letters.
   */
  function shortName(p, max) {
    var m = max || 34;
    var brand = String((p && p.brand) || '').trim();
    var line = String((p && p.line) || '').replace(/\s+/g, ' ').trim();
    var size = String((p && p.vitola) || '').trim();
    var whole = [brand, line, size].filter(Boolean).join(' ');
    if (whole.length <= m) return whole;
    var noBrand = [line, size].filter(Boolean).join(' ');
    if (noBrand.length <= m) return noBrand;
    var abbreviated = noBrand.replace(/\bAnniversary\b/i, 'Anniv.');
    return abbreviated.length <= m ? abbreviated : labelName(abbreviated, m);
  }

  return { boxCode: boxCode, unitCode: unitCode, ownCode: ownCode, norm: norm, typeOf: typeOf, FORMATS: FORMATS, guard: guard, sideOf: sideOf, qrPath: qrPath, qrSvg: qrSvg, labelName: labelName, shortName: shortName };
});
