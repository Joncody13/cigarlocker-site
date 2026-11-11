// What the launch build reports, in the console's words (2026-11-11; the
// launch report's "console page for errors, switches and the launch
// funnel"): errors from phones (104_app_errors.sql), the six switches
// (106_app_flags.sql) and the way in, scans and Plus (112_console_launch.sql).
// The figures and words only, kept apart from the page so the app's tests can
// run them (test/console-launch.test.ts). He is not a developer: every label
// is a plain word and every number says what it counts.

(function (root) {
  const whole = new Intl.NumberFormat('en-US');
  const n = (x) => whole.format(Math.round(Number(x) || 0));
  const plural = (count, one, many) => `${n(count)} ${Number(count) === 1 ? one : many || `${one}s`}`;

  // ---- the switches ---------------------------------------------------------

  /**
   * The six, as 106 and src/cloud/flags.ts name them (a test holds the lists
   * equal), each with what it is and what turning it off does.
   */
  const SWITCHES = [
    { name: 'places', title: 'Shops and lounges', stops: 'The shop and lounge finder, its map and its searches of new towns.' },
    { name: 'shelf_scan', title: 'Reading a shelf from a photo', stops: 'Adding or placing many cigars from one photo. Scanning one cigar or box carries on.' },
    { name: 'video_scan', title: 'Reading a video or a filmed row', stops: 'Film a row and Choose a video. Photos carry on.' },
    { name: 'suggestions', title: 'Suggestions', stops: 'Suggest One, pairings and trips. You may also like then chooses on the phone.' },
    { name: 'friends_live', title: 'Friends, live', stops: 'Only the live connection: what is new among friends still shows, up to a minute later.' },
    { name: 'background_fill', title: 'Filling in by itself', stops: 'Collecting look-ups, shop pictures and photo clean-up in the background. Nothing a member taps is stopped.' },
  ];

  /** What he is asked before one goes off. */
  const OFF_QUESTION = (s) => `Turn off “${s.title}” for everyone?\n\nMembers will see a short line saying this part is resting. Everything else carries on, and you can turn it back on here at any time.`;

  /** The switches as the server last gave them: on unless it said off outright. */
  function switchStates(flags) {
    return SWITCHES.map((s) => ({ ...s, on: !flags || flags[s.name] !== false }));
  }

  // ---- errors -----------------------------------------------------------------

  const AREAS = {
    crash: 'Stopped the app',
    render: 'A screen could not be drawn',
    database: 'The phone’s own database',
    api: 'Talking to the server',
    scan: 'Scanning',
    lookup: 'Looking up a cigar',
    pairing: 'Suggestions',
    sync: 'Backup',
    photo: 'Photos',
    auth: 'Signing in',
    plus: 'Cigar Locker Plus',
    import: 'Importing a collection',
    places: 'Shops and lounges',
    friends: 'Friends',
    other: 'Something else',
  };
  const areaWords = (area) => AREAS[area] || 'Something else';

  /** "Last day", "Last 7 days". */
  const spanWords = (days) => (Number(days) === 1 ? 'the last day' : `the last ${n(days)} days`);

  /** The totals over the card, or the plain line when there are none. */
  function errorTotals(e) {
    if (!e) return { none: true, line: 'The errors could not be read just now.' };
    if (!Number(e.reports)) return { none: true, line: `No errors reported in ${spanWords(e.days)}.` };
    return {
      none: false,
      line: `${plural(e.times, 'time')} in ${spanWords(e.days)}, on ${plural(e.installs, 'phone')}${Number(e.members) ? ` (${plural(e.members, 'member')} signed in)` : ''}.`,
      tiles: [
        { label: 'Times something went wrong', value: n(e.times), note: `In ${plural(e.reports, 'report')}; a report can count the same fault many times` },
        { label: 'Phones', value: n(e.installs), note: `${plural(e.members, 'member')} signed in` },
        { label: 'Stopped the app', value: n(e.fatal), note: Number(e.fatal) ? 'Reports where the app could not carry on' : 'None: every one was caught' },
        { label: 'Kinds of error', value: n((e.groups || []).length), note: 'Each is a row below, newest first' },
      ],
    };
  }

  /** Where the errors were, the most first: [{ area, words, times }]. */
  function byArea(e) {
    return Object.entries((e && e.byArea) || {})
      .map(([area, times]) => ({ area, words: areaWords(area), times: Number(times) || 0 }))
      .sort((a, b) => b.times - a.times || a.words.localeCompare(b.words));
  }

  /** A few plain details the code sent with a report, as "code: 42501 · where: friends_feed". */
  function extraWords(extra) {
    if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return '';
    return Object.entries(extra)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
      .join(' · ')
      .slice(0, 600);
  }

  /** The phone the newest report came from: "iPhone 16 Pro · iOS 26.1 · build 10 · update 01a1c7e4". */
  function phoneWords(latest) {
    if (!latest) return '';
    const system = latest.platform === 'ios' ? 'iOS' : latest.platform === 'android' ? 'Android' : latest.platform === 'web' ? 'The web version' : latest.platform || '';
    return [
      latest.model,
      [system, latest.os].filter(Boolean).join(' '),
      latest.build ? `build ${latest.build}` : latest.expoGo ? 'Expo Go' : '',
      latest.update ? `update ${String(latest.update).slice(0, 8)}` : latest.build ? 'as installed, no update' : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }

  /** One kind of error as its row reads. */
  function errorRow(g) {
    const latest = g.latest || {};
    return {
      area: areaWords(g.area),
      fatal: g.fatal === true,
      message: g.message || g.name || 'No message',
      name: g.name && g.name !== 'Error' && g.name !== g.message ? g.name : '',
      version: g.version ? `Version ${g.version}` : 'Version not known',
      times: `${plural(g.times, 'time')} on ${plural(g.installs, 'phone')}`,
      extra: extraWords(latest.extra),
      phone: phoneWords(latest),
      stack: latest.stack || '',
      firstSeen: g.firstSeen || null,
      lastSeen: g.lastSeen || null,
    };
  }

  // ---- the launch funnel --------------------------------------------------------

  /** "42 s", "1 min 05 s", "2 h 10 min"; a dash when there is none. */
  function duration(ms) {
    if (ms === null || ms === undefined || !Number.isFinite(Number(ms))) return '–';
    const s = Math.round(Number(ms) / 1000);
    if (s < 60) return `${s} s`;
    if (s < 3600) return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
    return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
  }

  /** A share as "25%"; a dash when there is nothing to take a share of. */
  function share(part, of) {
    const whole = Number(of) || 0;
    if (whole <= 0) return '–';
    const p = ((Number(part) || 0) / whole) * 100;
    return `${p > 0 && p < 1 ? '<1' : Math.round(p)}%`;
  }

  const SPANS = ['today', 'd7', 'd30'];
  const SPAN_HEADS = ['Today', '7 days', '30 days'];

  const SCAN_FAILS = {
    network: 'No connection',
    slow: 'The answer never came',
    unreadable: 'The answer could not be read',
    exception: 'A fault in the app',
    'member-limit': 'The member’s free scans were used up',
    limit: 'The day’s scans for everyone were used up',
    resting: 'Scanning was resting (the month’s AI allowance)',
    'sign-in': 'Not signed in',
    profile: 'Sign-up not finished',
    'auth-down': 'Sign-ins could not be checked',
    unknown: 'No reason given',
    other: 'Another reason',
  };
  const failWords = (code) => SCAN_FAILS[code] || String(code || 'No reason given');

  /**
   * The funnel as the page draws it: sections of rows, each row a label, what
   * it counts and its three figures (today, 7 days, 30 days) as words.
   */
  function funnel(launch) {
    if (!launch || !launch.spans) return null;
    const of = (span) => launch.spans[span] || {};
    const count = (key) => SPANS.map((sp) => n(of(sp)[key]));
    const row = (label, counts, cells) => ({ label, counts, cells });
    return [
      {
        title: 'The way in',
        note: 'Phones with the app, each counted once at each step.',
        rows: [
          row('Said they are 21 or older', 'installs', count('ageConfirmed')),
          row('Made an account', 'installs', count('accounts')),
          row('Made their first humidor', 'installs', count('firstHumidor')),
          row('Added their first cigar', 'installs', count('firstCigar')),
          row('Reached 5 cigars', 'installs', count('five')),
          row('Reached 25 cigars', 'installs', count('twentyFive')),
        ],
      },
      {
        title: 'Scanning',
        note: 'Each scan of one cigar or box counted; corrected means it was saved under another brand, line or size than the scan named.',
        rows: [
          row('Scans started', 'scans', count('scansStarted')),
          row('Phones that scanned', 'installs', count('scanInstalls')),
          row('Scans that came back', 'scans', count('scansCompleted')),
          row('… and named a cigar', 'scans', count('scansNamed')),
          row('Scans that failed', 'scans', count('scansFailed')),
          row('Saved as the scan named them', 'scans', count('scansConfirmed')),
          row('Saved after a correction', 'scans', count('scansCorrected')),
          row('Share corrected', 'of saved scans', SPANS.map((sp) => share(of(sp).scansCorrected, (Number(of(sp).scansConfirmed) || 0) + (Number(of(sp).scansCorrected) || 0)))),
          row('Gave up on the scan and typed or searched', 'times', count('manualFallbacks')),
          row('Whole shelves read', 'shelf reads', SPANS.map((sp) => `${n(of(sp).shelfCompleted)} of ${n(of(sp).shelfStarted)}`)),
          row('Time to add a purchase, the middle one', 'from opening Add to saved', SPANS.map((sp) => (Number(of(sp).adds) ? `${duration(of(sp).addMedianMs)} (of ${n(of(sp).adds)})` : '–'))),
        ],
      },
      {
        title: 'Coming back',
        note: 'How many times each was used.',
        rows: [
          row('Imports finished', 'of imports started', SPANS.map((sp) => `${n(of(sp).importsCompleted)} of ${n(of(sp).importsStarted)}`)),
          row('Journal entries', 'entries', count('journalEntries')),
          row('Suggest One', 'times', count('suggestOne')),
          row('Pairings', 'times', count('pairings')),
          row('Trips planned', 'times', count('trips')),
          row('Shops added', 'shops', count('shopsAdded')),
          row('Friends added', 'friendships', count('friendsAdded')),
        ],
      },
      {
        title: 'Cigar Locker Plus',
        note: 'The Plus page and what followed.',
        rows: [
          row('Looked at the Plus page', 'times', SPANS.map((sp) => `${n(of(sp).plusViews)} (${plural(of(sp).plusViewInstalls, 'phone')})`)),
          row('Tapped Subscribe', 'times', count('plusStarted')),
          row('Subscribed', 'purchases', count('plusCompleted')),
          row('Restored a subscription', 'times', count('plusRestores')),
        ],
      },
    ];
  }

  /** True while no launch event has ever arrived. */
  const nothingYet = (launch) => !launch || !launch.since;

  /** Why scans failed in the last 30 days, the commonest first. */
  function scanFailures(launch) {
    return ((launch && launch.scanFailures) || []).map((f) => ({ words: failWords(f.code), times: Number(f.times) || 0 }));
  }

  /** The campaigns table's rows: where installs came from, by the link's tags. */
  function campaignRows(launch) {
    return ((launch && launch.campaigns) || []).map((c) => [
      c.source || '–',
      c.medium || '–',
      c.campaign || '–',
      n(c.opens),
      n(c.ageConfirmed),
      n(c.accounts),
      n(c.firstCigars),
      n(c.plus),
    ]);
  }
  const CAMPAIGN_HEADS = ['Source', 'Medium', 'Campaign', 'Opened the app', 'Said 21+', 'Accounts', 'First cigars', 'Subscribed'];

  const api = {
    SWITCHES,
    OFF_QUESTION,
    switchStates,
    areaWords,
    spanWords,
    errorTotals,
    byArea,
    extraWords,
    phoneWords,
    errorRow,
    duration,
    share,
    SPAN_HEADS,
    failWords,
    funnel,
    nothingYet,
    scanFailures,
    campaignRows,
    CAMPAIGN_HEADS,
  };
  root.CigarLaunch = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
