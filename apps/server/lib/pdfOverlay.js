// PDF overlay replace. Drawing is pdf-lib only (research plan).
// pdf-lib cannot extract glyph positions, so pdfjs-dist getTextContent() is used
// for coordinates/font metadata only — not a swap of the drawing library.
//
// Font/size: size = hypot(transform[0], transform[1]) from the text item (scale).
// Family is resolved in this order, never guessed:
//   1. styles[item.fontName].fontFamily mapped to a pdf-lib StandardFont
//      (Helvetica / Times / Courier + bold/italic), including subset prefixes.
//   2. Else item.fontName (g_d0_f1 vs g_d0_f2) via pdfjs commonObjs Font.name
//      after getOperatorList() — that is the PDF BaseFont for THAT item, so
//      Helvetica body is not skipped just because the page also has Helvetica-Bold.
//   3. If commonObjs has no entry, fall back to a unique page-level StandardFont
//      of that CSS generic. Multiple variants on the page without a per-item
//      name still skip rather than guess.
// No Arial→Helvetica. Skips are console.warn'd, never silently drawn.
//
// Multi-occurrence: EVERY regex match on EVERY page is considered, not the first
// per page. Same buildMultiWordRegex + findPairForMatch + applyCasePattern as .txt.
//
// Rotated/skewed items (non-axis-aligned transform) are skipped, not guessed.
// Longer replacement overlapping neighbors is an accepted limitation (no reflow).
//
// Substring position: pdfjs getTextContent() has no item.chars. A single PDF
// show-text (one drawText / one Tj) is ONE item for the whole line, so we cannot
// use the item's full x/width for a match inside it. We slice with the resolved
// StandardFont's widthOfTextAtSize(prefix) and widthOfTextAtSize(match), then
// scale those widths so they fit the item's extracted width
// (item.width / measured(item.str)). That is glyph-metric placement, not
// character-count proportion. Limits: extra per-glyph TJ tweaks / word-spacing
// that are not uniform across the item can shift the box slightly; if the font
// cannot measure the item string, the occurrence is skipped, not guessed.
//
// White-box vertical bounds: pdfjs item origin is the baseline; item.height is
// the font-size (em), NOT ascent+descent. The overlay box uses the StandardFont
// AFM FontBBox/Ascender/Descender so descenders (p) and tall ascenders (l) are
// covered. Replacement text is still drawn at the original baseline.
//
// Wider replacements: drawSize is widthOfTextAtSize-scaled to the original
// match width, floored at 70% of original size. Below that floor we keep full
// size (overlap accepted). Text stays on the original baseline.

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

