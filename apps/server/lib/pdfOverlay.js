// PDF overlay replace. Drawing is pdf-lib only (research plan).
// pdf-lib cannot extract glyph positions, so pdfjs-dist getTextContent() is used
// for coordinates/font metadata only — not a swap of the drawing library.
//
// Font/size: size = hypot(transform[0], transform[1]) from the text item (scale).
// Family is resolved in this order, never guessed:
//   1. styles[item.fontName].fontFamily mapped to a pdf-lib StandardFont
//      (Helvetica / Times / Courier + bold/italic), including subset prefixes.
//   2. If pdfjs only reports a CSS generic (sans-serif/serif/monospace), look at
//      that page's /BaseFont resources via pdf-lib. If exactly one StandardFont
//      matches that generic, use it. If more than one (e.g. Helvetica + Bold),
//      SKIP the occurrence — we will not pick a face.
// No Arial→Helvetica. Skips are console.warn'd, never silently drawn.
//
// Multi-occurrence: EVERY regex match on EVERY page is considered, not the first
// per page. Same buildMultiWordRegex + findPairForMatch + applyCasePattern as .txt.
//
// Rotated/skewed items (non-axis-aligned transform) are skipped, not guessed.
// Longer replacement overlapping neighbors is an accepted limitation (no reflow).

const { PDFDocument, StandardFonts, PDFName, rgb } = require('pdf-lib');
const { pathToFileURL } = require('url');
const {
  buildMultiWordRegex,
  findPairForMatch,
  applyCasePattern,
  emptyWordCounts,
} = require('./textReplace');

let pdfjsModulePromise;

async function loadPdfjs() {
  if (!pdfjsModulePromise) {
    pdfjsModulePromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((mod) => {
      const pdfjs = mod.default || mod;
      // Node needs the legacy worker URL; without it getDocument rejects.
      const workerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
      return pdfjs;
    });
  }
  return pdfjsModulePromise;
}

const STANDARD_BY_KEY = {
  helvetica: StandardFonts.Helvetica,
  helveticaoblique: StandardFonts.HelveticaOblique,
  helveticaitalic: StandardFonts.HelveticaOblique,
  helveticabold: StandardFonts.HelveticaBold,
  helveticaboldoblique: StandardFonts.HelveticaBoldOblique,
  helveticabolditalic: StandardFonts.HelveticaBoldOblique,
  times: StandardFonts.TimesRoman,
  timesroman: StandardFonts.TimesRoman,
  timesitalic: StandardFonts.TimesRomanItalic,
  timesromanitalic: StandardFonts.TimesRomanItalic,
  timesbold: StandardFonts.TimesRomanBold,
  timesromanbold: StandardFonts.TimesRomanBold,
  timesbolditalic: StandardFonts.TimesRomanBoldItalic,
  timesromanbolditalic: StandardFonts.TimesRomanBoldItalic,
  courier: StandardFonts.Courier,
  courieroblique: StandardFonts.CourierOblique,
  courieritalic: StandardFonts.CourierOblique,
  courierbold: StandardFonts.CourierBold,
  courierboldoblique: StandardFonts.CourierBoldOblique,
  courierbolditalic: StandardFonts.CourierBoldOblique,
};

function stripSubsetPrefix(fontFamily) {
  return String(fontFamily || '').replace(/^[A-Za-z0-9]{4,}\+/, '');
}

function standardFontKey(fontFamily) {
  return stripSubsetPrefix(fontFamily)
    .replace(/[-_\s]/g, '')
    .toLowerCase();
}

function mapToStandardFont(fontFamily) {
  const mapped = STANDARD_BY_KEY[standardFontKey(fontFamily)];
  return mapped || null;
}

function genericFamilyPool(cssFamily) {
  const generic = String(cssFamily || '').toLowerCase();
  if (generic === 'sans-serif') return 'Helvetica';
  if (generic === 'serif') return 'Times';
  if (generic === 'monospace') return 'Courier';
  return null;
}

