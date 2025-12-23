// /code-parts/offline-scripts/refreshMetaAndSitemaps.js
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '../../');
const BASE_ORIGIN = 'https://csgobroker.co';

const LANGS = ['en', 'ru', 'pt', 'es', 'hi', 'tr'];
const ALT_ORDER = ['en', 'ru', 'pt', 'es', 'hi', 'tr'];

// ---------- FS utils ----------
const readFile = (fp) => fs.readFileSync(fp, 'utf-8');
const ensureDir = (d) => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); };
function writeFileIfChanged(fp, next, label) {
  const prev = fs.existsSync(fp) ? readFile(fp) : null;
  if (prev === next) return false;
  ensureDir(path.dirname(fp));
  fs.writeFileSync(fp, next);
  if (label) console.log(label);
  return true;
}

// ---------- scan ----------
const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', '.vercel', '.cache',
  'dist', 'build', 'out', 'tmp', 'temp',
  'code-parts', 'sitemaps', 'assets', 'static',
]);

function collectHtmlFiles(dir) {
  const stack = [dir], res = [];
  while (stack.length) {
    const cur = stack.pop();
    let entries; try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        const top = path.relative(ROOT_DIR, full).split(path.sep)[0];
        if (IGNORE_DIRS.has(e.name) || IGNORE_DIRS.has(top)) continue;
        stack.push(full);
      } else if (e.isFile() && e.name.endsWith('.html')) {
        res.push(full);
      }
    }
  }
  return res;
}

// ---------- url/lang ----------
function relToUrlPath(rel) {
  rel = rel.split(path.sep).join('/');
  if (rel === 'index.html') return '/';
  const mLangRoot = rel.match(/^([a-z]{2})\.html$/i);
  if (mLangRoot && LANGS.includes(mLangRoot[1].toLowerCase())) return `/${mLangRoot[1].toLowerCase()}`;
  if (rel.endsWith('/index.html')) return '/' + rel.slice(0, -'/index.html'.length);
  if (rel.endsWith('.html')) return '/' + rel.slice(0, -'.html'.length);
  return null;
}
function filePathToUrlPath(fp) { return relToUrlPath(path.relative(ROOT_DIR, fp)); }
function detectLangFromUrl(urlPath) {
  if (urlPath === '/') return 'en';
  const first = urlPath.split('/').filter(Boolean)[0] || '';
  return LANGS.includes(first) ? first : 'en';
}
function stripLocale(urlPath) {
  const parts = urlPath.split('/').filter(Boolean);
  if (parts[0] && LANGS.includes(parts[0])) parts.shift();
  return '/' + parts.join('/');
}
function langUrlForKey(keyNoLocale, lang) {
  if (lang === 'en') return keyNoLocale === '/' ? '/' : keyNoLocale;
  return keyNoLocale === '/' ? `/${lang}` : `/${lang}${keyNoLocale}`;
}
function absoluteUrlNormalized(urlPath) {
  return urlPath === '/' ? BASE_ORIGIN : (BASE_ORIGIN + urlPath);
}
// variant-safe
function absoluteUrlWithOrigin(urlPath, origin) {
  return urlPath === '/' ? origin : (origin + urlPath);
}

