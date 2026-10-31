/*
 * Cigar Locker partner snippet (cigarlocker.app/partner.js).
 *
 * For shops whose links appear in Cigar Locker's emails: it lets Cigar
 * Locker count the carts and sales its emails send you, so you both see
 * what works. Put it on every page:
 *
 *   <script src="https://cigarlocker.app/partner.js" async></script>
 *
 * When a visitor arrives from one of our emails, the link carries cl_ref, a
 * random code that says nothing about the person. This keeps it on your
 * site for 30 days, and nothing else. Then, when something goes in the cart
 * and when an order is placed:
 *
 *   cigarLocker.cart();
 *   cigarLocker.purchase({ value: 86.40, order: 'A1234' });
 *
 * Only visitors who came from our emails are ever reported, with the code,
 * the order's total and number, and your site's name. Nothing about the
 * visitor, their basket or their payment is sent.
 */
(function () {
  var API = 'https://nypahhdmoxrfvwnfufdf.supabase.co/functions/v1/email/convert';
  var KEY = 'cl_ref';
  var DAYS = 30;
  var queued = (window.cigarLocker && window.cigarLocker.q) || [];

  function keep(ref) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ref: ref, at: Date.now() }));
    } catch (e) {}
    try {
      document.cookie = KEY + '=' + ref + ';max-age=' + DAYS * 86400 + ';path=/;SameSite=Lax';
    } catch (e) {}
  }

  function current() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (v && /^[0-9a-f]{16}$/.test(v.ref) && Date.now() - v.at < DAYS * 86400000) return v.ref;
    } catch (e) {}
    var m = document.cookie.match(/(?:^|; )cl_ref=([0-9a-f]{16})/);
    return m ? m[1] : null;
  }

  try {
    var arrived = new URLSearchParams(location.search).get(KEY);
    if (arrived && /^[0-9a-f]{16}$/i.test(arrived)) keep(arrived.toLowerCase());
  } catch (e) {}

  function send(event, o) {
    var ref = current();
    if (!ref) return;
    o = o || {};
    var q = 'ref=' + ref + '&event=' + event + '&site=' + encodeURIComponent(location.hostname);
    if (o.value !== undefined && o.value !== null) q += '&value=' + encodeURIComponent(String(o.value));
    if (o.order) q += '&order=' + encodeURIComponent(String(o.order));
    var url = API + '?' + q;
    if (navigator.sendBeacon && navigator.sendBeacon(url)) return;
    new Image().src = url;
  }

  window.cigarLocker = {
    cart: function (o) {
      send('cart', o);
    },
    purchase: function (o) {
      send('purchase', o);
    },
  };
  // Calls made before the script loaded (cigarLocker.q = [['purchase', {...}]]).
  for (var i = 0; i < queued.length; i++) {
    var call = queued[i];
    if (call && window.cigarLocker[call[0]]) window.cigarLocker[call[0]](call[1]);
  }
})();
