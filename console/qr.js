// Printed QR codes (2026-11-22, his words over the coasters and cards for Hank's counter: "can we build
// something in mission control to track hanks coaster"): the words and figures of the "Printed QR codes" card
// in the Marketing section, kept apart from the page so the app's tests can run them (test/console-qr.test.ts).
// The answer read here is the console function's `qr-codes`: console_qr_codes(days)
// (supabase/sql/158_qr_codes.sql), which only reads the website's own visit counter.
//
// A scan is a visit, never a person. A download is never tied to a code: Apple passes nothing on.

(function (root) {
  const whole = new Intl.NumberFormat('en-US');
  const dayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const DASH = '—';
  const has = (x) => typeof x === 'number' && Number.isFinite(x);
  const n = (x) => (has(x) ? whole.format(Math.round(x)) : DASH);
  const day = (iso) => {
    const t = Date.parse(`${iso}T00:00:00Z`);
    return Number.isFinite(t) ? dayFmt.format(t) : DASH;
  };
  /** "central_cigars" as a person reads it: "Central Cigars". Never anything but letters, digits and spaces. */
  const words = (tag) =>
    String(tag || '')
      .replace(/[^a-z0-9]+/gi, ' ')
      .trim()
      .replace(/\b[a-z]/g, (c) => c.toUpperCase());
  const what = (tag) => {
    const w = words(tag).toLowerCase();
    return w ? w.charAt(0).toUpperCase() + w.slice(1) : 'Not said';
  };

  const HEAD = 'Printed QR codes';
  const NONE = 'No printed code has been scanned yet. A scan shows here within a minute of someone opening the website from a code.';
  const LIMITS = [
    'A scan is one opening of the website from a printed code. The same phone scanning twice counts as two.',
    'A tap on the App Store button is counted. Whether that person then downloaded is not known: Apple passes nothing on.',
    'A browser set to ask not to be tracked is not counted, so the true number can be a little higher.',
    'Nobody is identified: no cookie, no name, no phone.',
  ];
  const CODE_HEAD = ['Where', 'Printed on', 'Today', 'Last 7 days', 'In this span', 'App Store taps', 'Ever', 'Last scan'];
  const DAY_HEAD = ['Day', 'Where', 'Printed on', 'Scans', 'App Store taps'];

  /** One line on how things stand, from figures read only. */
  function standing(board) {
    const codes = (board && board.codes) || [];
    if (!board) return 'The scans could not be read.';
    if (!codes.length) return NONE;
    const scans = codes.reduce((a, c) => a + (has(c.scans) ? c.scans : 0), 0);
    const taps = codes.reduce((a, c) => a + (has(c.storeTaps) ? c.storeTaps : 0), 0);
    const today = codes.reduce((a, c) => a + (has(c.scansToday) ? c.scansToday : 0), 0);
    const span = `the last ${n(board.days)} days`;
    return `${n(scans)} ${scans === 1 ? 'scan' : 'scans'} in ${span}, ${n(today)} today. ${n(taps)} ${taps === 1 ? 'tap' : 'taps'} on the App Store button from those visits.`;
  }

  function codeRows(board) {
    return ((board && board.codes) || []).map((c) => ({
      where: words(c.source) || 'Not said',
      on: what(c.campaign),
      cells: [n(c.scansToday), n(c.scansWeek), n(c.scans), n(c.storeTaps), n(c.scansEver), c.lastDay ? day(c.lastDay) : DASH],
    }));
  }

  function dayRows(board, most) {
    return ((board && board.byDay) || []).slice(0, most || 30).map((d) => ({ day: day(d.day), where: words(d.source) || 'Not said', on: what(d.campaign), cells: [n(d.scans), n(d.storeTaps)] }));
  }

  const api = { HEAD, NONE, LIMITS, CODE_HEAD, DAY_HEAD, DASH, words, what, standing, codeRows, dayRows };
  root.CigarQr = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
