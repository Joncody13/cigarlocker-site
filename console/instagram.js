// The Instagram part of the Marketing section: its words and figures (2026-11-16), kept apart from the page so
// the app's tests can run them (test/console-instagram.test.ts). The answer read here is the console function's
// `instagram`: {board: mktg_social_board('instagram', days), setUp, analyst} (supabase/sql/142_social_insights.sql).
//
// His words: "Never interpret unavailable metrics as zero."; "respect Meta API rate limits, metric availability
// and reporting delays"; "Do not create another disconnected dashboard." So: a figure Instagram did not report
// is shown as a dash with why, never as 0 and never counted into a total, a median or a ranking; every total
// says how many days or posts it rests on; a post under two days old is marked as still filling in; and a
// finding that rests on a handful of posts says so.

(function (root) {
  const ZONE = 'America/New_York';
  const whole = new Intl.NumberFormat('en-US');
  const whenFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: ZONE });
  const dayFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const longDayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const postDayFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: ZONE });
  const weekdayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: ZONE });
  const hourFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: ZONE });
  const has = (x) => typeof x === 'number' && Number.isFinite(x);
  const n = (x) => whole.format(Math.round(x));
  const plural = (count, one, many) => `${n(count)} ${count === 1 ? one : many}`;
  const when = (iso) => {
    const d = new Date(iso);
    return iso && !Number.isNaN(d.getTime()) ? whenFmt.format(d) : '';
  };
  const DASH = '—';
  /** Under this many posts a comparison is said to be too few to judge. */
  const FEW = 3;
  /** Instagram's own figures can change for this long after a post goes up. */
  const SETTLING_HOURS = 48;

  const KIND_WORDS = { post: 'Post', carousel: 'Carousel', reel: 'Reel', story: 'Story' };
  const KIND_PLURAL = { post: 'Posts', carousel: 'Carousels', reel: 'Reels', story: 'Stories' };
  /** Meta's metric names as a person reads them. */
  const METRIC_WORDS = {
    reach: 'Reach',
    views: 'Views',
    likes: 'Likes',
    comments: 'Comments',
    shares: 'Shares',
    saved: 'Saves',
    saves: 'Saves',
    total_interactions: 'Interactions',
    follows: 'Follows',
    profile_visits: 'Profile visits',
    profile_activity: 'Profile actions',
    reposts: 'Reposts',
    replies: 'Replies',
    navigation: 'Story taps',
    ig_reels_avg_watch_time: 'Average watch time',
    ig_reels_video_view_total_time: 'Total watch time',
    reels_skip_rate: 'Skipped in 3 seconds',
    accounts_engaged: 'Accounts engaged',
    profile_links_taps: 'Contact button taps',
    follows_and_unfollows: 'Follows and unfollows',
  };
  const metricWords = (m) => METRIC_WORDS[m] || m.replace(/_/g, ' ');

  const median = (list) => {
    const v = list.filter(has).sort((a, b) => a - b);
    if (!v.length) return null;
    const mid = Math.floor(v.length / 2);
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  };
  const pct = (x) => (has(x) ? `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%` : DASH);
  /** Milliseconds as "12 s" or "1 min 5 s" (Instagram reports Reel watch time in milliseconds). */
  const duration = (ms) => {
    if (!has(ms)) return DASH;
    const s = Math.round(ms / 1000);
    return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
  };
  const figure = (metric, value) => {
    if (!has(value)) return DASH;
    if (metric === 'ig_reels_avg_watch_time' || metric === 'ig_reels_video_view_total_time') return duration(value);
    if (metric === 'reels_skip_rate') return `${Math.round(value)}%`;
    return n(value);
  };

  /** Interactions for each account reached, only where Instagram reported both. */
  const engagement = (m) => (m && has(m.total_interactions) && has(m.reach) && m.reach > 0 ? m.total_interactions / m.reach : null);

  const dayAdd = (ymd, delta) => new Date(Date.parse(`${ymd}T12:00:00Z`) + delta * 86400000).toISOString().slice(0, 10);

  // ---- Where it stands ------------------------------------------------------------------------------------------

  /** One of: not-set-up, not-connected, needs-reconnect, waiting (connected, nothing read yet), reading. */
  function standing(answer) {
    const board = answer && answer.board;
    const acct = board && board.account;
    if (!answer) return { state: 'unread', words: 'Instagram could not be read just now.' };
    if (!acct || acct.status === 'disconnected') {
      return answer.setUp
        ? { state: 'not-connected', words: 'Ready to connect. Press Connect Instagram and approve the read-only permissions on Meta’s own page.' }
        : { state: 'not-set-up', words: 'Not connected. The Meta app’s three values are not in Supabase’s secrets yet; the steps are below.' };
    }
    if (acct.status === 'needs-reconnect')
      return { state: 'needs-reconnect', words: `Instagram ended the sign-in for @${acct.username}. Press Connect Instagram to renew it. What was collected is kept.` };
    const name = `@${acct.username}`;
    if (!acct.lastSyncAt) return { state: 'waiting', words: `${name} is connected. The first reading is under way; it takes a minute or two.` };
    const err = acct.lastError ? ` The last try failed: ${acct.lastError}` : '';
    return { state: 'reading', words: `${name} · read ${when(acct.lastSyncAt)}, and again every hour.${err}` };
  }

  /** The steps to connect, for the card shown until it is. */
  const SETUP = [
    'The Instagram account must be a professional account of type Business, public, and linked to the Cigar Locker Facebook Page (Instagram app: Edit profile, Page).',
    'At developers.facebook.com/apps, open the app “Cigar Locker Console”. Under Facebook Login for Business, Settings, add this Valid OAuth Redirect URI exactly: https://cigarlocker.app/console/instagram.html',
    'Under Facebook Login for Business, Configurations, create a configuration with a User access token and only these permissions: instagram_basic, instagram_manage_insights, pages_show_list, pages_read_engagement, ads_read, read_insights. Nothing that publishes, manages or messages.',
    'Put the App ID, the App Secret (App settings, Basic) and the Configuration ID into Supabase’s secrets as META_APP_ID, META_APP_SECRET and META_CONFIG_ID.',
    'Then press Connect Instagram here.',
  ];
  const READ_ONLY =
    'Read only. The permissions asked for (instagram_basic, instagram_manage_insights, pages_show_list, pages_read_engagement, and the reading permissions ads_read and read_insights) let Cigar Locker read the profile, the posts and their figures. Nothing here can post, delete, comment, message or spend, and a sign-in that allows more than reading is refused and not kept. The pass Meta issues is kept encrypted on the server and never reaches this page.';

  // ---- The account over the span ------------------------------------------------------------------------------

  /** The rows of the span and of the same number of days before it. */
  function spans(board) {
    const days = board.days;
    const start = dayAdd(board.today, -(days - 1));
    const before = dayAdd(start, -days);
    const rows = Array.isArray(board.daysRead) ? board.daysRead : [];
    return { now: rows.filter((r) => r.day >= start && r.day <= board.today), then: rows.filter((r) => r.day >= before && r.day < start), start, days };
  }

  /** A day metric added up over rows: the total, and how many of the days Instagram reported it for. */
  function total(rows, metric) {
    let sum = 0;
    let reported = 0;
    for (const r of rows) {
      const v = r.metrics && r.metrics[metric];
      if (has(v)) {
        sum += v;
        reported++;
      }
    }
    return { sum: reported ? sum : null, reported, of: rows.length };
  }

  const changeWords = (now, then, days) => {
    if (!has(now) || !has(then)) return has(now) ? `No figure for the ${days} days before to set it against` : '';
    if (then === 0) return now === 0 ? `The same as the ${days} days before` : `Nothing in the ${days} days before`;
    const d = (now - then) / then;
    if (Math.abs(d) < 0.005) return `The same as the ${days} days before`;
    return `${d > 0 ? 'Up' : 'Down'} ${Math.abs(d * 100).toFixed(Math.abs(d) < 0.1 ? 1 : 0)}% on the ${days} days before (${n(then)})`;
  };

  /** The few figures at the top. A figure Instagram did not report is a dash with why, never a zero. */
  function overview(board) {
    if (!board || !board.account) return null;
    const { now, then, days } = spans(board);
    const tile = (label, metric, about) => {
      const a = total(now, metric);
      const b = total(then, metric);
      const refused = now.map((r) => r.unavailable && r.unavailable[metric]).find(Boolean);
      return {
        label,
        value: has(a.sum) ? n(a.sum) : DASH,
        note: has(a.sum) ? (a.reported < a.of ? `Reported for ${a.reported} of ${a.of} days` : about) : refused ? `Not reported: ${refused}` : 'Instagram has not reported it yet',
        change: changeWords(a.sum, b.reported >= Math.min(days, 3) ? b.sum : null, days),
        measured: has(a.sum),
      };
    };
    const withFollowers = (Array.isArray(board.daysRead) ? board.daysRead : []).filter((r) => has(r.followers));
    const latest = withFollowers[withFollowers.length - 1];
    const inSpan = withFollowers.filter((r) => r.day >= spans(board).start);
    const first = inSpan[0];
    const grew = latest && first && first.day !== latest.day ? latest.followers - first.followers : null;
    const reach = total(now, 'reach');
    const inter = total(now, 'total_interactions');
    const posts = (Array.isArray(board.media) ? board.media : []).filter((m) => m.postedAt >= `${spans(board).start}T00:00:00` && m.kind !== 'story');
    const stories = (Array.isArray(board.media) ? board.media : []).filter((m) => m.postedAt >= `${spans(board).start}T00:00:00` && m.kind === 'story');
    return [
      {
        label: 'Followers',
        value: latest ? n(latest.followers) : DASH,
        note: latest ? `As read ${dayFmt.format(new Date(`${latest.day}T12:00:00Z`))}` : 'Not read yet',
        change: !has(grew)
          ? 'Growth shows once two days have been read'
          : grew === 0
            ? `No change since ${dayFmt.format(new Date(`${first.day}T12:00:00Z`))}`
            : `${grew > 0 ? 'Up' : 'Down'} ${n(Math.abs(grew))} since ${dayFmt.format(new Date(`${first.day}T12:00:00Z`))}`,
        measured: !!latest,
      },
      tile('Reach', 'reach', 'Accounts that saw anything of yours, added up by day (the same account on two days counts twice)'),
      tile('Views', 'views', 'Times your content was played or shown'),
      tile('Interactions', 'total_interactions', 'Likes, comments, saves, shares and replies'),
      {
        label: 'Engagement rate',
        value: has(reach.sum) && has(inter.sum) && reach.sum > 0 ? pct(inter.sum / reach.sum) : DASH,
        note: has(reach.sum) && has(inter.sum) ? 'Interactions for each account reached' : 'Needs both reach and interactions',
        change: '',
        measured: has(reach.sum) && has(inter.sum) && reach.sum > 0,
      },
      { label: 'Published', value: n(posts.length), note: stories.length ? `and ${plural(stories.length, 'Story', 'Stories')} seen while up` : `in these ${days} days`, change: '', measured: true },
    ];
  }

  /** What the chart can draw, and its rows: only days Instagram reported the figure for. */
  const CHARTS = [
    ['reach', 'Reach by day'],
    ['views', 'Views by day'],
    ['total_interactions', 'Interactions by day'],
    ['followers', 'Followers'],
    ['accounts_engaged', 'Accounts engaged by day'],
  ];
  function series(board, metric) {
    const title = (CHARTS.find((c) => c[0] === metric) || ['', metricWords(metric)])[1];
    if (!board) return { rows: [], missing: 0, title, unit: 'day', note: '' };
    const { now, start, days } = spans(board);
    const byDay = new Map(now.map((r) => [r.day, r]));
    const level = metric === 'followers';
    const each = [];
    for (let i = 0; i < days; i++) {
      const day = dayAdd(start, i);
      const r = byDay.get(day);
      const v = r ? (level ? r.followers : r.metrics && r.metrics[metric]) : null;
      const why = !r ? 'Not read' : has(v) ? '' : (r.unavailable && r.unavailable[metric]) || 'Not reported by Instagram';
      each.push({ day, value: has(v) ? v : null, why });
    }
    // Over 90 days a bar is a week: its days added up (for followers, the week's last reading).
    const rows = [];
    if (days > 90) {
      for (let i = 0; i < each.length; i += 7) {
        const week = each.slice(i, i + 7);
        const known = week.filter((d) => has(d.value));
        const d = new Date(`${week[0].day}T12:00:00Z`);
        const value = !known.length ? null : level ? known[known.length - 1].value : known.reduce((s, x) => s + x.value, 0);
        const part = known.length && known.length < week.length && !level ? ` (${known.length} of ${week.length} days reported)` : '';
        rows.push({ day: week[0].day, label: dayFmt.format(d), long: `Week of ${dayFmt.format(d)}${part}`, value, why: known.length ? '' : week[0].why });
      }
    } else {
      for (const d of each) {
        const date = new Date(`${d.day}T12:00:00Z`);
        rows.push({ day: d.day, label: dayFmt.format(date), long: longDayFmt.format(date), value: d.value, why: d.why });
      }
    }
    const missing = each.filter((d) => !has(d.value)).length;
    const note = !missing
      ? ''
      : missing === each.length
        ? 'No day in this span has a figure yet.'
        : `${plural(missing, 'day has', 'days have')} no figure and ${missing === 1 ? 'is' : 'are'} left blank, not counted as zero.`;
    return { rows, missing, title, unit: days > 90 ? 'week' : 'day', level, note };
  }

  // ---- Posts ----------------------------------------------------------------------------------------------------

  const SORTS = [
    ['posted', 'Newest first'],
    ['reach', 'Most reach'],
    ['total_interactions', 'Most interactions'],
    ['engagement', 'Highest engagement rate'],
    ['saved', 'Most saves'],
    ['shares', 'Most shares'],
    ['views', 'Most views'],
  ];
  const KIND_FILTERS = [
    ['', 'Everything'],
    ['post', 'Posts'],
    ['carousel', 'Carousels'],
    ['reel', 'Reels'],
    ['story', 'Stories'],
  ];
  const HEADLINE = {
    post: ['reach', 'views', 'likes', 'comments', 'saved', 'shares'],
    carousel: ['reach', 'views', 'likes', 'comments', 'saved', 'shares'],
    reel: ['reach', 'views', 'likes', 'comments', 'saved', 'shares', 'ig_reels_avg_watch_time'],
    story: ['reach', 'views', 'replies', 'shares', 'profile_visits'],
  };

  function post(m, now) {
    const metrics = m.metrics || {};
    const un = m.unavailable || {};
    const age = (now - Date.parse(m.postedAt)) / 3600000;
    const bio = m.breakdowns && m.breakdowns.profile_activity && m.breakdowns.profile_activity.bio_link_clicked;
    const missing = Object.keys(un).filter((k) => !(k in metrics));
    // One reason said once when every missing figure shares it (a Story too few have seen).
    const reasons = [...new Set(missing.map((k) => un[k]))];
    return {
      id: m.id,
      kind: m.kind,
      kindWords: KIND_WORDS[m.kind] || m.kind,
      thumb: m.thumb || '',
      permalink: m.permalink || '',
      caption: (m.caption || '').replace(/\s+/g, ' ').trim().slice(0, 140) || '(no caption)',
      posted: m.postedAt ? postDayFmt.format(new Date(m.postedAt)) : '',
      postedAt: m.postedAt,
      settling: age < SETTLING_HOURS,
      figures: (HEADLINE[m.kind] || HEADLINE.post).map((k) => ({ name: metricWords(k), value: figure(k, metrics[k]), measured: has(metrics[k]) })),
      engagement: engagement(metrics),
      engagementWords: pct(engagement(metrics)),
      bioLink: has(bio) ? n(bio) : null,
      unavailable: !missing.length ? '' : reasons.length === 1 ? `Not reported: ${reasons[0]}` : `Not reported: ${missing.map(metricWords).join(', ')}`,
      readings: m.readings || 0,
      read: m.readAt ? when(m.readAt) : '',
      value: (key) => (key === 'engagement' ? engagement(metrics) : key === 'posted' ? Date.parse(m.postedAt) : metrics[key]),
    };
  }

  /** The posts of the span, ranked. A post Instagram gave no figure for is listed last, never ranked as zero. */
  function ranking(board, sort, kind, nowMs) {
    if (!board) return { rows: [], left: 0, note: '' };
    const now = nowMs || Date.now();
    const start = `${spans(board).start}T00:00:00`;
    const all = (Array.isArray(board.media) ? board.media : []).filter((m) => m.postedAt >= start && (!kind || m.kind === kind)).map((m) => post(m, now));
    const key = SORTS.some((s) => s[0] === sort) ? sort : 'posted';
    const known = all.filter((p) => has(p.value(key)));
    const unknown = all.filter((p) => !has(p.value(key)));
    known.sort((a, b) => b.value(key) - a.value(key));
    unknown.sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt));
    const settling = all.filter((p) => p.settling).length;
    const notes = [];
    if (unknown.length && key !== 'posted') notes.push(`${plural(unknown.length, 'has', 'have')} no figure for this and ${unknown.length === 1 ? 'is' : 'are'} listed last, not ranked.`);
    if (settling) notes.push(`${plural(settling, 'is', 'are')} under two days old: ${settling === 1 ? 'its' : 'their'} figures are still filling in.`);
    return { rows: [...known, ...unknown], note: notes.join(' ') };
  }

  /** A group of posts in one line: how many, and the middle reach, interactions and engagement of those reported. */
  function group(name, list) {
    const settled = list.filter((p) => !p.settling);
    const reach = median(settled.map((p) => p.value('reach')));
    const inter = median(settled.map((p) => p.value('total_interactions')));
    const eng = median(settled.map((p) => p.engagement));
    return {
      name,
      count: list.length,
      judged: settled.length,
      reach: has(reach) ? n(reach) : DASH,
      interactions: has(inter) ? n(inter) : DASH,
      engagement: pct(eng),
      rank: has(eng) ? eng : has(inter) ? inter / 1e9 : -1,
      few: settled.length < FEW,
    };
  }
  const settledPosts = (board, nowMs) => {
    const now = nowMs || Date.now();
    const start = `${spans(board).start}T00:00:00`;
    return (Array.isArray(board.media) ? board.media : []).filter((m) => m.postedAt >= start).map((m) => post(m, now));
  };
  const GROUP_HEAD = ['', 'Published', 'Middle reach', 'Middle interactions', 'Middle engagement rate'];
  const groupRow = (g) => [g.name, g.few ? `${n(g.count)} (too few to judge)` : n(g.count), g.reach, g.interactions, g.engagement];
  const FEW_WORDS = `With fewer than ${FEW} settled posts in a group, its middle figure is one or two posts: read it as a note, not a finding. Posts under two days old are left out until their figures settle.`;

  /** By format: Posts, Carousels, Reels, Stories, the best engagement first. */
  function formats(board, nowMs) {
    if (!board) return [];
    const all = settledPosts(board, nowMs);
    return ['post', 'carousel', 'reel', 'story']
      .map((k) =>
        group(
          KIND_PLURAL[k],
          all.filter((p) => p.kind === k),
        ),
      )
      .filter((g) => g.count)
      .sort((a, b) => b.rank - a.rank);
  }

  /** By the day of the week and the part of the day it was published (Massachusetts time). Stories left out. */
  const PARTS = [
    ['Early morning (5 to 9)', 5, 9],
    ['Late morning (9 to 12)', 9, 12],
    ['Afternoon (12 to 5)', 12, 17],
    ['Evening (5 to 9)', 17, 21],
    ['Night (9 to 5)', 21, 29],
  ];
  function times(board, nowMs) {
    if (!board) return { days: [], parts: [] };
    const all = settledPosts(board, nowMs).filter((p) => p.kind !== 'story');
    const byDay = new Map();
    const byPart = new Map();
    for (const p of all) {
      const d = new Date(p.postedAt);
      const wd = weekdayFmt.format(d);
      const hr = Number(hourFmt.format(d)) % 24;
      const part = PARTS.find(([, from, to]) => (hr >= from && hr < to) || (to > 24 && hr < to - 24));
      byDay.set(wd, [...(byDay.get(wd) || []), p]);
      if (part) byPart.set(part[0], [...(byPart.get(part[0]) || []), p]);
    }
    const sorted = (map) => [...map.entries()].map(([name, list]) => group(name, list)).sort((a, b) => b.rank - a.rank);
    return { days: sorted(byDay), parts: sorted(byPart) };
  }

  /** By hashtag: each one used on two posts or more. A caption's own words are not guessed into topics. */
  function topics(board, nowMs) {
    if (!board) return [];
    const now = nowMs || Date.now();
    const start = `${spans(board).start}T00:00:00`;
    const by = new Map();
    for (const m of (Array.isArray(board.media) ? board.media : []).filter((x) => x.postedAt >= start && x.kind !== 'story')) {
      const tags = new Set(((m.caption || '').toLowerCase().match(/#[\p{L}\p{N}_]{2,40}/gu) || []).map((t) => t));
      for (const t of tags) by.set(t, [...(by.get(t) || []), post(m, now)]);
    }
    return [...by.entries()]
      .filter(([, list]) => list.length >= 2)
      .map(([name, list]) => group(name, list))
      .sort((a, b) => b.rank - a.rank)
      .slice(0, 15);
  }

  // ---- The audience, and what can be attributed -------------------------------------------------------------------

  const AUDIENCE = [
    ['follower_demographics', 'Followers'],
    ['engaged_audience_demographics', 'Accounts that engaged this month'],
  ];
  const BREAKDOWN_WORDS = { age: 'By age', gender: 'By gender', city: 'By city', country: 'By country' };
  const GENDER = { f: 'Women', m: 'Men', u: 'Not said' };

  /** Each audience Instagram reported, by age, gender, city and country, the largest first, as shares of what it gave. */
  function audience(board) {
    const rows = board && Array.isArray(board.demographics) ? board.demographics : [];
    const out = [];
    for (const [metric, title] of AUDIENCE) {
      for (const breakdown of ['country', 'city', 'age', 'gender']) {
        const list = rows.filter((r) => r.metric === metric && r.breakdown === breakdown).sort((a, b) => b.value - a.value);
        if (!list.length) continue;
        const sum = list.reduce((s, r) => s + r.value, 0);
        out.push({
          title: `${title} · ${BREAKDOWN_WORDS[breakdown].toLowerCase()}`,
          day: list[0].day,
          pairs: list.slice(0, 8).map((r) => [breakdown === 'gender' ? GENDER[String(r.key).toLowerCase()] || String(r.key) : String(r.key), r.value, sum ? r.value / sum : 0]),
        });
      }
    }
    return out;
  }
  const AUDIENCE_LIMITS =
    'Instagram gives the audience only for accounts with 100 followers or more, only its top 45 of each kind, and only for people it knows these things about, so the parts add up to less than the follower count. Until it reports, nothing is shown here.';

  const ATTR_HEAD = ['Campaign on the link', 'Opened the app', 'Accounts made', 'First cigar added', 'Plus'];
  /** What Cigar Locker's own app counted for links tagged utm_source=instagram, and what cannot be measured yet. */
  function attribution(board) {
    const a = (board && board.attribution) || {};
    const app = Array.isArray(a.app) ? a.app : [];
    const site = Array.isArray(a.site) ? a.site : null;
    const rows = app.map((r) => [r.campaign, n(r.opened), n(r.accounts), n(r.first_cigars), n(r.plus)]);
    const limits = [
      'Counted by Cigar Locker itself, for people whose first link into the app carried utm_source=instagram. Put that tag on the link in the Instagram bio and on Story links, with a campaign name for each: for example https://cigarlocker.app/app/?utm_source=instagram&utm_medium=social&utm_campaign=bio',
      a.siteCounting
        ? site && site.length
          ? `Website visits from Instagram in this span: ${n(site.reduce((s, r) => s + (r.visits || 0), 0))}, with ${n(site.reduce((s, r) => s + (r.store_clicks || 0), 0))} taps on a store button.`
          : 'The website counted no visit from Instagram in this span.'
        : 'Website visits from Instagram are not counted: the website’s visit counter is off (it is one of the proposals above).',
      'App Store page visits and downloads from Instagram cannot be seen from here: Apple reports them only in App Store Connect, which is not connected yet, and an installed iPhone app is not told which link led to its download.',
      'Taps on the bio link after a post or Story are shown on each post where Instagram reports them.',
    ];
    return { rows, empty: rows.length ? '' : 'Nothing attributed yet. That means no tagged link has brought anyone, or the links are not tagged; it does not mean Instagram brought nobody.', limits };
  }

  // ---- Health, and the analyst ------------------------------------------------------------------------------------

  const OUTCOME = { ok: 'Read', partial: 'Read in part', slowed: 'Stopped early', 'signed-out': 'Sign-in ended', failed: 'Failed', running: 'Running' };
  function health(board) {
    const acct = (board && board.account) || {};
    const lines = [];
    if (acct.passExpiresAt) lines.push(`The pass is good until ${when(acct.passExpiresAt)} and is renewed by itself each week.`);
    if (acct.usage && has(acct.usage.percent)) lines.push(`Meta’s allowance was ${Math.round(acct.usage.percent)}% used at the last reading; a reading stops itself at 75%.`);
    if (board && has(board.readingsEver))
      lines.push(
        `${plural(board.readingsEver, 'reading', 'readings')} of ${plural(board.mediaEver || 0, 'post', 'posts')} kept since ${board.firstReadingAt ? when(board.firstReadingAt) : 'connecting'}.`,
      );
    const never = [];
    for (const [kind, set] of Object.entries(acct.unsupported || {})) {
      const names = Object.keys(set || {});
      if (names.length) never.push(`${kind === 'account' ? 'The account' : KIND_PLURAL[kind] || kind}: ${names.map(metricWords).join(', ')}`);
    }
    if (never.length) lines.push(`Instagram does not offer these figures, so they are not asked for (asked again weekly): ${never.join('; ')}.`);
    const runs = (board && Array.isArray(board.runs) ? board.runs : []).map((r) => {
      const notes = r.notes || {};
      const bits = [];
      if (has(notes.media)) bits.push(plural(notes.media, 'post listed', 'posts listed'));
      if (has(notes.stories) && notes.stories) bits.push(plural(notes.stories, 'Story up', 'Stories up'));
      if (has(notes.readings)) bits.push(plural(notes.readings, 'reading', 'readings'));
      if (has(notes.days)) bits.push(plural(notes.days, 'day', 'days'));
      if (notes.stopped) bits.push(`stopped: ${notes.stopped}`);
      if (notes.why) bits.push(String(notes.why));
      if (Array.isArray(notes.failed) && notes.failed.length) bits.push(`could not read: ${notes.failed.join(', ')}`);
      return [when(r.started_at), OUTCOME[r.outcome] || r.outcome, `${n(r.calls || 0)} calls`, bits.join(' · ')];
    });
    return { lines, runs, head: ['When', 'Outcome', 'Calls to Instagram', 'What it did'] };
  }

  const ANALYST_HELP =
    'The analyst is Claude, given these figures and nothing else. It explains what moved and proposes what to try; it does not post, change or spend anything. Each analysis costs a few cents at Anthropic and runs only when you press the button.';
  function analysis(a) {
    if (!a || !a.analysis) return null;
    const x = a.analysis;
    const list = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s.trim()) : []);
    return {
      when: a.made_at ? `Written ${when(a.made_at)} from the last ${a.days} days${has(Number(a.cost_cents)) ? ` · about ${Number(a.cost_cents).toFixed(1)} cents` : ''}` : '',
      headline: typeof x.headline === 'string' ? x.headline : '',
      sections: [
        ['What happened', list(x.whatHappened)],
        ['Working', list(x.working)],
        ['Not working', list(x.notWorking)],
        ['What these figures cannot tell yet', list(x.cannotTell)],
      ].filter(([, items]) => items.length),
      recommendations: (Array.isArray(x.recommendations) ? x.recommendations : [])
        .filter((r) => r && typeof r.action === 'string')
        .map((r) => ({ action: r.action, why: String(r.why || ''), measure: String(r.measure || ''), confidence: ['low', 'medium', 'high'].includes(r.confidence) ? r.confidence : 'low' })),
    };
  }

  const SPANS = [
    [7, '7 days'],
    [30, '30 days'],
    [90, '90 days'],
    [365, 'A year'],
  ];
  const LIMITS =
    'Instagram’s figures can lag up to 48 hours and are estimates for reach. A Story’s figures exist for only 24 hours, and not at all under 5 viewers, so each Story is read every hour while it is up. History here begins the day Instagram was connected; Instagram itself keeps a post’s figures for up to two years.';

  const api = {
    standing,
    SETUP,
    READ_ONLY,
    overview,
    CHARTS,
    series,
    SORTS,
    KIND_FILTERS,
    ranking,
    formats,
    times,
    topics,
    GROUP_HEAD,
    groupRow,
    FEW_WORDS,
    audience,
    AUDIENCE_LIMITS,
    attribution,
    ATTR_HEAD,
    health,
    analysis,
    ANALYST_HELP,
    SPANS,
    LIMITS,
    metricWords,
    engagement,
    median,
    DASH,
  };
  root.CigarInstagram = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
