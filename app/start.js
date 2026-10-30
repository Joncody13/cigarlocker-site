// Cigar Locker on the web: starts the app once the page is cross-origin
// isolated (web/sw.js says why). The first visit installs the service worker
// and loads the page again through it. Put first in the app's page by
// scripts/build-web.cjs, which moves the app's own scripts into
// data-scripts, to be added here in order.
(function () {
  var me = document.currentScript;
  var scripts = JSON.parse(me.getAttribute('data-scripts'));
  var TRIED = 'cigar.isolate';

  function run() {
    try {
      sessionStorage.removeItem(TRIED);
    } catch (e) {}
    scripts.forEach(function (src) {
      var s = document.createElement('script');
      s.src = src;
      s.async = false;
      document.body.appendChild(s);
    });
  }

  function fail() {
    var root = document.getElementById('root');
    root.style.cssText = 'align-items:center;justify-content:center;padding:32px;font:16px/1.5 -apple-system,system-ui,sans-serif;text-align:center';
    root.textContent = 'Cigar Locker on the web needs an up-to-date Safari, Chrome, Edge or Firefox. In a private window, open it in a regular one.';
  }

  if (window.crossOriginIsolated) return run();
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return fail();
  var tried = false;
  try {
    tried = sessionStorage.getItem(TRIED) === '1';
    sessionStorage.setItem(TRIED, '1');
  } catch (e) {}
  if (tried) return fail();
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    location.reload();
  });
  navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' }).then(
    function (reg) {
      if (navigator.serviceWorker.controller) {
        // Taken in, yet not isolated: once more, then say so.
        location.reload();
      } else if (reg.active) {
        reg.active.postMessage({ type: 'claim' });
      }
    },
    function () {
      fail();
    },
  );
})();
