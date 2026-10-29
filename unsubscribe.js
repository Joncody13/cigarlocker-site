// The unsubscribe link in a Cigar Locker email (2026-10-29). One button, so
// a mail app or security scanner opening the link never unsubscribes anyone;
// the email function checks the link's signature and turns that kind of
// email off in the member's account.
(() => {
  const ENDPOINT = 'https://nypahhdmoxrfvwnfufdf.supabase.co/functions/v1/email/unsubscribe';
  const WORDS = { news: 'news from Cigar Locker', offers: 'offers from local shops' };
  const token = new URLSearchParams(location.search).get('t') || '';
  const kind = token.split('.')[1];
  const button = document.getElementById('unsub-button');
  const note = document.getElementById('unsub-note');
  if (!WORDS[kind]) {
    document.getElementById('unsub-words').textContent = 'This link is not complete. Turn emails off in the app: Settings, then Account.';
    button.hidden = true;
    return;
  }
  document.getElementById('unsub-words').textContent = `Stop emails with ${WORDS[kind]}.`;
  button.addEventListener('click', async () => {
    button.disabled = true;
    note.textContent = 'One moment…';
    try {
      const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t: token }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'That did not go through. Try again in a minute.');
      document.getElementById('unsub-title').textContent = 'Unsubscribed';
      document.getElementById('unsub-words').textContent = `You won't get ${WORDS[kind]} by email any more.`;
      button.hidden = true;
      note.textContent = '';
    } catch (e) {
      note.textContent = e.message;
      button.disabled = false;
    }
  });
})();
