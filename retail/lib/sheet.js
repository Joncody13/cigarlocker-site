/*
 * Cigar Locker Retail: a shop's spreadsheet read (CSV or Excel .xlsx), its
 * columns guessed and mapped, each row turned into what the import needs.
 * Pure, with no outside library: an .xlsx is a zip of XML, opened with the
 * browser's own DecompressionStream (Node's in the tests).
 */
(function (root, make) {
  if (typeof module === 'object' && module.exports) module.exports = make();
  else root.RetailSheet = make();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** The fields a column can be. */
  var FIELDS = [
    { key: 'brand', label: 'Brand', names: ['brand', 'manufacturer', 'maker', 'mfg', 'vendor', 'company'] },
    { key: 'line', label: 'Line / cigar', names: ['line', 'cigar', 'series', 'blend', 'product line', 'name'] },
    { key: 'name', label: 'Full name (brand and line together)', names: ['description', 'product', 'item', 'item name', 'product name', 'title'] },
    { key: 'vitola', label: 'Vitola (size name)', names: ['vitola', 'size name', 'shape', 'format'] },
    { key: 'size', label: 'Size (6 x 52)', names: ['size', 'dimensions', 'length x ring', 'lxr'] },
    { key: 'length', label: 'Length', names: ['length', 'len', 'inches'] },
    { key: 'ring', label: 'Ring gauge', names: ['ring', 'ring gauge', 'rg', 'gauge'] },
    // A total of all the store's cigars comes before a part of them (a shop's sheet may have Boxes, Singles and Total Sticks).
    { key: 'quantity', label: 'Quantity', names: ['total sticks', 'total cigars', 'total quantity', 'total qty', 'quantity', 'qty', 'count', 'on hand', 'stock', 'inventory', 'units', 'qoh', 'in stock', 'sticks'] },
    { key: 'cost', label: 'Cost', names: ['cost', 'unit cost', 'cost each', 'wholesale', 'our cost', 'cost per'] },
    { key: 'price', label: 'Retail price', names: ['price', 'retail', 'retail price', 'msrp', 'sell price', 'selling price', 'unit price'] },
    { key: 'sku', label: 'SKU', names: ['sku', 'item #', 'item number', 'item no', 'code', 'product code', 'part'] },
    { key: 'upc', label: 'UPC / barcode', names: ['upc', 'barcode', 'ean', 'gtin', 'bar code'] },
    { key: 'location', label: 'Location', names: ['location', 'shelf', 'bin', 'humidor', 'where', 'section', 'aisle'] },
    { key: 'box_count', label: 'Cigars per box', names: ['box count', 'per box', 'box qty', 'count per box', 'box size', 'pack'] },
    { key: 'wrapper', label: 'Wrapper', names: ['wrapper', 'wrapper leaf'] },
    { key: 'binder', label: 'Binder', names: ['binder'] },
    { key: 'filler', label: 'Filler', names: ['filler', 'fillers'] },
    { key: 'country', label: 'Country', names: ['country', 'origin', 'country of origin'] },
    { key: 'strength', label: 'Strength', names: ['strength', 'body', 'profile'] },
    // "Vendor" is the brand only when there is no Brand column (the brand's names come first and prefer "brand").
    { key: 'supplier', label: 'Supplier / distributor', names: ['supplier', 'distributor', 'wholesaler', 'vendor', 'vendor name', 'source'] },
  ];

  function plain(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9#]+/g, ' ')
      .trim();
  }

  // ---- CSV ------------------------------------------------------------------

  /** Rows of cells from CSV (commas, semicolons or tabs; quoted cells; a byte-order mark). */
  function parseCSV(text) {
    var t = String(text || '').replace(/^﻿/, '');
    var firstLine = t.split(/\r?\n/)[0] || '';
    var counts = { ',': (firstLine.match(/,/g) || []).length, ';': (firstLine.match(/;/g) || []).length, '\t': (firstLine.match(/\t/g) || []).length };
    var sep = Object.keys(counts).sort(function (a, b) {
      return counts[b] - counts[a];
    })[0];
    if (!counts[sep]) sep = ',';
    var rows = [];
    var row = [];
    var cell = '';
    var quoted = false;
    for (var i = 0; i < t.length; i++) {
      var c = t[i];
      if (quoted) {
        if (c === '"') {
          if (t[i + 1] === '"') {
            cell += '"';
            i++;
          } else quoted = false;
        } else cell += c;
      } else if (c === '"' && cell === '') quoted = true;
      else if (c === sep) {
        row.push(cell);
        cell = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && t[i + 1] === '\n') i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else cell += c;
    }
    if (cell !== '' || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows.filter(function (r) {
      return r.some(function (x) {
        return String(x).trim() !== '';
      });
    });
  }

  // ---- XLSX -----------------------------------------------------------------

  function u16(b, o) {
    return b[o] | (b[o + 1] << 8);
  }
  function u32(b, o) {
    return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 16777216;
  }

  async function inflate(data) {
    var ds = new DecompressionStream('deflate-raw');
    var stream = new Blob([data]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /** The files in a zip, by name (stored or deflated). */
  async function unzip(buffer) {
    var b = new Uint8Array(buffer);
    var end = -1;
    for (var i = b.length - 22; i >= Math.max(0, b.length - 66000); i--) {
      if (u32(b, i) === 0x06054b50) {
        end = i;
        break;
      }
    }
    if (end < 0) throw new Error('This is not an Excel workbook (.xlsx).');
    var count = u16(b, end + 10);
    var at = u32(b, end + 16);
    var files = {};
    var dec = new TextDecoder();
    for (var n = 0; n < count; n++) {
      if (u32(b, at) !== 0x02014b50) break;
      var method = u16(b, at + 10);
      var size = u32(b, at + 20);
      var nameLen = u16(b, at + 28);
      var extra = u16(b, at + 30);
      var comment = u16(b, at + 32);
      var local = u32(b, at + 42);
      var name = dec.decode(b.subarray(at + 46, at + 46 + nameLen));
      var start = local + 30 + u16(b, local + 26) + u16(b, local + 28);
      files[name] = { method: method, data: b.subarray(start, start + size) };
      at += 46 + nameLen + extra + comment;
    }
    return {
      read: async function (name) {
        var f = files[name];
        if (!f) return null;
        var raw = f.method === 0 ? f.data : await inflate(f.data);
        return dec.decode(raw);
      },
      names: Object.keys(files),
    };
  }

  function unescapeXml(s) {
    return s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, function (_, e) {
      var k = e.toLowerCase();
      if (k === 'lt') return '<';
      if (k === 'gt') return '>';
      if (k === 'amp') return '&';
      if (k === 'quot') return '"';
      if (k === 'apos') return "'";
      if (k[0] === '#') return String.fromCodePoint(k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
      return _;
    });
  }

  /** The text of a string item: every <t> in it run together. */
  function textOf(xml) {
    var out = '';
    var re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
    var m;
    while ((m = re.exec(xml))) out += unescapeXml(m[1]);
    return out;
  }

  function colIndex(ref) {
    var letters = (ref.match(/^[A-Z]+/) || ['A'])[0];
    var n = 0;
    for (var i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
    return n - 1;
  }

  /** The first sheet of a workbook, as rows of cells (text, numbers as written). */
  async function readXLSX(buffer) {
    var zip = await unzip(buffer);
    var shared = [];
    var ss = await zip.read('xl/sharedStrings.xml');
    if (ss) {
      var si = /<si>([\s\S]*?)<\/si>/g;
      var m;
      while ((m = si.exec(ss))) shared.push(textOf(m[1]));
    }
    var sheetName = 'xl/worksheets/sheet1.xml';
    var wb = await zip.read('xl/workbook.xml');
    var rels = await zip.read('xl/_rels/workbook.xml.rels');
    if (wb && rels) {
      var first = /<sheet\b[^>]*r:id="([^"]+)"/.exec(wb);
      if (first) {
        var rel = new RegExp('<Relationship\\b[^>]*Id="' + first[1] + '"[^>]*Target="([^"]+)"').exec(rels) ||
          new RegExp('<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="' + first[1] + '"').exec(rels);
        if (rel) sheetName = rel[1].replace(/^\/?(xl\/)?/, 'xl/');
      }
    }
    var sheet = await zip.read(sheetName);
    if (!sheet) throw new Error('The workbook has no sheet to read.');
    var rows = [];
    var rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
    var r;
    while ((r = rowRe.exec(sheet))) {
      var cells = [];
      var cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      var c;
      while ((c = cellRe.exec(r[1]))) {
        var attrs = c[1];
        var inner = c[2] || '';
        var ref = (/\br="([A-Z]+\d+)"/.exec(attrs) || [])[1];
        var type = (/\bt="([^"]+)"/.exec(attrs) || [])[1] || '';
        var v = (/<v>([\s\S]*?)<\/v>/.exec(inner) || [])[1];
        var value = '';
        if (type === 's') value = shared[Number(v)] || '';
        else if (type === 'inlineStr') value = textOf(inner);
        else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
        else if (v != null) value = unescapeXml(v);
        var idx = ref ? colIndex(ref) : cells.length;
        while (cells.length < idx) cells.push('');
        cells[idx] = value;
      }
      rows.push(cells);
    }
    return rows.filter(function (row) {
      return row.some(function (x) {
        return String(x).trim() !== '';
      });
    });
  }

  // ---- columns --------------------------------------------------------------

  /** The row of headings: the first of the top ten naming a brand, a cigar or a name column, else the first. */
  function headerRow(rows) {
    for (var i = 0; i < Math.min(rows.length, 10); i++) {
      var names = rows[i].map(plain);
      if (names.some(function (n) {
        return ['brand', 'manufacturer', 'maker', 'description', 'product', 'item', 'cigar', 'item name', 'product name'].indexOf(n) >= 0;
      })) return i;
    }
    return 0;
  }

  var CODES = { sku: true, upc: true };

  /** A heading read three ways: whole, without what is in brackets ("Boxes (Nov 9 count)" is "boxes"), and what is in them ("Item # (SKU)" names "sku"). */
  function headingForms(h) {
    var raw = String(h == null ? '' : h);
    return {
      whole: plain(raw),
      core: plain(raw.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')),
      inner: (raw.match(/\([^)]*\)|\[[^\]]*\]/g) || []).map(plain).filter(Boolean),
    };
  }

  /**
   * Each field's column, guessed from the headings. First exact names, each field's in its own order of
   * preference ("Brand" before "Vendor", "Total Sticks" before "Count"), a heading matching whole, without
   * its brackets, or by what its brackets say; then a heading, without its brackets, that starts or ends
   * with a field's name.
   */
  function guessMapping(headers) {
    var hs = headers.map(headingForms);
    var used = {};
    var out = {};
    FIELDS.forEach(function (f) {
      for (var a = 0; a < f.names.length && out[f.key] == null; a++) {
        var n = f.names[a];
        for (var i = 0; i < hs.length; i++) {
          if (used[i] || !hs[i].whole) continue;
          // What brackets say names only a code ("Item # (SKU)"); "Boxes (count)" is not a quantity of cigars.
          if (hs[i].whole === n || hs[i].core === n || (CODES[f.key] && hs[i].inner.indexOf(n) >= 0)) {
            out[f.key] = i;
            used[i] = true;
            break;
          }
        }
      }
    });
    FIELDS.forEach(function (f) {
      if (out[f.key] != null) return;
      for (var i = 0; i < hs.length; i++) {
        var h = hs[i].core;
        if (used[i] || !h) continue;
        if (f.names.some(function (n) {
          return h.indexOf(n + ' ') === 0 || h.indexOf(' ' + n) > 0;
        })) {
          out[f.key] = i;
          used[i] = true;
          return;
        }
      }
    });
    // A single "Cigar" or "Name" column with no brand column is the full name.
    if (out.brand == null && out.line != null && out.name == null) {
      out.name = out.line;
      delete out.line;
    }
    return out;
  }

  /** A layout's signature: its headings, plain and sorted, so the same spreadsheet finds its saved mapping. */
  function signature(headers) {
    return headers
      .map(plain)
      .filter(Boolean)
      .sort()
      .join('|');
  }

  // ---- values ---------------------------------------------------------------

  /** Money as cents ("$12.50", "12.5", "1,234"); null when it does not read. */
  function cents(v) {
    var t = String(v == null ? '' : v).replace(/[$,\s]/g, '');
    if (!/^\d{1,7}(\.\d+)?$/.test(t)) return null;
    return Math.round(Number(t) * 100);
  }

  /** A whole count ("24", "24.0", "1,200"); null when it does not read. */
  function count(v) {
    var t = String(v == null ? '' : v).replace(/[,\s]/g, '');
    if (!/^-?\d{1,6}(\.0+)?$/.test(t)) return null;
    return Math.max(0, Math.round(Number(t)));
  }

  function fraction(t) {
    var m = /^(\d+)(?:\s+(\d+)\/(\d+)|\.(\d+))?$/.exec(t.trim());
    if (!m) return null;
    var n = Number(m[1]);
    if (m[2]) n += Number(m[2]) / Number(m[3]);
    if (m[4]) n = Number(m[1] + '.' + m[4]);
    return n;
  }

  /** "6 x 52", "6 1/2 x 52", "6.5x52", "52 x 6": length in inches and ring gauge; null when it does not read. */
  function size(v) {
    var t = String(v == null ? '' : v).replace(/["″”]/g, '').replace(/[×*]/g, 'x');
    var m = /(\d+(?:\s+\d+\/\d+|\.\d+)?)\s*x\s*(\d+(?:\s+\d+\/\d+|\.\d+)?)/i.exec(t);
    if (!m) return null;
    var a = fraction(m[1]);
    var b = fraction(m[2]);
    if (a == null || b == null) return null;
    var length = a < b ? a : b;
    var ring = a < b ? b : a;
    if (length < 2 || length > 12 || ring < 20 || ring > 80) return null;
    return { lengthIn: Math.round(length * 1000) / 1000, ring: Math.round(ring) };
  }

  /**
   * Each row as the import needs it, its original cells kept.
   * opts: {costPer: 'cigar' | 'box', pricePer: 'cigar' | 'box'}
   */
  function records(rows, header, mapping, opts) {
    var o = opts || {};
    var headers = rows[header] || [];
    var out = [];
    for (var i = header + 1; i < rows.length; i++) {
      var r = rows[i];
      var get = function (k) {
        return mapping[k] != null ? String(r[mapping[k]] == null ? '' : r[mapping[k]]).trim() : '';
      };
      var original = {};
      headers.forEach(function (h, j) {
        if (String(r[j] == null ? '' : r[j]).trim() !== '') original[String(h || 'Column ' + (j + 1))] = String(r[j]);
      });
      if (!Object.keys(original).length) continue;
      var sz = size(get('size')) || size(get('vitola')) || size(get('name')) || size(get('line'));
      var length = Number(get('length')) || (sz && sz.lengthIn) || null;
      var ring = Number(get('ring')) || (sz && sz.ring) || null;
      var boxCount = count(get('box_count'));
      var cost = cents(get('cost'));
      var price = cents(get('price'));
      if (o.costPer === 'box' && cost != null && boxCount) cost = Math.round(cost / boxCount);
      if (o.pricePer === 'box' && price != null && boxCount) price = Math.round(price / boxCount);
      var vitola = get('vitola');
      if (vitola && size(vitola) && !/[a-z]{3}/i.test(vitola.replace(/x/gi, ''))) vitola = '';
      out.push({
        n: i + 1,
        original: original,
        brand: get('brand'),
        line: get('line'),
        name: get('name'),
        vitola: vitola,
        size_text: sz ? (get('size') || '') : get('size'),
        length_in: length && length >= 2 && length <= 12 ? length : null,
        ring: ring && ring >= 20 && ring <= 80 ? Math.round(ring) : null,
        quantity: count(get('quantity')),
        cost_cents: cost,
        price_cents: price,
        sku: get('sku'),
        upc: get('upc').replace(/\s/g, ''),
        location: get('location'),
        box_count: boxCount && boxCount >= 1 && boxCount <= 500 ? boxCount : null,
        wrapper: get('wrapper'),
        binder: get('binder'),
        filler: get('filler'),
        country: get('country'),
        strength: get('strength'),
        supplier: get('supplier'),
      });
    }
    return withSharedSkus(out);
  }

  /**
   * A SKU written on rows of different cigars (a placeholder such as "PORTAL", or one number a shop reused)
   * names none of them: it is taken off those rows (kept in their original cells, and as sku_shared) so the
   * import never makes them one product by it. Rows of the same cigar keep it.
   */
  function withSharedSkus(recs) {
    var names = {};
    recs.forEach(function (r) {
      var k = plain(r.sku);
      if (!k) return;
      var who = plain([r.brand, r.line, r.name, r.vitola, r.size_text].join(' '));
      (names[k] = names[k] || {})[who] = true;
    });
    recs.forEach(function (r) {
      var k = plain(r.sku);
      if (k && Object.keys(names[k]).length > 1) {
        r.sku_shared = r.sku;
        r.sku = '';
      }
    });
    return recs;
  }

  /** A whole row that is a total or a heading inside the list ("Total", "Subtotal"), to leave out. */
  function isTotalRow(rec) {
    var words = plain([rec.brand, rec.line, rec.name].join(' '));
    return /^(grand )?(sub)?totals?\b/.test(words);
  }

  return {
    FIELDS: FIELDS,
    parseCSV: parseCSV,
    readXLSX: readXLSX,
    headerRow: headerRow,
    guessMapping: guessMapping,
    signature: signature,
    cents: cents,
    count: count,
    size: size,
    records: records,
    withSharedSkus: withSharedSkus,
    headingForms: headingForms,
    isTotalRow: isTotalRow,
    plain: plain,
  };
});