// pdfjs item.fontName (g_d0_f1 vs g_d0_f2) is unique per loaded font. After
// getOperatorList(), commonObjs holds the Font with .name = PDF BaseFont
// (Helvetica vs Helvetica-Bold). styles[].fontFamily is only a CSS generic.
function lookupPdfjsFont(page, fontName) {
  if (!page || !page.commonObjs || !fontName) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 4000);
    try {
      page.commonObjs.get(fontName, (font) => {
        clearTimeout(timer);
        resolve(font || null);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

async function buildItemFontMap(page, items) {
  const fontMap = Object.create(null);
  const names = [...new Set((items || []).map((item) => item.fontName).filter(Boolean))];
  if (names.length === 0) return fontMap;
  // getTextContent() does not populate commonObjs; getOperatorList() does.
  await page.getOperatorList();
  for (const name of names) {
    const font = await lookupPdfjsFont(page, name);
    fontMap[name] = mapToStandardFont(font && font.name) || null;
  }
  return fontMap;
}

function resolveItemFont(item, styles, fontMap, pageStandardFonts) {
  const style = (styles && item.fontName && styles[item.fontName]) || {};
  const direct = mapToStandardFont(style.fontFamily || '');
  if (direct) return direct;
  if (fontMap && Object.prototype.hasOwnProperty.call(fontMap, item.fontName)) {
    return fontMap[item.fontName];
  }
  return resolveDrawFont(style.fontFamily || '', pageStandardFonts);
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
  return {
    rotated: false,
    fontSize,
    x: e,
    y: f, // pdfjs origin is the baseline, not the glyph bbox top
    width,
  };
}

// Cover the original glyphs, not the pdfjs item box. item.height is hypot(c,d)
// = font-size (the em), and the origin is the baseline, so a box of
// [baseline, baseline+em] misses descenders (p/g/y) entirely and can leave
// hinted ascender stems (l) visible at the top edge. Use the StandardFont AFM
// FontBBox/Ascender/Descender, plus a small pad for raster AA.
function overlayCoverBox(baselineY, matchX, matchWidth, fontSize, pdfFont) {
  const afm = pdfFont.embedder && pdfFont.embedder.font;
  let unitsUp = 1000;
  let unitsDown = 250;
  if (afm) {
    const bbox = Array.isArray(afm.FontBBox) ? afm.FontBBox : [];
    const asc = afm.Ascender != null ? afm.Ascender : bbox[3];
    const desc = afm.Descender != null ? afm.Descender : bbox[1];
    unitsUp = Math.max(Number(asc) || 0, Number(bbox[3]) || 0, 1000);
    unitsDown = Math.max(0, -(Number(desc) || 0), -(Number(bbox[1]) || 0));
  } else {
    const ascent = pdfFont.heightAtSize(fontSize, { descender: false });
    const total = pdfFont.heightAtSize(fontSize, { descender: true });
    unitsUp = (ascent / fontSize) * 1000;
    unitsDown = Math.max(0, ((total - ascent) / fontSize) * 1000);
  }
  const pad = fontSize * 0.12;
  const above = (unitsUp / 1000) * fontSize + pad;
  const below = (unitsDown / 1000) * fontSize + pad;
  return {
    boxX: matchX - pad,
    boxY: baselineY - below,
    boxWidth: matchWidth + pad * 2,
    boxHeight: above + below,
    textX: matchX,
    textY: baselineY,
  };
}

// Shrink-to-fit: same widthOfTextAtSize glyph metrics as substring placement.
// Scale is direct: originalWidth / replacementWidth * fontSize. Floor is 70% of
// original size; below that we keep full size (accept overlap) rather than
// shrinking further. Same-or-narrower replacements keep original size.
function replacementDrawSize(pdfFont, text, matchWidth, fontSize) {
  if (!text || !(matchWidth > 0) || !(fontSize > 0)) return fontSize;
  let needed;
  try {
    needed = pdfFont.widthOfTextAtSize(text, fontSize);
  } catch {
    return fontSize;
  }
  if (!(needed > matchWidth)) return fontSize;
  const scaled = fontSize * (matchWidth / needed);
  // Same-length pairs like grape/apple differ by a few percent of width in
  // Helvetica; shrinking those would regress the passing overlay. Only shrink
  // when the replacement is materially wider (more than 5%).
  if (needed <= matchWidth * 1.05) return fontSize;
  if (scaled < fontSize * 0.7) return fontSize;
  return scaled;
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
  const end = start + length;
  for (const item of lineItems) {
    const next = cursor + item.str.length;
    if (next > start && cursor < end) {
      covered.push({
        item,
        startInItem: Math.max(0, start - cursor),
        endInItem: Math.min(item.str.length, end - cursor),
      });
    }
    cursor = next;
  }
  return covered;
}

// Map a match slice onto the item box using StandardFont glyph widths, scaled so
// the full item string's measured width equals pdfjs item.width. Whole-item
// matches keep the extracted box (no measurement needed).
function sliceItemGeometry(geo, item, startInItem, endInItem, pdfFont) {
  const whole = startInItem === 0 && endInItem === item.str.length;
  if (whole) return geo;
  let measuredTotal;
  let prefixW;
  let sliceW;
  try {
    measuredTotal = pdfFont.widthOfTextAtSize(item.str, geo.fontSize);
    prefixW = pdfFont.widthOfTextAtSize(item.str.slice(0, startInItem), geo.fontSize);
    sliceW = pdfFont.widthOfTextAtSize(item.str.slice(startInItem, endInItem), geo.fontSize);
  } catch {
    return null;
  }
  if (!(measuredTotal > 0) || !(sliceW > 0) || !(geo.width > 0)) return null;
  const scale = geo.width / measuredTotal;
  return {
    ...geo,
    x: geo.x + prefixW * scale,
    width: sliceW * scale,
  };
}

async function buildOccurrence(pageNumber, lineItems, styles, pageStandardFonts, fontMap, match, measureFont) {
  const covered = itemsCoveringRange(lineItems, match.index, match.length);
  if (covered.length === 0) {
    return { skip: 'no-glyphs', match };
  }
  const resolved = covered.map(({ item }) => resolveItemFont(item, styles, fontMap, pageStandardFonts));
  if (resolved.some((font) => !font)) {
    return {
      skip: 'font-not-resolved',
      match,
      extra: `cssFont=${JSON.stringify(
        covered.map(({ item }) => (styles[item.fontName] || {}).fontFamily || '')
      )} itemFonts=${JSON.stringify(covered.map(({ item }) => item.fontName))} pageFonts=${JSON.stringify(
        pageStandardFonts
      )} mapped=${JSON.stringify(resolved)}`,
    };
  }
  if (new Set(resolved).size > 1) {
    return { skip: 'mixed-font', match, extra: `font=${JSON.stringify(resolved.join('|'))}` };
  }
  const pdfFont = await measureFont(resolved[0]);
  const geos = [];
  for (const slice of covered) {
    const geo = itemGeometry(slice.item);
    if (!geo) return { skip: 'missing-transform', match };
    if (geo.rotated) return { skip: 'rotated-text', match };
    const sliced = sliceItemGeometry(geo, slice.item, slice.startInItem, slice.endInItem, pdfFont);
    if (!sliced) {
      return { skip: 'cannot-measure-substring', match };
    }
    geos.push(sliced);
  }
  const sizes = geos.map((geo) => geo.fontSize);
  if (Math.max(...sizes) - Math.min(...sizes) > 0.15) {
    return { skip: 'mixed-size', match };
  }
  const matchX = Math.min(...geos.map((geo) => geo.x));
  const baselineY = Math.min(...geos.map((geo) => geo.y));
  const matchWidth = Math.max(...geos.map((geo) => geo.x + geo.width)) - matchX;
  const cover = overlayCoverBox(baselineY, matchX, matchWidth, sizes[0], pdfFont);
  const drawSize = replacementDrawSize(pdfFont, match.drawn, matchWidth, sizes[0]);
  return {
    skip: null,
    occurrence: {
      pageNumber,
      pageIndex: pageNumber - 1,
      x: cover.boxX,
      y: cover.boxY,
      width: cover.boxWidth,
      height: cover.boxHeight,
      textX: cover.textX,
      textY: cover.textY,
      fontSize: sizes[0],
      drawSize,
      matchWidth,
      standardFont: resolved[0],
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
      const items = content.items || [];
      const fontMap = await buildItemFontMap(page, items);
      pages.push({
        pageNumber,
        items,
        styles: content.styles || {},
        pageStandardFonts: pdfLibPage ? listPageStandardFonts(pdfLibPage) : [],
        fontMap,
      });
    }
  } finally {
    if (doc && typeof doc.destroy === 'function') await doc.destroy();
    else if (doc && doc.cleanup) doc.cleanup();
  }
  return pages;
}

async function collectOccurrences(pages, pairs, flags) {
  const measureDoc = await PDFDocument.create();
  const fontCache = new Map();
  async function measureFont(name) {
    if (!fontCache.has(name)) {
      fontCache.set(name, await measureDoc.embedFont(name));
    }
    return fontCache.get(name);
  }

  const overlayable = [];
  for (const page of pages) {
    const lines = groupItemsIntoLines(page.items);
    for (const line of lines) {
      const text = line.items.map((item) => item.str).join('');
      const matches = collectRegexMatches(text, pairs, flags);
      for (const match of matches) {
        const built = await buildOccurrence(
          page.pageNumber,
          line.items,
          page.styles,
          page.pageStandardFonts || [],
          page.fontMap || Object.create(null),
          match,
          measureFont
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
  const occurrences = await collectOccurrences(pages, pairs, flags);
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
  const occurrences = await collectOccurrences(pages, pairs, flags);

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
      // White stroke (not a dark outline): pdf-lib still emits setLineWidth(0)
      // which some viewers treat as a 1-device-pixel hairline. A white border
      // also covers antialiased glyph edges the fill might miss.
      borderWidth: 0.75,
      borderColor: rgb(1, 1, 1),
    });
    if (occurrence.drawn.length > 0) {
      const font = await embedStandard(occurrence.standardFont);
      page.drawText(occurrence.drawn, {
        x: occurrence.textX,
        y: occurrence.textY,
        size: occurrence.drawSize || occurrence.fontSize,
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
