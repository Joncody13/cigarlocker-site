// Apple Ads (2026-11-21, his "Build the Apple ads code. I need you and chat to be able to monitor everything."):
// the words and figures of the "Apple Ads" card in the Marketing section, kept apart from the page so the app's
// tests can run them (test/appleads.test.ts). The answer read here is the console function's `apple-ads`:
// mktg_ads_board(days) (supabase/sql/157_apple_ads.sql).
//
// His rule stands: "Never interpret unavailable metrics as zero." A figure Apple did not report is a dash, and
// a cost per download is worked out only when there was a download. Read only: nothing here can change a bid,
// a budget, a keyword or a campaign, or spend anything.

(function (root) {
  const whole = new Intl.NumberFormat('en-US');
  const dayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const DASH = '—';
  const has = (x) => typeof x === 'number' && Number.isFinite(x);
  const n = (x) => (has(x) ? whole.format(Math.round(x)) : DASH);
  const usd = (x) => (has(x) ? `$${(Math.round((x + Number.EPSILON) * 100) / 100).toFixed(2)}` : DASH);
  const per = (spend, count) => (has(spend) && has(count) && count > 0 ? spend / count : null);
  const ago = (iso, now) => {
    const m = Math.round((now - Date.parse(iso)) / 60000);
    if (!Number.isFinite(m)) return '';
    if (m < 2) return 'just now';
    if (m < 90) return `${m} minutes ago`;
    if (m < 48 * 60) return `${Math.round(m / 60)} hours ago`;
    return `${Math.round(m / 1440)} days ago`;
  };

  const READ_ONLY = 'Read once an hour. Read only: nothing here can change a bid, a budget, a keyword or a campaign, or spend anything.';
  const NOT_SET_UP = 'Not set up yet. Press Start setup: it makes a key for this console, and you paste its public half into Apple Ads.';
  const STEPS = [
    'In Apple Ads, click your name at the top right, then Account Settings, then API.',
    'Paste the public key below into the Public Key box there and press Save.',
    'Apple then shows three lines: clientId, teamId and keyId. Copy each into the boxes below and press Connect.',
  ];
  const NO_API_TAB = 'If the API page says your role cannot use it, tell Claude: Apple gives the API to a user with an API role, and one may need to be invited first.';
  const LIMITS = [
    'Apple counts a day in UTC here, and a day’s figures keep moving for a day or two.',
    'Downloads are Apple’s count of installs after an ad, new and repeat together. They are not Cigar Locker accounts.',
    'A cost per download is shown only when there was a download; a figure Apple did not report is a dash, never zero.',
  ];
  const DAY_HEAD = ['Day', 'Spend', 'Shown', 'Taps', 'Downloads', 'Cost a tap', 'Cost a download'];
  const KW_HEAD = ['Keyword', 'Group', 'Bid', 'Spend', 'Shown', 'Taps', 'Downloads', 'Cost a download'];

  const STATUS_WORDS = {
    RUNNING: 'Running',
    ON_HOLD: 'On hold',
    PAUSED: 'Paused',
    DELETED: 'Deleted',
  };
  const REASON_WORDS = {
    APP_NOT_ELIGIBLE: 'the app is not eligible',
    APP_NOT_ELIGIBLE_SEARCHADS: 'the app is not eligible for search ads',
    APP_NOT_PUBLISHED_YET: 'the app is not published yet',
    CAMPAIGN_NOT_YET_STARTED: 'it has not started yet',
    NO_PAYMENT_METHOD_ON_FILE: 'no payment card is on the account',
    PAUSED_BY_USER: 'you paused it',
    PAUSED_BY_SYSTEM: 'Apple paused it',
    DAILY_CAP_EXHAUSTED: 'today’s budget is spent',
    TOTAL_BUDGET_EXHAUSTED: 'the whole budget is spent',
    NO_ELIGIBLE_COUNTRIES: 'no country is eligible',
    AD_GROUP_MISSING: 'it has no ad group',
    BO_END_DATE_REACHED: 'its end date has passed',
    CREATIVE_SET_UNSUPPORTED: 'its ad is not supported',
    PENDING_AUDIENCE_VERIFICATION: 'Apple is still checking it',
  };
  const reasonWords = (r) => REASON_WORDS[r] || String(r || '').toLowerCase().replace(/_/g, ' ');

  /** Which step the card is at: 'none', 'key' (paste the key, type the ids), 'connected' or 'trouble'. */
  function step(board) {
    const a = board && board.account;
    if (!a) return 'none';
    if (a.status === 'connected') return 'connected';
    if (a.status === 'trouble') return 'trouble';
    return 'key';
  }

  /** How it stands, in a sentence. */
  function standing(board, now) {
    const a = board && board.account;
    const s = step(board);
    if (s === 'none') return { state: 'none', words: NOT_SET_UP };
    if (s === 'key') return { state: 'key', words: a.lastError ? `Not connected yet. ${a.lastError}` : 'A key is made. Three steps remain, below.' };
    const read = a.lastSyncAt ? `Last read ${ago(a.lastSyncAt, now == null ? Date.now() : now)}.` : 'Not read yet.';
    if (s === 'trouble') return { state: 'trouble', words: `Apple did not answer the last reading. ${a.lastError || ''} ${read}`.replace(/\s+/g, ' ').trim() };
    return { state: 'reading', words: `Connected${a.orgName ? ` to ${a.orgName}` : ''}. ${read}` };
  }

  /** Each campaign in a line: its name, how it stands in plain words, and its daily budget. */
  function campaignLines(board) {
    return ((board && board.campaigns) || []).map((c) => {
      const st = STATUS_WORDS[c.displayStatus] || STATUS_WORDS[c.servingStatus] || c.displayStatus || c.servingStatus || 'Not known';
      const why = (c.reasons || []).map(reasonWords).filter(Boolean);
      return { name: c.name || `Campaign ${c.id}`, words: `${st}${why.length ? `: ${why.join(', ')}` : ''}${has(c.dailyBudget) ? ` · $${c.dailyBudget.toFixed(2)} a day` : ''}` };
    });
  }

  /** The days read, added across campaigns, newest first. A figure no campaign reported that day stays a dash. */
  function dayRows(board, most) {
    const by = new Map();
    for (const d of (board && board.daysRead) || []) {
      const m = d.metrics || {};
      const row = by.get(d.day) || {};
      for (const k of ['spend', 'impressions', 'taps', 'installs']) if (has(m[k])) row[k] = (has(row[k]) ? row[k] : 0) + m[k];
      by.set(d.day, row);
    }
    return [...by.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .slice(0, most || 14)
      .map(([day, m]) => ({ day: dayFmt.format(new Date(`${day}T00:00:00Z`)), cells: [usd(m.spend), n(m.impressions), n(m.taps), n(m.installs), usd(per(m.spend, m.taps)), usd(per(m.spend, m.installs))] }));
  }

  /** The totals over the days read. */
  function totals(board) {
    const t = {};
    let days = 0;
    const seen = new Set();
    for (const d of (board && board.daysRead) || []) {
      const m = d.metrics || {};
      if (!seen.has(d.day)) {
        seen.add(d.day);
        days += 1;
      }
      for (const k of ['spend', 'impressions', 'taps', 'installs']) if (has(m[k])) t[k] = (has(t[k]) ? t[k] : 0) + m[k];
    }
    return { days, spend: usd(t.spend), shown: n(t.impressions), taps: n(t.taps), downloads: n(t.installs), costPerDownload: usd(per(t.spend, t.installs)), raw: t };
  }

  function totalsWords(board) {
    const t = totals(board);
    if (!t.days) return '';
    return `Over ${t.days} ${t.days === 1 ? 'day' : 'days'} read: ${t.spend} spent · shown ${t.shown} times · ${t.taps} taps · ${t.downloads} downloads · ${t.costPerDownload} a download`;
  }

  /** The keywords, the ones that cost most first; one never shown sits last. */
  function keywordRows(board) {
    return ((board && board.keywords) || [])
      .slice()
      .sort((a, b) => ((b.metrics || {}).spend || 0) - ((a.metrics || {}).spend || 0) || ((b.metrics || {}).impressions || 0) - ((a.metrics || {}).impressions || 0) || String(a.keyword).localeCompare(String(b.keyword)))
      .map((k) => {
        const m = k.metrics || {};
        const cost = per(m.spend, m.installs);
        return {
          keyword: k.keyword,
          note: `${String(k.matchType || '').toLowerCase() === 'exact' ? 'Exact' : k.matchType ? `${String(k.matchType).charAt(0)}${String(k.matchType).slice(1).toLowerCase()} match` : ''}${k.displayStatus && k.displayStatus !== 'RUNNING' ? ` · ${String(k.displayStatus).toLowerCase().replace(/_/g, ' ')}` : ''}`.replace(/^ · /, ''),
          dear: has(cost) && cost > DEAR,
          cells: [k.adGroup || DASH, usd(k.bid), usd(m.spend), n(m.impressions), n(m.taps), n(m.installs), usd(cost)],
        };
      });
  }
  /** His mark for a keyword to look at: over about $4 a download. */
  const DEAR = 4;

  /** The span the keyword figures cover, in words. */
  function keywordSpan(board) {
    const k = ((board && board.keywords) || [])[0];
    if (!k || !k.from || !k.to) return '';
    return `${dayFmt.format(new Date(`${k.from}T00:00:00Z`))} to ${dayFmt.format(new Date(`${k.to}T00:00:00Z`))}`;
  }

  /** The three ids as typed: tidy, or which one does not look like Apple's. */
  function readIds(v) {
    const tidy = (x) => String(x || '').trim().replace(/^(clientId|teamId|keyId)\s*[:=]?\s*/i, '');
    const ids = { clientId: tidy(v.clientId), teamId: tidy(v.teamId), keyId: tidy(v.keyId) };
    const sa = /^SEARCHADS\.[0-9a-f-]{20,60}$/i;
    if (!sa.test(ids.clientId)) return { problem: 'The clientId should start with SEARCHADS. followed by letters, digits and dashes.' };
    if (!sa.test(ids.teamId)) return { problem: 'The teamId should start with SEARCHADS. followed by letters, digits and dashes.' };
    if (!/^[0-9a-f-]{20,60}$/i.test(ids.keyId)) return { problem: 'The keyId is letters, digits and dashes only.' };
    return { ids };
  }

  const api = { READ_ONLY, NOT_SET_UP, STEPS, NO_API_TAB, LIMITS, DAY_HEAD, KW_HEAD, DEAR, step, standing, campaignLines, dayRows, totals, totalsWords, keywordRows, keywordSpan, readIds, reasonWords };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CigarAppleAds = api;
})(typeof window !== 'undefined' ? window : globalThis);
