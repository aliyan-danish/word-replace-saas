// Format-aware search/replace. Matching always goes through countPlainText /
// replacePlainText in textReplace.js so HTML/XML/DOCX cannot drift from .txt.
//
// DOCX KNOWN LIMITATION (deferred, not solved in this pass):
// Word often splits one visible word across adjacent <w:t> runs (bold/spell-check
// markup). We match inside each <w:t> separately. A word split across runs is
// silently missed even though it looks whole on screen. Same class of limitation
// as whole-word-OFF substring overlap: flagged here, not papered over. A later
// pass could concatenate adjacent run text, match, then write back.
// HTML/XML have the analogous case: a word split across elements (ap<b>ple</b>)
// is also missed.
//
// PDF: overlay via pdf-lib (white box + replacement text). Positions from
// pdfjs-dist getTextContent. Same-line text items are concatenated before the
// shared regex, so a word split across adjacent items on one line is matched.
// Rotated text, unresolved fonts, and mixed-font matches are skipped and logged.

const path = require('path');
const cheerio = require('cheerio');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const AdmZip = require('adm-zip');
const {
  countPlainText,
  replacePlainText,
  emptyWordCounts,
  addWordCounts,
} = require('./textReplace');
const { countPdf, replacePdf } = require('./pdfOverlay');

class FormatParseError extends Error {}
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W_NS_STRICT = 'http://purl.oclc.org/ooxml/wordprocessingml/main';

const SUPPORTED_EXTS = ['.txt', '.html', '.htm', '.xml', '.docx', '.pdf'];
const SKIP_HTML_TAGS = new Set(['script', 'style', 'noscript']);

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const CDATA_NODE = 4;

function getExt(filename) {
  return path.extname(String(filename || '').trim()).toLowerCase();
}

function isSupportedExt(ext) {
  return SUPPORTED_EXTS.includes(String(ext || '').toLowerCase());
}

function isDocxFilename(filename) {
  return getExt(filename) === '.docx';
}

function isBinaryStoredFilename(filename) {
  const ext = getExt(filename);
  return ext === '.docx' || ext === '.pdf';
}

// Windows editors (and PowerShell Set-Content -Encoding utf8) often prefix UTF-8
// files with EF BB BF. Node's utf8 decoder turns that into U+FEFF; if those three
// bytes were instead decoded as latin1 they become "ï»¿". Either form must come
// off before HTML/XML parse or it is treated as document text / breaks the XML
// declaration. .txt does not throw, but the BOM would stay in the file and can
// show as garbage at the start — strip it there too.
function stripUtf8Bom(text) {
  if (typeof text !== 'string' || text.length === 0) return text;
  if (text.charCodeAt(0) === 0xfeff) return text.slice(1);
  if (
    text.charCodeAt(0) === 0xef &&
    text.charCodeAt(1) === 0xbb &&
    text.charCodeAt(2) === 0xbf
  ) {
    return text.slice(3);
  }
  return text;
}

// .docx and .pdf are binary. Storing them as UTF-8 would corrupt bytes, so we keep
// base64 in the existing JobFile.content String column — no schema change.
function encodeStoredContent(filename, buffer) {
  if (isBinaryStoredFilename(filename)) return buffer.toString('base64');
  return stripUtf8Bom(buffer.toString('utf8'));
}

function storedToDownloadBuffer(filename, stored) {
  if (isBinaryStoredFilename(filename)) return Buffer.from(stored, 'base64');
  return Buffer.from(stored, 'utf8');
}

async function countInStoredFile(filename, stored, words, flags) {
  const ext = getExt(filename);
  if (ext === '.html' || ext === '.htm') return countHtml(stored, words, flags);
  if (ext === '.xml') return countXml(stored, words, flags);
  if (ext === '.docx') return countDocx(stored, words, flags);
  if (ext === '.pdf') {
    try {
      return await countPdf(stored, words, flags);
    } catch (err) {
      throw new FormatParseError(err.message || 'The PDF file is invalid or could not be parsed.');
    }
  }
  return countPlainText(stripUtf8Bom(stored), words, flags);
}

