// injectjson2.js — фикс бесконечного перезаписывания dateModified и корректный canonical для index.*
// Path canonicalization: homepage => https://csgobroker.co (no trailing slash)

const fs = require('fs');
const path = require('path');

const HTML_BASE_DIR = path.resolve('.');
const languageDirs = ['.', 'ru', 'tr', 'es', 'pt', 'hi'];
const EXCLUDE_DIRS = ['code-parts', 'img', 'fonts', 'sitemaps_me'];

// ---------- helpers ----------
function extractMeta(html, key) {
  const regex = new RegExp(`<meta\\s+[^>]*\\b(?:name|property)=["']${key}["'][^>]*>`, 'i');
  const match = html.match(regex);
  if (!match) return null;
  const contentMatch = match[0].match(/\bcontent=(["'])(.*?)\1/i);
  return contentMatch ? contentMatch[2] : null;
}

function detectLanguageFromContent(html) {
  const match = html.match(/<html[^>]*lang=["']([^"'>]+)["']/i);
  if (!match) return 'en-US';
  const lang = match[1].toLowerCase();
  switch (lang) {
    case 'ru': return 'ru-RU';
    case 'tr': return 'tr-TR';
    case 'es': return 'es-ES';
    case 'pt': return 'pt-PT';
    case 'hi': return 'hi-IN';
    default: return 'en-US';
  }
}

function getFileTimes(filePath) {
  // why: используем ВХОДНОЙ mtime как единственный источник истины и потом его восстанавливаем
  const st = fs.statSync(filePath);
  return { atime: st.atime, mtime: st.mtime, mtimeISO: st.mtime.toISOString() };
}

function getPublishedDate(filePath) {
  try {
    const stats = fs.statSync(filePath);
    const created = stats.birthtime;
    if (created && created.getTime() !== stats.mtime.getTime()) {
      return created.toISOString();
    }
  } catch {}
  return '2023-07-01T00:00:00+00:00';
}

function fileExistsForPath(pathArray) {
  const flatHtml = path.join(HTML_BASE_DIR, ...pathArray) + '.html';
  const indexHtml = path.join(HTML_BASE_DIR, ...pathArray, 'index.html');
  if (fs.existsSync(flatHtml)) return flatHtml;
  if (fs.existsSync(indexHtml)) return indexHtml;
  return null;
}

// ---------- breadcrumbs (как было) ----------
function generateBreadcrumbList(pageUrl, alt, urlParts, langCode) {
  const items = [];
  const isDefaultLang = langCode === 'en';
  const base = isDefaultLang ? 'https://csgobroker.co' : `https://csgobroker.co/${langCode}`;
  const homeName = langCode === 'ru' ? 'Главная' : 'Main Page';

  items.push({ "@type": "ListItem", position: 1, name: homeName, item: base });

  const parts = (!isDefaultLang && urlParts[0] === langCode) ? urlParts.slice(1) : urlParts;
  const addedPaths = new Set();
  let breadcrumbPos = 2;

  if (parts[0] === 'csgo') {
    const cs2PathParts = isDefaultLang ? ['cs2'] : [langCode, 'cs2'];
    const cs2File = fileExistsForPath(cs2PathParts);
    if (cs2File) {
      const html = fs.readFileSync(cs2File, 'utf-8');
      const cs2Name = extractMeta(html, 'og:image:alt') || 'CS2 Gambling Sites';
      const cs2Url = `https://csgobroker.co/${isDefaultLang ? '' : langCode + '/'}cs2`;
      items.push({ "@type": "ListItem", position: breadcrumbPos++, name: cs2Name, item: cs2Url });
    }
  }

  for (let i = 0; i < parts.length; i++) {
    const currentParts = parts.slice(0, i + 1);
    const current = currentParts[i];
    const prev = currentParts[i - 1] || '';
    const isLast = i === parts.length - 1;

    if (["reviews", "steam", "mirrors", "tf2"].includes(current)) continue;

    if (parts[0] === 'topic' && ['cases', 'charms', 'collections'].includes(parts[1]) && parts.length >= 3) {
      insertItemFromPath(['topic']);
      insertItemFromPath(['topic', 'items']);
      insertItemFromPath(['topic', 'items-type', parts[1]]);
      insertItemFromPath(parts);
      return items;
    }

    if (currentParts[0] === 'topic' && current === 'skin' && prev === 'sticker-crafts' && isLast) {
      insertItemFromPath(['topic', 'sticker-crafts']);
      insertItemFromPath(currentParts);
      continue;
    }

    if (["stickers", "items-type", "collection", "cases", "charms", "collections"].includes(current)) {
      insertItemFromPath(currentParts.slice(0, i).concat(['items']));
    }

    if (current === 'skin' && prev === 'sticker-crafts') {
      insertItemFromPath(currentParts.slice(0, i));
    }

    if (current === 'guides' && i > 0) {
      insertItemFromPath(currentParts.slice(0, i));
    }

    insertItemFromPath(currentParts);
  }

  function insertItemFromPath(labelParts) {
    const key = labelParts.join('/');
    if (addedPaths.has(key)) return;
    addedPaths.add(key);

    const fullPath = isDefaultLang ? labelParts : [langCode, ...labelParts];
    const skipMissing = ['csgo', 'tf2', 'steam', 'mirrors', 'reviews', 'stickers', 'cases', 'charms', 'collections'];
    const filePath = fileExistsForPath(fullPath);
    if (!filePath) {
      if (skipMissing.includes(labelParts[labelParts.length - 1])) return;
      return;
    }

    const html = fs.readFileSync(filePath, 'utf-8');
    const name = extractMeta(html, 'og:image:alt') || labelParts[labelParts.length - 1];
    const itemUrl = `https://csgobroker.co/${(isDefaultLang ? '' : langCode + '/')}${labelParts.join('/')}`;

    items.push({ "@type": "ListItem", position: breadcrumbPos++, name, item: itemUrl });
  }

  return items;
}

// ---------- JSON-LD utils ----------
function parseYoastBlock(html) {
  const m = html.match(/<script type="application\/ld\+json" class="yoast-schema-graph">([\s\S]*?)<\/script>/);
  if (!m) return { matchHtml: null, jsonRaw: '', jsonObj: null };
  const raw = (m[1] || '').trim();
  try {
    return { matchHtml: m[0], jsonRaw: raw, jsonObj: JSON.parse(raw) };
  } catch {
    return { matchHtml: m[0], jsonRaw: raw, jsonObj: null };
  }
}

function deepClone(x) { return JSON.parse(JSON.stringify(x)); }
function removeDM(obj) {
  const c = deepClone(obj);
  if (c && c['@graph'] && c['@graph'][0]) delete c['@graph'][0]['dateModified'];
  return c;
}
function canonicalize(v) {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = canonicalize(v[k]);
    return out;
  }
  return v;
}
function stableStringify(o) { return JSON.stringify(canonicalize(o)); }

// ---------- main injection ----------
function injectSchema(filePath) {
  const { atime, mtime, mtimeISO } = getFileTimes(filePath); // до любых записей
  let html = fs.readFileSync(filePath, 'utf-8');

  const name = html.match(/<title>(.*?)<\/title>/i)?.[1]?.trim() || '';
  const description = extractMeta(html, 'description');
  const image = extractMeta(html, 'og:image');
  const imageWidth = extractMeta(html, 'og:image:width');
  const imageHeight = extractMeta(html, 'og:image:height');
  const imageAlt = extractMeta(html, 'og:image:alt');
  const langFull = detectLanguageFromContent(html);
  const langCode = langFull.split('-')[0];
  const datePublished = getPublishedDate(filePath);

  const relativePath = path.relative(HTML_BASE_DIR, filePath).replace(/\\/g, '/');

  // skip guides
  if (/(^|\/)topic\/guides\//.test(relativePath)) {
    console.log(`⏭️ Skipped guide page: ${relativePath}`);
    return;
  }

  // ----- canonical pagePath & pageUrl (без хвостового / и без /index.html) -----
  const parsed = path.parse(relativePath);
  const dirNorm = (parsed.dir || '').replace(/\\/g, '/');
  let pagePath;
  if (parsed.name.toLowerCase() === 'index') {
    pagePath = '/' + dirNorm; // e.g., "ru" or ""
  } else {
    pagePath = '/' + [dirNorm, parsed.name].filter(Boolean).join('/');
  }
  pagePath = pagePath.replace(/\/+$/g, ''); // no trailing slash
  if (pagePath === '') pagePath = '/';

  const pageUrl = `https://csgobroker.co${pagePath === '/' ? '' : pagePath}`;
  const urlParts = pagePath.split('/').filter(Boolean);

  const breadcrumbItems = generateBreadcrumbList(pageUrl, imageAlt || name, urlParts, langCode);
  if (!breadcrumbItems.length) {
    console.log(`⚠️  No breadcrumbs generated for ${filePath}`);
    return;
  }

  const baseJsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": pageUrl,
        "url": pageUrl,
        "name": name,
        "isPartOf": { "@id": "https://csgobroker.co/#website" },
        "primaryImageOfPage": { "@id": `${pageUrl}#primaryimage` }, // why: избегаем "/#"
        "image": { "@id": `${pageUrl}#primaryimage` },
        "thumbnailUrl": image,
        "datePublished": datePublished,
        "description": description,
        "breadcrumb": { "@id": `${pageUrl}#breadcrumb` },
        "inLanguage": langFull,
        "potentialAction": [{ "@type": "ReadAction", "target": [pageUrl] }] // why: без хвостового '/'
      },
      {
        "@type": "ImageObject",
        "inLanguage": langFull,
        "@id": `${pageUrl}#primaryimage`,
        "url": image,
        "contentUrl": image,
        "width": parseInt(imageWidth) || 0,
        "height": parseInt(imageHeight) || 0,
        "caption": imageAlt
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${pageUrl}#breadcrumb`,
        "itemListElement": breadcrumbItems
      },
      {
        "@type": "WebSite",
        "@id": "https://csgobroker.co/#website",
        "url": "https://csgobroker.co",
        "name": "CSGOBroker",
        "description": "We conduct thorough hands-on testing of each site before publishing a review, ensuring accuracy and fairness. Our evaluations are regularly updated to reflect any changes, focusing on reliability and user trust.",
        "publisher": { "@id": "https://csgobroker.co/#organization" },
        "inLanguage": langFull,
        "potentialAction": [
          {
            "@type": "SearchAction",
            "target": { "@type": "EntryPoint", "urlTemplate": "https://csgobroker.co/?s={search_term_string}" },
            "query-input": { "@type": "PropertyValueSpecification", "valueRequired": true, "valueName": "search_term_string" }
          }
        ]
      },
      {
        "@type": "Organization",
        "@id": "https://csgobroker.co/#organization",
        "name": "CSGOBroker",
        "url": "https://csgobroker.co",
        "logo": {
          "@type": "ImageObject",
          "inLanguage": langFull,
          "@id": "https://csgobroker.co/#/schema/logo/image/",
          "url": "https://csgobroker.co/img/logo.svg",
          "contentUrl": "https://csgobroker.co/img/logo.svg",
          "width": 515,
          "height": 100,
          "caption": "CSGOBroker"
        },
        "image": { "@id": "https://csgobroker.co/#/schema/logo/image/" }
      }
    ]
  };

  const { matchHtml, jsonObj } = parseYoastBlock(html);
  const baseNoDM = removeDM(baseJsonLd);

  // Нет валидного блока → вставка с dateModified = входной mtime
  if (!matchHtml || !jsonObj) {
    const full = deepClone(baseJsonLd);
    full['@graph'][0]['dateModified'] = mtimeISO;
    const updatedJson = JSON.stringify(full, null, 2);
    html = html.replace(/(\s*)<\/head>/i, `\n<script type="application/ld+json" class="yoast-schema-graph">\n${updatedJson}\n</script>\n$1</head>`);
    fs.writeFileSync(filePath, html, 'utf-8');
    fs.utimesSync(filePath, atime, mtime); // важный шаг: вернуть исходные времена
    console.log(`✅ Schema inserted in ${filePath}`);
    return;
  }

  // Есть блок → сравниваем без dateModified (канонично)
  const existingNoDM = removeDM(jsonObj);
  const sameWithoutDM = stableStringify(existingNoDM) === stableStringify(baseNoDM);

  const existingDM = jsonObj?.['@graph']?.[0]?.['dateModified'] || null;

  if (sameWithoutDM) {
    // Меняем только dateModified, если отличается от входного mtime
    if (existingDM !== mtimeISO) {
      jsonObj['@graph'][0]['dateModified'] = mtimeISO;
      const updatedJson = JSON.stringify(jsonObj, null, 2);
      const newBlock = `<script type="application/ld+json" class="yoast-schema-graph">\n${updatedJson}\n</script>`;
      html = html.replace(/<script type="application\/ld\+json" class="yoast-schema-graph">[\s\S]*?<\/script>/, newBlock);
      fs.writeFileSync(filePath, html, 'utf-8');
      fs.utimesSync(filePath, atime, mtime); // не даём mtime «скакнуть»
      console.log(`✅ dateModified updated in ${filePath}`);
    }
    return;
  }

  // Содержимое отличается → полная замена с актуальным mtime
  const full = deepClone(baseJsonLd);
  full['@graph'][0]['dateModified'] = mtimeISO;
  const updatedJson = JSON.stringify(full, null, 2);
  const newBlock = `<script type="application/ld+json" class="yoast-schema-graph">\n${updatedJson}\n</script>`;
  html = html.replace(/<script type="application\/ld\+json" class="yoast-schema-graph">[\s\S]*?<\/script>/, newBlock);
  fs.writeFileSync(filePath, html, 'utf-8');
  fs.utimesSync(filePath, atime, mtime); // сохраняем исходный mtime
  console.log(`✅ Schema updated in ${filePath}`);
}

// ---------- walker ----------
const visitedPaths = new Set();
function walk(dir) {
  const abs = path.resolve(dir);
  if (visitedPaths.has(abs)) return;
  visitedPaths.add(abs);

  if (!fs.existsSync(dir)) return;

  fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
    const fullPath = path.join(dir, entry.name);
    const relative = path.relative(HTML_BASE_DIR, fullPath);
    if (EXCLUDE_DIRS.some(ex => relative.startsWith(ex))) return;

    if (entry.isFile() && entry.name.endsWith('.html')) {
      injectSchema(fullPath);
    } else if (entry.isDirectory()) {
      walk(fullPath);
    }
  });
}

languageDirs.forEach(dir => walk(path.join(HTML_BASE_DIR, dir)));
