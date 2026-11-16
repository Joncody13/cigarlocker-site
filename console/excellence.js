// Product Excellence in the console's words (2026-11-16; his directive: "Create a continuously maintained
// competitive product scorecard... Separate advertised features from independently tested features. Never invent
// competitive results... I want a weekly Product Excellence report identifying where Cigar Locker leads, where it
// trails, what evidence supports each finding, and what we are improving next."). The words and the sorting only,
// kept apart from the page so the app's tests can run them (test/excellence.test.ts). The answer read here is
// px_board's (supabase/sql/143_product_excellence.sql); the scorecard inside it is docs/excellence/scorecard.json
// as loaded.
//
// What it never does: judge another product. A rival's entry is what its own listing said ("Listed"), what its
// listing does not mention ("Not mentioned"), what no listing can show ("Not tested"), a product nobody has read
// yet ("Not read"), or a hands-on result somebody recorded ("Tested"). A figure that was not measured is a dash.

(function (root) {
  const whole = new Intl.NumberFormat('en-US');
  const n = (x) => whole.format(Math.round(Number(x) || 0));
  const plural = (v, one, many) => `${n(v)} ${Number(v) === 1 ? one : many || `${one}s`}`;
  const dayFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const longFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const day = (d) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d) ? new Date(`${d.slice(0, 10)}T12:00:00Z`) : null);
  const short = (d) => (day(d) ? dayFmt.format(day(d)) : '');
  const long = (d) => (day(d) ? longFmt.format(day(d)) : '');
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const arr = (v) => (Array.isArray(v) ? v : []);
  const known = (v) => typeof v === 'number' && Number.isFinite(v);
  const DASH = '—';

  const STANDING = { leads: 'Leads', even: 'Level', trails: 'Trails', unknown: 'Not known yet' };
  const ORDER = ['leads', 'even', 'trails', 'unknown'];
  /** What a rival's entry rests on, in a word. */
  const MARK = { listed: 'Listed', part: 'Listed in part', not: 'Not mentioned', untested: 'Not tested', unread: 'Not read', tested: 'Tested' };
  /** What one of our own entries rests on. */
  const OURS = { verified: 'Verified by us', measured: 'Measured in use', 'not-built': 'Not built' };
  const KIND = { ours: 'Ours', app: 'On the App Store', web: 'A website, not read yet', gone: 'Not on the U.S. App Store' };
  const FIELD = { version: 'A new version', price: 'Its price changed', store: 'In or out of the store', name: 'Its name changed', seller: 'Its seller changed', description: 'Its description was rewritten' };
  const OPP_KIND = { foundation: 'Foundation', scope: 'New scope', decision: 'His decision' };

  const LIMITS =
    'How to read it. What is said of another product is what its own App Store listing said on the day it was read: “Listed” means it says so, never that it works. “Not mentioned” means its listing is silent, never that the product cannot do it. Nothing of theirs counts as tested until someone has used it on a real iPhone and the result is recorded here. A product whose pages have not been read says so and is given no entry.';
  /** The count of scans saved after a change runs high today, and the page says why. */
  const CHANGE_NOTE = 'Saved after a change runs high today: it also counts a blank the collector filled in and what the look-up changed (to be put right in the app).';
  const ONE_COLLECTOR = 'So far these come from one collector’s phone and the test builds: a first reading, not a rate.';

  const doc = (x) => obj(obj(obj(x).scorecard).doc);
  const cats = (x) => arr(doc(x).categories);
  const apps = (x) => arr(doc(x).apps);
  const rivalsOf = (x) => apps(x).filter((a) => a.kind !== 'ours');
  const testsOf = (x) => arr(doc(x).tests);

  /** A share said honestly: under five it is “2 of 3”, never a percent. */
  function share(part, all) {
    if (!known(part) || !known(all)) return DASH;
    if (all === 0) return 'none yet';
    if (all < 5) return `${n(part)} of ${n(all)}`;
    return `${n(part)} of ${n(all)} (${Math.round((part / all) * 100)}%)`;
  }
  const count = (v, one, many) => (known(v) ? plural(v, one, many) : DASH);
  const seconds = (ms) => (known(ms) ? (ms >= 90_000 ? `${Math.round(ms / 6000) / 10} minutes` : `${Math.round(ms / 1000)} seconds`) : DASH);

  /** How many measures stand where. */
  function tally(x) {
    const ours = obj(doc(x).ours);
    const t = { leads: 0, even: 0, trails: 0, unknown: 0 };
    for (const c of cats(x)) {
      const s = obj(ours[c.key]).standing;
      t[ORDER.includes(s) ? s : 'unknown']++;
    }
    return t;
  }

  /** How much of what is said of the rivals rests on a listing, on silence, on nothing read, or on a test. */
  function basis(x) {
    const b = { listed: 0, silent: 0, unread: 0, untested: 0, tested: 0, all: 0 };
    const cells = obj(doc(x).cells);
    const tested = new Set(testsOf(x).filter((t) => t.app !== 'cigarlocker').map((t) => `${t.app}|${t.category}`));
    for (const a of rivalsOf(x)) {
      for (const c of cats(x)) {
        b.all++;
        const state = arr(obj(cells[a.key])[c.key])[0];
        if (tested.has(`${a.key}|${c.key}`)) b.tested++;
        else if (state === 'listed' || state === 'part') b.listed++;
        else if (state === 'unread') b.unread++;
        else if (state === 'untested') b.untested++;
        else b.silent++;
      }
    }
    return b;
  }

  /** The little block on Mission Control. Null when no scorecard is loaded. */
  function tiles(x) {
    if (!cats(x).length) return null;
    const t = tally(x);
    const b = basis(x);
    return [
      { label: 'Leads', value: n(t.leads), note: `of ${plural(cats(x).length, 'measure')}` },
      { label: 'Level', value: n(t.even), note: 'with the best listed elsewhere' },
      { label: 'Trails', value: n(t.trails), note: 'by what the others list' },
      { label: 'Not known yet', value: n(t.unknown), note: 'needs a side-by-side test' },
      { label: 'Rivals tested hands-on', value: `${n(b.tested)} of ${n(b.all)}`, note: b.tested ? 'entries rest on a recorded test' : 'every entry about them is from their listings' },
    ];
  }

  function summary(x) {
    const s = obj(obj(x).scorecard);
    if (!cats(x).length) return 'No scorecard is loaded yet.';
    return `Scorecard of ${long(s.version) || s.version || 'an unknown day'} · ${plural(rivalsOf(x).length, 'other product')} · listings read ${short(doc(x).listings_read_on) || 'on no day yet'}`;
  }

  /** Where Cigar Locker stands, measure by measure, with why and on what evidence. */
  function standings(x) {
    const ours = obj(doc(x).ours);
    return cats(x)
      .map((c) => {
        const o = obj(ours[c.key]);
        const standing = ORDER.includes(o.standing) ? o.standing : 'unknown';
        return { key: c.key, name: c.name, standing, word: STANDING[standing], rests: OURS[o.state] || 'Not said', words: o.words || '', why: o.why || '', evidence: arr(o.evidence) };
      })
      .sort((a, b) => ORDER.indexOf(a.standing) - ORDER.indexOf(b.standing));
  }

  /** The scorecard as a grid: a row a measure, a column a product, each entry with what it rests on. */
  function grid(x) {
    const cells = obj(doc(x).cells);
    const ours = obj(doc(x).ours);
    const tested = new Map(testsOf(x).map((t) => [`${t.app}|${t.category}`, t]));
    const columns = rivalsOf(x).map((a) => ({ key: a.key, name: a.name, kind: KIND[a.kind] || '', named: a.named_by_owner === true, note: a.note || '', url: a.url || '' }));
    const rows = cats(x).map((c) => {
      const o = obj(ours[c.key]);
      return {
        key: c.key,
        name: c.name,
        what: c.what || '',
        ours: { mark: OURS[o.state] || 'Not said', words: o.words || '' },
        cells: columns.map((a) => {
          const cell = arr(obj(cells[a.key])[c.key]);
          const t = tested.get(`${a.key}|${c.key}`);
          if (t) return { state: 'tested', mark: MARK.tested, words: `${t.words || ''} (${long(t.on)}, ${t.device || 'device not said'})` };
          const state = Object.hasOwn(MARK, cell[0]) ? cell[0] : 'unread';
          return { state, mark: MARK[state], words: typeof cell[1] === 'string' ? cell[1] : '' };
        }),
      };
    });
    return { columns, rows };
  }

  /** Cigar Locker's own measures over thirty days, each with what it is counted from. */
  function measures(x) {
    const m = obj(obj(x).measures);
    const s = obj(obj(obj(m.launch).spans).d30);
    const e = obj(m.errors);
    const v = obj(m.visits);
    const d = obj(m.duplicates);
    const c = obj(m.catalog);
    const g = obj(m.suggestions);
    const saved = known(s.scansConfirmed) && known(s.scansCorrected) ? s.scansConfirmed + s.scansCorrected : null;
    return [
      { label: 'Scans that named a cigar', value: share(s.scansNamed, s.scansCompleted), note: `${count(s.scansStarted, 'scan')} started, ${count(s.scansFailed, 'failure')}` },
      { label: 'Saved as the scan named it', value: share(s.scansConfirmed, saved), note: `${count(s.scansCorrected, 'scan')} saved after a change. ${CHANGE_NOTE}` },
      { label: 'Gave up and typed it', value: count(s.manualFallbacks, 'time'), note: 'after a scan that did not serve' },
      { label: 'Time to add a cigar', value: seconds(s.addMedianMs), note: 'the middle time from starting a scan to a saved cigar' },
      { label: 'Imports finished', value: share(s.importsCompleted, s.importsStarted), note: 'of imports started' },
      { label: 'Cigar records that repeat another', value: share(d.repeated, d.records), note: `letter for letter, across ${count(d.collections, 'collection')}. A nearer match (another spelling, a wrapper left blank) is judged on the phone and is not counted here` },
      { label: 'Error reports', value: count(e.reports, 'report'), note: `${count(e.fatal, 'crash', 'crashes')}, ${count(e.sync, 'report')} from backup or the database, in ${count(v.visits, 'visit')}` },
      { label: 'New accounts', value: count(s.accounts, 'account'), note: `${count(s.firstCigar, 'first cigar')} added, ${count(s.plusCompleted, 'Plus subscription')}` },
      { label: 'Suggestions from members', value: count(g.all, 'suggestion'), note: `${count(g.open, 'one', 'ones')} not yet read` },
      { label: 'Catalog', value: count(c.lines, 'line'), note: `${count(c.bands, 'band')}, ${count(c.questions, 'open question')}, ${known(c.codesNamed) && known(c.codes) ? `${n(c.codesNamed)} of ${n(c.codes)} barcodes named` : DASH}` },
    ];
  }

  /** What must be said beside our own measures: the scorecard's notes, then how few they come from. */
  function measureNotes(x) {
    return [...arr(doc(x).measure_notes).filter((t) => typeof t === 'string'), ONE_COLLECTOR].join(' ');
  }

  /** Each rival's store record as last read, with how its rating moved in a week. */
  function rivals(x) {
    const read = new Map(arr(obj(x).listings).map((l) => [l.app, l]));
    return rivalsOf(x).map((a) => {
      const l = read.get(a.key);
      if (!l) return { key: a.key, name: a.name, named: a.named_by_owner === true, status: a.kind === 'web' ? 'A website: not read yet' : a.kind === 'gone' ? 'Not on the U.S. App Store when last looked' : 'Not read yet', version: DASH, rating: DASH, moved: '', read: '', note: a.note || '' };
      if (l.ok !== true) return { key: a.key, name: a.name, named: a.named_by_owner === true, status: l.why || 'Not on the U.S. App Store', version: DASH, rating: DASH, moved: '', read: short(l.day), note: a.note || '' };
      const before = obj(l.week_ago);
      const moved = known(l.ratings) && known(before.ratings) ? (l.ratings === before.ratings ? 'no new ratings in a week' : `${l.ratings > before.ratings ? '+' : ''}${n(l.ratings - before.ratings)} ratings in a week`) : '';
      return {
        key: a.key,
        name: a.name,
        named: a.named_by_owner === true,
        status: 'On the U.S. App Store',
        version: l.version ? `${l.version}${l.released ? `, ${short(l.released)}` : ''}` : DASH,
        rating: known(l.rating) && known(l.ratings) && l.ratings > 0 ? `${l.rating} from ${plural(l.ratings, 'rating')}` : 'No ratings',
        moved,
        read: short(l.day),
        note: a.note || '',
      };
    });
  }

  /** What changed in their store records, newest first. */
  function changes(x) {
    const names = new Map(apps(x).map((a) => [a.key, a.name]));
    return arr(obj(x).changes).map((c) => ({ when: short(c.day), name: names.get(c.app) || c.app, what: FIELD[c.field] || c.field, was: c.was || '', now: c.now || '' }));
  }

  /** The improvements most likely to make a collector choose Cigar Locker, in order. */
  function opportunities(x) {
    return arr(doc(x).opportunities)
      .slice()
      .sort((a, b) => Number(a.rank) - Number(b.rank))
      .map((o) => ({ rank: Number(o.rank), title: o.title || '', kind: OPP_KIND[o.kind] || '', why: o.why || '', evidence: o.evidence || '', next: o.next || '', needs: o.needs || '', status: o.status || '' }));
  }

  /** Hands-on results on record, newest first. */
  function tests(x) {
    const names = new Map(apps(x).map((a) => [a.key, a.name]));
    const cat = new Map(cats(x).map((c) => [c.key, c.name]));
    return testsOf(x)
      .slice()
      .sort((a, b) => String(b.on).localeCompare(String(a.on)))
      .map((t) => ({ on: long(t.on), product: names.get(t.app) || t.app, measure: cat.get(t.category) || t.category, protocol: t.protocol || '', device: t.device || '', by: t.by || '', words: t.words || '', evidence: t.evidence || '' }));
  }

  function weeks(x) {
    return arr(obj(x).reports).map((r) => ({ week: r.week, label: `Week of ${short(r.week)}` }));
  }

  /** The weekly report in sentences, from the frozen facts and nothing else. */
  function report(r) {
    const d = obj(r);
    if (!d.week) return null;
    const line = (it) => ({ head: it.name, text: it.why || it.words || '', evidence: arr(it.evidence).join(' · ') });
    const section = (head, items, none) => ({ head, items: arr(items).map(line), none });
    const w = obj(d.week7);
    const m = obj(d.month30);
    const e = obj(d.errors);
    const v = obj(d.visits);
    const b = obj(d.basis);
    const saved = known(m.savedAsNamed) && known(m.savedAfterChange) ? m.savedAsNamed + m.savedAfterChange : null;
    const own = [
      `Scanning: ${share(m.scansNamed, m.scansCompleted)} scans named a cigar in the last 30 days (${count(w.scansStarted, 'scan')} this week). ${share(m.savedAsNamed, saved)} were saved as named. ${CHANGE_NOTE}`,
      `Speed: the middle time from starting a scan to a saved cigar was ${seconds(m.addMedianMs)}.`,
      `Imports: ${known(m.importsStarted) && m.importsStarted === 0 ? 'none was started, so import success is not measured yet' : `${share(m.importsCompleted, m.importsStarted)} finished`}.`,
      `Duplicates: ${share(obj(d.duplicates).repeated, obj(d.duplicates).records)} cigar records repeat another letter for letter. A nearer match is judged on the phone and is not counted here.`,
      `Reliability: ${count(e.reports, 'error report')}, ${count(e.fatal, 'crash', 'crashes')}, in ${count(v.visits, 'visit')} over 30 days.`,
      `Members: ${count(m.accounts, 'new account')}, ${count(m.firstCigar, 'first cigar')}, ${count(m.plusCompleted, 'Plus subscription')} in 30 days. ${count(obj(d.suggestions).all, 'suggestion')} from members on record.`,
      ...arr(d.notes).filter((t) => typeof t === 'string'),
      ONE_COLLECTOR,
    ];
    const total = (b.listed || 0) + (b.silent || 0) + (b.unread || 0);
    const evidence = [
      `Of ${plural(total, 'entry', 'entries')} about other products, ${n(b.listed)} rest on what their own listings say, ${n(b.silent)} are things their listings do not mention or cannot show, and ${n(b.unread)} belong to products not yet read.`,
      known(b.testedRivals) && b.testedRivals > 0 ? `${plural(b.testedRivals, 'entry rests', 'entries rest')} on a hands-on test of a rival.` : 'None rests on a hands-on test of a rival yet, so no lead here is proven against one.',
      `Cigar Locker’s own entries rest on its tests and its record of use${known(b.testedOurs) ? `, with ${plural(b.testedOurs, 'recorded run')}` : ''}.`,
    ];
    const moved = arr(d.changes).map((c) => `${c.name}: ${(FIELD[c.field] || c.field).toLowerCase()}${c.now ? `. ${c.now}` : ''}`);
    const read = arr(d.rivals).filter((x) => x.ok === true).length;
    const next = arr(d.next)
      .slice(0, 5)
      .map((o) => `${o.rank}. ${o.title} (${o.status}). ${o.next}`);
    return {
      title: `Week of ${short(d.week)} to ${long(d.through)}`,
      made: d.madeAt || '',
      leads: section('Where Cigar Locker leads', d.leads, 'Nowhere that the evidence supports yet.'),
      even: section('Where it is level', d.even, 'Nowhere.'),
      trails: section('Where it trails', d.trails, 'Nowhere that the listings show.'),
      unknown: section('What cannot be told yet', d.unknown, 'Nothing.'),
      evidence,
      own,
      moved: moved.length ? moved : [read ? 'Nothing changed in their store records this week.' : 'Their store records were not read this week.'],
      next: next.length ? next : ['No improvement is on the list.'],
    };
  }

  const api = { STANDING, MARK, OURS, KIND, FIELD, LIMITS, CHANGE_NOTE, ONE_COLLECTOR, DASH, share, seconds, tally, basis, tiles, summary, standings, grid, measures, measureNotes, rivals, changes, opportunities, tests, weeks, report };
  root.CigarExcellence = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