function listPageStandardFonts(pdfLibPage) {
  try {
    const resources = pdfLibPage.node.Resources();
    if (!resources) return [];
    const fonts = resources.lookup(PDFName.of('Font'));
    if (!fonts || typeof fonts.keys !== 'function') return [];
    const names = [];
    for (const key of fonts.keys()) {
      const fontObj = fonts.lookup(key);
      if (!fontObj || typeof fontObj.lookup !== 'function') continue;
      const base = fontObj.lookup(PDFName.of('BaseFont'));
      const raw = base
        ? String(base.decodeText ? base.decodeText() : base).replace(/^\//, '')
        : '';
      const mapped = mapToStandardFont(raw);
      if (mapped) names.push(mapped);
    }
    return names;
  } catch {
    return [];
  }
}

function resolveDrawFont(cssFamily, pageStandardFonts) {
  const direct = mapToStandardFont(cssFamily);
  if (direct) return direct;
  const prefix = genericFamilyPool(cssFamily);
  const pool = prefix
    ? pageStandardFonts.filter((name) => name.startsWith(prefix))
    : pageStandardFonts;
  const unique = [...new Set(pool)];
  if (unique.length === 1) return unique[0];
  return null;
}

function logSkip(pageNumber, word, reason, extra) {
  const bits = [`[pdf-overlay] skip page=${pageNumber} word=${JSON.stringify(word)} reason=${reason}`];
  if (extra) bits.push(extra);
  console.warn(bits.join(' '));
}

function itemGeometry(item) {
  const t = item.transform;
  if (!Array.isArray(t) || t.length < 6) return null;
  const [a, b, c, d, e, f] = t;
  // Non-axis-aligned text: we will not invent a rotation for drawText.
  if (Math.abs(b) > 0.01 || Math.abs(c) > 0.01) return { rotated: true };
  const fontSize = Math.hypot(a, b);
  if (!Number.isFinite(fontSize) || fontSize <= 0) return null;
  const width = Number(item.width);
  if (!Number.isFinite(width) || width <= 0) return null;
  const height = Number(item.height) > 0 ? Number(item.height) : fontSize;
  return {
    rotated: false,
    fontSize,
    x: e,
    y: f,
    width,
    height,
  };
}

function groupItemsIntoLines(items) {
  const usable = items.filter((item) => item && typeof item.str === 'string' && item.str.length > 0);
  usable.sort((left, right) => {
    const gy = (right.transform && right.transform[5]) - (left.transform && left.transform[5]);
    if (Math.abs(gy) > 0.5) return gy;
    return (left.transform && left.transform[4]) - (right.transform && right.transform[4]);
  });
  const lines = [];
  for (const item of usable) {
    const y = item.transform[5];
    const size = Math.hypot(item.transform[0], item.transform[1]) || 12;
    const line = lines.find((candidate) => Math.abs(candidate.y - y) <= Math.max(1, size * 0.2));
    if (line) {
      line.items.push(item);
    } else {
      lines.push({ y, items: [item] });
    }
  }
  for (const line of lines) {
    line.items.sort((a, b) => a.transform[4] - b.transform[4]);
  }
  return lines;
}

function collectRegexMatches(text, pairs, flags) {
  const regex = buildMultiWordRegex(
    pairs.map((pair) => pair.word),
    flags
  );
  regex.lastIndex = 0;
  const matches = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match[0].length === 0) {
      regex.lastIndex += 1;
      continue;
    }
    const pair = findPairForMatch(match[0], pairs, flags.caseSensitive);
    if (!pair) continue;
    const drawn = flags.caseSensitive
      ? pair.replacement
      : applyCasePattern(match[0], pair.replacement);
    matches.push({
      index: match.index,
      length: match[0].length,
      matched: match[0],
      pair,
      drawn,
    });
  }
  return matches;
}

function itemsCoveringRange(lineItems, start, length) {
  const covered = [];
  let cursor = 0;
  for (const item of lineItems) {
    const next = cursor + item.str.length;
    if (next > start && cursor < start + length) covered.push(item);
    cursor = next;
  }
  return covered;
}

function buildOccurrence(pageNumber, lineItems, styles, pageStandardFonts, match) {
  const covered = itemsCoveringRange(lineItems, match.index, match.length);
  if (covered.length === 0) {
    return { skip: 'no-glyphs', match };
  }
  const geos = [];
  for (const item of covered) {
    const geo = itemGeometry(item);
    if (!geo) return { skip: 'missing-transform', match };
    if (geo.rotated) return { skip: 'rotated-text', match };
    geos.push(geo);
  }
  const fontFamilies = covered.map((item) => {
    const style = styles[item.fontName] || {};
    return style.fontFamily || '';
  });
  const standardFonts = fontFamilies.map((family) => resolveDrawFont(family, pageStandardFonts));
  if (standardFonts.some((font) => !font)) {
    return {
      skip: 'font-not-resolved',
      match,
      extra: `cssFont=${JSON.stringify(fontFamilies.join('|'))} pageFonts=${JSON.stringify(pageStandardFonts)}`,
    };
  }
  if (new Set(standardFonts).size > 1) {
    return { skip: 'mixed-font', match, extra: `font=${JSON.stringify(standardFonts.join('|'))}` };
  }
  const sizes = geos.map((geo) => geo.fontSize);
  if (Math.max(...sizes) - Math.min(...sizes) > 0.15) {
    return { skip: 'mixed-size', match };
  }
  const x = Math.min(...geos.map((geo) => geo.x));
  const y = Math.min(...geos.map((geo) => geo.y));
  const right = Math.max(...geos.map((geo) => geo.x + geo.width));
  const top = Math.max(...geos.map((geo) => geo.y + geo.height));
  return {
    skip: null,
    occurrence: {
      pageNumber,
      pageIndex: pageNumber - 1,
      x,
      y,
      width: right - x,
      height: top - y,
      fontSize: sizes[0],
      standardFont: standardFonts[0],
      matched: match.matched,
      drawn: match.drawn,
      pair: match.pair,
    },
  };
}

