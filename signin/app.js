// After signing in with Apple or Google in a phone's browser (the app's
// Android sign-in, and Google anywhere): the server sends the answer here in
// the address's fragment, which never reaches any server, and this page
// opens the app with it (cigarlocker://signin-done). The token is of no use
// without the one-time value only the app holds. The address is cleared at
// once so the token stays out of the browser's history.
(() => {
  const given = new URLSearchParams(location.hash.slice(1));
  const keep = new URLSearchParams();
  for (const key of ['provider', 'state', 'id_token', 'error']) {
    const v = given.get(key);
    if (v && v.length < 8000) keep.set(key, v);
  }
  history.replaceState(null, '', location.pathname);
  const button = document.getElementById('back-button');
  const note = document.getElementById('back-note');
  if (!keep.get('state')) {
    note.textContent = 'There is nothing to sign in with here. Go back to Cigar Locker and try again.';
    button.setAttribute('href', 'cigarlocker://account');
    return;
  }
  const app = `cigarlocker://signin-done?${keep}`;
  button.setAttribute('href', app);
  if (keep.get('error')) note.textContent = 'Going back to Cigar Locker…';
  // Most browsers open the app straight away; some wait for the tap.
  setTimeout(() => location.replace(app), 50);
})();
