/*
 * Cigar Locker Retail: a dedicated scanner, read as a keyboard (docs/retail.md,
 * "The register").
 *
 * Presentation scanners (Zebra, Honeywell, Socket and the rest) plugged in by
 * USB or paired by Bluetooth as a keyboard "type" what they read, very fast,
 * then a terminator (Enter, unless set otherwise). Nothing here is tied to a
 * maker: any scanner set up as a keyboard works. A burst is told from a
 * person typing by its speed: every key within maxGapMs of the one before
 * (a scanner sends a key every few milliseconds; a person, every 100 or so),
 * at least minLength characters, ending in the terminator. A prefix or
 * suffix the scanner is set to add is taken off. With no terminator ('none'),
 * a burst ends when the keys stop (idleMs).
 *
 * Pure: the page feeds it each key and its time; runs under the tests too.
 */
(function (root, make) {
  if (typeof module === 'object' && module.exports) module.exports = make();
  else root.RetailHid = make();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULTS = { terminator: 'Enter', prefix: '', suffix: '', maxGapMs: 50, minLength: 4, idleMs: 120 };
  var TERMINATORS = ['Enter', 'Tab', 'none'];
  var MODIFIERS = { Shift: 1, Alt: 1, Control: 1, Meta: 1, CapsLock: 1, AltGraph: 1 };

  /** Settings as kept (anything missing or out of range back to the default). */
  function settings(raw) {
    var r = raw || {};
    var num = function (v, lo, hi, d) {
      var x = Number(v);
      return isFinite(x) && x >= lo && x <= hi ? Math.round(x) : d;
    };
    return {
      terminator: TERMINATORS.indexOf(r.terminator) >= 0 ? r.terminator : DEFAULTS.terminator,
      prefix: typeof r.prefix === 'string' ? r.prefix.slice(0, 8) : '',
      suffix: typeof r.suffix === 'string' ? r.suffix.slice(0, 8) : '',
      maxGapMs: num(r.maxGapMs, 5, 300, DEFAULTS.maxGapMs),
      minLength: num(r.minLength, 2, 40, DEFAULTS.minLength),
      idleMs: num(r.idleMs, 30, 1000, DEFAULTS.idleMs),
    };
  }

  /** What was read, without the scanner's own prefix or suffix, control characters or edge spaces. */
  function clean(text, cfg) {
    var s = String(text || '').replace(/[\u0000-\u001f\u007f]/g, '');
    if (cfg.prefix && s.indexOf(cfg.prefix) === 0) s = s.slice(cfg.prefix.length);
    if (cfg.suffix && s.length >= cfg.suffix.length && s.slice(-cfg.suffix.length) === cfg.suffix) s = s.slice(0, -cfg.suffix.length);
    return s.trim();
  }

  /**
   * A reader. key(k, t) for each key pressed (its name, as KeyboardEvent.key,
   * and its time in ms) answers:
   *   {scan: {code, chars, ms, gaps}}   a scan just ended (the page should not
   *                                     act on this key: it is the terminator)
   *   {burst: n}                        a key that belongs to a burst so far
   *   null                              an ordinary key
   * idle(t), called now and then, ends a burst when the terminator is 'none'.
   */
  function create(raw) {
    var cfg = settings(raw);
    var buf = '';
    var times = [];
    var last = -1;
    function reset() {
      buf = '';
      times = [];
      last = -1;
    }
    function finish(t) {
      var code = clean(buf, cfg);
      var gaps = [];
      for (var i = 1; i < times.length; i++) gaps.push(Math.round(times[i] - times[i - 1]));
      var ms = times.length ? Math.round(t - times[0]) : 0;
      var chars = buf.length;
      reset();
      if (code.length < cfg.minLength || chars < cfg.minLength) return null;
      return { code: code, chars: chars, ms: ms, gaps: gaps };
    }
    return {
      settings: cfg,
      key: function (k, t) {
        var key = String(k || '');
        if (key.length === 1) {
          if (last >= 0 && t - last > cfg.maxGapMs) reset();
          buf += key;
          times.push(t);
          last = t;
          return buf.length >= 2 ? { burst: buf.length } : null;
        }
        if (cfg.terminator !== 'none' && key === cfg.terminator) {
          // The terminator follows the last character as fast as the rest.
          var quick = last >= 0 && t - last <= Math.max(cfg.maxGapMs * 2, 100);
          if (!buf || !quick) {
            reset();
            return null;
          }
          var s = finish(t);
          return s ? { scan: s } : null;
        }
        if (MODIFIERS[key]) return buf ? { burst: buf.length } : null;
        reset();
        return null;
      },
      idle: function (t) {
        if (cfg.terminator !== 'none' || !buf || t - last < cfg.idleMs) return null;
        var s = finish(t);
        return s ? { scan: s } : null;
      },
      pending: function () {
        return buf.length;
      },
      reset: reset,
    };
  }

  return { DEFAULTS: DEFAULTS, TERMINATORS: TERMINATORS, settings: settings, clean: clean, create: create };
});