// ---------- noindex ----------
// Считаем noindex ТОЛЬКО если есть <meta name="robots" content="...noindex/none...">
function hasNoindex(html) {
  if (!html) return false;

  const metas = html.match(/<meta\b[^>]*>/gi) || [];
  for (const raw of metas) {
    const low = raw.toLowerCase();

    // только name="robots"
    const isRobots = /\bname\s*=\s*["']?\s*robots\b/.test(low);
    if (!isRobots) continue;

    const mContent = low.match(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i);
    const content = ((mContent && (mContent[1] || mContent[2] || mContent[3])) || '').toLowerCase();

    if (/\bnoindex\b/.test(content) || /\bnone\b/.test(content)) return true;
  }

  return false;
}

// ---------- head helpers ----------
function ensureHtmlLang(doc, lang) {
  return doc.replace(/<html\b([^>]*)>/i, (m, attrs) => {
    let a = attrs || '';
    if (/\blang\s*=/.test(a)) a = a.replace(/\blang\s*=\s*(['"])[^'"]*\1/i, `lang="${lang}"`);
    else a = (a ? ' ' + a.trim() : '') + ` lang="${lang}"`;
    return `<html${a}>`;
  });
}
function upsertTagInHead(html, tagHtml, findRe) {
  if (findRe.test(html)) return html.replace(findRe, tagHtml);
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${tagHtml}\n</head>`);
  return html + `\n${tagHtml}\n`;
}

// remove <link rel="alternate"> ПОСТРОЧНО (не трогаем отступ следующей строки)
function removeAlternatesFromHeadInner(headInner) {
  let res = headInner
    .replace(/^[ \t]*<link\b[^>]*\brel\s*=\s*["']alternate["'][^>]*>[ \t]*\r?\n?/gmi, '')
    .replace(/\n{3,}/g, '\n\n');
  // why: чистим «висячие» пустые строки/пробелы, которые остаются от прошлых вставок
  res = res.replace(/(\r?\n)[ \t]+(?=\r?\n)/g, '$1');
  return res;
}
function findLastStylesheet(headInner) {
  const re = /<link\b[^>]*\brel\s*=\s*["']stylesheet["'][^>]*>/gmi;
  let last = null;
  for (const m of headInner.matchAll(re)) last = { index: m.index, text: m[0] };
  return last;
}
function computeIndentAtLineStart(headInner, idx, fallback = '    ') {
  const nl = headInner.lastIndexOf('\n', idx);
  const lineStart = nl === -1 ? 0 : nl + 1;
  const seg = headInner.slice(lineStart, idx);
  const m = seg.match(/^[ \t]*/);
  return (m && m[0] !== undefined) ? m[0] : fallback;
}
function detectEol(s) {
  return s.includes('\r\n') ? '\r\n' : '\n';
}

function detectHeadIndent(headInner) {
  // Берём отступ с первой нормальной строки внутри <head> (meta/link/script).
  const m = headInner.match(/(?:^|\r?\n)([ \t]+)<(?:meta|link|script)\b/i);
  return m ? m[1] : '    ';
}

function getLineIndent(line, fallback = '    ') {
  const m = (line || '').match(/^[ \t]*/);
  return (m && m[0] !== undefined) ? (m[0] || fallback) : fallback;
}

function findFirstIndex(lines, re) {
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) return i;
  }
  return -1;
}

function findEarliestIndex(lines, res) {
  let best = -1;
  for (const re of res) {
    const idx = findFirstIndex(lines, re);
    if (idx !== -1 && (best === -1 || idx < best)) best = idx;
  }
  return best;
}

function upsertCoreSeoHeadTags(html, canonicalHref, lang) {
  const m = html.match(/(<head\b[^>]*>)([\s\S]*?)(<\/head>)/i);
  if (!m) return html;

  const open = m[1];
  const inner = m[2];
  const close = m[3];

  const eol = detectEol(inner);
  let lines = inner.split(/\r?\n/);

  // 1) Удаляем старые canonical/googlebot/og:url/og:locale (строками, чтобы не было "съезда" и дублей)
  const removeRes = [
    /^\s*<link\b[^>]*\brel\s*=\s*["']canonical["'][^>]*\/?>\s*$/i,
    /^\s*<meta\b[^>]*\bname\s*=\s*["']?\s*googlebot\s*["']?[^>]*\/?>\s*$/i,
    /^\s*<meta\b[^>]*\bproperty\s*=\s*["']og:url["'][^>]*\/?>\s*$/i,
    /^\s*<meta\b[^>]*\bproperty\s*=\s*["']og:locale["'][^>]*\/?>\s*$/i,
  ];
  lines = lines.filter(line => !removeRes.some(re => re.test(line)));

  // 2) Вставка canonical/googlebot рядом с SEO-метами (description/robots/og)
  const seoAnchorIdx = findEarliestIndex(lines, [
    /^\s*<meta\b[^>]*\bname\s*=\s*["']?\s*description\b/i,
    /^\s*<meta\b[^>]*\bname\s*=\s*["']?\s*robots\b/i,
    /^\s*<meta\b[^>]*\bproperty\s*=\s*["']og:/i,
    /^\s*<link\b[^>]*\brel\s*=\s*["']icon["']/i,
  ]);

  // fallback: после </title>, если вдруг нет SEO-мет
  let titleIdx = findFirstIndex(lines, /<\/title\s*>/i);
  const baseInsertIdx = (seoAnchorIdx !== -1)
    ? seoAnchorIdx
    : (titleIdx !== -1 ? titleIdx + 1 : 0);

  const indentSeo = (baseInsertIdx >= 0 && baseInsertIdx < lines.length)
    ? getLineIndent(lines[baseInsertIdx], detectHeadIndent(inner))
    : detectHeadIndent(inner);

  // вставляем canonical
  lines.splice(baseInsertIdx, 0, `${indentSeo}<link rel="canonical" href="${canonicalHref}">`);
  const canonicalLineIdx = baseInsertIdx;

  // вставляем googlebot — сразу после <meta name="robots"> если он есть, иначе после canonical
  const robotsIdx = findFirstIndex(lines, /^\s*<meta\b[^>]*\bname\s*=\s*["']?\s*robots\b/i);
  const gbInsertIdx = (robotsIdx !== -1) ? (robotsIdx + 1) : (canonicalLineIdx + 1);
  const indentGb = (gbInsertIdx >= 0 && gbInsertIdx < lines.length)
    ? getLineIndent(lines[gbInsertIdx], indentSeo)
    : indentSeo;

  lines.splice(gbInsertIdx, 0, `${indentGb}<meta name="googlebot" content="noindex, nofollow">`);

  // 3) OG-блок: og:url + og:locale рядом с остальными OG (после og:type, либо перед первым og:*)
  const ogTypeIdx = findFirstIndex(lines, /^\s*<meta\b[^>]*\bproperty\s*=\s*["']og:type["'][^>]*\/?>\s*$/i);
  const firstOgIdx = findFirstIndex(lines, /^\s*<meta\b[^>]*\bproperty\s*=\s*["']og:/i);

  let ogInsertIdx = -1;
  if (ogTypeIdx !== -1) ogInsertIdx = ogTypeIdx + 1;
  else if (firstOgIdx !== -1) ogInsertIdx = firstOgIdx;
  else ogInsertIdx = gbInsertIdx + 1;

  const indentOg = (ogInsertIdx >= 0 && ogInsertIdx < lines.length)
    ? getLineIndent(lines[ogInsertIdx], indentSeo)
    : indentSeo;

  lines.splice(
    ogInsertIdx,
    0,
    `${indentOg}<meta property="og:url" content="${canonicalHref}">`,
    `${indentOg}<meta property="og:locale" content="${lang}">`
  );

  const nextInner = lines.join(eol);
  return html.replace(/(<head\b[^>]*>)[\s\S]*?(<\/head>)/i, `${open}${nextInner}${close}`);
}

function buildAlternateLines(keyNoLocale, presentLangs) {
  const lines = [];
  for (const lang of ALT_ORDER) {
    if (!presentLangs.has(lang)) continue;
    const href = absoluteUrlNormalized(langUrlForKey(keyNoLocale, lang));
    lines.push(`<link rel="alternate" hreflang="${lang}" href="${href}">`);
  }
  return lines;
}

// вставка под последним stylesheet (без накопления пустых строк)
function insertAlternatesUnderLastStylesheet(html, keyNoLocale, presentLangs) {
  const m = html.match(/(<head\b[^>]*>)([\s\S]*?)(<\/head>)/i);
  if (!m) return html;

  const open = m[1], inner = m[2], close = m[3];
  let headInner = removeAlternatesFromHeadInner(inner);

  const lastCss = findLastStylesheet(headInner);
  const insertIdx = lastCss ? (lastCss.index + lastCss.text.length) : headInner.length;
  const indent = lastCss
    ? computeIndentAtLineStart(headInner, lastCss.index)
    : computeIndentAtLineStart(headInner, insertIdx);

  const lines = buildAlternateLines(keyNoLocale, presentLangs);
  if (!lines.length) return html;

  const nextChar = headInner[insertIdx] || '';
  const skip = nextChar === '\n' ? 1 : 0; // why: заменяем один существующий \n, чтобы он не оставался «лишним»

  const before = headInner.slice(0, insertIdx);
  let after = headInner.slice(insertIdx + skip);

  // нормализуем начало хвоста: не больше одного пустого ряда
  after = after.replace(/^(?:[ \t]*\r?\n)+/, '\n');

  const block = '\n' + lines.map(l => indent + l).join('\n') + '\n';

  headInner = before + block + after;

  return html.replace(/(<head\b[^>]*>)[\s\S]*?(<\/head>)/i, `${open}${headInner}${close}`);
}

// ---------- sitemap hreflang helpers ----------
function parseAlternatesFromHead(html) {
  const m = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i);
  const headInner = m ? m[1] : html;
  const links = headInner.match(/<link\b[^>]*\brel\s*=\s*["']alternate["'][^>]*>/gmi) || [];
  /** @type {Map<string,string>} */
  const map = new Map();
  for (const raw of links) {
    const hreflangM = raw.match(/\bhreflang\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s"'>]+))/i);
    const hrefM = raw.match(/\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s"'>]+))/i);
    const lang = (hreflangM && (hreflangM[1] || hreflangM[2] || hreflangM[3]) || '').trim().toLowerCase();
    const href = (hrefM && (hrefM[1] || hrefM[2] || hrefM[3]) || '').trim();
    if (!lang || !href) continue;
    if (!map.has(lang)) map.set(lang, href);
  }
  const ordered = [];
  for (const lang of ALT_ORDER) if (map.has(lang)) ordered.push({ lang, href: map.get(lang) });
  if (map.has('x-default')) ordered.push({ lang: 'x-default', href: map.get('x-default') });
  for (const [lang, href] of map.entries()) {
    if (ALT_ORDER.includes(lang) || lang === 'x-default') continue;
    ordered.push({ lang, href });
  }
  return ordered;
}

function makeFallbackAlternatesForKey(keyNoLocale, presentLangs) {
  const res = [];
  for (const lang of ALT_ORDER) {
    if (!presentLangs.has(lang)) continue;
    res.push({ lang, href: absoluteUrlNormalized(langUrlForKey(keyNoLocale, lang)) });
  }
  return res;
}
function makeFallbackAlternatesForKeyWithOrigin(keyNoLocale, presentLangs, origin) {
  const res = [];
  for (const lang of ALT_ORDER) {
    if (!presentLangs.has(lang)) continue;
    res.push({ lang, href: absoluteUrlWithOrigin(langUrlForKey(keyNoLocale, lang), origin) });
  }
  return res;
}

function isNonRuBucket(bucketName) {
  return !/_ru$/.test(bucketName);
}

// ---------- category & sitemap ----------
function isReviewsPath(urlPath) {
  return /^\/(?:[a-z]{2}\/)?reviews\/|^\/(?:[a-z]{2}\/)?mirrors\//i.test(urlPath);
}
function isTopicPath(urlPath) {
  return /^\/(?:[a-z]{2}\/)?topic(\/|$)/i.test(urlPath);
}
function computePriority(urlPath) {
  const d = stripLocale(urlPath).split('/').filter(Boolean).length;
  if (d <= 1) return '1.0';
  if (d === 2) return '0.8';
  if (d === 3) return '0.6';
  return '0.5';
}

function buildSitemapXml(entries, { includeAlternates = false, alternatesByKey = new Map() } = {}) {
  const ns = includeAlternates ? ' xmlns:xhtml="http://www.w3.org/1999/xhtml"' : '';
  const head = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${ns}>`;

  const body = entries
    .slice()
    .sort((a, b) => a.loc.localeCompare(b.loc, 'en'))
    .map(e => {
      const alt = includeAlternates ? (alternatesByKey.get(e.key) || []) : [];
      const links = alt.map(a => `    <xhtml:link rel="alternate" hreflang="${a.lang}" href="${a.href}" />`).join('\n');
      return [
        '  <url>',
        `    <loc>${e.loc}</loc>`,
        links || null,
        `    <lastmod>${e.lastmod}</lastmod>`,
        `    <priority>${e.priority || computePriority(new URL(e.loc).pathname)}</priority>`,
        '  </url>',
      ].filter(Boolean).join('\n');
    })
    .join('\n');

  return head + (body ? '\n' + body + '\n' : '\n') + '</urlset>\n';
}

// ---------- variants helpers ----------
function remapEntriesOrigin(entries, origin) {
  return entries.map(e => {
    const url = new URL(e.loc);
    const newLoc = absoluteUrlWithOrigin(url.pathname + url.search + url.hash, origin);
    return { ...e, loc: newLoc };
  });
}
function buildAlternatesByKeyForOrigin(presentLangsByKey, origin) {
  const map = new Map();
  for (const [key, langs] of presentLangsByKey.entries()) {
    map.set(key, makeFallbackAlternatesForKeyWithOrigin(key, langs, origin));
  }
  return map;
}

// ---------- main ----------
function main() {
  const files = collectHtmlFiles(ROOT_DIR);

  /** @type {Array<{filePath:string,urlPath:string,lang:string,key:string,abs:string,mtime:string,noindex:boolean}>} */
  const pages = [];
  const presentLangsByKey = new Map(); // все локали (вкл. noindex) для alternate
  const alternatesByKey = new Map();   // key -> Array<{lang,href}>

  for (const fp of files) {
    const urlPath = filePathToUrlPath(fp);
    if (!urlPath) continue;

    const lang = detectLangFromUrl(urlPath);
    const key = stripLocale(urlPath);
    const abs = absoluteUrlNormalized(urlPath);
    const html = readFile(fp);
    const ni = hasNoindex(html);
    const stats = fs.statSync(fp);
    const mtime = stats.mtime.toISOString();

    pages.push({ filePath: fp, urlPath, lang, key, abs, mtime, noindex: ni });

    // учитываем локали
    const set = presentLangsByKey.get(key) || new Set();
    set.add(lang);
    presentLangsByKey.set(key, set);

    // парсим hreflang из HEAD
    const parsed = parseAlternatesFromHead(html);
    if (parsed.length) {
      const cur = alternatesByKey.get(key) || [];
      const seen = new Map(cur.map(x => [x.lang, x.href]));
      for (const a of parsed) if (!seen.has(a.lang)) seen.set(a.lang, a.href);
      const ordered = [];
      for (const l of ALT_ORDER) if (seen.has(l)) ordered.push({ lang: l, href: seen.get(l) });
      if (seen.has('x-default')) ordered.push({ lang: 'x-default', href: seen.get('x-default') });
      for (const [l, h] of seen.entries()) {
        if (ALT_ORDER.includes(l) || l === 'x-default') continue;
        ordered.push({ lang: l, href: h });
      }
      alternatesByKey.set(key, ordered);
    }
  }

  // Фолбэк для key без альтов
  for (const [key, langs] of presentLangsByKey.entries()) {
    if (!alternatesByKey.has(key) || alternatesByKey.get(key).length === 0) {
      alternatesByKey.set(key, makeFallbackAlternatesForKey(key, langs));
    }
  }

  // Step 1: обновляем head (все страницы)
  let changedHtmlCount = 0;
  for (const p of pages) {
    const present = presentLangsByKey.get(p.key) || new Set([p.lang]);
    const canonicalHref = absoluteUrlNormalized(p.urlPath);

    const before = readFile(p.filePath);
    let html = before;

  html = ensureHtmlLang(html, p.lang);
  html = upsertCoreSeoHeadTags(html, canonicalHref, p.lang);

    html = insertAlternatesUnderLastStylesheet(html, p.key, present);

    if (html !== before) {
      fs.writeFileSync(p.filePath, html);
      changedHtmlCount++;
    }
  }

  // Step 2: buckets (только индексируемые)
  const buckets = {
    main_en: [], main_ru: [],
    reviews_en: [], reviews_ru: [],
    topics_en: [], topics_ru: [],
    reviews_es: [],
  };

  for (const p of pages) {
    if (p.noindex) continue;
    const entry = { loc: p.abs, lastmod: p.mtime, priority: computePriority(p.urlPath), key: p.key };

    if (isTopicPath(p.urlPath)) {
      if (p.lang === 'en') buckets.topics_en.push(entry);
      else if (p.lang === 'ru') buckets.topics_ru.push(entry);
      continue;
    }
    if (isReviewsPath(p.urlPath)) {
      if (p.lang === 'en') buckets.reviews_en.push(entry);
      else if (p.lang === 'ru') buckets.reviews_ru.push(entry);
      else if (p.lang === 'es') buckets.reviews_es.push(entry);
      continue;
    }
    if (p.lang === 'en') buckets.main_en.push(entry);
    else if (p.lang === 'ru') buckets.main_ru.push(entry);
  }

  const rootNames = {
    main_en: 'sitemap_main.xml',
    main_ru: 'sitemap_main_ru.xml',
    reviews_en: 'sitemap_reviews.xml',
    reviews_ru: 'sitemap_reviews_ru.xml',
    topics_en: 'sitemap_topics.xml',
    topics_ru: 'sitemap_topics_ru.xml',
    reviews_es: 'sitemap_reviews_es.xml',
  };

  // Писатель под таргет-оригин/директорию
  function writeBucketSitemaps(targetDir, origin, opts = {}) {
    const inRoot = !targetDir;
    const altByKey = inRoot ? alternatesByKey : buildAlternatesByKeyForOrigin(presentLangsByKey, origin);
    let changed = 0;

    for (const [bucket, name] of Object.entries(rootNames)) {
      const includeAlternates = isNonRuBucket(bucket);
      const sourceEntries = buckets[bucket] || [];
      const entries = inRoot ? sourceEntries : remapEntriesOrigin(sourceEntries, origin);
      const xml = buildSitemapXml(entries, { includeAlternates, alternatesByKey: altByKey });
      const outPath = inRoot
        ? path.join(ROOT_DIR, name)
        : path.join(ROOT_DIR, targetDir, name);
      const label = `✅ ${inRoot ? '' : `${targetDir}/`}${name} updated.`;
      if (writeFileIfChanged(outPath, xml, label)) changed++;
    }
    return changed;
  }

  // Корень (старое поведение)
  let changedSitemaps = 0;
  changedSitemaps += writeBucketSitemaps('', BASE_ORIGIN);

  // changedSitemaps += writeBucketSitemaps('sitemaps_me', 'https://csgobroker.me');
  // Replaced cs2freebies.com -> csgobroker.co and sitemaps_com -> sitemaps_co
  changedSitemaps += writeBucketSitemaps('sitemaps_co', 'https://csgobroker.co');

  console.log(`🏁 Done. HTML changed: ${changedHtmlCount}, sitemaps changed: ${changedSitemaps}.`);
}

if (require.main === module) main();
