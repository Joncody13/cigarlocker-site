/*
 * Cigar Locker Retail: printing labels (docs/retail.md, "Cigar labels").
 *
 * A print job is the same whatever prints it: which template (a box's label,
 * or one cigar's), the label stock (media), the labels, and where to start on
 * a sheet already part used. A printer is a way to turn a job into labels on
 * paper. Today there is one, the device's own Print (any printer the iPad,
 * iPhone or computer can reach: an office printer with label sheets, or a
 * label printer that takes AirPrint), drawn at actual size. A label printer's
 * own language (ZPL, a maker's SDK) comes in as another printer here, taking
 * the same job; nothing in the app is tied to one maker.
 *
 * Every machine-readable code holds an opaque code only (CL-... a box,
 * CLS-... a cigar). Names and prices are printed for people, never encoded.
 * Pure: runs in the browser and under the tests.
 */
(function (root, make) {
  if (typeof module === 'object' && module.exports) module.exports = make();
  else root.RetailPrinters = make();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Label stock, in inches: the page, one label, how many across and down,
   * the top and left margins and the gaps between. `template` is what goes
   * on it: 'box' (a box's label), 'unit' (one cigar's), 'collar' (one
   * cigar's, as a paper band to wrap round a cigar with no cellophane).
   */
  var MEDIA = {
    'box-sheet-30': { template: 'box', name: 'Sheet of 30 address labels (Avery 5160 and alike)', page: [8.5, 11], label: [2.625, 1], across: 3, down: 10, top: 0.5, left: 0.1875, gapX: 0.125, gapY: 0 },
    'box-roll-2x1': { template: 'box', name: 'Label printer, 2 × 1 in', page: [2, 1], label: [2, 1], across: 1, down: 1, top: 0, left: 0, gapX: 0, gapY: 0 },
    'unit-sheet-80': { template: 'unit', name: 'Sheet of 80 small labels (Avery 5267 and alike), for cellophane', page: [8.5, 11], label: [1.75, 0.5], across: 4, down: 20, top: 0.5, left: 0.28125, gapX: 0.3125, gapY: 0 },
    'unit-roll-1.5x0.5': { template: 'unit', name: 'Label printer, 1.5 × 0.5 in, for cellophane', page: [1.5, 0.5], label: [1.5, 0.5], across: 1, down: 1, top: 0, left: 0, gapX: 0, gapY: 0 },
    'unit-collar-sheet': { template: 'collar', name: 'Paper bands on plain paper, for cigars without cellophane', page: [8.5, 11], label: [3.5, 0.6], across: 2, down: 16, top: 0.45, left: 0.5, gapX: 0.5, gapY: 0.05 },
  };

  /** What each template is for, and how a person puts it on. */
  var TEMPLATES = {
    box: { name: 'Box labels', kind: 'box', care: 'Put it where it covers no maker\'s code, stamp or seal.' },
    unit: { name: 'Cigar labels', kind: 'unit', care: 'On the cellophane only, never on the leaf, and never over the band.' },
    collar: { name: 'Cigar labels', kind: 'unit', care: 'Cut along the lines, wrap round the cigar beside the band, and tape the paper to itself. No glue touches the leaf.' },
  };

  /**
   * The printers. Each takes a job; `transport` says how it reaches paper.
   * 'print-dialog' is the device's Print, the job drawn at actual size.
   */
  var PRINTERS = [
    { id: 'device', name: 'This device\'s Print', transport: 'print-dialog', media: Object.keys(MEDIA) },
  ];

  /** The stock that fits a kind of label ('box' or 'unit'). */
  function mediaFor(kind) {
    return Object.keys(MEDIA).filter(function (k) { return TEMPLATES[MEDIA[k].template].kind === kind; });
  }

  /** A job: the template comes from the stock; labels in order; skip the first spots of a part-used sheet. */
  function job(mediaKey, labels, skip) {
    var m = MEDIA[mediaKey];
    if (!m) throw new Error('No such label stock.');
    var per = m.across * m.down;
    return { media: mediaKey, template: m.template, labels: labels.slice(), skip: per > 1 ? Math.max(0, Math.min(per - 1, skip || 0)) : 0 };
  }

  /** Where each label of a job goes: [{page, x, y}] in inches, in order. */
  function place(j) {
    var m = MEDIA[j.media];
    var per = m.across * m.down;
    var out = [];
    for (var i = 0; i < j.labels.length; i++) {
      var k = j.skip + i;
      var spot = k % per;
      out.push({ page: Math.floor(k / per), x: m.left + (spot % m.across) * (m.label[0] + m.gapX), y: m.top + Math.floor(spot / m.across) * (m.label[1] + m.gapY) });
    }
    return out;
  }

  /** How many pages a job takes. */
  function pages(j) {
    var m = MEDIA[j.media];
    return j.labels.length ? Math.floor((j.skip + j.labels.length - 1) / (m.across * m.down)) + 1 : 0;
  }

  /** The @page rule for the device's Print: the stock's page, no margins. */
  function pageRule(mediaKey) {
    var m = MEDIA[mediaKey];
    return '@page { size: ' + m.page[0] + 'in ' + m.page[1] + 'in; margin: 0; }';
  }

  /** A price as a label shows it: "$28", "$12.50". */
  function priceWords(cents) {
    if (cents === null || cents === undefined || cents === '') return '';
    var d = Number(cents) / 100;
    if (!isFinite(d) || d <= 0) return '';
    return '$' + (d % 1 ? d.toFixed(2) : String(d));
  }

  return { MEDIA: MEDIA, TEMPLATES: TEMPLATES, PRINTERS: PRINTERS, mediaFor: mediaFor, job: job, place: place, pages: pages, pageRule: pageRule, priceWords: priceWords };
});