async function extractPages(pdfBytes) {
  const pdfjs = await loadPdfjs();
  const data = Uint8Array.from(pdfBytes);
  let doc;
  try {
    doc = await pdfjs.getDocument({
      data,
      disableFontFace: true,
      isEvalSupported: false,
      useSystemFonts: false,
      verbosity: 0,
    }).promise;
  } catch (err) {
    const wrapped = new Error('The PDF file is invalid or could not be parsed.');
    wrapped.cause = err;
    throw wrapped;
  }

  let pdfLibPages = [];
  try {
    const pdfLibDoc = await PDFDocument.load(pdfBytes);
    pdfLibPages = pdfLibDoc.getPages();
  } catch {
    pdfLibPages = [];
  }

  const pages = [];
  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent({ includeMarkedContent: false });
      const pdfLibPage = pdfLibPages[pageNumber - 1];
      pages.push({
        pageNumber,
        items: content.items || [],
        styles: content.styles || {},
        pageStandardFonts: pdfLibPage ? listPageStandardFonts(pdfLibPage) : [],
      });
    }
  } finally {
    if (doc && typeof doc.destroy === 'function') await doc.destroy();
    else if (doc && doc.cleanup) doc.cleanup();
  }
  return pages;
}

function collectOccurrences(pages, pairs, flags) {
  const overlayable = [];
  for (const page of pages) {
    const lines = groupItemsIntoLines(page.items);
    for (const line of lines) {
      const text = line.items.map((item) => item.str).join('');
      const matches = collectRegexMatches(text, pairs, flags);
      for (const match of matches) {
        const built = buildOccurrence(
          page.pageNumber,
          line.items,
          page.styles,
          page.pageStandardFonts || [],
          match
        );
        if (built.skip) {
          logSkip(page.pageNumber, match.matched, built.skip, built.extra);
          continue;
        }
        overlayable.push(built.occurrence);
      }
    }
  }
  return overlayable;
}

async function countPdf(storedBase64, words, flags) {
  const bytes = Buffer.from(storedBase64, 'base64');
  const pages = await extractPages(bytes);
  const pairs = words.map((word) => ({ word, replacement: word }));
  const occurrences = collectOccurrences(pages, pairs, flags);
  const counts = emptyWordCounts(words, flags.caseSensitive);
  for (const occurrence of occurrences) {
    const key = flags.caseSensitive
      ? occurrence.pair.word
      : occurrence.pair.word.toLowerCase();
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

async function replacePdf(storedBase64, pairs, flags) {
  const bytes = Buffer.from(storedBase64, 'base64');
  const pages = await extractPages(bytes);
  const occurrences = collectOccurrences(pages, pairs, flags);

  const pdfDoc = await PDFDocument.load(bytes);
  const fontCache = new Map();
  async function embedStandard(name) {
    if (!fontCache.has(name)) {
      fontCache.set(name, await pdfDoc.embedFont(name));
    }
    return fontCache.get(name);
  }

  const pdfPages = pdfDoc.getPages();
  for (const occurrence of occurrences) {
    const page = pdfPages[occurrence.pageIndex];
    if (!page) {
      logSkip(occurrence.pageNumber, occurrence.matched, 'missing-page');
      continue;
    }
    page.drawRectangle({
      x: occurrence.x,
      y: occurrence.y,
      width: occurrence.width,
      height: occurrence.height,
      color: rgb(1, 1, 1),
      borderWidth: 0,
    });
    if (occurrence.drawn.length > 0) {
      const font = await embedStandard(occurrence.standardFont);
      page.drawText(occurrence.drawn, {
        x: occurrence.x,
        y: occurrence.y,
        size: occurrence.fontSize,
        font,
        color: rgb(0, 0, 0),
      });
    }
  }

  const saved = await pdfDoc.save();
  return {
    stored: Buffer.from(saved).toString('base64'),
    count: occurrences.length,
  };
}

module.exports = {
  countPdf,
  replacePdf,
  mapToStandardFont,
};