async function replaceInStoredFile(filename, stored, pairs, flags) {
  const ext = getExt(filename);
  if (ext === '.html' || ext === '.htm') return replaceHtml(stored, pairs, flags);
  if (ext === '.xml') return replaceXml(stored, pairs, flags);
  if (ext === '.docx') return replaceDocx(stored, pairs, flags);
  if (ext === '.pdf') {
    try {
      return await replacePdf(stored, pairs, flags);
    } catch (err) {
      if (err instanceof FormatParseError) throw err;
      throw new FormatParseError(err.message || 'The PDF file is invalid or could not be parsed.');
    }
  }
  const result = replacePlainText(stripUtf8Bom(stored), pairs, flags);
  return { stored: result.text, count: result.count };
}

// --- HTML (cheerio): text nodes only; never tags, attributes, or URLs. ---

function loadHtml(html) {
  html = stripUtf8Bom(html);
  const isDocument = /^\s*(<!doctype|<html[\s>])/i.test(html);
  return cheerio.load(html, null, isDocument);
}

function walkHtmlTextNodes(nodes, visit) {
  if (!nodes) return;
  for (const node of nodes) {
    if (node.type === 'text') {
      visit(node);
    } else if (node.type === 'tag' && !SKIP_HTML_TAGS.has(node.name)) {
      walkHtmlTextNodes(node.children, visit);
    }
  }
}

function countHtml(html, words, flags) {
  const $ = loadHtml(html);
  const counts = emptyWordCounts(words, flags.caseSensitive, flags.isRegex);
  walkHtmlTextNodes($.root().contents().toArray(), (node) => {
    addWordCounts(
      counts,
      countPlainText(node.data || '', words, flags),
      words,
      flags.caseSensitive,
      flags.isRegex
    );
  });
  return counts;
}

function replaceHtml(html, pairs, flags) {
  const $ = loadHtml(html);
  let count = 0;
  walkHtmlTextNodes($.root().contents().toArray(), (node) => {
    const result = replacePlainText(node.data || '', pairs, flags);
    node.data = result.text;
    count += result.count;
  });
  return { stored: $.html(), count };
}

// --- XML (@xmldom/xmldom): W3C DOM, text/CDATA nodes only. ---
// Chosen over cheerio xmlMode so namespaces, prefixes, and attributes are not
// HTML-normalized. Chosen over fast-xml-parser so mixed content stays a tree
// of text nodes instead of being flattened into JSON.

function parseXmlDocument(xml) {
  xml = stripUtf8Bom(xml);
  try {
    const doc = new DOMParser({
      onError(level) {
        if (level === 'warning') return;
        throw new FormatParseError('The XML file is invalid and could not be parsed.');
      },
    }).parseFromString(xml, 'application/xml');
    if (!doc || !doc.documentElement) {
      throw new FormatParseError('The XML file is invalid and could not be parsed.');
    }
    return doc;
  } catch (err) {
    if (err instanceof FormatParseError) throw err;
    throw new FormatParseError('The XML file is invalid and could not be parsed.');
  }
}

function restoreXmlDeclaration(original, serialized) {
  original = stripUtf8Bom(original);
  serialized = stripUtf8Bom(serialized);
  const match = original.match(/^\s*<\?xml\b[^?]*\?>\s*/);
  if (!match) return serialized;
  if (/^\s*<\?xml\b/i.test(serialized)) return serialized;
  return match[0] + serialized.replace(/^\s*/, '');
}

function walkXmlTextNodes(node, visit, { onlyWt } = {}) {
  if (!node) return;
  if (onlyWt && isWtElement(node)) {
    for (let i = 0; i < node.childNodes.length; i += 1) {
      const child = node.childNodes[i];
      if (child.nodeType === TEXT_NODE || child.nodeType === CDATA_NODE) {
        visit(child);
      }
    }
    return;
  }
  if (!onlyWt && (node.nodeType === TEXT_NODE || node.nodeType === CDATA_NODE)) {
    visit(node);
    return;
  }
  if (node.nodeType === ELEMENT_NODE) {
    const children = [];
    for (let i = 0; i < node.childNodes.length; i += 1) {
      children.push(node.childNodes[i]);
    }
    for (const child of children) {
      walkXmlTextNodes(child, visit, { onlyWt });
    }
  }
}

function countXml(xml, words, flags) {
  const doc = parseXmlDocument(xml);
  const counts = emptyWordCounts(words, flags.caseSensitive, flags.isRegex);
  walkXmlTextNodes(doc.documentElement, (node) => {
    addWordCounts(
      counts,
      countPlainText(node.data || '', words, flags),
      words,
      flags.caseSensitive,
      flags.isRegex
    );
  });
  return counts;
}

