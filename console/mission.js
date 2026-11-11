// Cigar Locker's console: Mission Control's words and figures (2026-11-11; 116_mission_control.sql).
//
// His words: "the central command center and intelligence platform for the entire Cigar Locker business",
// "Create an automatically generated daily executive summary based only on real data", "Never invent
// insights", "Never present inferred information as verified fact", "Do not create dozens of identical
// statistic cards", "Protect small cohorts from re-identification".
//
// Nothing here touches the page: it turns what the console function answers into the sentences, figures and
// rows the page draws (console.js), so each rule can be tested. The rules it keeps:
//   - A sentence is written only from a figure the server sent. A part that could not be read is left out or
//     said to be unread; nothing is guessed, rounded up to a trend, or filled in.
//   - A share of fewer than five is said as "2 of 3", never as a percent.
//   - An alert has one of four standings: problem, watch, opportunity, healthy. "Worth your attention" is
//     the first three that are not healthy, the worst first; with none, it says so.
//   - A state with too few members shows that it has some and nothing else (the server sends nothing more).

(function (root) {
  'use strict';

  const whole = new Intl.NumberFormat('en-US');
  const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
  const n = (x) => whole.format(Math.round(num(x)));
  const plural = (count, one, many) => `${n(count)} ${Math.round(num(count)) === 1 ? one : many || `${one}s`}`;
  const money = (cents) => {
    const d = num(cents) / 100;
    return d >= 100 ? `$${whole.format(Math.round(d))}` : `$${d.toFixed(2)}`;
  };
  const sum = (a, from, to) => (Array.isArray(a) ? a.slice(from, to).reduce((t, v) => t + num(v), 0) : 0);
  const at = (a, i) => (Array.isArray(a) && i < a.length ? num(a[i]) : 0);
  const list = (words) => (words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`);

  /** Under this many, a share is said as "2 of 3": a percent of a handful misleads. */
  const SMALL = 5;

  /** "67%", or "2 of 3" for a handful, or null when there is nothing to take a share of. */
  function share(part, of) {
    part = num(part);
    of = num(of);
    if (of <= 0) return null;
    if (of < SMALL) return `${n(part)} of ${n(of)}`;
    return `${percent(part, of)}%`;
  }

  /** A whole percent that says 100 only when complete and 0 only when none. */
  function percent(part, of) {
    part = num(part);
    of = num(of);
    if (of <= 0) return 0;
    const p = Math.round((part / of) * 100);
    if (part >= of) return 100;
    if (part <= 0) return 0;
    return Math.min(99, Math.max(1, p));
  }

  /**
   * How a figure stands against the one before it. `good` is whether the change is welcome: up is good for
   * people in the app, bad for errors; null when it did not move.
   */
  function versus(now, before, words, upIsGood = true) {
    if (now === null || before === null) return null;
    const dir = now > before ? 'up' : now < before ? 'down' : 'flat';
    return { dir, good: dir === 'flat' ? null : (dir === 'up') === upIsGood, words };
  }

  /**
   * Today so far against a whole earlier day. Ahead already is welcome; behind is only "so far", since the
   * day is not over, and is never marked as bad news.
   */
  function versusSoFar(now, before, words) {
    const v = versus(now, before, words);
    return v && v.dir !== 'up' ? { ...v, good: null } : v;
  }

  const ratio = (part, of) => (num(of) > 0 ? num(part) / num(of) : null);

  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  /** "Wednesday, November 11" from the server's calendar day, wherever this computer is. */
  function dayWords(day) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
    if (!m) return '';
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
    return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  }

  const defaultClock = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).format(d);
  };

  // ---- the schedule -------------------------------------------------------------

  /** Each scheduled job in plain words. One not named here shows under its own name. */
  const JOB_WORDS = {
    'marketing-refresh': 'Members’ buying figures',
    'marketing-refresh-all': 'Buying figures, the nightly pass',
    'deals-watch': 'The run-out watch for deals',
    'console-refresh': 'This console’s People list',
    'console-refresh-all': 'The People list, the nightly pass',
    'email-worker': 'The email sender',
    'knowledge-ingest': 'Scans and searches kept as evidence; a saved scan’s facts put under the cigar it was saved as',
    'places-seed': 'Places: towns searched ahead',
    'plus-recheck': 'Plus: subscriptions checked again',
    'roll-up-usage': 'Visits rolled up by the day',
    'social-photos': 'Photos of removed posts cleared',
    'social-purge': 'Removed posts cleared for good',
    'app-errors-prune': 'Old error reports cleared',
    'own-sensors-prune': 'Old sensor readings cleared',
    'sensor-watch': 'Humidity alerts',
  };
  const jobName = (j) => JOB_WORDS[j.name] || j.name;

  /** Why a run failed, in a few plain words. */
  function failureWords(message) {
    const m = String(message || '');
    if (/statement timeout/i.test(m)) return 'It ran out of time.';
    if (/deadlock/i.test(m)) return 'It was blocked by another job.';
    if (/permission denied/i.test(m)) return 'It was refused permission.';
    const first = m.replace(/^ERROR:\s*/i, '').split('\n')[0].trim();
    return first ? `${first.slice(0, 120)}${first.length > 120 ? '…' : ''}` : '';
  }

  /** The schedule in a word: which jobs are failing now, how many runs failed in the last day, the slow ones. */
  function scheduleState(jobs) {
    if (!Array.isArray(jobs)) return null;
    const failingNow = jobs.filter((j) => j.lastStatus === 'failed');
    const failedRuns = jobs.reduce((t, j) => t + num(j.failed), 0);
    const failedJobs = jobs.filter((j) => num(j.failed) > 0);
    const lastFailedAt = failedJobs.map((j) => j.lastFailedAt).filter(Boolean).sort().pop() || null;
    // A job that needed over a minute came close to the two minutes it is allowed.
    const slow = jobs.filter((j) => num(j.maxSeconds) >= 60);
    return { total: jobs.length, failingNow, failedRuns, failedJobs, lastFailedAt, slow };
  }

  // ---- alerts: problem, watch, opportunity, healthy ------------------------------

  const STANDINGS = ['problem', 'watch', 'opportunity', 'healthy'];
  const STANDING_WORDS = { problem: 'Problem', watch: 'Watch', opportunity: 'Opportunity', healthy: 'Healthy' };
  // Never colour alone: each standing has its own mark beside its word.
  const STANDING_MARKS = { problem: '✕', watch: '!', opportunity: '◆', healthy: '✓' };

  /**
   * Every alert, the worst first. `x` is what the console holds: mission, jobs, queues, providers (the
   * mission answer's parts), totals and errors (the board's). Any part may be missing.
   */
  function alerts(x, opts) {
    const clock = (opts && opts.clock) || defaultClock;
    const out = [];
    const add = (standing, weight, area, title, detail, tab) => out.push({ standing, weight, area, title, detail: detail || '', tab });
    const m = x && x.mission;
    const s = (m && m.series) || {};
    const now = (m && m.now) || {};

    // The schedule.
    const sched = scheduleState(x && x.jobs);
    if (!sched) add('watch', 40, 'Scheduled work', 'The schedule could not be read just now', 'Nothing is known to be wrong; try Refresh.', 'health');
    else if (sched.failingNow.length) {
      add(
        'problem',
        100,
        'Scheduled work',
        sched.failingNow.length === 1 ? `${jobName(sched.failingNow[0])} failed on its last run` : `${n(sched.failingNow.length)} scheduled jobs failed on their last run`,
        [sched.failingNow.length > 1 ? `${list(sched.failingNow.map(jobName))}.` : '', failureWords(sched.failingNow[0].lastError)].filter(Boolean).join(' '),
        'health',
      );
    } else if (sched.failedRuns > 0) {
      add(
        'watch',
        60,
        'Scheduled work',
        `${plural(sched.failedRuns, 'scheduled run')} failed in the last day`,
        `${list(sched.failedJobs.map(jobName))}. Every job has run clean since${sched.lastFailedAt ? ` ${clock(sched.lastFailedAt)}` : ''}.`,
        'health',
      );
    } else {
      add('healthy', 0, 'Scheduled work', `All ${n(sched.total)} scheduled jobs ran clean in the last day`, '', 'health');
    }
    if (sched && !sched.failingNow.length) {
      const slowOnly = sched.slow.filter((j) => num(j.failed) === 0);
      if (slowOnly.length) {
        add('watch', 35, 'Scheduled work', `${jobName(slowOnly[0])} took ${n(slowOnly[0].maxSeconds)} seconds at its slowest`, 'A job is stopped at 120 seconds. Slow runs come before failed ones.', 'health');
      }
    }

    // What the app reported going wrong.
    if (m) {
      const crashesToday = at(s.crashes, 13);
      const crashes7 = sum(s.crashes, 7, 14);
      const errors7 = sum(s.errors, 7, 14);
      if (crashesToday > 0) add('problem', 90, 'The app', `The app stopped ${crashesToday === 1 ? 'once' : `${n(crashesToday)} times`} today`, 'Each one is on the Health page, with the phone it came from.', 'health');
      else if (crashes7 > 0) add('watch', 70, 'The app', `The app stopped ${crashes7 === 1 ? 'once' : `${n(crashes7)} times`} in 7 days`, 'None today.', 'health');
      else if (errors7 > 0) add('watch', 30, 'The app', `${plural(errors7, 'error')} reported by the app in 7 days`, `None stopped the app. ${at(s.errors, 13) ? `${n(at(s.errors, 13))} today.` : 'None today.'}`, 'health');
      else add('healthy', 0, 'The app', 'No errors reported by the app in 7 days', '', 'health');

      // The AI behind scans and look-ups.
      const ai7 = sum(s.aiCents, 7, 14);
      const aiBefore = sum(s.aiCents, 0, 7);
      if (now.resting) add('problem', 95, 'AI', 'Scans and look-ups are resting', `The month’s allowance at Anthropic is used up until ${String(now.resting).slice(0, 10)}. The rest of the app works.`, 'money');
      else if (ai7 >= 1000 && ai7 > aiBefore * 2) add('watch', 45, 'AI', `AI cost ${money(ai7)} in 7 days, up from ${money(aiBefore)}`, `${money(at(s.aiCents, 13))} so far today. An estimate from each answer’s size.`, 'money');
      else add('healthy', 0, 'AI', `AI cost ${money(ai7)} in 7 days`, '', 'money');

      // A part of the app switched off for everyone.
      const off = Array.isArray(now.flagsOff) ? now.flagsOff : [];
      if (off.length) add('watch', 65, 'Switches', `${plural(off.length, 'part')} of the app switched off for everyone`, `${off.join(', ')}. Turn it back on from Health once it is mended.`, 'health');
      else add('healthy', 0, 'Switches', 'Every part of the app is switched on', '', 'health');

      // Fewer new installs getting as far as a first cigar; fewer scans naming the cigar. Only with enough of each.
      const a = now.activation || {};
      const aNow = ratio(a.activated, a.installs);
      const aBefore = ratio(a.activatedBefore, a.installsBefore);
      if (num(a.installs) >= SMALL && num(a.installsBefore) >= SMALL && aNow !== null && aBefore !== null && aBefore - aNow >= 0.15) {
        add('watch', 55, 'Growth', `Fewer new installs are adding a first cigar: ${share(a.activated, a.installs)}, from ${share(a.activatedBefore, a.installsBefore)}`, 'The last 7 days of installs against the 7 before.', 'growth');
      }
      const scans7 = sum(s.scans, 7, 14);
      const scansBefore = sum(s.scans, 0, 7);
      const named = ratio(sum(s.scansNamed, 7, 14), scans7);
      const namedBefore = ratio(sum(s.scansNamed, 0, 7), scansBefore);
      if (scans7 >= 10 && scansBefore >= 10 && named !== null && namedBefore !== null && namedBefore - named >= 0.15) {
        add('watch', 58, 'Locker Vision', `Scans are naming fewer cigars: ${share(sum(s.scansNamed, 7, 14), scans7)}, from ${share(sum(s.scansNamed, 0, 7), scansBefore)}`, 'The last 7 days of scans against the 7 before.', 'knowledge');
      }

      // Codes nobody has named yet.
      if (num(now.unknownIdentifiers) > 0) {
        const most = now.identifierMostSeen;
        add('opportunity', 50, 'Knowledge', `${plural(now.unknownIdentifiers, 'unknown code')} waiting to be named`, most ? `The most seen: ${most.value} (${most.kind}), ${plural(most.seen, 'time')}.` : '', 'knowledge');
      }
    }

    // Members' reports of one another, waiting on him.
    const t = (x && x.totals) || {};
    if (num(t.openReports) > 0) add('watch', 80, 'Friends', `${plural(t.openReports, 'report')} from members waiting for you`, 'Reviewed in the app: Friends, Reports to review.', 'people');
    else if (x && x.totals) add('healthy', 0, 'Friends', 'No report from a member is waiting', '', 'people');

    // What the queues hold.
    const q = x && x.queues;
    if (q) {
      const repeated = ((q.corrections && q.corrections.rows) || []).find((r) => r.said && r.saved && r.said !== r.saved && num(r.times) >= 2);
      if (repeated) add('opportunity', 48, 'Locker Vision', `Scans named “${repeated.said}” were saved as “${repeated.saved}” ${n(repeated.times)} times`, 'A band the library should learn to tell apart.', 'knowledge');
      const searched = ((q.searchesWithoutMatch && q.searchesWithoutMatch.rows) || []).find((r) => r.words && (num(r.members) >= 2 || num(r.times) >= 3));
      if (searched) add('opportunity', 44, 'Knowledge', `“${searched.words}” was searched ${n(searched.times)} times and found nothing`, `By ${plural(searched.members, 'member')} in 30 days.`, 'knowledge');
      const held = q.heldNotInLibrary;
      if (held && num(held.count) > 0) {
        const top = (held.rows || [])[0];
        add(
          'opportunity',
          38,
          'Knowledge',
          `${plural(held.count, 'name')} in members’ humidors the library does not hold word for word`,
          top ? `First: ${[top.brand, top.line].filter(Boolean).join(' ')}. Each is a new line, or another spelling of one the library has.` : '',
          'knowledge',
        );
      }
      if (q.conflicts && num(q.conflicts.count) > 0) add('opportunity', 20, 'Knowledge', `${plural(q.conflicts.count, 'cigar')} where two sources disagree`, 'The library’s own reading is kept until one is checked.', 'knowledge');
    }

    // Connections that hold up money or mail.
    for (const p of (x && x.providers) || []) {
      if (p.key === 'apple-billing') {
        if (p.status !== 'connected') add('watch', 50, 'Revenue', 'Plus cannot be bought yet', p.words, 'health');
        else add('healthy', 0, 'Revenue', 'Plus can be bought on iPhone', '', 'money');
      }
      if (p.key === 'email') {
        if (p.status !== 'connected') add('watch', 25, 'Emails', 'No email can be sent yet', p.words, 'health');
        else add('healthy', 0, 'Emails', 'Email is connected', '', 'emails');
      }
    }

    return out.sort((p, r) => STANDINGS.indexOf(p.standing) - STANDINGS.indexOf(r.standing) || r.weight - p.weight);
  }

  /**
   * How each part stands, a line a part: its worst notice, and how many more it has. The parts come in the
   * order the notices do, so the worst is first.
   */
  function board(all) {
    const out = [];
    for (const a of all || []) {
      const row = out.find((r) => r.area === a.area);
      if (row) row.more += 1;
      else out.push({ area: a.area, standing: a.standing, title: a.title, detail: a.detail, tab: a.tab, more: 0 });
    }
    return out;
  }

  /** The three most pressing, never a healthy one. */
  const attention = (all) => (all || []).filter((a) => a.standing !== 'healthy').slice(0, 3);

  /** The whole platform in a word: the worst of its problems and watches. An opportunity is not ill health. */
  function overall(all) {
    const list = all || [];
    if (list.some((a) => a.standing === 'problem')) return 'problem';
    if (list.some((a) => a.standing === 'watch')) return 'watch';
    return 'healthy';
  }

  // ---- the figures along the top ---------------------------------------------------

  /**
   * The eight figures: each a value, what it is set against, and fourteen days of it for a small line.
   * Null when the front page's figures could not be read.
   */
  function metrics(mission, all) {
    if (!mission || !mission.series) return null;
    const s = mission.series;
    const now = mission.now || {};
    const out = [];

    const activeToday = at(s.active, 13);
    const activeWeekAgo = at(s.active, 6);
    out.push({
      key: 'active',
      label: 'In the app today',
      value: n(activeToday),
      note: 'People, or installs not signed in',
      change: versusSoFar(activeToday, activeWeekAgo, `${n(activeWeekAgo)} a week ago today, the whole day`),
      spark: s.active,
      tab: 'growth',
    });

    const installs7 = sum(s.installs, 7, 14);
    const installsBefore = sum(s.installs, 0, 7);
    out.push({
      key: 'installs',
      label: 'New installs, 7 days',
      value: n(installs7),
      note: `${n(sum(s.accounts, 7, 14))} made an account`,
      change: versus(installs7, installsBefore, `${n(installsBefore)} the 7 days before`),
      spark: s.installs,
      tab: 'growth',
    });

    const a = now.activation || {};
    const aNow = ratio(a.activated, a.installs);
    const aBefore = ratio(a.activatedBefore, a.installsBefore);
    out.push({
      key: 'activation',
      label: 'Activation, 7 days',
      value: share(a.activated, a.installs) || '–',
      note: num(a.installs) > 0 ? 'New installs that added a first cigar' : 'No new installs in 7 days',
      change: aNow !== null && aBefore !== null ? versus(aNow, aBefore, `${share(a.activatedBefore, a.installsBefore)} the 7 days before`) : null,
      spark: s.firstCigars,
      tab: 'growth',
    });

    const d7 = now.d7 || {};
    const backNow = ratio(d7.came, d7.cohort);
    const backBefore = ratio(d7.cameBefore, d7.cohortBefore);
    out.push({
      key: 'retention',
      label: 'Back after a week',
      value: share(d7.came, d7.cohort) || '–',
      note: num(d7.cohort) > 0 ? 'Accounts made 7 to 13 days ago, seen again a week on' : 'No accounts that old yet',
      change: backNow !== null && backBefore !== null ? versus(backNow, backBefore, `${share(d7.cameBefore, d7.cohortBefore)} of the week before them`) : null,
      spark: null,
      tab: 'growth',
    });

    const scans7 = sum(s.scans, 7, 14);
    const scansBefore = sum(s.scans, 0, 7);
    const named7 = sum(s.scansNamed, 7, 14);
    const namedNow = ratio(named7, scans7);
    const namedBefore = ratio(sum(s.scansNamed, 0, 7), scansBefore);
    out.push({
      key: 'vision',
      label: 'Locker Vision, 7 days',
      value: share(named7, scans7) || '–',
      note: scans7 > 0 ? `Named, of ${plural(scans7, 'scan')} · ${n(sum(s.scansCorrected, 7, 14))} corrected · ${n(sum(s.scansFailed, 7, 14))} failed` : 'No scans in 7 days',
      change: namedNow !== null && namedBefore !== null ? versus(namedNow, namedBefore, `${share(sum(s.scansNamed, 0, 7), scansBefore)} the 7 days before`) : null,
      spark: s.scans,
      tab: 'knowledge',
    });

    const learnedToday = at(s.learned, 13);
    out.push({
      key: 'learned',
      label: 'Learned today',
      value: n(learnedToday),
      note: `${n(sum(s.learned, 7, 14))} in 7 days: look-ups, bands, lines, shops, evidence`,
      change: versusSoFar(learnedToday, at(s.learned, 12), `${n(at(s.learned, 12))} yesterday, the whole day`),
      spark: s.learned,
      tab: 'knowledge',
    });

    const paying = num(now.plusPaying);
    const bought7 = sum(s.plusBought, 7, 14);
    const boughtBefore = sum(s.plusBought, 0, 7);
    out.push({
      key: 'plus',
      label: 'Plus, a month',
      value: money(paying * num(now.priceCents)),
      note: `${plural(paying, 'paying member')}, before the stores’ share`,
      change: bought7 || boughtBefore ? versus(bought7, boughtBefore, `${n(bought7)} bought in 7 days, ${n(boughtBefore)} the 7 before`) : null,
      spark: s.plusBought,
      tab: 'money',
    });

    const standing = overall(all);
    const crashes7 = sum(s.crashes, 7, 14);
    const errors7 = sum(s.errors, 7, 14);
    out.push({
      key: 'platform',
      label: 'Platform',
      value: STANDING_WORDS[standing],
      standing,
      note: `${crashes7 === 0 ? 'No crashes' : plural(crashes7, 'crash', 'crashes')} · ${plural(errors7, 'error')} in 7 days`,
      change: null,
      spark: s.errors,
      tab: 'health',
    });
    return out;
  }

  // ---- the day in a few sentences --------------------------------------------------

  const LEARNED_PARTS = [
    ['lookups', 'look-up'],
    ['bands', 'band'],
    ['lines', 'line'],
    ['shops', 'shop'],
    ['identifiers', 'code'],
    ['observations', 'piece of evidence', 'pieces of evidence'],
  ];

  /** The day so far, one true sentence at a time. Each is written only from a figure that was read. */
  function summary(x, opts) {
    const clock = (opts && opts.clock) || defaultClock;
    const m = x && x.mission;
    if (!m || !m.series) return ['The day’s figures could not be read just now.'];
    const s = m.series;
    const now = m.now || {};
    const out = [];

    const active = at(s.active, 13);
    const weekAgo = at(s.active, 6);
    out.push(active === 0 ? `Nobody has opened the app yet today (${n(weekAgo)} a week ago today).` : `${plural(active, 'person has', 'people have')} been in the app today, against ${n(weekAgo)} a week ago today.`);

    const installs7 = sum(s.installs, 7, 14);
    const accounts7 = sum(s.accounts, 7, 14);
    out.push(`${plural(installs7, 'new install')} in the last 7 days and ${n(sum(s.installs, 0, 7))} in the 7 before${installs7 ? `; ${accounts7 === 0 ? 'none' : n(accounts7)} made an account` : ''}.`);

    const scans7 = sum(s.scans, 7, 14);
    if (scans7 === 0) out.push('No cigar was scanned in the last 7 days.');
    else {
      const bits = [`${n(sum(s.scansNamed, 7, 14))} named`];
      if (sum(s.scansCorrected, 7, 14)) bits.push(`${n(sum(s.scansCorrected, 7, 14))} corrected by the member after`);
      if (sum(s.scansFailed, 7, 14)) bits.push(`${n(sum(s.scansFailed, 7, 14))} failed`);
      out.push(`${plural(scans7, 'scan')} in 7 days: ${list(bits)}.`);
    }

    const today = x.growth && x.growth.today;
    if (today) {
      const parts = LEARNED_PARTS.map(([key, one, many]) => [num(today[key]), one, many]).filter(([v]) => v > 0);
      const total = parts.reduce((t, [v]) => t + v, 0);
      out.push(total === 0 ? 'Nothing new has been learned yet today.' : `Cigar Locker learned ${plural(total, 'new thing')} today: ${list(parts.map(([v, one, many]) => plural(v, one, many)))}.`);
    } else if (at(s.learned, 13) > 0) {
      out.push(`Cigar Locker learned ${plural(at(s.learned, 13), 'new thing')} today.`);
    }

    const paying = num(now.plusPaying);
    out.push(paying === 0 ? 'Nobody is paying for Plus yet.' : `${plural(paying, 'member is', 'members are')} paying for Plus: ${money(paying * num(now.priceCents))} a month before the stores’ share.`);

    const sched = scheduleState(x.jobs);
    if (sched) {
      if (sched.failingNow.length) out.push(`${plural(sched.failingNow.length, 'scheduled job is', 'scheduled jobs are')} failing: ${list(sched.failingNow.map(jobName))}.`);
      else if (sched.failedRuns > 0) out.push(`${plural(sched.failedRuns, 'scheduled run')} failed in the last day; every job has run clean since${sched.lastFailedAt ? ` ${clock(sched.lastFailedAt)}` : ''}.`);
      else out.push('Every scheduled job ran clean in the last day.');
    }

    const errorsToday = at(s.errors, 13);
    const crashesToday = at(s.crashes, 13);
    if (crashesToday > 0) out.push(`The app stopped ${crashesToday === 1 ? 'once' : `${n(crashesToday)} times`} today.`);
    else if (errorsToday > 0) out.push(`The app reported ${plural(errorsToday, 'error')} today; none stopped it.`);
    return out;
  }

  // ---- what Cigar Locker knows ----------------------------------------------------

  /** How far a fact can be trusted, in the server's own seven words (116), each said plainly. */
  const STATES = ['VERIFIED', 'SUPPORTED', 'OBSERVED', 'USER_CONFIRMED', 'INFERRED', 'CONFLICTED', 'UNKNOWN'];
  const STATE_WORDS = {
    VERIFIED: ['Verified', 'The maker’s own word'],
    SUPPORTED: ['Supported', 'A reliable distributor, shop or catalogue'],
    OBSERVED: ['Observed', 'Seen plainly: a code in a photo, a page on the web'],
    USER_CONFIRMED: ['Confirmed by a member', 'A member saved it as named, or corrected it'],
    INFERRED: ['Inferred', 'A machine’s estimate, never shown as fact'],
    CONFLICTED: ['Conflicted', 'Two sources disagree'],
    UNKNOWN: ['Unknown', 'Kept, not yet placed'],
  };

  const LINE_FIELDS = [
    ['wrapper', 'Wrapper'],
    ['binder', 'Binder'],
    ['filler', 'Filler'],
    ['country', 'Country'],
    ['vitolas', 'The sizes it comes in'],
    ['dimensions', 'Sizes with a length and ring gauge'],
    ['band', 'A band it can recognise'],
    ['strength', 'Strength'],
    ['maker', 'Maker'],
    ['factory', 'Factory'],
    ['released', 'Release year'],
    ['msrp', 'Maker’s suggested price'],
    ['boxCount', 'Box count'],
  ];
  const PRODUCT_FIELDS = [
    ['length', 'Length'],
    ['ring', 'Ring gauge'],
    ['country', 'Country'],
    ['wrapper', 'Wrapper'],
    ['package', 'A package on record'],
    ['boxCount', 'Maker’s box count'],
    ['strength', 'Strength'],
    ['binder', 'Binder'],
    ['filler', 'Filler'],
    ['boxDimensions', 'Box measured'],
    ['layers', 'Layers in the box'],
    ['gtin', 'Barcode (UPC or EAN)'],
  ];

  const coverRows = (group, fields) =>
    fields.map(([key, label]) => {
      const have = num(group.have && group.have[key]);
      const of = num(group.of);
      return { key, label, have, of, missing: Math.max(0, of - have), pct: percent(have, of) };
    });

  /** How complete the catalogue is: each fact, how many have it, of how many. Null when unread. */
  function coverage(c) {
    if (!c || !c.lines || !c.products) return null;
    const t = c.totals || {};
    const states = c.states || {};
    return {
      totals: [
        ['Lines in the library', n(t.lines), `${n(t.sizes)} sizes among them`],
        ['Bands it can recognise', n(t.bands), ''],
        ['Cigars looked up in detail', n(t.lookups), ''],
        ['Makers’ listed sizes', n(t.products), `${n(t.packages)} packages · ${n(t.packageChecks)} checked against a real box`],
        ['Shops and lounges', n(t.shops), ''],
        ['Codes on record', n(t.identifiers), num(t.identifiersOpen) ? `${n(t.identifiersOpen)} not yet named` : 'UPC, EAN, SKU, QR'],
        ['Prices on record', n(t.priceObservations), 'Makers’ prices and listings; members’ purchases are counted apart'],
        ['Evidence kept', n(t.observations), 'Each with where it came from'],
      ],
      lines: coverRows(c.lines, LINE_FIELDS),
      products: coverRows(c.products, PRODUCT_FIELDS),
      linesOf: num(c.lines.of),
      productsOf: num(c.products.of),
      sources: c.sources
        ? [
            ['From two sources or more', n(c.sources.multi)],
            ['From one source only', n(c.sources.single)],
            ['Where sources disagree', n(num(c.sources.flagged) + num(c.sources.conflicts))],
          ]
        : [],
      states: STATES.map((key) => ({ key, name: STATE_WORDS[key][0], means: STATE_WORDS[key][1], count: num(states[key]) })),
      images: num(t.images),
    };
  }

  const GROWTH_ROWS = [
    ['lines', 'Lines in the library'],
    ['bands', 'Bands'],
    ['lookups', 'Cigars looked up'],
    ['products', 'Makers’ listed sizes'],
    ['packages', 'Packages'],
    ['packageChecks', 'Boxes checked'],
    ['shops', 'Shops and lounges'],
    ['identifiers', 'Codes first seen'],
    ['identifiersResolved', 'Codes named'],
    ['prices', 'Prices'],
    ['observations', 'Evidence kept'],
    ['confirmed', 'Confirmed by members'],
    ['corrections', 'Scans corrected'],
    ['verified', 'Verified by a maker'],
  ];
  const GROWTH_HEADS = ['', 'Today', '7 days', '30 days'];

  /** What was added today, in 7 days and in 30. Null when unread. */
  function growth(g) {
    if (!g || !g.today) return null;
    return GROWTH_ROWS.map(([key, label]) => ({ key, label, cells: [n(g.today[key]), n((g.d7 || {})[key]), n((g.d30 || {})[key])] }));
  }

  // ---- what scans taught (117) ---------------------------------------------------------------------------

  /** How much a scan leaves behind for the catalogue, the fullest first (117; LEARN_SETTINGS in gate.ts). */
  const LEARN_SETTINGS = ['all', 'reading', 'off'];
  const LEARN_WORDS = {
    all: ['Everything the photo shows', 'What the scan read, and a second look for boxes, codes, other cigars and accessories.'],
    reading: ['Only what the scan itself read', 'The band, the printed words and the shape. No second look, so nothing more is spent.'],
    off: ['Nothing', 'Scans answer as usual and leave nothing behind for the catalogue.'],
  };
  /** Asked before the setting is turned down: what will stop being kept. */
  const LEARN_QUESTION = (to) =>
    to === 'off'
      ? 'Stop learning from scans? Scans will answer as usual, and nothing more will be kept for the catalogue until this is turned on again. What is already kept stays.'
      : 'Keep only what the scan itself reads? Boxes, codes, other cigars and accessories in the photo will no longer be kept. What is already kept stays.';
  /** Each kind of fact a scan can leave, as he reads it (the fields learn.ts writes). */
  const FACT_WORDS = {
    band_look: 'The band, in words',
    printed_text: 'Words printed on the band or box',
    shape: 'Shape: pressed, pointed',
    wrapper_seen: 'Wrapper, by its colour',
    size_printed: 'A size printed on it',
    count_printed: 'A count printed on a box',
    looks_like: 'What it can be mistaken for',
    dress: 'How it is dressed: bands, cellophane, tube',
    band_serial: 'A serial number on a band',
    barcode_seen: 'A barcode seen but not read',
    qr_seen: 'A QR code seen',
    printed_number: 'A printed code number',
    package_seen: 'A box or case, described',
    seen_nearby: 'Another cigar in the photo',
    seen_on_shelf: 'A cigar or box on a shelf',
    accessory_seen: 'An accessory, with its maker',
  };
  const FACT_HEADS = ['What was learned', '7 days', '30 days', 'In all'];
  /** A sum in cents that may be a fraction of one: said in words then, never as "$0.00" for something spent. */
  const smallMoney = (cents) => (num(cents) <= 0 ? '$0.00' : num(cents) < 1 ? 'under a cent' : `about ${money(cents)}`);
  const named = (r) => [r.brand, r.line].filter(Boolean).join(' ');

  /**
   * What scans have taught, for the Knowledge part: a few sentences only from figures that were read, each
   * kind of fact over 7 and 30 days and in all, and what was read beside the scanned cigar. Null when unread.
   */
  function fromScans(f) {
    if (!f || !f.scans) return null;
    const setting = LEARN_SETTINGS.includes(f.setting) ? f.setting : 'all';
    const facts = Array.isArray(f.facts) ? f.facts : [];
    const total = facts.reduce((t, r) => t + num(r.all), 0);
    const scans = f.scans;
    const looks = f.looks || {};
    const tied = f.tied || {};
    const codes = f.codes || {};
    const says = [];
    if (setting === 'off') says.push('Learning from scans is off: scans answer as usual and nothing more is kept for the catalogue.');
    if (num(scans.all) === 0) {
      if (setting !== 'off') says.push('No scan has left anything yet. From here each one leaves what its photo showed, in words and numbers. The photo itself is still not kept.');
    } else {
      says.push(`${plural(scans.all, 'scan')} ${Math.round(num(scans.all)) === 1 ? 'has' : 'have'} left ${plural(total, 'fact')} for the catalogue (${plural(scans.d7, 'scan')} in the last 7 days). The photos themselves are not kept.`);
      if (num(tied.confirmed) + num(tied.corrected) + num(tied.waiting) > 0) {
        says.push(
          `Facts about the scanned cigar itself: ${n(tied.confirmed)} under a cigar saved as the scan named it, ${n(tied.corrected)} under one the member corrected, ${n(tied.waiting)} waiting for the scan to be saved. A fact that is waiting is one reading, not yet anyone’s word.`,
        );
      }
      if (num(codes.seen)) {
        const likely = num(codes.withLikely);
        says.push(`${plural(codes.seen, 'barcode')} read off photos${likely ? `; ${n(likely)} still unnamed ${Math.round(likely) === 1 ? 'has' : 'have'} a likely cigar` : ''}. They are in the list of codes below.`);
      }
    }
    if (num(looks.d30)) says.push(`The second looks cost ${smallMoney(looks.cents30)} in 30 days (${plural(looks.d30, 'look')}), beside the AI cost under Revenue and costs.`);
    return {
      setting,
      says,
      heads: FACT_HEADS,
      rows: facts.map((r) => [FACT_WORDS[r.field] || String(r.field || '').replace(/_/g, ' '), n(r.d7), n(r.d30), n(r.all)]),
      nearby: (Array.isArray(f.nearby) ? f.nearby : []).map((r) => [named(r), plural(r.times, 'time')]).filter((r) => r[0]),
      packages: (Array.isArray(f.packages) ? f.packages : []).map((r) => [named(r), String(r.kind || 'box'), plural(r.times, 'time')]).filter((r) => r[0]),
      accessories: (Array.isArray(f.accessories) ? f.accessories : []).map((r) => [String(r.maker || ''), String(r.kind || ''), plural(r.times, 'time')]).filter((r) => r[0]),
      cost: { looks30: num(looks.d30), words: smallMoney(looks.cents30) },
    };
  }

  const MISSING_WORDS = {
    releaseYear: 'lines with no release year',
    maker: 'lines with no maker named',
    strength: 'lines with no strength',
    band: 'lines with no band to recognise',
    vitolas: 'lines with no sizes',
    wrapper: 'lines with no wrapper',
    boxCount: 'makers’ sizes with no box count',
    boxDimensions: 'packages nobody has measured',
    upc: 'packages with no barcode',
  };

  const UNMATCHED_WORDS = { scan_unmatched: 'Named no cigar', scan_failed: 'Failed' };

  /**
   * The queues of what to research next. Each has a count, a line on what it is, and rows as text. The
   * unknown codes keep their own rows whole (`items`), for the page's form. Null when unread.
   */
  function queues(q, opts) {
    if (!q) return null;
    const when = (opts && opts.when) || ((iso) => String(iso || '').slice(0, 10));
    const sec = (key, title, note, empty, box, heads, row, numeric) => ({
      key,
      title,
      note,
      empty,
      count: num(box && box.count),
      heads,
      rows: ((box && box.rows) || []).map(row),
      numeric: numeric || [],
    });
    const codes = q.unknownIdentifiers || {};
    return {
      identifiers: {
        key: 'identifiers',
        title: 'Unknown codes',
        note: 'Every UPC, EAN, SKU or QR code seen that is not yet tied to a cigar or a box. None is ever thrown away.',
        empty: 'No code has been seen yet. The phones do not read barcodes today; a shop’s register, or a scan that catches a barcode, fills this.',
        count: num(codes.count),
        items: (codes.rows || []).map((r) => ({
          id: r.id,
          kind: String(r.kind || ''),
          value: String(r.value || ''),
          seen: n(r.seen),
          members: n(r.members),
          seenWords: `seen ${plural(r.seen, 'time')} by ${plural(r.members, 'member')}`,
          firstSeen: when(r.firstSeen),
          lastSeen: when(r.lastSeen),
          status: r.status === 'researching' ? 'Being looked into' : 'New',
          likely: r.likely && r.likely.name ? `Likely ${r.likely.name}${r.likely.why ? ` (${r.likely.why})` : ''}: a guess, not yet confirmed` : '',
        })),
      },
      sections: [
        sec(
          'corrections',
          'Scans members corrected',
          'What the scan said and what the member saved instead. A correction is kept, not written over.',
          'No scan has been corrected yet.',
          q.corrections,
          ['The scan said', 'Saved as', 'Times', 'Members', 'Last'],
          (r) => [r.said || '(no name)', r.saved && r.saved !== r.said ? r.saved : 'The same name; another detail was changed', n(r.times), n(r.members), when(r.last)],
          [2, 3],
        ),
        sec(
          'unmatched',
          'Scans that named nothing, 30 days',
          'A photo the scan could not put a name to, or that failed.',
          'Every scan in 30 days named a cigar.',
          q.unmatchedScans,
          ['What happened', 'Why', 'Times', 'Members', 'Last'],
          (r) => [UNMATCHED_WORDS[r.what] || r.what, r.why || '', n(r.times), n(r.members), when(r.last)],
          [2, 3],
        ),
        sec(
          'searches',
          'Searches that found nothing, 30 days',
          'What members typed that matched nothing.',
          'No search came up empty in 30 days.',
          q.searchesWithoutMatch,
          ['Typed', 'Times', 'Members', 'Last'],
          (r) => [r.words || '', n(r.times), n(r.members), when(r.last)],
          [1, 2],
        ),
        sec(
          'held',
          'In members’ humidors, not in the library by that name',
          'Either a line to add, or another way of writing one the library has: a name to learn as the same cigar.',
          'Every name in members’ humidors is in the library.',
          q.heldNotInLibrary,
          ['Maker', 'Line', 'Members', 'Kinds'],
          (r) => [r.brand || '', r.line || '(no line given)', n(r.members), n(r.kinds)],
          [2, 3],
        ),
        sec(
          'conflicts',
          'Where two sources disagree',
          'The library keeps its own reading until one of them is checked.',
          'No disagreement on record.',
          q.conflicts,
          ['Cigar', 'What differs'],
          (r) => [r.name || '', r.why || ''],
        ),
      ],
      fillFirst: {
        count: (q.fillFirst || []).length >= 25 ? '25+' : n((q.fillFirst || []).length),
        heads: ['Maker', 'Line', 'Members who hold it', 'Still lacks'],
        rows: (q.fillFirst || []).map((r) => [r.brand || '', r.line || '', n(r.members), (r.lacks || []).join(', ')]),
        numeric: [2],
      },
      missing: Object.entries(q.missing || {})
        .map(([key, count]) => ({ key, count: num(count), words: MISSING_WORDS[key] || key }))
        .filter((r) => r.count > 0)
        .sort((a, b) => b.count - a.count),
    };
  }

  // ---- the market by state ---------------------------------------------------------

  const STATE_HEADS = ['State', 'Members', 'Active, 30 days', 'Plus', 'Cigars on hand', 'Purchases, 12 mo', 'Spent, 12 mo', 'Journal entries, 90 days', 'Scans, 30 days', 'Brands kept most'];

  /**
   * States with enough members show their figures; the rest are only named, with the reason. Null when unread.
   * No town, ZIP code or address: a state is the smallest place on this page.
   */
  function byState(b) {
    if (!b || !Array.isArray(b.states)) return null;
    const shown = b.states.filter((r) => !r.small);
    const small = b.states.filter((r) => r.small).map((r) => r.state);
    return {
      min: num(b.min),
      heads: STATE_HEADS,
      numeric: [1, 2, 3, 4, 5, 6, 7, 8],
      rows: shown.map((r) => [r.state, n(r.members), n(r.active30), n(r.plus), n(r.cigars), n(r.purchases12), num(r.spend12) ? money(r.spend12) : '–', n(r.entries90), n(r.scans30), (r.brands || []).join(', ')]),
      small,
      smallWords: small.length ? `Fewer than ${n(b.min)} members, so no figures are shown: ${small.join(', ')}.` : '',
      unplaced: num(b.unplaced),
      unplacedWords: num(b.unplaced) ? `${plural(b.unplaced, 'member')} gave no ZIP code or state.` : '',
      empty: shown.length === 0 ? `No state has ${n(b.min)} members yet. Figures by state appear as each one passes that mark.` : '',
    };
  }

  const PRICE_SOURCES = {
    member_purchase: 'What members paid',
    maker: 'Makers’ suggested prices',
    public_listing: 'Shops’ public listings',
    campaign: 'An email campaign’s prices',
    deal: 'Deals from shops',
    shop_sheet: 'A shop’s own sheet',
    console: 'Entered here',
  };
  const PRICE_HEADS = ['Where it came from', 'Prices', 'Cigars', 'Shops', 'From', 'To'];

  /** The prices on record by where they came from: how many, and between which days. Never one "current price". */
  function prices(p) {
    if (!p || !Array.isArray(p.sources)) return null;
    return {
      total: num(p.total),
      heads: PRICE_HEADS,
      numeric: [1, 2, 3],
      rows: p.sources.map((r) => [PRICE_SOURCES[r.source] || r.source, n(r.observations), n(r.cigars), num(r.retailers) ? n(r.retailers) : '–', r.from || '', r.to || '']),
      note: 'A price is kept as an observation with its day and its source. A figure for a cigar is only fair with its count and its dates beside it.',
    };
  }

  /** How complete the record of shops is, as label and value pairs. Null when unread. */
  function shops(s) {
    if (!s) return null;
    const of = num(s.places);
    const part = (v) => (of ? `${n(v)} (${percent(v, of)}%)` : n(v));
    return [
      ['Shops and lounges listed', n(of)],
      ['Shops · lounges · both', `${n(s.shops)} · ${n(s.lounges)} · ${n(s.both)}`],
      ['States covered', n(s.states)],
      ['With a website', part(s.withWebsite)],
      ['With a logo', part(s.withLogo)],
      ['With a photo', part(s.withPhoto)],
      ['With a phone number', part(s.withPhone)],
      ['With opening hours', part(s.withHours)],
      ['Checked by a person', part(s.verified)],
      ['Recommended by a member', n(s.recommended)],
      ['Hidden (closed, a duplicate, or reported)', n(s.hidden)],
      ['Shop names members write on purchases', n(s.retailerNames)],
      ['Of those, tied to a listed place', n(s.retailersPlaced)],
    ];
  }

  // ---- the schedule and the connections, as rows -----------------------------------

  const JOB_HEADS = ['Job', 'Runs, last day', 'Failed', 'Slowest', 'Last ran', 'Standing'];

  function jobRows(jobs, opts) {
    if (!Array.isArray(jobs)) return null;
    const clock = (opts && opts.clock) || defaultClock;
    return jobs.map((j) => {
      const failing = j.lastStatus === 'failed';
      const standing = failing ? 'problem' : num(j.failed) > 0 || num(j.maxSeconds) >= 60 ? 'watch' : 'healthy';
      return {
        name: jobName(j),
        code: j.name,
        runs: n(j.runs),
        failed: n(j.failed),
        slowest: `${num(j.maxSeconds) < 10 ? num(j.maxSeconds).toFixed(1) : n(j.maxSeconds)} s`,
        last: j.lastAt ? clock(j.lastAt) : 'Not in the last day',
        standing,
        words: failing
          ? `Failing. ${failureWords(j.lastError)}`
          : num(j.failed) > 0
            ? `Clean now; last failed ${j.lastFailedAt ? clock(j.lastFailedAt) : 'in the last day'}. ${failureWords(j.lastError)}`
            : num(j.maxSeconds) >= 60
              ? 'Clean, but slow: stopped at 120 seconds.'
              : num(j.runs) === 0
                ? 'Has not been due in the last day.'
                : 'Clean.',
      };
    });
  }

  const PROVIDER_WORDS = { connected: 'Connected', 'not-configured': 'Not configured', connect: 'Connect', unavailable: 'Unavailable' };

  function providerRows(providers) {
    if (!Array.isArray(providers)) return null;
    return providers.map((p) => ({ key: p.key, name: p.name, feeds: p.feeds, status: p.status, standing: PROVIDER_WORDS[p.status] || 'Unavailable', words: p.words || '' }));
  }

  // ---- revenue and costs -----------------------------------------------------------

  /** Plus and the AI's cost as label, value, note. The stores' share is a range, not a guess at which applies. */
  function moneyFacts(mission, scans) {
    if (!mission || !mission.series) return null;
    const s = mission.series;
    const now = mission.now || {};
    const gross = num(now.plusPaying) * num(now.priceCents);
    const views7 = sum(s.plusViews, 7, 14);
    const bought7 = sum(s.plusBought, 7, 14);
    return [
      ['Plus, a month', money(gross), `${plural(now.plusPaying, 'paying member')} at ${money(now.priceCents)}`],
      ['After the stores’ share', gross ? `${money(gross * 0.7)} to ${money(gross * 0.85)}` : money(0), 'Apple and Google keep 15% to 30%'],
      ['Members with Plus', n(now.plusMembers), `${n(Math.max(0, num(now.plusMembers) - num(now.plusPaying)))} given, not paid for`],
      ['Plus page seen, 7 days', n(views7), views7 ? `${share(bought7, views7)} went on to buy` : 'Nobody opened it'],
      ['AI cost today', money(at(s.aiCents, 13)), 'An estimate from each answer’s size'],
      ['AI cost, 7 days', money(sum(s.aiCents, 7, 14)), `${money(sum(s.aiCents, 0, 7))} the 7 days before`],
      ['AI cost, 14 days', money(sum(s.aiCents, 0, 14)), 'Scans, look-ups, suggestions and towns searched ahead'],
      // The second looks that learn from scans run on the small model and are counted apart (117): said
      // beside the rest, never folded in unseen. Left out when that part could not be read.
      ...(scans && scans.looks ? [['Learning from scans, 30 days', smallMoney(scans.looks.cents30), `${plural(scans.looks.d30, 'second look')}, not in the figures above`]] : []),
    ];
  }

  /** Fourteen days of one figure as the bar chart wants them: a day and its value. */
  function daily(mission, key) {
    const s = (mission && mission.series) || {};
    return (s.days || []).map((day, i) => ({ day, [key]: at(s[key], i) }));
  }

  // ---- a small line ----------------------------------------------------------------

  /**
   * Fourteen days as a small line: the path, the area under it and where today sits. All-zero is a flat line
   * along the foot. Null with fewer than two points.
   */
  function spark(values, w, h) {
    if (!Array.isArray(values) || values.length < 2) return null;
    const v = values.map(num);
    const top = Math.max(...v);
    const pad = 2;
    const x = (i) => pad + (i * (w - pad * 2)) / (v.length - 1);
    const y = (val) => (top <= 0 ? h - pad : pad + (h - pad * 2) * (1 - val / top));
    const pts = v.map((val, i) => [Math.round(x(i) * 10) / 10, Math.round(y(val) * 10) / 10]);
    const line = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px},${py}`).join('');
    return { line, area: `${line}L${pts[pts.length - 1][0]},${h}L${pts[0][0]},${h}Z`, last: { x: pts[pts.length - 1][0], y: pts[pts.length - 1][1] }, flat: top <= 0 };
  }

  const api = {
    SMALL,
    STANDINGS,
    STANDING_WORDS,
    STANDING_MARKS,
    STATES,
    STATE_WORDS,
    JOB_WORDS,
    JOB_HEADS,
    GROWTH_HEADS,
    PROVIDER_WORDS,
    LEARN_SETTINGS,
    LEARN_WORDS,
    LEARN_QUESTION,
    FACT_WORDS,
    fromScans,
    share,
    percent,
    dayWords,
    alerts,
    attention,
    board,
    overall,
    metrics,
    summary,
    coverage,
    growth,
    queues,
    byState,
    prices,
    shops,
    jobRows,
    providerRows,
    moneyFacts,
    daily,
    spark,
  };
  root.CigarMission = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
