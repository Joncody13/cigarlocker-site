// The console's groups (2026-10-29, his words: "I want to really be able to
// nail people down and weed through people... split it up any way I want
// to"). Every way a member can be picked out, how each is matched and put
// into words, and the spreadsheet of a group. Kept apart from the page so
// the app's tests can run it (test/console-groups.test.ts).

(function (root) {
  const DAY = 86400000;
  const daysSince = (iso, now) => (iso ? Math.floor((now - Date.parse(iso)) / DAY) : null);
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const TIMES = ['Morning', 'Afternoon', 'Evening', 'Night'];
  const STRENGTHS = ['mild', 'mild-medium', 'medium', 'medium-full', 'full'];
  const strengthWords = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace('-', ' to ') : '');

  /** When they usually log a cigar they enjoyed: the part of the day with most, or null. */
  function usualTime(m) {
    const counts = [m.morning, m.afternoon, m.evening, m.night].map((x) => Number(x) || 0);
    const most = Math.max(...counts);
    return most > 0 ? TIMES[counts.indexOf(most)] : null;
  }

  function timesEnjoyed(m) {
    return TIMES.filter((t, i) => (Number([m.morning, m.afternoon, m.evening, m.night][i]) || 0) > 0);
  }

  function milesBetween(a, b) {
    const rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad;
    const dLon = (b.lon - a.lon) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  const yes = (v) => !!v;
  const dollars = (cents) => (cents == null ? null : Math.round(Number(cents) / 100));

  // type: range (min and max), choice (one of these), has (owns any of
  // these), text (contains), yesno, place (within miles of somewhere).
  // unit: what a range counts. options: fixed choices; otherwise the
  // choices are what members have.
  const FIELDS = [
    // Who they are
    { key: 'age', group: 'Who they are', label: 'Age', type: 'range', unit: 'years', get: (m) => m.age },
    { key: 'birthMonth', group: 'Who they are', label: 'Birthday month', type: 'choice', options: MONTHS, get: (m) => (m.birthMonth ? MONTHS[m.birthMonth - 1] : null) },
    { key: 'place', group: 'Who they are', label: 'Lives within', type: 'place' },
    { key: 'state', group: 'Who they are', label: 'State', type: 'choice', get: (m) => m.state || null },
    { key: 'city', group: 'Who they are', label: 'Town', type: 'text', get: (m) => m.city },
    { key: 'zip', group: 'Who they are', label: 'ZIP code starts with', type: 'text', starts: true, get: (m) => m.zip },
    { key: 'hasName', group: 'Who they are', label: 'Gave their name', type: 'yesno', get: (m) => yes(m.name) },
    { key: 'hasPhone', group: 'Who they are', label: 'Gave a phone number', type: 'yesno', get: (m) => yes(m.phone) },
    { key: 'hasAddress', group: 'Who they are', label: 'Gave a street address', type: 'yesno', get: (m) => yes(m.street) },
    { key: 'joinedDays', group: 'Who they are', label: 'Joined, days ago', type: 'range', unit: 'days', get: (m, c) => daysSince(m.joined, c.now) },
    { key: 'profile', group: 'Who they are', label: 'Finished signing up', type: 'yesno', get: (m) => yes(m.profile) },
    // Emails
    { key: 'news', group: 'Emails', label: 'Says yes to news', type: 'yesno', get: (m) => yes(m.news) },
    { key: 'offers', group: 'Emails', label: 'Says yes to offers', type: 'yesno', get: (m) => yes(m.offers) },
    { key: 'insights', group: 'Emails', label: 'Says yes to market insights', type: 'yesno', get: (m) => yes(m.insights) },
    { key: 'relay', group: 'Emails', label: 'Apple relay address', type: 'yesno', get: (m) => yes(m.relay) },
    { key: 'emailsReceived', group: 'Emails', label: 'Emails received', type: 'range', unit: 'emails', get: (m) => m.emailsReceived },
    { key: 'emailsOpened', group: 'Emails', label: 'Emails opened', type: 'range', unit: 'emails', get: (m) => m.emailsOpened },
    { key: 'emailsClicked', group: 'Emails', label: 'Emails tapped through', type: 'range', unit: 'emails', get: (m) => m.emailsClicked },
    // In the app
    { key: 'lastSeenDays', group: 'In the app', label: 'Last in the app, days ago', type: 'range', unit: 'days', get: (m, c) => daysSince(m.lastSeen, c.now) },
    { key: 'opens7', group: 'In the app', label: 'Opens, last 7 days', type: 'range', unit: 'opens', get: (m) => m.opens7 },
    { key: 'opens30', group: 'In the app', label: 'Opens, last 30 days', type: 'range', unit: 'opens', get: (m) => m.opens30 },
    { key: 'opensAll', group: 'In the app', label: 'Opens, ever', type: 'range', unit: 'opens', get: (m) => m.opensAll },
    { key: 'minutes7', group: 'In the app', label: 'Time in the app, last 7 days', type: 'range', unit: 'minutes', get: (m) => m.minutes7 },
    { key: 'minutes30', group: 'In the app', label: 'Time in the app, last 30 days', type: 'range', unit: 'minutes', get: (m) => m.minutes30 },
    { key: 'minutesAll', group: 'In the app', label: 'Time in the app, ever', type: 'range', unit: 'minutes', get: (m) => m.minutesAll },
    { key: 'days30', group: 'In the app', label: 'Days in the app, last 30', type: 'range', unit: 'days', get: (m) => m.days30 },
    { key: 'daysAll', group: 'In the app', label: 'Days in the app, ever', type: 'range', unit: 'days', get: (m) => m.daysAll },
    { key: 'scans30', group: 'In the app', label: 'Scans, last 30 days', type: 'range', unit: 'scans', get: (m) => m.scans30 },
    { key: 'scansAll', group: 'In the app', label: 'Scans, ever', type: 'range', unit: 'scans', get: (m) => m.scansAll },
    { key: 'lookups30', group: 'In the app', label: 'Look-ups, last 30 days', type: 'range', unit: 'look-ups', get: (m) => m.lookups30 },
    { key: 'suggestions30', group: 'In the app', label: 'Suggestions asked, last 30 days', type: 'range', unit: 'suggestions', get: (m) => m.suggestions30 },
    { key: 'platform', group: 'In the app', label: 'Phone', type: 'choice', get: (m) => m.platform || null },
    { key: 'onFriends', group: 'In the app', label: 'On Friends', type: 'yesno', get: (m) => yes(m.username) },
    { key: 'friends', group: 'In the app', label: 'Friends', type: 'range', unit: 'friends', get: (m) => m.friends },
    { key: 'posts', group: 'In the app', label: 'Posts', type: 'range', unit: 'posts', get: (m) => m.posts },
    // Their collection
    { key: 'cigarsNow', group: 'Their collection', label: 'Cigars on hand', type: 'range', unit: 'cigars', get: (m) => m.cigarsNow },
    { key: 'kindsNow', group: 'Their collection', label: 'Kinds on hand', type: 'range', unit: 'kinds', get: (m) => m.kindsNow },
    { key: 'value', group: 'Their collection', label: 'Collection worth', type: 'range', unit: 'dollars', get: (m) => dollars(m.valueCents) },
    { key: 'humidors', group: 'Their collection', label: 'Humidors', type: 'range', unit: 'humidors', get: (m) => m.humidors },
    { key: 'places', group: 'Their collection', label: 'Places with a humidor', type: 'range', unit: 'places', get: (m) => m.places },
    { key: 'sensors', group: 'Their collection', label: 'Humidity sensors', type: 'range', unit: 'sensors', get: (m) => m.sensors },
    { key: 'brands', group: 'Their collection', label: 'Keeps the brand', type: 'has', get: (m) => m.brands },
    { key: 'cigars', group: 'Their collection', label: 'Keeps a cigar named', type: 'text', get: (m) => (m.cigars || []).join(' | ') },
    { key: 'topBrand', group: 'Their collection', label: 'Brand they keep most', type: 'choice', get: (m) => m.topBrand || null },
    { key: 'shades', group: 'Their collection', label: 'Keeps the wrapper', type: 'has', get: (m) => m.shades },
    { key: 'shadeMost', group: 'Their collection', label: 'Wrapper they keep most', type: 'choice', get: (m) => m.shadeMost },
    { key: 'shadesLoved', group: 'Their collection', label: 'Loves the wrapper (rates it 8+)', type: 'has', get: (m) => m.shadesLoved },
    { key: 'shadeLoved', group: 'Their collection', label: 'Wrapper they rate highest', type: 'choice', get: (m) => m.shadeLoved },
    { key: 'strengths', group: 'Their collection', label: 'Keeps the strength', type: 'has', options: STRENGTHS, words: strengthWords, get: (m) => m.strengths },
    { key: 'strengthMost', group: 'Their collection', label: 'Strength they keep most', type: 'choice', options: STRENGTHS, words: strengthWords, get: (m) => m.strengthMost },
    { key: 'countries', group: 'Their collection', label: 'Keeps cigars from', type: 'has', get: (m) => m.countries },
    // Buying
    { key: 'spentYear', group: 'Buying', label: 'Spent this year', type: 'range', unit: 'dollars', get: (m) => dollars(m.spentYear) },
    { key: 'boughtYear', group: 'Buying', label: 'Cigars bought this year', type: 'range', unit: 'cigars', get: (m) => m.boughtYear },
    { key: 'spent12', group: 'Buying', label: 'Spent, last 12 months', type: 'range', unit: 'dollars', get: (m) => dollars(m.spent12) },
    { key: 'bought12', group: 'Buying', label: 'Cigars bought, last 12 months', type: 'range', unit: 'cigars', get: (m) => m.bought12 },
    { key: 'avgPaid', group: 'Buying', label: 'Pays per cigar, on average', type: 'range', unit: 'dollars', get: (m) => (m.avgPaidCents == null ? null : Math.round(m.avgPaidCents) / 100) },
    { key: 'paidPct', group: 'Buying', label: 'Pays, against retail', type: 'range', unit: '% of retail', get: (m) => m.paidPct },
    { key: 'purchases', group: 'Buying', label: 'Purchases', type: 'range', unit: 'purchases', get: (m) => m.purchases },
    { key: 'shops', group: 'Buying', label: 'Buys at', type: 'has', get: (m) => m.shops },
    { key: 'shopsUsed', group: 'Buying', label: 'Shops bought from', type: 'range', unit: 'shops', get: (m) => m.shopsUsed },
    { key: 'shipped', group: 'Buying', label: 'Purchases shipped', type: 'range', unit: 'purchases', get: (m) => m.shipped },
    { key: 'inPerson', group: 'Buying', label: 'Purchases in person', type: 'range', unit: 'purchases', get: (m) => m.inPerson },
    { key: 'lastBoughtDays', group: 'Buying', label: 'Last bought, days ago', type: 'range', unit: 'days', get: (m, c) => daysSince(m.lastBought, c.now) },
    // Enjoying
    { key: 'perWeek', group: 'Enjoying', label: 'Cigars a week (last 90 days)', type: 'range', unit: 'a week', get: (m) => m.perWeek },
    { key: 'enjoyed30', group: 'Enjoying', label: 'Cigars enjoyed, last 30 days', type: 'range', unit: 'cigars', get: (m) => m.enjoyed30 },
    { key: 'enjoyedAll', group: 'Enjoying', label: 'Cigars enjoyed, ever', type: 'range', unit: 'cigars', get: (m) => m.enjoyedAll },
    { key: 'perEnjoyDay', group: 'Enjoying', label: 'Cigars on a day they enjoy one', type: 'range', unit: 'a day', get: (m) => m.perEnjoyDay },
    { key: 'mostInADay', group: 'Enjoying', label: 'Most in one day', type: 'range', unit: 'cigars', get: (m) => m.mostInADay },
    { key: 'lastEnjoyedDays', group: 'Enjoying', label: 'Last enjoyed one, days ago', type: 'range', unit: 'days', get: (m, c) => daysSince(m.lastEnjoyed ? `${m.lastEnjoyed}T12:00:00Z` : null, c.now) },
    { key: 'usualTime', group: 'Enjoying', label: 'Usually enjoys one in the', type: 'choice', options: TIMES, get: usualTime },
    { key: 'timesEnjoyed', group: 'Enjoying', label: 'Has enjoyed one in the', type: 'has', options: TIMES, get: timesEnjoyed },
    { key: 'weekendShare', group: 'Enjoying', label: 'Share on weekends', type: 'range', unit: '%', get: (m) => (m.enjoyedAll ? Math.round((m.weekend / m.enjoyedAll) * 100) : null) },
    { key: 'rated', group: 'Enjoying', label: 'Cigars rated', type: 'range', unit: 'cigars', get: (m) => m.rated },
    { key: 'avgRating', group: 'Enjoying', label: 'Average rating', type: 'range', unit: 'of 10', get: (m) => (m.avgRating == null ? null : Number(m.avgRating)) },
    { key: 'loved', group: 'Enjoying', label: 'Cigars rated 8 or more', type: 'range', unit: 'cigars', get: (m) => m.loved },
    { key: 'gifted', group: 'Enjoying', label: 'Cigars given away', type: 'range', unit: 'cigars', get: (m) => m.gifted },
  ];

  const byKey = new Map(FIELDS.map((f) => [f.key, f]));

  const num = (v) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));

  /** Whether a member is in, for one filter. A filter not yet filled in lets everyone in. */
  function matches(m, filter, ctx) {
    const f = byKey.get(filter.field);
    if (!f) return true;
    if (f.type === 'place') {
      if (!filter.place || num(filter.miles) === null) return true;
      if (m.lat == null || m.lon == null) return false;
      return milesBetween(filter.place, m) <= num(filter.miles);
    }
    const v = f.get(m, ctx);
    switch (f.type) {
      case 'range': {
        const min = num(filter.min);
        const max = num(filter.max);
        if (min === null && max === null) return true;
        if (v === null || v === undefined) return false;
        return (min === null || v >= min) && (max === null || v <= max);
      }
      case 'choice':
        return !filter.values || filter.values.length === 0 || (v !== null && v !== undefined && filter.values.includes(String(v)));
      case 'has':
        return !filter.values || filter.values.length === 0 || (Array.isArray(v) && v.some((x) => filter.values.includes(String(x))));
      case 'text': {
        const t = (filter.text || '').trim().toLowerCase();
        if (!t) return true;
        const s = String(v || '').toLowerCase();
        return f.starts ? s.startsWith(t) : s.includes(t);
      }
      case 'yesno':
        return filter.yes === undefined || filter.yes === null || v === !!filter.yes;
      default:
        return true;
    }
  }

  function pick(list, filters, ctx) {
    return list.filter((m) => filters.every((filter) => matches(m, filter, ctx)));
  }

  /** The choices for a choice or has filter: its own, or every value members have, most common first. */
  function choicesFor(field, list, ctx) {
    const f = byKey.get(field);
    if (!f) return [];
    if (f.options) return f.options;
    const counts = new Map();
    for (const m of list) {
      const v = f.get(m, ctx);
      for (const x of Array.isArray(v) ? v : [v]) if (x !== null && x !== undefined && x !== '') counts.set(String(x), (counts.get(String(x)) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([x]) => x);
  }

  const unitWords = (f, v) => (f.unit === 'dollars' ? `$${Number(v).toLocaleString('en-US')}` : `${Number(v).toLocaleString('en-US')}`);

  /** A filter in words, or null while it is not filled in. */
  function describe(filter) {
    const f = byKey.get(filter.field);
    if (!f) return null;
    const words = f.words || ((x) => x);
    switch (f.type) {
      case 'place':
        return filter.place && num(filter.miles) !== null ? `within ${num(filter.miles)} miles of ${filter.place.name}` : null;
      case 'range': {
        const min = num(filter.min);
        const max = num(filter.max);
        const unit = f.unit && f.unit !== 'dollars' ? ` ${f.unit}` : '';
        if (min !== null && min === max) return `${f.label} ${unitWords(f, min)}${unit}`;
        if (min !== null && max !== null) return `${f.label} ${unitWords(f, min)} to ${unitWords(f, max)}${unit}`;
        if (min !== null) return `${f.label} ${unitWords(f, min)}${unit} or more`;
        if (max !== null) return `${f.label} ${unitWords(f, max)}${unit} or less`;
        return null;
      }
      case 'choice':
      case 'has':
        return filter.values && filter.values.length ? `${f.label}: ${filter.values.map(words).join(' or ')}` : null;
      case 'text':
        return (filter.text || '').trim() ? `${f.label} "${filter.text.trim()}"` : null;
      case 'yesno':
        return filter.yes === undefined || filter.yes === null ? null : `${f.label}: ${filter.yes ? 'yes' : 'no'}`;
      default:
        return null;
    }
  }

  function describeAll(filters) {
    const parts = filters.map(describe).filter(Boolean);
    return parts.length ? parts.join(' · ') : 'Everyone';
  }

  /** Members who would get an email of this kind. */
  function reachable(list, kind) {
    return list.filter((m) => m.profile && m.email && !m.blocked && (kind === 'news' ? m.news : m.offers));
  }

  /** A spreadsheet (CSV) of members; a cell that a spreadsheet would run as a formula is written as text. */
  function csv(list, columns, ctx) {
    const cell = (v) => {
      let s = v === null || v === undefined ? '' : Array.isArray(v) ? v.join('; ') : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [columns.map((c) => cell(c.label)).join(',')];
    for (const m of list) lines.push(columns.map((c) => cell(c.get(m, ctx))).join(','));
    return `﻿${lines.join('\r\n')}\r\n`;
  }

  // -- how well an email worked (2026-10-31, his words: "how many people
  // looked at the email how many people opened it how many people clicked on
  // the link and how many people put something in their cart at the link
  // site how many people bought something / And over all effectiveness of
  // the campaign / And conversion rate") ------------------------------------

  /** Part of a whole as a percentage, or null when there is no whole. */
  const share = (part, whole) => (whole > 0 ? (100 * (Number(part) || 0)) / whole : null);

  /**
   * An email's funnel (email_funnel) as rates. Rates are of the emails
   * delivered (else sent); buyers are the people traced to a purchase plus
   * the orders shops reported in totals (one buyer each, the best guess).
   */
  function emailRates(f) {
    const sent = Number(f.sent) || 0;
    const delivered = Number(f.delivered) || 0;
    const base = delivered || sent;
    const buyers = (Number(f.bought) || 0) + (Number(f.reportedOrders) || 0);
    const orders = Number(f.orders) || 0;
    const revenue = Number(f.revenueCents) || 0;
    return {
      base,
      buyers,
      delivery: share(delivered, sent),
      open: share(f.opened, base),
      click: share(f.clicked, base),
      clickToOpen: share(f.clicked, f.opened),
      cart: share(f.carted, f.clicked),
      conversion: share(buyers, base),
      clickConversion: share(buyers, f.clicked),
      revenuePerEmailCents: base ? revenue / base : null,
      averageOrderCents: orders ? revenue / orders : null,
      unsubscribe: share(f.unsubscribed, base),
    };
  }

  /** The average rates of several emails (members only, not tests), weighting each by its size. */
  function averageRates(funnels) {
    const total = { sent: 0, delivered: 0, opened: 0, clicked: 0, carted: 0, bought: 0, reportedOrders: 0, orders: 0, revenueCents: 0, unsubscribed: 0 };
    for (const f of funnels) for (const k of Object.keys(total)) total[k] += Number(f[k]) || 0;
    return emailRates(total);
  }

  /**
   * How an email did against his own average, in a word: the conversion
   * rate when anyone bought, else the click rate. Null with nothing to
   * compare (his first email, or one not yet delivered).
   */
  function verdict(rates, average, others) {
    if (!others || !rates.base) return null;
    const pick = (rates.conversion || average.conversion) ? 'conversion' : 'click';
    const mine = rates[pick] ?? 0;
    const usual = average[pick] ?? 0;
    if (!usual) return mine > 0 ? { word: 'Better than usual', measure: pick, mine, usual } : null;
    const ratio = mine / usual;
    const word = ratio >= 1.15 ? 'Better than usual' : ratio <= 0.85 ? 'Below usual' : 'About usual';
    return { word, measure: pick, mine, usual };
  }

  const api = { FIELDS, byKey, matches, pick, choicesFor, describe, describeAll, reachable, csv, usualTime, milesBetween, strengthWords, emailRates, averageRates, verdict };
  root.CigarGroups = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
