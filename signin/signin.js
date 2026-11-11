// Signing in to the web version of the app (cigarlocker.app/app) with Apple
// (2026-10-30). The app's own pages are cross-origin isolated (its browser
// database needs it), which cuts Apple's sign-in window off from them, so the
// app sends people here and this page, outside them, opens Apple's window.
// Apple's answer is left for the app in this browser (src/cloud/account.ts,
// finishWebSignIn) with the one-time value it was asked with, and the app
// signs in with it as a phone does; Supabase checks both.
//
// The button is the page's own, drawn as Apple asks, and opens Apple's window
// itself (AppleID.auth.signIn, which answers in a promise in its pop-up
// mode): his first try, on an iPhone the same day, went no further than this
// page with Apple's script drawing the button.
/* global AppleID */
(() => {
  const CLIENT = 'com.cigarlocker.web';
  const RETURN = 'https://cigarlocker.app/signin/';
  const HANDOFF = 'cigar.apple';
  const note = document.getElementById('signin-note');
  const button = document.getElementById('apple-button');

  // Back only into the app, never to another site.
  const asked = new URLSearchParams(location.search).get('back') || '';
  const back = /^\/app(\/[A-Za-z0-9/_\-.?=&%]*)?$/.test(asked) ? asked : '/app/';

  const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

  // Why a sign-in here did not go through, told to Cigar Locker as the app
  // tells its own errors (record_errors, 104_app_errors.sql): his first try
  // on a Mac, 2026-11-10, failed on this page and left nothing to go by.
  // Only Apple's own word for the failure and which step it was: never the
  // sign-in itself, an address or a name. One a failure, under a name made
  // up for this visit; nothing is sent when a sign-in works or is cancelled.
  const SUPABASE_URL = 'https://nypahhdmoxrfvwnfufdf.supabase.co';
  const PUBLIC_KEY = 'sb_publishable_QeBMueHE5KTcVrtU4Ys8AA_nFi_kdb1';
  const visit = `signin-${Math.random().toString(16).slice(2, 12).padEnd(10, '0')}`;
  let told = 0;
  function tell(where, code) {
    if (told >= 5) return;
    told += 1;
    const agent = navigator.userAgent || '';
    const browser = /Edg\//.test(agent) ? 'Edge' : /Chrome\//.test(agent) ? 'Chrome' : /Firefox\//.test(agent) ? 'Firefox' : /Safari\//.test(agent) ? 'Safari' : 'Another browser';
    const system = /iPhone|iPad/.test(agent) ? 'iPhone or iPad' : /Mac OS X/.test(agent) ? 'Mac' : /Windows/.test(agent) ? 'Windows' : /Android/.test(agent) ? 'Android' : '';
    try {
      fetch(`${SUPABASE_URL}/rest/v1/rpc/record_errors`, {
        method: 'POST',
        keepalive: true,
        headers: { apikey: PUBLIC_KEY, Authorization: `Bearer ${PUBLIC_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          p_install: visit,
          p_errors: [
            {
              eid: `web-${told}-${Date.now().toString(36)}`,
              at: new Date().toISOString(),
              area: 'auth',
              name: 'WebSignIn',
              message: `The web sign-in page: ${String(code).slice(0, 200)}`,
              extra: { where, code: String(code).slice(0, 100) },
              platform: 'web',
              model: system ? `${browser} on ${system}` : browser,
            },
          ],
        }),
      }).catch(() => undefined);
    } catch (e) {
      // Telling is never in the way of signing in.
    }
  }

  if (!window.AppleID || !window.crypto || !crypto.subtle) {
    note.textContent = "Apple's sign-in did not load. Check the connection, then reload this page.";
    tell('web.page.load', !window.AppleID ? 'apple-script-missing' : 'no-crypto');
    return;
  }

  const random = () => hex(crypto.getRandomValues(new Uint8Array(24)));
  const nonce = random();
  const state = random();

  crypto.subtle.digest('SHA-256', new TextEncoder().encode(nonce)).then(
    (digest) => {
      AppleID.auth.init({ clientId: CLIENT, scope: 'email', redirectURI: RETURN, state, nonce: hex(new Uint8Array(digest)), usePopup: true });
      button.disabled = false;
    },
    () => {
      note.textContent = 'This browser cannot sign in here. Open Cigar Locker in Safari or Chrome.';
      tell('web.page.start', 'no-digest');
    },
  );

  function signedIn(res) {
    const answer = res && res.authorization;
    if (!answer || !answer.id_token) {
      button.disabled = false;
      note.textContent = 'Apple did not send the sign-in back. Try again.';
      tell('web.page.answer', 'no-id-token');
      return;
    }
    if (answer.state !== state) {
      button.disabled = false;
      note.textContent = 'That sign-in was for another page. Try again.';
      tell('web.page.answer', 'state-differs');
      return;
    }
    try {
      localStorage.setItem(HANDOFF, JSON.stringify({ token: answer.id_token, nonce, at: Date.now() }));
    } catch (e) {
      button.disabled = false;
      note.textContent = 'This browser keeps nothing for websites (a private window?). Open Cigar Locker in a regular window.';
      tell('web.page.keep', 'no-storage');
      return;
    }
    note.textContent = 'Signing you in…';
    location.replace(back);
  }

  function failed(e) {
    button.disabled = false;
    const code = (e && e.error) || (e && e.message) || 'unknown';
    if (code === 'popup_closed_by_user' || code === 'user_cancelled_authorize') return;
    tell('web.page.apple', code);
    note.textContent =
      code === 'popup_blocked_by_browser'
        ? "Your browser blocked Apple's sign-in window. Allow pop-ups for cigarlocker.app, then try again."
        : `Apple could not sign you in (${code}). Try again.`;
  }

  button.addEventListener('click', () => {
    note.textContent = '';
    button.disabled = true;
    let answer;
    try {
      // Opened straight from the tap, or a browser takes it for a pop-up nobody asked for.
      answer = AppleID.auth.signIn();
    } catch (e) {
      failed(e);
      return;
    }
    Promise.resolve(answer).then(signedIn, failed);
    // Apple's window can close without a word (Safari's own sheet, put away):
    // the button is never left greyed out, so another try needs no reload.
    setTimeout(() => {
      button.disabled = false;
    }, 4000);
  });
})();
