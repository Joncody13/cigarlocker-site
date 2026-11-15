// Shops and lounges in the console's words (2026-11-15; his words: "a little block in mission control that says
// how many shops were added this week or how many shops we have on record... per day or per week, be able to
// filter it. Curious what people look up and where they were... what shops they were looking, what cities they
// explored, and who it was."). The words and the sorting only, kept apart from the page so the app's tests can
// run them (test/console-shops.test.ts). The answer read here is console_shop_activity's
// (supabase/sql/139_shop_activity.sql).
//
// What it never says, because the app does not keep it: where a member stood, or the town they typed. Their
// home town is the ZIP code they gave; the towns they explored are those of the places whose pages they opened.

(function (root) {
  const ZONE = 'America/New_York';
  const whole = new Intl.NumberFormat('en-US');
  const n = (x) => whole.format(Math.round(Number(x) || 0));
  const plural = (v, one, many) => `${n(v)} ${Number(v) === 1 ? one : many || `${one}s`}`;
  const whenFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: ZONE });
  const dayFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const longFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const day = (d) => new Date(`${d}T12:00:00Z`);

  const DAYS = [
    { days: 7, label: '7 days' },
    { days: 30, label: '30 days' },
    { days: 90, label: '90 days' },
    { days: 365, label: 'A year' },
  ];
  const BY = [
    { by: 'day', label: 'By day' },
    { by: 'week', label: 'By week' },
  ];
  const KINDS = [
    { kind: '', label: 'Shops and lounges' },
    { kind: 'shop', label: 'Shops only' },
    { kind: 'lounge', label: 'Lounges only' },
    { kind: 'both', label: 'Places that are both' },
  ];
  const KIND = { shop: 'Shop', lounge: 'Lounge', both: 'Shop and lounge' };
  // How a Places search was asked (114: the event keeps this and how many came back, never the words or the spot).
  const HOW = { zip: 'Their own ZIP code', typed: 'A town or ZIP code typed', spot: 'Near me' };
  const HOW_SHORT = { zip: 'by their own ZIP code', typed: 'by a town or ZIP code typed', spot: 'by Near me' };
  const LIMITS =
    'The app does not keep where a member stood, or the town they typed: a search is recorded only as how it was asked and how many places came back. Home is the ZIP code they gave. The towns a member explored are those of the places whose pages they opened.';

  function when(iso) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : whenFmt.format(d);
  }

  function place(city, state) {
    return [city, state].filter(Boolean).join(', ');
  }

  /** Who it was: their username and email, or that nobody was signed in. */
  function who(r) {
    if (!r.user_id) return r.install ? `Someone not signed in (phone ${r.install})` : 'Someone not signed in';
    return [r.username ? `@${r.username}` : '', r.email || ''].filter(Boolean).join(' · ') || 'A member';
  }

  /** What a person's page is opened with. */
  function person(r) {
    return r.user_id ? { id: r.user_id, email: r.email || '', username: r.username || '' } : null;
  }

  /** The little block on Mission Control: four figures, each with what it is set beside. */
  function tiles(x) {
    const t = x && x.totals;
    if (!t) return null;
    const kinds = [plural(t.shops, 'shop'), plural(t.lounges, 'lounge'), `${n(t.both)} both`].join(' · ');
    return [
      { label: 'Shops and lounges on record', value: n(t.places), note: `${kinds}, in ${plural(t.states, 'state')}` },
      { label: 'Listed this week', value: n(t.added7), note: `${n(t.addedToday)} today · ${n(t.addedBefore7)} the week before · ${n(t.added30)} in 30 days` },
      { label: 'Towns searched', value: n(t.towns), note: `${n(t.towns7)} this week · each town is searched once, for everyone` },
      { label: 'In members’ own lists', value: n(t.memberShops), note: `${plural(t.membersWithShops, 'member')} · ${n(t.memberShops7)} added this week` },
    ];
  }

  /** One sentence over the block, only from figures read. */
  function summary(x) {
    const t = x && x.totals;
    if (!t) return 'The shops could not be read just now.';
    if (!Number(t.places)) return 'No place is listed yet.';
    const first = t.firstDay ? `, the first on ${dayFmt.format(day(t.firstDay))}` : '';
    return `${n(t.places)} on record${first}. ${n(t.added7)} listed in the last 7 days.`;
  }

  /** The filters as words: "Lounges only in FL, the last 90 days, by week". */
  function asked(x) {
    const a = (x && x.asked) || {};
    const kind = (KINDS.find((k) => k.kind === (a.kind || '')) || KINDS[0]).label;
    const span = (DAYS.find((d) => d.days === a.days) || { label: `${a.days} days` }).label;
    return `${kind}${a.state ? ` in ${a.state}` : ''}, the last ${span.toLowerCase().replace(/^a /, '')}, ${a.by === 'week' ? 'by week' : 'by day'}`;
  }

  /** The chart's rows, oldest first, each with the words its bar says. */
  function series(x) {
    const a = (x && x.asked) || {};
    const week = a.by === 'week';
    const rows = (x && Array.isArray(x.added) ? x.added : []).map((r) => ({
      day: r.from,
      places: Number(r.places) || 0,
      towns: Number(r.towns) || 0,
      memberShops: Number(r.memberShops) || 0,
      label: week ? `Week of ${dayFmt.format(day(r.from))}` : dayFmt.format(day(r.from)),
      long: week ? `Week of ${longFmt.format(day(r.from))}` : longFmt.format(day(r.from)),
    }));
    return { week, rows, last: week ? 'This week' : 'Today', total: Number(x && x.addedInSpan) || 0, matching: Number(x && x.matching) || 0 };
  }

  /** The line under the chart. */
  function chartNote(x) {
    const s = series(x);
    const towns = s.rows.reduce((sum, r) => sum + r.towns, 0);
    return `${plural(s.total, 'place')} listed in this span, of ${n(s.matching)} that match · ${plural(towns, 'town')} searched for the first time`;
  }

  /** The numbers under the chart: only the days or weeks with something, newest first. */
  function numbers(x) {
    const s = series(x);
    return {
      heads: [s.week ? 'Week' : 'Day', 'Places listed', 'Towns searched', 'Added by members'],
      numeric: [1, 2, 3],
      rows: s.rows
        .filter((r) => r.places || r.towns || r.memberShops)
        .reverse()
        .map((r) => [r.long, n(r.places), n(r.towns), n(r.memberShops)]),
    };
  }

  function byTown(x) {
    return (x && Array.isArray(x.byTown) ? x.byTown : []).map((r) => [place(r.city, r.state) || 'No town given', Number(r.places) || 0]);
  }

  function townsSearched(x) {
    return {
      heads: ['Town', 'Searched', 'Places found'],
      numeric: [2],
      rows: (x && Array.isArray(x.townsSearched) ? x.townsSearched : []).map((r) => [place(r.town, r.state), r.day ? longFmt.format(day(r.day)) : '', n(r.found)]),
    };
  }

  /** A place's page opened: who, which place, in which town. */
  function looks(x) {
    return (x && Array.isArray(x.looks) ? x.looks : []).map((r) => ({
      when: when(r.at),
      who: who(r),
      person: person(r),
      home: place(r.home_city, r.home_state),
      what: r.name || 'A place',
      kind: KIND[r.kind] || '',
      where: place(r.city, r.state),
    }));
  }

  /** A Places search answered: who, how it was asked, how many came back. */
  function searches(x) {
    return (x && Array.isArray(x.searches) ? x.searches : []).map((r) => ({
      when: when(r.at),
      who: who(r),
      person: person(r),
      home: place(r.home_city, r.home_state),
      how: HOW[r.how] || 'Not said',
      found: r.found === null || r.found === undefined ? '' : plural(r.found, 'place'),
    }));
  }

  /** How the searches in the span were asked, as "5 Near me · 1 their own ZIP code". */
  function searchesHow(x) {
    const h = (x && x.searchesHow) || {};
    const parts = Object.keys(HOW_SHORT)
      .filter((k) => Number(h[k]) > 0)
      .map((k) => `${n(h[k])} ${HOW_SHORT[k]}`);
    return parts.length ? parts.join(' · ') : '';
  }

  /** A shop a member put in their own list. */
  function ownShops(x) {
    return (x && Array.isArray(x.ownShops) ? x.ownShops : []).map((r) => ({
      when: r.at ? when(r.at) : 'Day not known',
      who: who(r),
      person: person(r),
      what: r.name || 'A shop',
      where: place(r.city, r.state),
    }));
  }

  function top(list, name) {
    return (Array.isArray(list) ? list : []).map((r) => [name(r), `${plural(r.looks, 'look')} · ${plural(r.people, 'person', 'people')}`]);
  }
  const topPlaces = (x) => top(x && x.topPlaces, (r) => [r.name, place(r.city, r.state)].filter(Boolean).join(' · '));
  const topCities = (x) => top(x && x.topCities, (r) => place(r.city, r.state) || 'No town given');

  /** The choices for the "who" filter: everyone who appears in the span. */
  function people(x) {
    return (x && Array.isArray(x.people) ? x.people : []).map((p) => ({ id: p.user_id, label: [p.username ? `@${p.username}` : '', p.email || ''].filter(Boolean).join(' · ') || 'A member' }));
  }

  function states(x) {
    return (x && Array.isArray(x.stateChoices) ? x.stateChoices : []).map((s) => ({ state: s.state, label: `${s.state} (${n(s.places)})` }));
  }

  /** What stands in an empty list, said for what it is. */
  const EMPTY = {
    looks: 'No place’s page has been opened in this span.',
    searches: 'No Places search in this span.',
    ownShops: 'No shop was added to a member’s own list in this span.',
  };

  const api = { DAYS, BY, KINDS, KIND, HOW, LIMITS, EMPTY, tiles, summary, asked, series, chartNote, numbers, byTown, townsSearched, looks, searches, searchesHow, ownShops, topPlaces, topCities, people, states, who, when };
  root.CigarShops = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
