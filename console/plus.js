// Cigar Locker Plus on a person's page, in the console's words (2026-11-11; his
// words: "would it be possible to be able to see someones profile from my
// console and turn on Plus for them for free?"). How a member has Plus (what
// they pay a store for, what was given free, or neither), the lengths a gift
// can be given for, and what is said before and after. The words and the
// arithmetic only, kept apart from the page so the app's tests can run them
// (test/console-plus.test.ts). The answer read here is console_member_plus's
// (supabase/sql/118_console_plus_gift.sql).

(function (root) {
  const ZONE = 'America/New_York';
  const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
  const dayFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: ZONE });
  const partsFmt = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

  /** A moment as its day in Massachusetts: "Dec 11, 2026"; '' when there is none. */
  function dayOf(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : dayFmt.format(d);
  }

  /** Today on the Massachusetts calendar: "2026-11-11". A gift's days are counted there, as the server counts them. */
  function today(now) {
    const parts = partsFmt.formatToParts(now || new Date());
    const get = (type) => parts.find((p) => p.type === type).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  }

  /** The same day of the month that many months on, or that month's last day when it is shorter (Jan 31 and a month is Feb 28). */
  function monthsOn(day, months) {
    const m = DAY.exec(day);
    if (!m) return '';
    const first = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + months, 1));
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    return `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(Number(m[3]), last)).padStart(2, '0')}`;
  }

  /** How long a gift can be given for. */
  const LENGTHS = [
    { key: '1m', label: 'For 1 month', months: 1 },
    { key: '3m', label: 'For 3 months', months: 3 },
    { key: '12m', label: 'For 1 year', months: 12 },
    { key: 'day', label: 'Until a day I choose' },
    { key: 'open', label: 'With no end date' },
  ];

  /** The longest his own note may be (the server cuts it there too). */
  const NOTE_MAX = 200;

  /**
   * What a choice asks the server for: { until } is the last day the gift is
   * good for, or null for no end date; { error } says what is missing.
   */
  function untilFor(key, picked, todayDay) {
    const length = LENGTHS.find((l) => l.key === key);
    if (!length || !DAY.test(todayDay || '')) return { error: 'Choose how long.' };
    if (length.months) return { until: monthsOn(todayDay, length.months) };
    if (key === 'open') return { until: null };
    if (!DAY.test(picked || '')) return { error: 'Choose the last day.' };
    if (picked < todayDay) return { error: 'The last day is today or later.' };
    if (picked > monthsOn(todayDay, 120)) return { error: 'Choose a day within ten years.' };
    return { until: picked };
  }

  /** A calendar day in words: "Dec 11, 2026". */
  function dayWords(day) {
    const m = DAY.exec(day || '');
    if (!m) return '';
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(
      new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))),
    );
  }

  /** Under the form, what the choice will do. */
  function meansWords(until) {
    return until
      ? `They have Plus through ${dayWords(until)}, then go back to the free plan by themselves.`
      : 'They have Plus until you end it here.';
  }

  const STORES = { apple: 'Apple', google: 'Google Play' };
  const storeOf = (provider) => STORES[provider] || 'a store';

  /** How long a gift runs: "through Dec 11, 2026", or "with no end date". */
  const lasts = (until) => (until ? `through ${dayOf(until)}` : 'with no end date');

  const TEST = ' A test purchase, not a real charge.';

  function paidLine(paid) {
    const store = storeOf(paid.provider);
    const day = dayOf(paid.expiresAt);
    const test = paid.environment === 'Sandbox' ? TEST : '';
    if (paid.status === 'grace') return `The last payment did not go through. ${store} is trying again, and Plus continues${day ? ` until ${day}` : ''} meanwhile.${test}`;
    if (paid.autoRenew === false) return `Cancelled: it ends ${day || 'at the end of what is paid for'}.${test}`;
    return `${day ? `Renews ${day}` : 'Renews by itself'}.${test}`;
  }

  function lapsedLine(paid) {
    const store = storeOf(paid.provider);
    const day = dayOf(paid.expiresAt);
    if (paid.status === 'billing-retry') return `Their payment to ${store} did not go through${day ? ` (${day})` : ''}, and ${store} is still trying.`;
    if (paid.status === 'revoked' || paid.status === 'refunded') return `Their subscription through ${store} was refunded or taken back${day ? `, ${day}` : ''}.`;
    return `They paid through ${store} before${day ? `; that ended ${day}` : ''}.`;
  }

  /**
   * A member's Plus as their page says it: a headline, the lines under it, a
   * warning when a gift would sit beside something they pay for, and what can
   * be done. Anything the answer lacks reads as not there; an answer that is
   * not 118's (it could not be read) offers nothing to press.
   */
  function standing(x) {
    if (!x || !Array.isArray(x.log)) {
      return { unread: true, on: false, headline: 'Plus could not be read just now', lines: ['Go back and open this person again in a minute.'], warn: '', canGive: false, canEnd: false };
    }
    const paid = x.paid && x.paid.active ? x.paid : null;
    const lapsed = x.paid && !x.paid.active ? x.paid : null;
    const gift = x.gift && x.gift.active ? x.gift : null;
    const ended = x.gift && !x.gift.active ? x.gift : null;
    const lines = [];
    let headline;
    let warn = '';
    if (x.owner) {
      headline = 'Plus, as the owner';
      lines.push('This is the owner’s own account. It is never counted against a limit, so there is nothing to give.');
      if (paid) lines.push(`Also paid through ${storeOf(paid.provider)}. ${paidLine(paid)}`);
    } else if (paid) {
      headline = `Plus, paid through ${storeOf(paid.provider)}`;
      lines.push(paidLine(paid));
      if (gift) lines.push(`Also given free by you, ${lasts(gift.until)}. It takes over when what they pay for ends.`);
      const store = storeOf(paid.provider);
      warn =
        paid.autoRenew === false
          ? 'What they pay for is already cancelled, so a gift simply carries on from the day it ends.'
          : `They already pay through ${store}, and a gift does not stop that: ${store} keeps charging them until they cancel it there. Their app goes on showing the paid subscription while it runs. If the gift is meant to replace it, tell them to cancel.`;
    } else if (gift) {
      headline = 'Plus, given free';
      lines.push(gift.until ? `Good through ${dayOf(gift.until)}.` : 'It has no end date.');
      const given = dayOf(gift.givenAt);
      if (given || gift.by) lines.push(`Given${given ? ` ${given}` : ''}${gift.by ? ` by ${byWords(gift.by)}` : ''}.`);
      if (gift.note) lines.push(`Your note: ${gift.note}`);
      if (lapsed) lines.push(lapsedLine(lapsed));
    } else {
      headline = 'No Plus: the free plan';
      if (lapsed) lines.push(lapsedLine(lapsed));
      if (ended) lines.push(`A gift from you ended ${dayOf(ended.until) || 'earlier'}.`);
      if (!lapsed && !ended) lines.push('They have never had Plus.');
    }
    return { unread: false, on: !!(x.owner || paid || gift), headline, lines, warn, canGive: !x.owner && !gift, canEnd: !x.owner && !!gift };
  }

  /** The same in one line, for the About list: "Yes, paid through Apple, renews Dec 1, 2026". */
  function line(x) {
    if (!x || !Array.isArray(x.log)) return 'Not read';
    const paid = x.paid && x.paid.active ? x.paid : null;
    const gift = x.gift && x.gift.active ? x.gift : null;
    if (x.owner) return 'Yes, as the owner';
    if (paid) {
      const day = dayOf(paid.expiresAt);
      const how = paid.autoRenew === false ? `, cancelled, ends ${day}` : day ? `, renews ${day}` : '';
      return `Yes, paid through ${storeOf(paid.provider)}${paid.environment === 'Sandbox' ? ' (a test purchase)' : ''}${how}${gift ? '; also given free' : ''}`;
    }
    if (gift) return `Yes, given free ${lasts(gift.until)}`;
    if (x.paid) return `No: ${lapsedLine(x.paid).replace(/\.$/, '')}`;
    if (x.gift) return 'No: a gift that has ended';
    return 'No';
  }

  /** Who did it, as the log names them: his email, or "by hand" for one made in the database itself. */
  const byWords = (by) => (by === 'sql' ? 'hand, in the database' : by);

  /** Asked before a gift is ended. */
  const END_QUESTION = (name) =>
    `End the free Plus for ${name}?\n\nThey go back to the free plan at once. Anything they pay a store for is not touched, and you can give it again at any time.`;

  /** Said once Plus was given, or its length changed; `plus` is the answer as it then stands. */
  function givenWords(name, plus, changed) {
    const until = plus && plus.gift ? plus.gift.until : null;
    if (changed) return `${name}’s free Plus now runs ${lasts(until)}.`;
    const paying = plus && plus.paid && plus.paid.active;
    return `Plus is on for ${name}, ${lasts(until)}. ${
      paying ? 'They already pay for Plus, so nothing changes for them until that ends.' : 'The limits are lifted at once, and their app says so the next time it is opened.'
    }`;
  }

  /** Said once a gift was ended. */
  function endedWords(name, plus) {
    const paying = plus && plus.paid && plus.paid.active;
    return paying ? `The gift has ended. ${name} still has Plus through ${storeOf(plus.paid.provider)}.` : `${name}’s free Plus has ended. They are on the free plan.`;
  }

  /** The log, newest first, a line each: "Nov 11, 2026 · Given through Dec 11, 2026 · by you@… · “a friend”". */
  function history(x) {
    const rows = x && Array.isArray(x.log) ? x.log : [];
    return rows.map((r) => {
      const what =
        r.action === 'ended' ? 'Ended' : r.action === 'changed' ? `Changed to run ${lasts(r.until)}` : `Given ${lasts(r.until)}`;
      return [dayOf(r.at), what, r.by ? `by ${byWords(r.by)}` : '', r.note ? `“${r.note}”` : ''].filter(Boolean).join(' · ');
    });
  }

  const api = { LENGTHS, NOTE_MAX, today, monthsOn, untilFor, dayOf, dayWords, meansWords, lasts, standing, line, END_QUESTION, givenWords, endedWords, history };
  root.CigarPlus = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
