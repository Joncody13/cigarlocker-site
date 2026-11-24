// Paying shops per download (2026-11-24, his words: "i am going to be paying hank and cigar cave per download",
// then "set up the mission control properly so i can put a number in there ... and it will calculate it for me").
// The words and figures of the "Shop payouts" card in the Marketing section, kept apart from the page so the app's
// tests can run them (test/console-payouts.test.ts). The answer is the console function's `shop-downloads`:
// console_shop_downloads(months) (supabase/sql/165_shop_payouts.sql).
//
// A download here is one new install whose owner answered "Did you scan our code at a shop?" with that shop.

(function (root) {
  const whole = new Intl.NumberFormat('en-US');
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const monthFmt = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const dayFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const DASH = '—';
  const has = (x) => typeof x === 'number' && Number.isFinite(x);
  const n = (x) => (has(x) ? whole.format(Math.round(x)) : DASH);
  const usd = (cents) => (has(cents) ? money.format(cents / 100) : DASH);
  const month = (iso) => {
    const t = Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);
    return Number.isFinite(t) ? monthFmt.format(t) : DASH;
  };
  const day = (iso) => {
    const t = Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);
    return Number.isFinite(t) ? dayFmt.format(t) : DASH;
  };

  const LIMITS = [
    'A download is a new install whose owner said they scanned a code at a shop and typed that shop’s name (no list of shops is ever shown). It is a real phone that opened the app, never a scan or a tap.',
    'Someone who skips the question is not counted, so the true number can be a little higher, never lower.',
    'Each download is paid at the rate in force on its day. Changing a rate never changes what is already owed.',
    'Nobody is named: counts only.',
  ];
  const MONTH_HEAD = ['Month', 'Downloads', 'Owed', 'Made an account', 'Added a cigar', 'Bought Plus'];

  /** "$2.00 a download, since Nov 24, 2026", or that no rate is set. */
  function rateWords(shop) {
    if (!shop || !has(shop.rateCents)) return 'No rate set yet: downloads are counted, nothing is owed.';
    return `${usd(shop.rateCents)} a download, since ${day(shop.rateFrom)}`;
  }

  /** Dollars as typed ("2", "$2.50", "2.5") to cents; null when it is not an amount. */
  function readRate(text) {
    const t = String(text || '').trim().replace(/^\$/, '').replace(/,/g, '');
    if (!/^\d{1,4}(\.\d{1,2})?$/.test(t)) return null;
    const cents = Math.round(Number(t) * 100);
    return cents >= 0 && cents <= 100000 ? cents : null;
  }

  /** The month just past and this month, owed, for the card's top line. */
  function owedNow(board, today) {
    const shops = (board && board.shops) || [];
    const thisMonth = String(today || (board && board.today) || '').slice(0, 7);
    let cents = 0;
    let downloads = 0;
    for (const s of shops)
      for (const m of s.byMonth || [])
        if (String(m.month).slice(0, 7) === thisMonth) {
          cents += m.owedCents || 0;
          downloads += m.downloads || 0;
        }
    return { cents, downloads };
  }

  function standing(board) {
    if (!board) return 'Not read yet.';
    const now = owedNow(board);
    const ever = (board.shops || []).reduce((t, s) => t + (s.downloadsEver || 0), 0);
    if (!ever) return 'No downloads from a shop yet. They show here once a new member answers the shop question in the app.';
    return `This month: ${n(now.downloads)} ${now.downloads === 1 ? 'download' : 'downloads'} from shops, ${usd(now.cents)} owed. ${n(ever)} in all.`;
  }

  /** One row a shop: name, rate, this month, owed this month, all time, owed all time. */
  function shopRows(board) {
    const thisMonth = String((board && board.today) || '').slice(0, 7);
    return ((board && board.shops) || []).map((s) => {
      const m = (s.byMonth || []).find((x) => String(x.month).slice(0, 7) === thisMonth);
      return {
        place: s.place,
        name: s.name,
        rate: rateWords(s),
        rateCents: has(s.rateCents) ? s.rateCents : null,
        cells: [n(m ? m.downloads : 0), usd(m ? m.owedCents : 0), n(s.downloadsEver), usd(s.owedEverCents), n(s.accountsEver), n(s.plusEver)],
        months: (s.byMonth || []).map((x) => ({
          month: month(x.month),
          cells: [n(x.downloads), usd(x.owedCents), n(x.accounts), n(x.cigars), n(x.plus)],
        })),
      };
    });
  }
  const SHOP_HEAD = ['Shop', 'Pay a download', 'This month', 'Owed this month', 'All time', 'Owed all time', 'Made an account', 'Bought Plus'];

  /** "Other shops people named: Holt's (3), Smoke Inn (1)", or nothing when none was typed. */
  function typedWords(board) {
    const list = (board && board.typedOther) || [];
    if (!list.length) return '';
    return `Other shops people named: ${list.map((x) => `${x.name} (${n(x.count)})`).join(', ')}.`;
  }

  const api = { LIMITS, MONTH_HEAD, SHOP_HEAD, rateWords, readRate, typedWords, owedNow, standing, shopRows, usd };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CigarPayouts = api;
})(typeof window !== 'undefined' ? window : globalThis);
