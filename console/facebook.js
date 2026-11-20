// The Facebook Page (2026-11-20, his "Build the Facebook reader."): the words and figures of the "Facebook Page"
// card in the Marketing section, kept apart from the page so the app's tests can run them
// (test/facebook.test.ts). The answer read here is the console function's `facebook`:
// mktg_social_board('facebook', days) (supabase/sql/156_facebook_page.sql).
//
// His rule stands: "Never interpret unavailable metrics as zero." A figure Facebook did not report is a dash,
// and a day Facebook has not closed yet says so. Read only: nothing here posts, comments, messages or spends.

(function (root) {
  const ZONE = 'America/New_York';
  const whole = new Intl.NumberFormat('en-US');
  const dayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const whenFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: ZONE });
  const DASH = '—';
  const has = (x) => typeof x === 'number' && Number.isFinite(x);
  const n = (x) => (has(x) ? whole.format(Math.round(x)) : DASH);
  const ago = (iso, now) => {
    const m = Math.round((now - Date.parse(iso)) / 60000);
    if (!Number.isFinite(m)) return '';
    if (m < 2) return 'just now';
    if (m < 90) return `${m} minutes ago`;
    if (m < 48 * 60) return `${Math.round(m / 60)} hours ago`;
    return `${Math.round(m / 1440)} days ago`;
  };

  const HEAD = 'Facebook Page';
  const READ_ONLY = 'Read with the same sign-in as Instagram, once an hour. Read only: nothing here can post, comment, message or spend.';
  const NOT_CONNECTED = 'Connect Instagram above first: the Facebook Page is read through the same sign-in.';
  const NOT_READ = 'The Page has not been read yet. Press Read now, or wait for the next hourly reading.';
  const LIMITS = [
    'Facebook counts a day in Pacific time, and today’s figures keep changing until that day ends.',
    'Facebook gives no age, gender or town of followers here, and no figure it has not reported is shown as zero.',
    'Views count every time a post was on a screen; viewers counts people once.',
  ];
  const DAY_HEAD = ['Day', 'Views', 'Viewers', 'Engagements', 'Page visits', 'New follows', 'Unfollows'];
  const DAY_KEYS = ['views', 'reach', 'total_interactions', 'page_visits', 'new_follows', 'unfollows'];
  const POST_HEAD = ['Posted', 'Post', 'Views', 'Viewers', 'Reactions', 'Comments', 'Shares', 'Clicks'];
  const POST_KEYS = ['views', 'reach', 'likes', 'comments', 'shares', 'clicks'];

  /** How the Page stands, in a sentence. `igConnected` is whether the Instagram sign-in it rides on is there. */
  function standing(board, igConnected, now) {
    const a = board && board.account;
    if (!igConnected && !a) return { state: 'not-connected', words: NOT_CONNECTED };
    if (!a) return { state: 'waiting', words: NOT_READ };
    if (a.status === 'needs-reconnect') return { state: 'trouble', words: a.lastError || 'Facebook would not hand over the Page at the last reading.' };
    const name = a.name || 'The Page';
    const followers = latestFollowers(board);
    const read = a.lastSyncAt ? `Last read ${ago(a.lastSyncAt, now == null ? Date.now() : now)}.` : 'Not read yet.';
    return { state: igConnected ? 'reading' : 'stale', words: `${name}${has(followers) ? `: ${whole.format(followers)} ${followers === 1 ? 'follower' : 'followers'}` : ''}. ${read}${igConnected ? '' : ' Instagram is not connected, so it is no longer being read.'}${a.lastError ? ` ${a.lastError}` : ''}` };
  }

  /** The newest follower count on record, or null when none was ever read. */
  function latestFollowers(board) {
    const days = ((board && board.daysRead) || []).filter((d) => has(d.followers));
    return days.length ? days[days.length - 1].followers : null;
  }

  /** The days read, newest first: each a label and its cells, a dash where Facebook gave nothing. */
  function dayRows(board, most) {
    return ((board && board.daysRead) || [])
      .slice()
      .reverse()
      .slice(0, most == null ? 14 : most)
      .map((d) => {
        const open = DAY_KEYS.every((k) => !has((d.metrics || {})[k]));
        return {
          day: dayFmt.format(new Date(`${d.day}T12:00:00Z`)),
          cells: DAY_KEYS.map((k) => n((d.metrics || {})[k])),
          note: open ? String((d.unavailable || {}).views || 'Not reported yet') : '',
        };
      });
  }

  /** The posts, newest first. */
  function postRows(board) {
    return ((board && board.media) || []).map((p) => {
      const m = p.metrics || {};
      const text = String(p.caption || '').replace(/\s+/g, ' ').trim();
      return {
        when: whenFmt.format(new Date(p.postedAt)),
        text: text ? (text.length > 90 ? `${text.slice(0, 88)}…` : text) : p.kind === 'reel' ? 'A video' : 'A photo post',
        cells: POST_KEYS.map((k) => n(m[k])),
        permalink: /^https:\/\/www\.facebook\.com\//.test(String(p.permalink || '')) ? p.permalink : '',
        read: p.readAt ? `Read ${p.readings === 1 ? 'once' : `${whole.format(p.readings)} times`}` : 'Not read yet',
      };
    });
  }

  /** The span's totals over the days Facebook reported, each with how many days it covers. */
  function totals(board) {
    const days = (board && board.daysRead) || [];
    return DAY_KEYS.map((k, i) => {
      const got = days.map((d) => (d.metrics || {})[k]).filter(has);
      return { label: DAY_HEAD[i + 1], value: got.length ? whole.format(got.reduce((a, b) => a + b, 0)) : DASH, days: got.length };
    });
  }

  const api = { HEAD, READ_ONLY, NOT_CONNECTED, NOT_READ, LIMITS, DAY_HEAD, POST_HEAD, DASH, standing, latestFollowers, dayRows, postRows, totals };
  root.CigarFacebook = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
