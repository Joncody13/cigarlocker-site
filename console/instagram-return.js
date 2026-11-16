// Instagram's sign-in page sends the browser here with ?code=...&state=... (or ?error=...). The code is put
// aside for the console in this tab only (sessionStorage), the address is cleaned so the code is not left in
// the history, and the console, which holds the sign-in, hands it to the server. Nothing is sent from here.
(() => {
  const q = new URLSearchParams(location.search);
  const take = (k, max) => (q.get(k) || '').slice(0, max);
  const got = { code: take('code', 700), state: take('state', 100), error: take('error', 80), why: take('error_description', 300) || take('error_reason', 80), at: Date.now() };
  const words = document.getElementById('ig-return-words');
  if (!got.code && !got.error) {
    words.textContent = 'Nothing came back from Instagram. Start again from the Marketing tab.';
    return;
  }
  try {
    sessionStorage.setItem('cigar.console.instagram', JSON.stringify(got));
    localStorage.setItem('console.tab', 'marketing');
  } catch {
    words.textContent = 'This browser would not keep the answer for the console. Allow storage for cigarlocker.app and try again.';
    return;
  }
  history.replaceState(null, '', location.pathname);
  location.replace('./');
})();
