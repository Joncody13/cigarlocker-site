// The unsubscribe page a Cigar Locker email's link opens (2026-10-29; finished 2026-11-13). No sign-in: the link
// itself, signed by the server, says whose emails and which kind. One button, so a mail app or security scanner
// that only opens the link never unsubscribes anyone; the email function checks the signature and turns that kind
// of email off in the member's account, or both kinds when asked. Opened with no link, or one that was cut short,
// the page says the other ways instead. Every word on it is this file's or the page's, never the link's.
(() => {
  const ENDPOINT = 'https://nypahhdmoxrfvwnfufdf.supabase.co/functions/v1/email/unsubscribe';
  // The two kinds, named as the app's Account screen names them.
  const KINDS = {
    news: { name: 'News from Cigar Locker', lower: 'News from Cigar Locker', what: 'New features and tips.', off: 'News from Cigar Locker is off' },
    offers: { name: 'Emails from Cigar Locker partners', lower: 'emails from Cigar Locker partners', what: 'Occasional emails from our partners.', off: 'Emails from Cigar Locker partners are off' },
  };
  const OTHER = { news: 'offers', offers: 'news' };
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const $ = (id) => document.getElementById(id);
  const say = (id, words) => {
    $(id).textContent = words;
  };

  const token = (new URLSearchParams(location.search).get('t') || '').trim();
  const parts = token.split('.');
  const kind = parts[1];
  // "<member>.<kind>.<email>.<signature>": anything else was cut short or is not ours. The server decides for good.
  const whole = parts.length === 4 && UUID.test(parts[0]) && UUID.test(parts[2]) && !!KINDS[kind] && parts[3].length >= 16;

  const badLink = () => {
    say('unsub-title', 'This link didn’t work');
    say('unsub-lead', 'It may have been cut short when it was copied or forwarded. Open the Unsubscribe link in the email again, or use either way below.');
    $('unsub-ask').hidden = true;
    $('unsub-done').hidden = true;
    $('unsub-ways').hidden = false;
  };

  if (!whole) {
    // No link at all is the page as it stands: how to stop the emails. A link that is not whole says so first.
    if (token) badLink();
    return;
  }

  say('unsub-title', 'Unsubscribe');
  say('unsub-lead', 'Press Unsubscribe to stop these emails. You don’t need to sign in.');
  say('unsub-kind-name', KINDS[kind].name);
  say('unsub-kind-what', KINDS[kind].what);
  $('unsub-ways').hidden = true;
  $('unsub-ask').hidden = false;

  /** Asks the server; answers 'one', 'all', or throws 'bad-link' / 'try-again'. */
  const stop = async (all) => {
    let res;
    try {
      res = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(all ? { t: token, all: true } : { t: token }) });
    } catch {
      throw new Error('try-again');
    }
    if (res.status === 400) throw new Error('bad-link');
    if (!res.ok) throw new Error('try-again');
    const out = await res.json().catch(() => ({}));
    // Only what the server says it did: 'all' when it answered so.
    return all && out.all === true ? 'all' : 'one';
  };

  const done = (did, askedAll) => {
    $('unsub-ask').hidden = true;
    $('unsub-done').hidden = false;
    say('unsub-title', 'You’re unsubscribed');
    if (did === 'all') {
      say('unsub-lead', 'We won’t send you marketing emails anymore.');
      say('unsub-done-name', 'All marketing emails are off');
      say('unsub-done-what', `${KINDS.news.name} and ${KINDS.offers.lower}.`);
      $('unsub-more').hidden = true;
    } else {
      say('unsub-lead', `We won’t send you ${KINDS[kind].lower} anymore.`);
      say('unsub-done-name', KINDS[kind].off);
      say('unsub-done-what', 'An email already on its way may still arrive.');
      say('unsub-rest', `Also stop ${KINDS[OTHER[kind]].lower}`);
      // Asked for both and the server stopped the one: the other kind has its own link, and the app has both.
      $('unsub-more').hidden = !!askedAll;
      if (askedAll) say('unsub-done-note', `To stop ${KINDS[OTHER[kind]].lower} too, use the Unsubscribe link in one of those emails, or the app: Settings, then Account.`);
    }
    say('unsub-fine', 'Changed your mind? Turn them back on in the app: Settings, then Account. Essential account, security and billing emails still come.');
  };

  /** One press: the buttons rest while it is asked, and a failure says what to do next. */
  const press = (button, all, note) => async () => {
    const buttons = [$('unsub-button'), $('unsub-all'), $('unsub-rest')];
    buttons.forEach((b) => (b.disabled = true));
    say(note, 'One moment…');
    try {
      const did = await stop(all);
      say(note, '');
      done(did, all);
    } catch (e) {
      if (e.message === 'bad-link') {
        badLink();
      } else {
        say(note, 'That didn’t go through. Check your connection and try again.');
      }
    } finally {
      buttons.forEach((b) => (b.disabled = false));
    }
  };

  $('unsub-button').addEventListener('click', press($('unsub-button'), false, 'unsub-note'));
  $('unsub-all').addEventListener('click', press($('unsub-all'), true, 'unsub-note'));
  $('unsub-rest').addEventListener('click', press($('unsub-rest'), true, 'unsub-done-note'));
})();
