// Signing in to the web version of the app (cigarlocker.app/app) with Apple
// (2026-10-30). The app's own pages are cross-origin isolated (its browser
// database needs it), which cuts Apple's sign-in window off from them, so the
// app sends people here and this page, outside them, shows Apple's button.
// Apple's answer is left for the app in this browser (src/cloud/account.ts,
// finishWebSignIn) with the one-time value it was asked with, and the app
// signs in with it as a phone does; Supabase checks both.
(() => {
  const CLIENT = 'com.cigarlocker.web';
  const RETURN = 'https://cigarlocker.app/signin/';
  const HANDOFF = 'cigar.apple';
  const note = document.getElementById('signin-note');

  // Back only into the app, never to another site.
  const asked = new URLSearchParams(location.search).get('back') || '';
  const back = /^\/app(\/[A-Za-z0-9/_\-.?=&%]*)?$/.test(asked) ? asked : '/app/';

  const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const random = () => hex(crypto.getRandomValues(new Uint8Array(24)));
  const nonce = random();
  const state = random();

  if (!window.AppleID || !crypto.subtle) {
    note.textContent = "Apple's sign-in did not load. Check the connection, then reload this page.";
    return;
  }

  crypto.subtle.digest('SHA-256', new TextEncoder().encode(nonce)).then((digest) => {
    AppleID.auth.init({ clientId: CLIENT, scope: 'email', redirectURI: RETURN, state, nonce: hex(new Uint8Array(digest)), usePopup: true });
  });

  document.addEventListener('AppleIDSignInOnSuccess', (event) => {
    const answer = event.detail && event.detail.authorization;
    if (!answer || !answer.id_token || answer.state !== state) {
      note.textContent = 'Apple could not sign you in. Try again.';
      return;
    }
    try {
      localStorage.setItem(HANDOFF, JSON.stringify({ token: answer.id_token, nonce, at: Date.now() }));
    } catch (e) {
      note.textContent = 'This browser keeps nothing for websites (a private window?). Open Cigar Locker in a regular window.';
      return;
    }
    note.textContent = 'Signing you in…';
    location.replace(back);
  });

  document.addEventListener('AppleIDSignInOnFailure', (event) => {
    const code = event.detail && event.detail.error;
    if (code === 'popup_closed_by_user' || code === 'user_cancelled_authorize') return;
    note.textContent =
      code === 'popup_blocked_by_browser'
        ? "Your browser blocked Apple's sign-in window. Allow pop-ups for cigarlocker.app, then try again."
        : 'Apple could not sign you in. Try again.';
  });
})();
