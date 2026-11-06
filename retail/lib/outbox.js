/*
 * Cigar Locker Retail: work that waits for the connection (docs/retail.md,
 * "Perpetual inventory", offline).
 *
 * A change made while the connection is down (a count's scan, a Queen's
 * count, a basket of cigars out) is kept on this device, in order, with the
 * operation id the device gave it, and sent when the connection is back. The
 * server does each operation id once (store_client_ops), so a send that went
 * through before the answer was lost, sent again, does nothing twice. What
 * the server refuses when it arrives (a cigar sold meanwhile) is set aside
 * with its words for a person to see, never retried blindly.
 *
 * Pure: storage is passed in; runs in the browser and under the tests.
 */
(function (root, make) {
  if (typeof module === 'object' && module.exports) module.exports = make();
  else root.RetailOutbox = make();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Did this fail for want of a connection (not a refusal from the server)? */
  function isNetworkError(e, online) {
    if (online === false) return true;
    var m = String((e && (e.message || e.name || e)) || '');
    return /failed to fetch|networkerror|load failed|fetch failed|network request failed|internet connection appears to be offline|err_internet|err_network|timed out|timeout/i.test(m);
  }

  /** A fresh operation id (a uuid). */
  function uuid() {
    var c = typeof crypto !== 'undefined' ? crypto : null;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    var b = new Uint8Array(16);
    if (c && c.getRandomValues) c.getRandomValues(b);
    else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var hex = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }

  /**
   * The queue in storage (localStorage, or anything with getItem/setItem).
   * An item: {op, fn, args, label, store, at}; at most `max` kept.
   */
  function create(storage, key, max) {
    var cap = max || 500;
    function read(k) {
      try {
        var v = JSON.parse(storage.getItem(k) || '[]');
        return Array.isArray(v) ? v : [];
      } catch (e) {
        return [];
      }
    }
    function write(k, list) {
      try {
        storage.setItem(k, JSON.stringify(list.slice(-cap)));
      } catch (e) {
        /* storage full or private: the queue lives as long as the page */
      }
    }
    var api = {
      list: function () { return read(key); },
      failed: function () { return read(key + ':failed'); },
      add: function (item) {
        var l = read(key);
        if (!l.some(function (x) { return x.op === item.op; })) l.push(item);
        write(key, l);
        return l.length;
      },
      remove: function (op) {
        write(key, read(key).filter(function (x) { return x.op !== op; }));
      },
      clearFailed: function () {
        write(key + ':failed', []);
      },
      /**
       * Sends what waits, in order, through send(item) (a promise). Stops at
       * the first want of a connection, leaving it and the rest waiting; a
       * refusal is set aside with its words and the rest carry on. Answers
       * {sent, failed, left}.
       */
      flush: async function (send, online) {
        var sent = 0;
        var failedNow = 0;
        var items = read(key);
        for (var i = 0; i < items.length; i++) {
          var it = items[i];
          try {
            var res = await send(it);
            api.remove(it.op);
            if (res && res.ok === false) {
              var f = read(key + ':failed');
              f.push(Object.assign({}, it, { words: res.words || 'Not done.' }));
              write(key + ':failed', f);
              failedNow += 1;
            } else {
              sent += 1;
            }
          } catch (e) {
            if (isNetworkError(e, typeof online === 'function' ? online() : online)) break;
            api.remove(it.op);
            var f2 = read(key + ':failed');
            f2.push(Object.assign({}, it, { words: (e && e.message) || 'Not done.' }));
            write(key + ':failed', f2);
            failedNow += 1;
          }
        }
        return { sent: sent, failed: failedNow, left: read(key).length };
      },
    };
    return api;
  }

  return { isNetworkError: isNetworkError, uuid: uuid, create: create };
});