function replaceXml(xml, pairs, flags) {
  const doc = parseXmlDocument(xml);
  let count = 0;
  walkXmlTextNodes(doc.documentElement, (node) => {
    const result = replacePlainText(node.data || '', pairs, flags);
    node.data = result.text;
    count += result.count;
  });
  const serialized = new XMLSerializer().serializeToString(doc);
  return { stored: restoreXmlDeclaration(xml, serialized), count };
}

// --- DOCX: unzip, replace only <w:t> text, re-zip. Per-run matching only. ---

function isWtElement(node) {
  if (!node || node.nodeType !== ELEMENT_NODE) return false;
  if (node.nodeName === 'w:t') return true;
  if (node.localName !== 't') return false;
  return (
    !node.namespaceURI ||
    node.namespaceURI === W_NS ||
    node.namespaceURI === W_NS_STRICT
  );
}

function isWordTextPart(entryName) {
  const n = String(entryName || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (n === 'word/document.xml') return true;
  if (n === 'word/footnotes.xml' || n === 'word/endnotes.xml') return true;
  if (/^word\/header\d*\.xml$/.test(n)) return true;
  if (/^word\/footer\d*\.xml$/.test(n)) return true;
  return false;
}

function openDocxZip(storedBase64) {
  const buffer = Buffer.from(storedBase64, 'base64');
  try {
    return new AdmZip(buffer);
  } catch {
    throw new FormatParseError('The .docx file is invalid or corrupted.');
  }
}

function countDocx(storedBase64, words, flags) {
  const zip = openDocxZip(storedBase64);
  const counts = emptyWordCounts(words, flags.caseSensitive, flags.isRegex);
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || !isWordTextPart(entry.entryName)) continue;
    const xml = stripUtf8Bom(entry.getData().toString('utf8'));
    const doc = parseXmlDocument(xml);
    walkXmlTextNodes(
      doc.documentElement,
      (node) => {
        addWordCounts(
          counts,
          countPlainText(node.data || '', words, flags),
          words,
          flags.caseSensitive,
          flags.isRegex
        );
      },
      { onlyWt: true }
    );
  }
  return counts;
}

function entryBuffer(entry) {
  const data = entry.getData();
  return Buffer.isBuffer(data) ? data : Buffer.from(data);
}

function documentXmlFromStored(storedBase64) {
  const zip = openDocxZip(storedBase64);
  const entry = zip.getEntries().find((item) => {
    const n = String(item.entryName || '').replace(/\\/g, '/');
    return n === 'word/document.xml' || n.endsWith('/word/document.xml');
  });
  return entry ? stripUtf8Bom(entryBuffer(entry).toString('utf8')) : '';
}

function replaceDocx(storedBase64, pairs, flags) {
  const src = openDocxZip(storedBase64);
  const beforeXml = documentXmlFromStored(storedBase64);
  // Do NOT mutate the opened archive with entry.setData() + toBuffer().
  // Search/count read uncompressed XML (so they report the real match count), but
  // AdmZip can still write the original compressed word/document.xml for zips that
  // use data descriptors / extra fields (typical of Word-saved files). Rebuild.
  const out = new AdmZip();
  let count = 0;
  for (const entry of src.getEntries()) {
    if (entry.isDirectory) continue;
    let data = entryBuffer(entry);
    const name = String(entry.entryName || '').replace(/^\/+/, '');
    if (isWordTextPart(name)) {
      const xml = stripUtf8Bom(data.toString('utf8'));
      const doc = parseXmlDocument(xml);
      walkXmlTextNodes(
        doc.documentElement,
        (node) => {
          const result = replacePlainText(node.data || '', pairs, flags);
          node.data = result.text;
          count += result.count;
        },
        { onlyWt: true }
      );
      const serialized = restoreXmlDeclaration(xml, new XMLSerializer().serializeToString(doc));
      data = Buffer.from(serialized, 'utf8');
    }
    out.addFile(name, data);
  }
  const stored = out.toBuffer().toString('base64');
  if (count > 0 && documentXmlFromStored(stored) === beforeXml) {
    throw new Error(
      'DOCX rewrite counted replacements but word/document.xml was unchanged after re-zip.'
    );
  }
  return { stored, count };
}

module.exports = {
  SUPPORTED_EXTS,
  isSupportedExt,
  encodeStoredContent,
  storedToDownloadBuffer,
  countInStoredFile,
  replaceInStoredFile,
  FormatParseError,
};
