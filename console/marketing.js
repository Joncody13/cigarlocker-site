// The Marketing section's words and figures (2026-11-15), kept apart from the page so the app's tests can
// run them (test/console-marketing.test.ts). The answer read here is the console function's `marketing`:
// {intel: mktg_intel(90), tokens: mktg_tokens()} (supabase/sql/135_marketing_monitor.sql).
//
// His words: "Never generate numbers that were not measured."; "Clearly identify data sources, collection
// times, missing data and reporting delays."; "Distinguish measured AI citations from sampled AI responses.
// Neither represents a guaranteed universal ranking."; "Do not create dozens of identical statistic cards."
//
// So every panel is in one of three states and says which: measured (with its figure and where it came
// from), waiting (connected, nothing to show yet), or not connected (with what it needs). A panel that is
// not connected never shows a zero.

(function (root) {
  const ZONE = 'America/New_York';
  const whole = new Intl.NumberFormat('en-US');
  const whenFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: ZONE });
  const dayFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
  const has = (x) => typeof x === 'number' && Number.isFinite(x);
  const n = (x) => whole.format(Math.round(num(x)));
  const plural = (count, one, many) => `${n(count)} ${num(count) === 1 ? one : many}`;
  const when = (iso) => {
    const d = new Date(iso);
    return iso && !Number.isNaN(d.getTime()) ? whenFmt.format(d) : '';
  };
  const day = (ymd) => (ymd ? dayFmt.format(new Date(`${ymd}T12:00:00Z`)) : '');
  const money = (cents) => `$${(num(cents) / 100).toFixed(2)}`;
  /** A part of a whole as people say it: "3 of 12". Never a percent of a handful. */
  const of = (part, all) => `${n(part)} of ${n(all)}`;

  const WINDOWS = [7, 30, 90];

  /**
   * One daily figure over the last 7, 30 and 90 days against the same span before. A span is compared only
   * when both halves are on record; otherwise it says how many days are.
   */
  function compare(history, pick) {
    const days = Array.isArray(history) ? history : [];
    const values = days.map((d) => pick(d.figures || {}));
    const measured = values.filter(has).length;
    return WINDOWS.map((w) => {
      const now = values.slice(-w).filter(has);
      const before = values.slice(-2 * w, -w).filter(has);
      const enough = values.length >= 2 * w && now.length > 0 && before.length > 0;
      const a = now.reduce((x, y) => x + y, 0);
      const b = before.reduce((x, y) => x + y, 0);
      return {
        days: w,
        enough,
        now: enough ? a : null,
        before: enough ? b : null,
        words: enough ? `${n(a)} in the last ${w} days, ${n(b)} in the ${w} before` : `${w} days: ${plural(measured, 'day', 'days')} on record, ${2 * w} needed to compare`,
      };
    });
  }

  /** The comparisons that can be made, in one line; with none, how many days are on record. */
  function trendWords(windows) {
    const ready = windows.filter((w) => w.enough);
    if (ready.length) return ready.map((w) => w.words).join(' · ');
    return windows.length ? windows[0].words.replace(/^\d+ days: /, '').replace(/, \d+ needed to compare$/, '') + ': a 7-day comparison needs 14' : '';
  }

  const series = (history, pick) => (Array.isArray(history) ? history.map((d) => pick(d.figures || {})).map((v) => (has(v) ? v : 0)) : []);
  const today = (key) => (f) => (f.todaySeries ? f.todaySeries[key] : undefined);

  function connection(latest, key) {
    const list = latest && latest.sources && Array.isArray(latest.sources.connections) ? latest.sources.connections : [];
    return list.find((c) => c.key === key) || null;
  }

  /** A panel for a source that is not connected: what it would bring and what it needs. Never a figure. */
  function waitingFor(key, title, link) {
    return { key, title, state: 'not-connected', headline: 'Not connected', lines: [link ? link.needs : 'Its connection has not been built yet.'], spark: null, trend: null };
  }

  /** The twelve panels, in his order. */
  function panels(intel) {
    if (!intel) return null;
    const latest = intel.latest || null;
    const f = (latest && latest.figures) || {};
    const now = f.now || {};
    const history = intel.history || [];
    const ai = intel.ai || {};
    const site = intel.site || {};
    const findings = Array.isArray(intel.findings) ? intel.findings.filter((x) => x.status !== 'done') : [];
    const recs = Array.isArray(intel.recommendations) ? intel.recommendations : [];
    const out = [];

    // 1. AI visibility: sampled answers, said as a sample.
    const sampled = num(ai.sampled);
    out.push(
      sampled > 0
        ? { key: 'ai', title: 'AI visibility', state: 'measured', headline: `Named in ${of(ai.mentioned, sampled)} sampled answers`, lines: [`Recommended in ${n(ai.recommended)}. The last ${n(ai.days)} days.`, 'A sample is one answer on one day, not a ranking.'], spark: null, trend: null }
        : { key: 'ai', title: 'AI visibility', state: 'waiting', headline: 'No answers sampled yet', lines: [intel.settings && intel.settings.aiAudit === 'on' ? 'The daily sample is on; the first runs at the next morning check.' : 'The daily sample is off. It costs money at Anthropic, so it waits for your word.'], spark: null, trend: null },
    );

    // 2. Google search.
    out.push(waitingFor('search', 'Google search performance', connection(latest, 'search-console')));

    // 3. App Store discovery: store figures are not connected; installs are phones that opened the app.
    const store = connection(latest, 'app-store');
    out.push({
      key: 'store',
      title: 'App Store discovery',
      state: 'not-connected',
      headline: 'Not connected',
      lines: [store ? store.needs : 'Its connection has not been built yet.', has(now.installs) ? `Counted here meanwhile: ${plural(now.installs, 'phone or browser has', 'phones and browsers have')} ever opened the app.` : ''].filter(Boolean),
      spark: series(history, today('installs')),
      trend: compare(history, today('installs')),
    });

    // 4. Social.
    out.push(waitingFor('social', 'Social media growth', connection(latest, 'social')));

    // 5. Website conversion.
    if (site.counting) {
      const visits = num(site.visits);
      out.push({
        key: 'site',
        title: 'Website conversion',
        state: 'measured',
        headline: `${plural(visits, 'visit', 'visits')} in ${n(site.days)} days`,
        lines: [visits > 0 ? `${of(site.storeClicks, visits)} tapped a store button; ${n(site.appOpens)} opened the web app.` : 'None yet since counting began.', 'Counted by the website itself, by day. No visitor is identified.'],
        spark: (site.byDay || []).map((d) => num(d.views)),
        trend: null,
      });
    } else out.push(waitingFor('site', 'Website conversion', connection(latest, 'site-visits')));

    // 6. Activated collectors.
    const a = now.activation || null;
    out.push(
      a
        ? { key: 'activated', title: 'Activated collectors', state: 'measured', headline: num(a.installs) > 0 ? `${of(a.activated, a.installs)} new installs added a first cigar` : 'No new installs in 7 days', lines: ['Installs of the last 7 days. Cigar Locker’s own count.'], spark: series(history, today('firstCigars')), trend: compare(history, today('firstCigars')) }
        : { key: 'activated', title: 'Activated collectors', state: 'waiting', headline: 'Not read yet', lines: ['The monitor has not saved its first figures.'], spark: null, trend: null },
    );

    // 7. Plus subscribers.
    const plus = f.plus || null;
    out.push(
      plus
        ? { key: 'plus', title: 'Plus subscribers', state: 'measured', headline: plural(plus.paying, 'paying subscriber', 'paying subscribers'), lines: [`${n(plus.renewing)} set to renew; ${n(plus.gifts)} given free; ${n(plus.lapsed30)} ended in 30 days.`, 'As the stores last told the server. A test purchase counts until it lapses.'], spark: null, trend: null }
        : { key: 'plus', title: 'Plus subscribers', state: 'waiting', headline: 'Not read yet', lines: ['The monitor has not saved its first figures.'], spark: null, trend: null },
    );

    // 8. Marketing revenue: only what follows from a measured count, and said to be before the stores' share.
    out.push(
      plus && has(now.priceCents)
        ? { key: 'revenue', title: 'Marketing revenue', state: 'measured', headline: `${money(num(plus.paying) * num(now.priceCents))} a month`, lines: ['Paying subscribers times the U.S. price, before the store’s share.', 'Not yet tied to the channel each subscriber came from: that needs website visits and store figures.'], spark: null, trend: null }
        : { key: 'revenue', title: 'Marketing revenue', state: 'waiting', headline: 'Not read yet', lines: ['The monitor has not saved its first figures.'], spark: null, trend: null },
    );

    // 9. Top campaigns: installs and visits that carried a campaign tag.
    const installs = f.launch && Array.isArray(f.launch.campaigns) ? f.launch.campaigns : [];
    const visits = Array.isArray(site.byCampaign) ? site.byCampaign : [];
    out.push(
      installs.length || visits.length
        ? { key: 'campaigns', title: 'Top campaigns', state: 'measured', headline: plural(installs.length + visits.length, 'campaign on record', 'campaigns on record'), lines: ['Listed below, by installs and by website visits.'], spark: null, trend: null }
        : { key: 'campaigns', title: 'Top campaigns', state: 'waiting', headline: 'None yet', lines: ['No install or website visit has carried a campaign tag. A link earns credit when it ends in utm_source and utm_campaign.'], spark: null, trend: null },
    );

    // 10. Competitors: the apps named in sampled answers.
    const rivals = Array.isArray(ai.competitors) ? ai.competitors : [];
    out.push(
      rivals.length
        ? { key: 'competitors', title: 'Competitor performance', state: 'measured', headline: `${rivals[0].name}: in ${of(rivals[0].answers, sampled)} answers`, lines: [`${plural(rivals.length, 'other app', 'other apps')} named in sampled answers. Listed below.`], spark: null, trend: null }
        : { key: 'competitors', title: 'Competitor performance', state: 'waiting', headline: 'Nothing sampled yet', lines: ['Other apps are counted from the AI answers sampled. None has been.'], spark: null, trend: null },
    );

    // 11 and 12. What to do, and what is wrong.
    const open = recs.filter((r) => r.status === 'proposed');
    const chances = findings.filter((x) => x.kind === 'opportunity');
    out.push({ key: 'opportunities', title: 'Opportunities', state: 'measured', headline: open.length ? plural(open.length, 'improvement proposed', 'improvements proposed') : 'Nothing proposed', lines: [chances.length ? chances[0].title : open.length ? `First: ${open[0].opportunity}.` : 'The monitor proposes one when it finds something measured to act on.'], spark: null, trend: null });
    const wrong = findings.filter((x) => x.kind === 'problem');
    const watch = findings.filter((x) => x.kind === 'watch');
    out.push({
      key: 'attention',
      title: 'Needs attention',
      state: 'measured',
      standing: wrong.length ? 'problem' : watch.length ? 'watch' : 'healthy',
      headline: wrong.length ? plural(wrong.length, 'problem', 'problems') : watch.length ? `${plural(watch.length, 'thing', 'things')} to look at` : 'Nothing',
      lines: [wrong.length ? wrong[0].title : watch.length ? watch[0].title : 'Nothing found at the last check.'],
      spark: null,
      trend: null,
    });
    return out;
  }

  /** The line under the heading: when the monitor last ran, and that it runs by itself. */
  function standing(intel) {
    if (!intel) return 'The Marketing section could not be read just now. Try Refresh.';
    const runs = Array.isArray(intel.runs) ? intel.runs : [];
    const scheduled = runs.filter((r) => r.trigger === 'schedule' && (r.outcome === 'ok' || r.outcome === 'partial'));
    if (intel.settings && intel.settings.monitor === 'off') return 'The hourly monitor is switched off. Nothing is being recorded.';
    if (!runs.length) return 'The monitor has not run yet. It runs each hour on the server, whether or not any computer of yours is on.';
    const last = runs[0];
    const said = last.outcome === 'ok' ? 'finished' : last.outcome === 'partial' ? 'finished with a part unread' : last.outcome === 'running' ? 'is running' : 'failed';
    return `Last run ${when(last.started_at)}, ${last.trigger === 'schedule' ? 'by the hourly schedule' : 'started by hand'}: it ${said}. ${scheduled.length ? `${plural(scheduled.length, 'scheduled run', 'scheduled runs')} among the last ${runs.length}.` : 'No scheduled run is on record yet.'}`;
  }

  /** The newest daily brief, or what stands in for one. */
  function brief(intel) {
    const all = intel && Array.isArray(intel.briefs) ? intel.briefs.filter((b) => b.kind === 'daily') : [];
    if (!all.length) return { day: '', sentences: ['No brief has been written yet. The first is written at the first check after six in the morning, Eastern.'] };
    return { day: day(all[0].day), sentences: Array.isArray(all[0].sentences) ? all[0].sentences : [] };
  }

  const KIND_WORDS = { problem: 'Problem', watch: 'Worth a look', opportunity: 'Opportunity', healthy: 'In order' };
  const APPROVAL = {
    none: 'Yours to do; nothing is published by it',
    'publish-website': 'Needs your word: it publishes the website',
    'app-store': 'Needs your word: it changes the App Store listing or release',
    'social-post': 'Needs your word: it posts publicly',
    email: 'Needs your word: it sends email',
    outreach: 'Needs your word: it contacts people outside',
    spend: 'Needs your word: it spends money',
    'public-claim': 'Needs your word: it makes a public claim',
    deploy: 'Needs your word: it changes the live app or server',
  };
  const EFFORT = { small: 'Small', medium: 'Medium', large: 'Large' };
  const PRIORITY = { 1: 'First', 2: 'Next', 3: 'Later' };
  const STATUS = { proposed: 'Proposed', approved: 'Approved', declined: 'Declined', done: 'Done' };

  function findings(intel) {
    const list = intel && Array.isArray(intel.findings) ? intel.findings : [];
    const order = { problem: 0, watch: 1, opportunity: 2, healthy: 3 };
    return list
      .filter((x) => x.status !== 'done')
      .sort((a, b) => order[a.kind] - order[b.kind] || String(b.found_at).localeCompare(String(a.found_at)))
      .map((x) => ({ id: x.id, kind: x.kind, kindWords: KIND_WORDS[x.kind] || x.kind, title: x.title, detail: x.detail || '', since: `Since ${when(x.found_at)}${num(x.times) > 1 ? `, seen at ${n(x.times)} checks` : ''}` }));
  }

  /** Each proposal with his seven headings, and the decisions open to him. */
  function recommendations(intel) {
    const list = intel && Array.isArray(intel.recommendations) ? intel.recommendations : [];
    return list.map((r) => ({
      id: r.id,
      status: r.status,
      head: `${PRIORITY[r.priority] || ''} · ${STATUS[r.status] || r.status}`,
      opportunity: r.opportunity,
      rows: [
        ['Supporting evidence', r.evidence],
        ['Expected benefit', r.benefit],
        ['Effort', EFFORT[r.effort] || r.effort],
        ['Recommended action', r.action],
        ['How success will be measured', r.measure],
        ['Before it happens', APPROVAL[r.approval] || r.approval],
        r.result ? ['What came of it', r.result] : null,
      ].filter(Boolean),
      // Approving records his decision. It carries nothing out: the publish, post or email is still asked for.
      actions: [
        { status: 'approved', label: 'Approve' },
        { status: 'declined', label: 'Decline' },
        { status: 'done', label: 'Mark as done' },
        { status: 'proposed', label: 'Back to proposed' },
      ].filter((a) => a.status !== r.status),
    }));
  }

  function aiRows(intel) {
    const list = intel && intel.ai && Array.isArray(intel.ai.latest) ? intel.ai.latest : [];
    return list.map((o) => ({
      when: when(o.at),
      platform: o.platform,
      method: o.method === 'measured_citation' ? 'Measured citation' : 'Sampled answer',
      question: o.question,
      us: o.mentioned ? (o.recommended ? `Recommended${o.position ? `, ${ordinal(o.position)}` : ''}` : 'Named, not recommended') : 'Not named',
      others: Array.isArray(o.competitors) ? o.competitors.slice(0, 6).join(', ') : '',
      cited: Array.isArray(o.citations) ? o.citations.length : 0,
    }));
  }
  const ordinal = (k) => `${k}${k % 10 === 1 && k % 100 !== 11 ? 'st' : k % 10 === 2 && k % 100 !== 12 ? 'nd' : k % 10 === 3 && k % 100 !== 13 ? 'rd' : 'th'}`;

  const BUCKETS = { ai: 'AI assistants', search: 'Search engines', social: 'Social', email: 'Email', direct: 'Typed in or bookmarked', other: 'Other sites' };

  function siteRows(intel) {
    const site = (intel && intel.site) || {};
    return {
      counting: site.counting === true,
      sources: (site.byBucket || []).map((b) => [BUCKETS[b.bucket] || b.bucket, n(b.views), n(b.storeClicks)]),
      pages: (site.byPage || []).slice(0, 12).map((p) => [p.path, n(p.views), n(p.storeClicks)]),
      referrers: (site.byReferrer || []).slice(0, 12).map((r) => [r.host, BUCKETS[r.bucket] || r.bucket, n(r.views)]),
      campaigns: (site.byCampaign || []).slice(0, 12).map((c) => [[c.source, c.medium, c.campaign].filter(Boolean).join(' / '), n(c.views), n(c.storeClicks)]),
      checks: (intel && Array.isArray(intel.siteChecks) ? intel.siteChecks : []).map((c) => [String(c.url).replace('https://cigarlocker.app', '') || '/', c.ok ? 'In order' : (c.problems || []).join('; ') || `answered ${c.status}`, has(c.ms) ? `${n(c.ms)} ms` : '']),
      checkedAt: intel && intel.siteChecks && intel.siteChecks[0] ? when(intel.siteChecks[0].at) : '',
    };
  }

  // Each public page's results side by side. A dash is "not measured" (its source is not connected); a 0 is a
  // measured nothing. The two are never mixed.
  const PAGE_HEAD = ['Page', 'In Google\u2019s index', 'Search views', 'Search clicks', 'Avg. position', 'Bing views', 'Bing clicks', 'Visits', 'From AI assistants', 'Cited in sampled answers', 'Store taps', 'Web app opens', 'Accounts', 'First cigar added', 'Plus bought'];
  function pages(intel) {
    const data = (intel && intel.pages) || {};
    const m = data.measured || {};
    const cell = (v) => (v === null || v === undefined ? '\u2014' : n(v));
    const rows = (data.pages || []).map((p) => [
      p.path === '/' ? 'Home page' : String(p.path).replace(/^\//, '').replace(/\.html$/, ''),
      p.indexed ? p.indexed : m.gsc ? 'Not reported' : '\u2014',
      cell(p.impressions), cell(p.clicks), p.position === null || p.position === undefined ? '\u2014' : String(p.position),
      cell(p.bingImpressions), cell(p.bingClicks), cell(p.visits), cell(p.fromAi), cell(p.citedInSamples), cell(p.storeClicks), cell(p.appOpens), cell(p.accounts), cell(p.firstCigars), cell(p.plus),
    ]);
    const missing = [];
    if (!m.gsc) missing.push('Google Search Console (index status, search views, clicks, position)');
    if (!m.bing) missing.push('Bing Webmaster Tools (Bing views and clicks)');
    if (!m.visits) missing.push('the website\u2019s visit counter (visits, visits from AI assistants, store taps, web app opens)');
    if (!m.ai) missing.push('the daily AI sample (pages cited in sampled answers)');
    return {
      head: PAGE_HEAD,
      rows,
      days: data.days || 28,
      note: missing.length ? `Not connected yet, so shown as a dash: ${missing.join('; ')}.` : 'Every source is connected.',
      limits: data.limits || '',
      empty: rows.length === 0 ? 'No page has a measurement yet. Each column fills in as its source is connected.' : '',
    };
  }

  function connections(intel) {
    const latest = intel && intel.latest;
    const list = latest && latest.sources && Array.isArray(latest.sources.connections) ? latest.sources.connections : [];
    return list.map((c) => ({ name: c.name, feeds: c.feeds, connected: c.status === 'connected', words: c.status === 'connected' ? 'Connected' : c.needs }));
  }

  function runs(intel) {
    const list = intel && Array.isArray(intel.runs) ? intel.runs : [];
    return list.slice(0, 12).map((r) => {
      const notes = r.notes || {};
      const bits = [has(notes.pagesChecked) ? `${n(notes.pagesChecked)} pages checked, ${n(notes.pagesWrong)} not in order` : notes.siteCheck || '', has(notes.findingsNew) && notes.findingsNew > 0 ? `${plural(notes.findingsNew, 'new finding', 'new findings')}` : '', notes.brief ? `brief for ${day(notes.brief)}` : '', Array.isArray(notes.failed) ? `could not read: ${notes.failed.join(', ')}` : '', notes.why || ''];
      return [when(r.started_at), r.trigger === 'schedule' ? 'The hourly schedule' : 'By hand', { ok: 'Finished', partial: 'Finished, a part unread', failed: 'Failed', running: 'Running', 'switched-off': 'Switched off' }[r.outcome] || r.outcome, bits.filter(Boolean).join(' · ')];
    });
  }

  function tokens(list) {
    return (Array.isArray(list) ? list : []).map((t) => ({
      id: t.id,
      name: t.name,
      live: !t.revokedAt,
      words: t.revokedAt ? `Ended ${when(t.revokedAt)}` : t.lastUsedAt ? `Last used ${when(t.lastUsedAt)} · ${plural(t.uses, 'read', 'reads')}` : `Made ${when(t.createdAt)} · never used`,
    }));
  }

  const TOKEN_HELP = 'A pass lets one outside AI agent read these marketing figures and nothing else: no member, no email address, no collection, and it can change nothing. It is shown once, here, when you make it. End it whenever you like.';

  const api = { panels, standing, brief, findings, recommendations, aiRows, siteRows, pages, PAGE_HEAD, connections, runs, tokens, compare, trendWords, of, WINDOWS, KIND_WORDS, APPROVAL, BUCKETS, TOKEN_HELP };
  root.CigarMarketing = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
