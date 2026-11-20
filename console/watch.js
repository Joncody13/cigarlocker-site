// Other accounts, watched (2026-11-20): the words and figures of the "Other accounts" card in the Marketing section,
// kept apart from the page so the app's tests can run them (test/console-watch.test.ts). The answer read here is the
// console function's `instagram-watch`: mktg_social_watch_board('instagram', days) (supabase/sql/154_social_watch.sql).
//
// His rule stands here too: "Never interpret unavailable metrics as zero." An account that hides its like counts
// gives none, shown as a dash; a finding that rests on a handful of posts says how many; and a day or hour with
// too few posts is listed without a verdict. Read only: nothing here follows, likes, comments or posts.

(function (root) {
  const ZONE = 'America/New_York';
  const whole = new Intl.NumberFormat('en-US');
  const dayFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: ZONE });
  const whenFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: ZONE });
  const DASH = '—';
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const KINDS = { post: 'Photos', carousel: 'Carousels', reel: 'Reels', story: 'Stories' };
  /** Under this many posts a day, hour or kind is listed without saying how it does. */
  const ENOUGH = 5;
  const has = (x) => typeof x === 'number' && Number.isFinite(x);
  const n = (x) => (has(x) ? whole.format(Math.round(x)) : DASH);
  const plural = (count, one, many) => `${whole.format(count)} ${count === 1 ? one : many}`;
  const hourWords = (h) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;
  /** A post against its own account's usual: 1 is usual, 2 twice as many likes and comments. */
  const liftWords = (lift, posts) => (!has(lift) || posts < ENOUGH ? DASH : lift >= 1.15 ? `${lift.toFixed(1)}× usual` : lift <= 0.87 ? `${lift.toFixed(1)}× usual` : 'About usual');

  const HEAD = 'Other accounts';
  const HELP = 'Public business and creator accounts, read once a day through your own Instagram connection: followers, how often they post, and how each post does. Read only.';
  const EMPTY = 'No accounts are being watched yet. Add one by its Instagram username.';
  const NOT_CONNECTED = 'Connect Instagram first: other accounts are read through your own connection.';
  const LIMITS = [
    'Instagram gives likes and comments for other accounts, never their reach, views, saves or shares.',
    'A private or personal account cannot be read, and an account that hides its like counts shows a dash.',
    'Times are Eastern. "Usual" sets each post against its own account’s typical post, so a small account counts as much as a large one.',
    'History starts the day an account is added; followers gained shows once there are two days to compare.',
  ];
  const ACCOUNT_HEAD = ['Account', 'Followers', 'Change', 'Posts a week', 'Typical likes', 'Typical comments', 'Last post', ''];

  function perWeek(a, days) {
    if (!a.posts || !a.first_post) return null;
    // Instagram hands over an account's latest posts only, so the rate is over the stretch those posts cover.
    const from = Math.max(Date.parse(a.first_post), Date.now() - days * 86_400_000);
    const weeks = Math.max(1, (Date.now() - from) / (7 * 86_400_000));
    return a.posts / weeks;
  }

  function change(a) {
    if (!has(a.followers) || !has(a.followers_then) || !a.since) return DASH;
    const d = a.followers - a.followers_then;
    const since = dayFmt.format(new Date(`${a.since}T12:00:00Z`));
    // Only today's reading so far: nothing to compare with yet.
    if (a.since === new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(new Date())) return DASH;
    return `${d > 0 ? '+' : d < 0 ? '−' : ''}${whole.format(Math.abs(d))} since ${since}`;
  }

  function accountRow(a, days) {
    const rate = perWeek(a, days);
    return {
      username: a.username,
      name: a.name || '',
      handle: `@${a.username}`,
      cells: [
        has(a.followers) ? n(a.followers) : DASH,
        change(a),
        rate === null ? DASH : rate >= 10 ? n(rate) : rate.toFixed(1),
        n(a.likes_mid),
        n(a.comments_mid),
        a.last_post ? dayFmt.format(new Date(a.last_post)) : DASH,
      ],
      problem: a.status !== 'watching' ? 'Not read yet' : a.last_error ? `Last reading failed: ${a.last_error}` : '',
    };
  }

  /** The days of the week and the hours posts went up, most posts first, each with how those posts did. */
  function whenRows(board) {
    const days = (board.byWeekday || []).slice().sort((a, b) => b.posts - a.posts).map((d) => [DAYS[d.dow] || DASH, n(d.posts), liftWords(d.lift, d.posts)]);
    const hours = (board.byHour || []).slice().sort((a, b) => b.posts - a.posts).slice(0, 8).map((d) => [hourWords(d.hour), n(d.posts), liftWords(d.lift, d.posts)]);
    return { days, hours };
  }

  function kindRows(board) {
    return (board.byKind || []).map((k) => [KINDS[k.kind] || k.kind, n(k.posts), n(k.likes), n(k.comments), liftWords(k.lift, k.posts)]);
  }

  function topRows(board) {
    return (board.top || []).filter((t) => has(t.lift) && t.lift > 1).slice(0, 8).map((t) => ({
      who: `@${t.username}`,
      when: t.posted_at ? whenFmt.format(new Date(t.posted_at)) : DASH,
      kind: (KINDS[t.kind] || t.kind).replace(/s$/, ''),
      figures: `${n(t.likes)} likes · ${n(t.comments)} comments · ${t.lift.toFixed(1)}× that account’s usual`,
      caption: (t.caption || '').replace(/\s+/g, ' ').trim().slice(0, 160),
      permalink: /^https:\/\/www\.instagram\.com\//.test(t.permalink || '') ? t.permalink : '',
    }));
  }

  /** A few sentences, each only from figures that were read and rest on enough posts. */
  function summary(board) {
    const out = [];
    const accounts = (board.accounts || []).filter((a) => a.status === 'watching');
    if (!accounts.length) return out;
    const posts = board.posts || 0;
    out.push(`${plural(accounts.length, 'account', 'accounts')} watched, ${plural(posts, 'post', 'posts')} read from the last ${board.days} days.`);
    if (posts < ENOUGH) {
      out.push('Too few posts yet to say what works.');
      return out;
    }
    const rates = accounts.map((a) => perWeek(a, board.days)).filter((r) => r !== null).sort((a, b) => a - b);
    if (rates.length) out.push(`They post about ${rates[Math.floor(rates.length / 2)].toFixed(1)} times a week (the middle account).`);
    const best = (rows, name) => rows.filter((r) => r.posts >= ENOUGH && has(r.lift)).sort((a, b) => b.lift - a.lift)[0];
    const day = best(board.byWeekday || []);
    if (day && day.lift >= 1.15) out.push(`${DAYS[day.dow]} posts do best: ${day.lift.toFixed(1)} times an account’s usual, over ${plural(day.posts, 'post', 'posts')}.`);
    const hour = best(board.byHour || []);
    if (hour && hour.lift >= 1.15) out.push(`Posts around ${hourWords(hour.hour)} Eastern do best: ${hour.lift.toFixed(1)} times usual, over ${plural(hour.posts, 'post', 'posts')}.`);
    const kind = best(board.byKind || []);
    if (kind && kind.lift >= 1.15) out.push(`${KINDS[kind.kind] || kind.kind} do best: ${kind.lift.toFixed(1)} times usual, over ${plural(kind.posts, 'post', 'posts')}.`);
    if (board.hidden) out.push(board.hidden === 1 ? '1 post hides its likes and is left out of how posts did.' : `${whole.format(board.hidden)} posts hide their likes and are left out of how posts did.`);
    return out;
  }

  const api = { HEAD, HELP, EMPTY, NOT_CONNECTED, LIMITS, ACCOUNT_HEAD, ENOUGH, DASH, accountRow, whenRows, kindRows, topRows, summary, liftWords, perWeek, change, hourWords };
  root.CigarWatch = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
