// /code-parts/offline-scripts/buildSearchConfig.js
/**
 * Генерирует:
 *   - /code-parts/search-config/config.json
 *   - /code-parts/search-config/translations.json
 *   - /code-parts/search-config/menu-build.json
 *
 * Правки:
 *   1) FIX: ключи больше не сводятся к /reviews/*.
 *   2) "icon" для /reviews/* и /mirrors/*, приоритет — пользовательский.
 *   3) noindex: исключаем ключ, если у любой версии страницы есть meta robots noindex;
 *      вклад из noindex-страниц игнорируется.
 *   4) ❗️og НЕ заполняем из og:site_name; en/ru приоритетнее og.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '../../');
const OUT_DIR = path.join(ROOT_DIR, 'code-parts', 'search-config');
const CONFIG_PATH = path.join(OUT_DIR, 'config.json');
const TRANSL_PATH = path.join(OUT_DIR, 'translations.json');
const MENU_OUT_PATH = path.join(OUT_DIR, 'menu-build.json');

// Категории (SOLID)
const CAT_DIR = path.join(ROOT_DIR, 'code-parts', 'category-import');
const CAT_CONTENTS_PATH = path.join(CAT_DIR, 'category-contents.json');
const CAT_TRANSL_PATH   = path.join(CAT_DIR, 'category-translations.json');

// Wiki topics (SOLID)
const TOPICS_NAV_PATH = path.join(ROOT_DIR, 'code-parts', 'topics', 'topics-nav.json');

const argv = new Set(process.argv.slice(2));
const argvRaw = process.argv.slice(2);

const FLAGS = {
  forceReviews:
    argv.has('--force-reviews') ||
    argv.has('--force-reviews-labels') ||
    process.env.FORCE_REVIEWS === '1',
  debug: argv.has('--debug') || process.env.DEBUG === '1',
};

// ---------- FS ----------
function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }
function readFileSafe(fp) { try { return fs.readFileSync(fp, 'utf-8'); } catch { return null; } }
function readJsonSafe(fp, fb) { try { return JSON.parse(fs.readFileSync(fp, 'utf-8')); } catch { return fb; } }
function writeJsonPretty(fp, obj) { fs.writeFileSync(fp, JSON.stringify(obj, null, 2) + '\n'); }

// ---------- Args ----------
function getArgNum(name, envName, def) {
  const pfx = `--${name}=`;
  const hit = argvRaw.find(a => a.startsWith(pfx));
  if (hit) {
    const n = Number(hit.slice(pfx.length));
    return Number.isFinite(n) && n >= 0 ? n : def;
  }
  const envv = process.env[envName];
  if (envv !== undefined) {
    const n = Number(envv);
    return Number.isFinite(n) && n >= 0 ? n : def;
  }
  return def;
}

const LIMITS = {
  popular: {
    gambling: getArgNum('limit-popular-gambling', 'LIMIT_POPULAR_GAMBLING', 15),
    trading:  getArgNum('limit-popular-trading',  'LIMIT_POPULAR_TRADING',  0),
  },
  cs2Sites: {
    gambling:     getArgNum('limit-cs2-gambling',       'LIMIT_CS2_GAMBLING',       15),
    tradingSell:  getArgNum('limit-cs2-trading-sell',   'LIMIT_CS2_TRADING_SELL',   5),
    tradingTrade: getArgNum('limit-cs2-trading-trade',  'LIMIT_CS2_TRADING_TRADE',  5),
  },
  rust: {
    gambling:     getArgNum('limit-rust-gambling',       'LIMIT_RUST_GAMBLING',       15),
    tradingSell:  getArgNum('limit-rust-trading-sell',   'LIMIT_RUST_TRADING_SELL',   5),
    tradingTrade: getArgNum('limit-rust-trading-trade',  'LIMIT_RUST_TRADING_TRADE',  5),
  },
  crypto: {
    gambling:     getArgNum('limit-crypto-gambling',     'LIMIT_CRYPTO_GAMBLING',     25),
  },
  earning: {
    list:         getArgNum('limit-earning',             'LIMIT_EARNING',             0),
  },
  steam: {
    list:         getArgNum('limit-steam',               'LIMIT_STEAM',               10),
  },
  newest: {
    list:         getArgNum('limit-newest',              'LIMIT_NEWEST',              30),
  },
};
LIMITS.popular.gamblingRu   = getArgNum('limit-popular-gambling-ru', 'LIMIT_POPULAR_GAMBLING_RU', LIMITS.popular.gambling);
LIMITS.popular.tradingRu    = getArgNum('limit-popular-trading-ru',  'LIMIT_POPULAR_TRADING_RU',  LIMITS.popular.trading);

LIMITS.cs2Sites.gamblingRu     = getArgNum('limit-cs2-gambling-ru',       'LIMIT_CS2_GAMBLING_RU',       LIMITS.cs2Sites.gambling);
LIMITS.cs2Sites.tradingSellRu  = getArgNum('limit-cs2-trading-sell-ru',   'LIMIT_CS2_TRADING_SELL_RU',   LIMITS.cs2Sites.tradingSell);
LIMITS.cs2Sites.tradingTradeRu = getArgNum('limit-cs2-trading-trade-ru',  'LIMIT_CS2_TRADING_TRADE_RU',  LIMITS.cs2Sites.tradingTrade);

LIMITS.rust.gamblingRu     = getArgNum('limit-rust-gambling-ru',       'LIMIT_RUST_GAMBLING_RU',       LIMITS.rust.gambling);
LIMITS.rust.tradingSellRu  = getArgNum('limit-rust-trading-sell-ru',   'LIMIT_RUST_TRADING_SELL_RU',   LIMITS.rust.tradingSell);
LIMITS.rust.tradingTradeRu = getArgNum('limit-rust-trading-trade-ru',  'LIMIT_RUST_TRADING_TRADE_RU',  LIMITS.rust.tradingTrade);

LIMITS.crypto.gamblingRu   = getArgNum('limit-crypto-gambling-ru',     'LIMIT_CRYPTO_GAMBLING_RU',     LIMITS.crypto.gambling);

LIMITS.steam.listRu        = getArgNum('limit-steam-ru',               'LIMIT_STEAM_RU',               LIMITS.steam.list);
LIMITS.newest.listRu       = getArgNum('limit-newest-ru',              'LIMIT_NEWEST_RU',              LIMITS.newest.list);

// ---------- URL/Path ----------
function filePathToUrlPath(filePath) {
  let rel = path.relative(ROOT_DIR, filePath).split(path.sep).join('/');
  if (!rel.endsWith('.html')) return null;
  if (rel === 'index.html') return '/';
  if (rel.endsWith('/index.html')) return '/' + rel.slice(0, -'/index.html'.length);
  return '/' + rel.slice(0, -'.html'.length);
}
function getLocale(urlPath) {
  const parts = urlPath.split('/').filter(Boolean);
  const cand = parts[0] || '';
  return cand.length === 2 ? cand : '';
}
function normalizeKeyNoLocale(urlPath) {
  if (!urlPath.startsWith('/')) urlPath = '/' + urlPath;
  const parts = urlPath.split('/').filter(Boolean);
  if (parts[0] && parts[0].length === 2) parts.shift();
  return '/' + parts.join('/');
}
function isReviewsUrl(urlPath) { return /^\/(?:ru\/)?reviews\/[^/]+\/?$/.test(urlPath); }
function isMirrorsUrl(urlPath) { return /^\/(?:ru\/)?mirrors\/[^/]+\/?$/.test(urlPath); }
function reviewsSlug(urlPath) { const m = urlPath.match(/^\/(?:ru\/)?reviews\/([^/]+)\/?$/); return m ? m[1] : null; }
const keyFromSlug = (slug) => `/reviews/${slug}`;

// Try to read either /route.html or /route/index.html
function readRouteHtml(route) {
  let r = String(route || '').replace(/\/+$/, '');
  if (!r.startsWith('/')) r = '/' + r;
  const rel = r.replace(/^\//, '');
  const p1 = path.join(ROOT_DIR, rel + '.html');
  const p2 = path.join(ROOT_DIR, ...rel.split('/'), 'index.html');
  return readFileSafe(p1) || readFileSafe(p2) || '';
}

// ---------- HTML helpers ----------
function section(html, tag) {
  const m = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? m[1] : '';
}
function metaContent(scope, key, by = 'name') {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<meta\\b[^>]*${by}\\s*=\\s*["']${esc}["'][^>]*>`, 'i');
  const m = scope.match(re);
  if (!m) return null;
  const tag = m[0];
  const mc = tag.match(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i);
  return (mc && (mc[1] || mc[2] || mc[3])) || null;
}
const og = (scope, prop) => metaContent(scope, prop, 'property');

function titleFrom(html) {
  const head = section(html, 'head') || html;
  const ot = og(head, 'og:title');
  if (ot) return ot;
  const m = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].trim() : null;
}
function h1From(html) {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return m ? m[1].replace(/<[^>]+>/g, '').trim() : null;
}
function keywordsFrom(html) {
  const head = section(html, 'head') || html;
  const kw = metaContent(head, 'keywords', 'name') || metaContent(head, 'keywords', 'property');
  if (!kw) return [];
  return kw.split(',').map(s => s.trim()).filter(Boolean);
}
function cleanLabel(s) { return s ? s.replace(/\s*[|—-]\s*CSGOBroker.*$/i, '').trim() : s; }
function cleanKeywords(list) {
  if (!Array.isArray(list)) return [];
  const out = []; const seen = new Set();
  for (const t of list) {
    if (!t) continue;
    if (/csgobroker/i.test(t)) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k); out.push(t);
  }
  return out;
}

// ---------- noindex detector ----------
function hasNoindex(html) {
  if (!html) return false;
  const metas = html.match(/<meta\b[^>]*>/gi) || [];
  for (const raw of metas) {
    const tag = raw;
    const who = (getAttrLower(tag, 'name') || getAttrLower(tag, 'property') || getAttrLower(tag, 'http-equiv')) || '';
    if (!/(robots|googlebot|x-robots-tag)/i.test(who)) continue;
    const content = (getAttr(tag, 'content') || '').toLowerCase();
    if (!content) continue;
    if (/(^|[^a-z0-9_-])(noindex|none)([^a-z0-9_-]|$)/i.test(content)) return true;
  }
  return false;

  function getAttr(src, name) {
    const re = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
    const m = src.match(re);
    return m ? (m[1] || m[2] || m[3] || '').trim() : '';
  }
  function getAttrLower(src, name) { return getAttr(src, name).toLowerCase(); }
}

// ---------- Project scan ----------
const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', '.vercel', '.cache',
  'dist', 'build', 'out', 'tmp', 'temp',
  'code-parts', 'sitemaps', 'sitemaps_me', 'assets', 'static',
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

// ---------- Merge translations ----------
function mergeTranslations(base, add) {
  const out = { ...(base || {}) };
  // приоритет: en, ru, потом og; не перетираем существующие значения
  for (const k of ['en', 'ru', 'og']) if (!out[k] && add[k]) out[k] = add[k];
  if (Array.isArray(add.keywords) && add.keywords.length) {
    out.keywords = Array.from(new Set([...(out.keywords || []), ...add.keywords]));
  } else if (!out.keywords && add.keywords) {
    out.keywords = add.keywords;
  }
  out.keywords = cleanKeywords(out.keywords || []);
  return out;
}

// ---------- Menu helpers ----------
function minimalNode(key, titleEn, titleRu) {
  return { key, icon: key, title: { en: titleEn, ru: titleRu }, groups: [], solid: [] };
}
function loadMenuBase() {
  const cand = [MENU_OUT_PATH, path.join(OUT_DIR, 'menu-template.json'), path.join(ROOT_DIR, 'menu-build.json')];
  for (const fp of cand) { const j = readJsonSafe(fp, null); if (j && typeof j === 'object') return j; }
  return { nav: [] };
}
function findEntry(menu, key) { return (menu.nav || []).find(n => n && n.key === key) || null; }
function ensureGroups(node, count) { node.groups = Array.isArray(node.groups) ? node.groups : []; while (node.groups.length < count) node.groups.push({ name: {}, reviews: [] }); }
function normalizeReviewHref(href) {
  if (!href) return null;
  href = href.trim().replace(/^https?:\/\/[^/]+/i, '').replace(/#.*$/, '').replace(/\?.*$/, '');
  href = href.replace(/^\/ru\/reviews\//, '/reviews/');
  const m = href.match(/^\/reviews\/([^/]+)\/?$/);
  return m ? `/reviews/${m[1]}` : null;
}
function normalizeSolidHref(href) {
  if (!href) return null;
  href = href.trim().replace(/^https?:\/\/[^/]+/i, '').replace(/#.*$/, '').replace(/\?.*$/, '');
  if (!href.startsWith('/')) href = '/' + href;
  return href.replace(/\/+$/, '');
}
function getAttr(tag, name) { const re = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i'); const m = tag.match(re); return m ? (m[1] || m[2] || m[3] || '').trim() : ''; }
function findMatchingTagEnd(html, startIndex) {
  const tagFinder = /<\/?(div|section)\b/gi; tagFinder.lastIndex = startIndex; let depth = 0, m;
  while ((m = tagFinder.exec(html)) !== null) {
    const isClose = html[m.index + 1] === '/'; const gt = html.indexOf('>', m.index); if (gt === -1) return -1;
    if (!isClose) depth++; else depth--; if (depth === 0) return gt + 1; tagFinder.lastIndex = gt + 1;
  } return -1;
}
function findSectionBlocks(html, targets) {
  if (!html) return [];
  const re = /<(div|section)\b[^>]*class\s*=\s*("|\')([^"\']*)\2[^>]*>/gi; const blocks = []; let m;
  while ((m = re.exec(html)) !== null) {
    const cls = (m[3] || '').split(/\s+/);
    if (!cls.includes('boxes-holder-section')) continue;
    if (!targets.some(t => cls.includes(t))) continue;
    const end = findMatchingTagEnd(html, m.index); if (end > m.index) blocks.push(html.slice(m.index, end));
  } return blocks;
}
function findBoxesHolderBlocks(html) {
  if (!html) return [];
  const re = /<(div|section)\b[^>]*class\s*=\s*("|\')([^"\']*)\2[^>]*>/gi; const blocks = []; let m;
  while ((m = re.exec(html)) !== null) {
    const cls = (m[3] || '').split(/\s+/);
    if (!cls.includes('boxes-holder')) continue;
    const end = findMatchingTagEnd(html, m.index); if (end > m.index) blocks.push(html.slice(m.index, end));
  } return blocks;
}
function extractCardsFromSectionBlock(blockHtml) {
  const results = [];
  const reLogoOpen = /<div\b[^>]*class\s*=\s*("|\')([^"\']*\blogobg\b[^"\']*)\1[^>]*>/gi; let m;
  while ((m = reLogoOpen.exec(blockHtml)) !== null) {
    const start = m.index; const end = findMatchingTagEnd(blockHtml, start); if (end === -1) continue;
    const content = blockHtml.slice(start, end);
    const aTag = content.match(/<a\b[^>]*>/i); const imgTag = content.match(/<img\b[^>]*>/i);
    if (!aTag || !imgTag) continue;
    const href = normalizeReviewHref(getAttr(aTag[0], 'href')); if (!href) continue;
    let img = getAttr(imgTag[0], 'src') || ''; if (!img.startsWith('/')) img = '/' + img.replace(/^\.?\//, '');
    let alt = getAttr(imgTag[0], 'alt') || 'logo';
    results.push({ href, img, alt });
  }
  return results;
}
function dedupeByHref(list) { const seen = new Set(); const out = []; for (const it of list) { if (!it || !it.href) continue; if (seen.has(it.href)) continue; seen.add(it.href); out.push(it); } return out; }
function capList(list, limit) { if (!limit || limit <= 0) return list.slice(); return list.slice(0, limit); }
function localizeHref(list, locale) { if (!Array.isArray(list) || locale !== 'ru') return list; return list.map(item => (!item || !item.href) ? item : { ...item, href: item.href.startsWith('/ru/') ? item.href : `/ru${item.href}` }); }

// ---------- Build: CONFIG + TRANSLATIONS ----------
function buildSearchConfigAndTranslations() {
  const files = collectHtmlFiles(ROOT_DIR);

  const keyState = new Map();   // key -> { anyIndexed, anyNoindex }
  const drafts = new Map();     // key -> partial translation (keywords, en/ru labels, og только вручную)
  const reviewLabels = new Map(); // slug -> { en?, ru? }

  for (const fp of files) {
    const urlPath = filePathToUrlPath(fp);
    if (!urlPath) continue;

    const html = readFileSafe(fp);
    if (!html) continue;

    const loc = getLocale(urlPath);
    if (loc && loc !== 'ru') continue; // только '' и 'ru'

    const isReview = isReviewsUrl(urlPath);
    const key = isReview ? keyFromSlug(reviewsSlug(urlPath)) : normalizeKeyNoLocale(urlPath);

    const ni = hasNoindex(html);
    const st = keyState.get(key) || { anyIndexed: false, anyNoindex: false };
    if (ni) st.anyNoindex = true; else st.anyIndexed = true;
    keyState.set(key, st);

    if (ni) continue; // не учитываем noindex-страницы

    const head = section(html, 'head') || html;

    if (isReview) {
      const slug = reviewsSlug(urlPath);
      if (!slug) continue;

      const alt = cleanLabel(og(head, 'og:image:alt') || '');
      const prev = reviewLabels.get(slug) || {};
      if (loc === 'ru') { if (alt) prev.ru = alt; } else { if (alt) prev.en = alt; }
      reviewLabels.set(slug, prev);

      const rec = drafts.get(key) || {};
      const kw = cleanKeywords(keywordsFrom(html));
      const hints = cleanKeywords([slug, 'обзор', 'review']);
      rec.keywords = cleanKeywords([...(rec.keywords || []), ...kw, ...hints]);

      if (!FLAGS.forceReviews) {
        if (!rec.en && prev.en) rec.en = prev.en;
        if (!rec.ru && prev.ru) rec.ru = prev.ru;
      }

      drafts.set(key, rec);
      continue;
    }

    // обычные страницы
    const rec = drafts.get(key) || {};
    const label = cleanLabel(titleFrom(html) || h1From(html) || '');
    const kw = cleanKeywords(keywordsFrom(html));
    if (loc === 'ru') { if (label && !rec.ru) rec.ru = label; }
    else { if (label && !rec.en) rec.en = label; }
    rec.keywords = cleanKeywords([...(rec.keywords || []), ...kw]);
    drafts.set(key, rec);
  }

  // Живые ключи: есть индексируемая версия И нет ни одной noindex-версии
  const aliveKeys = new Set(
    [...keyState.entries()].filter(([, s]) => s.anyIndexed && !s.anyNoindex).map(([k]) => k)
  );

  if (FLAGS.debug) {
    const dropped = [...keyState.entries()]
      .filter(([, s]) => !(s.anyIndexed && !s.anyNoindex))
      .map(([k, s]) => `${k}  (indexed:${s.anyIndexed}, noindex:${s.anyNoindex})`);
    if (dropped.length) console.log('⛔ Excluded by noindex/missing indexable:\n' + dropped.join('\n'));
  }

  const existingConfig = readJsonSafe(CONFIG_PATH, { sites: [] });
  const existingTransl = readJsonSafe(TRANSL_PATH, {});

  const mergedSites = Array.from(new Set([...(existingConfig.sites || []), ...aliveKeys]))
    .filter(s => aliveKeys.has(s))
    .sort((a, b) => a.localeCompare(b, 'en'));

  const allKeys = Array.from(new Set([...Object.keys(existingTransl), ...aliveKeys]))
    .filter(k => aliveKeys.has(k))
    .sort((a, b) => a.localeCompare(b, 'en'));

  const mergedTranslations = {};
  for (const k of allKeys) {
    const base = existingTransl[k];
    const add = drafts.get(k) || {};
    let merged = mergeTranslations(base, add);

    // Спец-обработка /reviews/*
    const m = k.match(/^\/reviews\/([^/]+)$/);
    if (m) {
      const slug = m[1];
      const labels = reviewLabels.get(slug) || {};
      if (FLAGS.forceReviews) {
        if (labels.en) merged.en = labels.en;
        if (labels.ru) merged.ru = labels.ru;
      } else {
        if (!merged.en && labels.en) merged.en = labels.en;
        if (!merged.ru && labels.ru) merged.ru = labels.ru;
      }
      if (!merged.en && !merged.ru) {
        const fallback = slug.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        merged.en = fallback; merged.ru = merged.ru || fallback;
      } else {
        if (!merged.ru) merged.ru = merged.en;
        if (!merged.en) merged.en = merged.ru;
      }
    } else {
      // обычные страницы
      if (!merged.en && !merged.ru) {
        const label = k === '/' ? 'Home' : k.split('/').filter(Boolean).slice(-1)[0]
          .replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        merged.en = label; merged.ru = merged.ru || label;
      } else {
        if (!merged.ru) merged.ru = merged.en;
        if (!merged.en) merged.en = merged.ru;
      }
    }

    // keywords
    merged.keywords = cleanKeywords(merged.keywords || []);

    // icon для /reviews/* и /mirrors/*; приоритет — base.icon
    const needsIcon = /^\/(?:reviews|mirrors)\/[^/]+$/.test(k);
    if (needsIcon) {
      const baseIcon = (base && typeof base.icon === 'string') ? base.icon.trim() : '';
      const mergedIcon = (merged.icon && typeof merged.icon === 'string') ? merged.icon.trim() : '';
      if (baseIcon) merged.icon = baseIcon;
      else if (!mergedIcon) merged.icon = "";
    }

    mergedTranslations[k] = merged;
  }

  ensureDir(OUT_DIR);
  writeJsonPretty(CONFIG_PATH, { sites: mergedSites });
  writeJsonPretty(TRANSL_PATH, mergedTranslations);

  console.log(`✅ Wrote ${path.relative(ROOT_DIR, CONFIG_PATH)} (${mergedSites.length} sites)  [forceReviews=${FLAGS.forceReviews}]`);
  console.log(`✅ Wrote ${path.relative(ROOT_DIR, TRANSL_PATH)} (${Object.keys(mergedTranslations).length} keys)`);
}

// ---------- SOLID из категорий ----------
function flattenCategory(items, ruDict, excludeTitles = new Set()) {
  const out = [];
  const push = (title, url) => {
    if (!url || excludeTitles.has(title)) return;
    const en = title;
    const ru = (ruDict && ruDict[title]) ? ruDict[title] : title;
    const href = normalizeSolidHref(url);
    out.push({ href, text: { en, ru } });
  };
  const walk = (list) => {
    for (const it of list || []) {
      if (!it || !it.title) continue;
      push(it.title, it.url);
      if (Array.isArray(it.children) && !excludeTitles.has(it.title)) {
        for (const ch of it.children) push(ch.title, ch.url);
      }
    }
  };
  walk(items || []);
  const seen = new Set();
  return out.filter(x => x && x.href && (seen.has(x.href) ? false : (seen.add(x.href), true)));
}
function applySolids(menu) {
  const cat = readJsonSafe(CAT_CONTENTS_PATH, { categories: {} });
  const tr  = readJsonSafe(CAT_TRANSL_PATH,   { ru: {} });
  const ruDict = tr.ru || {};

  const mapping = [
    { key: 'popular',   cat: 'freebies', exclude: new Set() },
    { key: 'cs2-sites', cat: 'cs2',      exclude: new Set(['Wiki']) },
    { key: 'rust',      cat: 'rust',     exclude: new Set() },
    { key: 'crypto',    cat: 'crypto',   exclude: new Set() },
    { key: 'earning',   cat: 'earning',  exclude: new Set() },
  ];

  for (const map of mapping) {
    const node = findEntry(menu, map.key);
    if (!node) continue;
    const items = (((cat || {}).categories || {})[map.cat] || {}).items || [];
    node.solid = flattenCategory(items, ruDict, map.exclude);
  }
}

// ---------- WIKI solid ----------
function applyWikiSolid(menu) {
  const node = findEntry(menu, 'wiki');
  if (!node) return;
  const list = readJsonSafe(TOPICS_NAV_PATH, []);
  const solid = [];
  const seen = new Set();
  for (const it of list) {
    if (!it || !it.href) continue;
    const href = normalizeSolidHref(it.href);
    if (seen.has(href)) continue;
    seen.add(href);
    const en = it.alt || '';
    const ru = it['data-title-ru'] || en;
    const rec = { href, img: it.img || '', text: { en, ru } };
    solid.push(rec);
  }
  node.solid = solid;
}

// ---------- Menu build ----------
function minimalNode(key, titleEn, titleRu) {
  return {
    nav: [
      { key: 'popular',   icon: 'fire',    title: { en: 'Popular',      ru: 'Популярное' }, groups: [
        { name: { en: 'Gambling', ru: 'Гемблинг' }, reviews: [], 'reviews-ru': [] },
        { name: { en: 'Trading',  ru: 'Трейдинг' }, reviews: [], 'reviews-ru': [] },
      ], solid: [] },
      { key: 'cs2-sites', icon: 'cs2',     title: { en: 'CS2 Sites',     ru: 'Сайты CS2' }, groups: [
        { name: { en: 'Gambling', ru: 'Гемблинг' }, reviews: [], 'reviews-ru': [] },
        { name: { en: 'Trading',  ru: 'Трейдинг' }, reviews: [], 'reviews-ru': [] },
      ], solid: [] },
      { key: 'rust',      icon: 'rust',    title: { en: 'Rust Sites',    ru: 'Сайты Rust' }, groups: [
        { name: { en: 'Gambling', ru: 'Гемблинг' }, reviews: [], 'reviews-ru': [] },
        { name: { en: 'Trading',  ru: 'Трейдинг' }, reviews: [], 'reviews-ru': [] },
      ], solid: [] },
      { key: 'crypto',    icon: 'crypto',  title: { en: 'Crypto Sites',  ru: 'Крипто-сайты' }, groups: [
        { name: { en: 'All', ru: 'Все' }, reviews: [], 'reviews-ru': [] },
      ], solid: [] },
      { key: 'earning',   icon: 'earning', title: { en: 'Earning Sites', ru: 'Заработок' }, groups: [
        { reviews: [], 'reviews-ru': [] },
      ], solid: [] },
      { key: 'steam',     icon: 'steam',   title: { en: 'Steam Sites',   ru: 'Сайты Steam' }, groups: [
        { name: { en: 'Increase Level', ru: 'Увеличить Уровень' }, reviews: [], 'reviews-ru': [] },
        { name: { en: 'Top Up Balance', ru: 'Пополнить Баланс' }, reviews: [], 'reviews-ru': [] },
        { name: { en: 'Buy Games',      ru: 'Купить Игры'       }, reviews: [], 'reviews-ru': [] },
      ], solid: [] },
      { key: 'newest',    icon: 'new',     title: { en: 'Newest',        ru: 'Новое' }, groups: [
        { reviews: [], 'reviews-ru': [] },
      ], solid: [] },
      { key: 'wiki',      icon: 'wiki',    title: { en: 'Skins Wiki',    ru: 'Wiki Скинов' }, groups: [], solid: [] },
    ],
  };
}
function buildMenu() {
  const menu = loadMenuBase();

  // Popular
  const enHtml = readRouteHtml('/index');
  const ruHtml = readRouteHtml('/ru');

  const enGambling = capList(
    dedupeByHref([
      ...findSectionBlocks(enHtml, ['cs2']).flatMap(extractCardsFromSectionBlock),
      ...findSectionBlocks(enHtml, ['crypto']).flatMap(extractCardsFromSectionBlock),
    ]),
    LIMITS.popular.gambling
  );
  const ruGambling = localizeHref(
    capList(
      dedupeByHref([
        ...findSectionBlocks(ruHtml, ['cs2']).flatMap(extractCardsFromSectionBlock),
        ...findSectionBlocks(ruHtml, ['crypto']).flatMap(extractCardsFromSectionBlock),
      ]),
      LIMITS.popular.gamblingRu
    ),
    'ru'
  );

  const enTrading = capList(
    dedupeByHref([
      ...findSectionBlocks(enHtml, ['sell-skins']).flatMap(extractCardsFromSectionBlock),
      ...findSectionBlocks(enHtml, ['trade-skins']).flatMap(extractCardsFromSectionBlock),
    ]),
    LIMITS.popular.trading
  );
  const ruTrading = localizeHref(
    capList(
      dedupeByHref([
        ...findSectionBlocks(ruHtml, ['sell-skins']).flatMap(extractCardsFromSectionBlock),
        ...findSectionBlocks(ruHtml, ['trade-skins']).flatMap(extractCardsFromSectionBlock),
      ]),
      LIMITS.popular.tradingRu
    ),
    'ru'
  );

  let popular = findEntry(menu, 'popular');
  if (!popular) { popular = minimalNode('popular', 'Popular', 'Популярное'); menu.nav.push(popular); }
  ensureGroups(popular, 2);
  popular.groups[0].reviews = enGambling;
  popular.groups[0]['reviews-ru'] = ruGambling;
  popular.groups[1].reviews = enTrading;
  popular.groups[1]['reviews-ru'] = ruTrading;

  // CS2 Sites
  const cs2EnPage = readRouteHtml('/cs2');
  const cs2RuPage = readRouteHtml('/ru/cs2');

  const cs2EnGambling = capList(
    dedupeByHref(findBoxesHolderBlocks(cs2EnPage).flatMap(extractCardsFromSectionBlock)),
    LIMITS.cs2Sites.gambling
  );
  const cs2RuGambling = localizeHref(
    capList(dedupeByHref(findBoxesHolderBlocks(cs2RuPage).flatMap(extractCardsFromSectionBlock)), LIMITS.cs2Sites.gamblingRu),
    'ru'
  );

  const cs2EnSell  = capList(dedupeByHref(findBoxesHolderBlocks(readRouteHtml('/csgo/sell-skins')).flatMap(extractCardsFromSectionBlock)), LIMITS.cs2Sites.tradingSell);
  const cs2EnTrade = capList(dedupeByHref(findBoxesHolderBlocks(readRouteHtml('/csgo/trade-skins')).flatMap(extractCardsFromSectionBlock)), LIMITS.cs2Sites.tradingTrade);
  const cs2EnTrading = dedupeByHref([...cs2EnSell, ...cs2EnTrade]);

  const cs2RuSell  = capList(dedupeByHref(findBoxesHolderBlocks(readRouteHtml('/ru/csgo/sell-skins')).flatMap(extractCardsFromSectionBlock)), LIMITS.cs2Sites.tradingSellRu);
  const cs2RuTrade = capList(dedupeByHref(findBoxesHolderBlocks(readRouteHtml('/ru/csgo/trade-skins')).flatMap(extractCardsFromSectionBlock)), LIMITS.cs2Sites.tradingTradeRu);
  const cs2RuTrading = localizeHref(dedupeByHref([...cs2RuSell, ...cs2RuTrade]), 'ru');

  let cs2Node = findEntry(menu, 'cs2-sites');
  if (!cs2Node) { cs2Node = minimalNode('cs2-sites', 'CS2 Sites', 'Сайты CS2'); menu.nav.push(cs2Node); }
  ensureGroups(cs2Node, 2);
  cs2Node.groups[0].reviews = cs2EnGambling;
  cs2Node.groups[0]['reviews-ru'] = cs2RuGambling;
  cs2Node.groups[1].reviews = cs2EnTrading;
  cs2Node.groups[1]['reviews-ru'] = cs2RuTrading;

  // Rust
  const rustEnPage = readRouteHtml('/rust');
  const rustRuPage = readRouteHtml('/ru/rust');

  const rustEnGambling = capList(
    dedupeByHref(findBoxesHolderBlocks(rustEnPage).flatMap(extractCardsFromSectionBlock)),
    LIMITS.rust.gambling
  );
  const rustRuGambling = localizeHref(
    capList(dedupeByHref(findBoxesHolderBlocks(rustRuPage).flatMap(extractCardsFromSectionBlock)), LIMITS.rust.gamblingRu),
    'ru'
  );

  const rustEnSell  = capList(dedupeByHref(findBoxesHolderBlocks(readRouteHtml('/rust/sell-skins')).flatMap(extractCardsFromSectionBlock)), LIMITS.rust.tradingSell);
  const rustEnTrade = capList(dedupeByHref(findBoxesHolderBlocks(readRouteHtml('/rust/trade-skins')).flatMap(extractCardsFromSectionBlock)), LIMITS.rust.tradingTrade);
  const rustEnTrading = dedupeByHref([...rustEnSell, ...rustEnTrade]);

  const rustRuSell  = capList(dedupeByHref(findBoxesHolderBlocks(readRouteHtml('/ru/rust/sell-skins')).flatMap(extractCardsFromSectionBlock)), LIMITS.rust.tradingSellRu);
  const rustRuTrade = capList(dedupeByHref(findBoxesHolderBlocks(readRouteHtml('/ru/rust/trade-skins')).flatMap(extractCardsFromSectionBlock)), LIMITS.rust.tradingTradeRu);
  const rustRuTrading = localizeHref(dedupeByHref([...rustRuSell, ...rustRuTrade]), 'ru');

  let rustNode = findEntry(menu, 'rust');
  if (!rustNode) { rustNode = minimalNode('rust', 'Rust Sites', 'Сайты Rust'); menu.nav.push(rustNode); }
  ensureGroups(rustNode, 2);
  rustNode.groups[0].reviews = rustEnGambling;
  rustNode.groups[0]['reviews-ru'] = rustRuGambling;
  rustNode.groups[1].reviews = rustEnTrading;
  rustNode.groups[1]['reviews-ru'] = rustRuTrading;

  // Crypto
  const cryptoEnPage = readRouteHtml('/crypto');
  const cryptoRuPage = readRouteHtml('/ru/crypto');

  const cryptoEnAll = capList(
    dedupeByHref(findBoxesHolderBlocks(cryptoEnPage).flatMap(extractCardsFromSectionBlock)),
    LIMITS.crypto.gambling
  );
  const cryptoRuAll = localizeHref(
    capList(dedupeByHref(findBoxesHolderBlocks(cryptoRuPage).flatMap(extractCardsFromSectionBlock)), LIMITS.crypto.gamblingRu),
    'ru'
  );

  let cryptoNode = findEntry(menu, 'crypto');
  if (!cryptoNode) { cryptoNode = minimalNode('crypto', 'Crypto Sites', 'Крипто-сайты'); menu.nav.push(cryptoNode); }
  ensureGroups(cryptoNode, 1);
  cryptoNode.groups[0].reviews = cryptoEnAll;
  cryptoNode.groups[0]['reviews-ru'] = cryptoRuAll;

  // Earning
  const earningEnPage = readRouteHtml('/earning');
  const earningRuPage = readRouteHtml('/ru/earning');

  const earningEnAll = capList(
    dedupeByHref(findBoxesHolderBlocks(earningEnPage).flatMap(extractCardsFromSectionBlock)),
    LIMITS.earning.list
  );
  const earningRuAll = localizeHref(
    capList(dedupeByHref(findBoxesHolderBlocks(earningRuPage).flatMap(extractCardsFromSectionBlock)), LIMITS.earning.list),
    'ru'
  );

  let earningNode = findEntry(menu, 'earning');
  if (!earningNode) { earningNode = minimalNode('earning', 'Earning Sites', 'Заработок'); menu.nav.push(earningNode); }
  ensureGroups(earningNode, 1);
  earningNode.groups[0].reviews = earningEnAll;
  earningNode.groups[0]['reviews-ru'] = earningRuAll;

  // Steam
  let steamNode = findEntry(menu, 'steam');
  if (!steamNode) { steamNode = minimalNode('steam', 'Steam Sites', 'Сайты Steam'); menu.nav.push(steamNode); }
  ensureGroups(steamNode, 3);
  steamNode.groups[0].name = { en: 'Increase Level', ru: 'Увеличить Уровень' };
  steamNode.groups[1].name = { en: 'Top Up Balance', ru: 'Пополнить Баланс' };
  steamNode.groups[2].name = { en: 'Buy Games',      ru: 'Купить Игры' };

  const steamLevelUpEN = capList(dedupeByHref(findBoxesHolderBlocks(readRouteHtml('/steam/levelup')).flatMap(extractCardsFromSectionBlock)), LIMITS.steam.list);
  const steamLevelUpRU = localizeHref(capList(dedupeByHref(findBoxesHolderBlocks(readRouteHtml('/ru/steam/levelup')).flatMap(extractCardsFromSectionBlock)), LIMITS.steam.listRu), 'ru');
  steamNode.groups[0].reviews = steamLevelUpEN;
  steamNode.groups[0]['reviews-ru'] = steamLevelUpRU;

  const steamTopUpEN = capList(dedupeByHref(findBoxesHolderBlocks(readRouteHtml('/steam/topup')).flatMap(extractCardsFromSectionBlock)), LIMITS.steam.list);
  const steamTopUpRU = localizeHref(capList(dedupeByHref(findBoxesHolderBlocks(readRouteHtml('/ru/steam/topup')).flatMap(extractCardsFromSectionBlock)), LIMITS.steam.listRu), 'ru');
  steamNode.groups[1].reviews = steamTopUpEN;
  steamNode.groups[1]['reviews-ru'] = steamTopUpRU;

  const steamBuyGamesEN = capList(dedupeByHref(findBoxesHolderBlocks(readRouteHtml('/steam/buy-games')).flatMap(extractCardsFromSectionBlock)), LIMITS.steam.list);
  const steamBuyGamesRU = localizeHref(capList(dedupeByHref(findBoxesHolderBlocks(readRouteHtml('/ru/steam/buy-games')).flatMap(extractCardsFromSectionBlock)), LIMITS.steam.listRu), 'ru');
  steamNode.groups[2].reviews = steamBuyGamesEN;
  steamNode.groups[2]['reviews-ru'] = steamBuyGamesRU;

  // Newest
  const newestEN = capList(dedupeByHref(findBoxesHolderBlocks(readRouteHtml('/newest')).flatMap(extractCardsFromSectionBlock)), LIMITS.newest.list);
  const newestRU = localizeHref(capList(dedupeByHref(findBoxesHolderBlocks(readRouteHtml('/ru/newest')).flatMap(extractCardsFromSectionBlock)), LIMITS.newest.listRu), 'ru');

  let newestNode = findEntry(menu, 'newest');
  if (!newestNode) { newestNode = minimalNode('newest', 'Newest', 'Новое'); menu.nav.push(newestNode); }
  ensureGroups(newestNode, 1);
  newestNode.groups[0].reviews = newestEN;
  newestNode.groups[0]['reviews-ru'] = newestRU;

  // Save
  ensureDir(OUT_DIR);
  writeJsonPretty(MENU_OUT_PATH, menu);

  console.log(`✅ Wrote ${path.relative(ROOT_DIR, MENU_OUT_PATH)}`
    + ` [popular.G=${enGambling.length}/${LIMITS.popular.gambling||'∞'};`
    + ` popular.T=${enTrading.length}/${LIMITS.popular.trading||'∞'};`
    + ` cs2.G=${cs2EnGambling.length}/${LIMITS.cs2Sites.gambling||'∞'};`
    + ` cs2.T=${cs2EnTrading.length}/≤${(LIMITS.cs2Sites.tradingSell||0)+(LIMITS.cs2Sites.tradingTrade||0)};`
    + ` rust.G=${rustEnGambling.length}/${LIMITS.rust.gambling||'∞'};`
    + ` rust.T=${rustEnTrading.length}/≤${(LIMITS.rust.tradingSell||0)+(LIMITS.rust.tradingTrade||0)};`
    + ` crypto=${cryptoEnAll.length}/${LIMITS.crypto.gambling||'∞'};`
    + ` earning=${earningEnAll.length}/${LIMITS.earning.list||'∞'};`
    + ` steam[0]=${steamLevelUpEN.length},[1]=${steamTopUpEN.length},[2]=${steamBuyGamesEN.length} / ${LIMITS.steam.list||'∞'};`
    + ` newest=${newestEN.length}/${LIMITS.newest.list||'∞'} ]`);
}

// ---------- Main ----------
function build() {
  buildSearchConfigAndTranslations();
  buildMenu();
}

if (require.main === module) build();
