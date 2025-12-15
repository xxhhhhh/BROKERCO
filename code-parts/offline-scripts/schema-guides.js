const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML_BASE_DIR = path.resolve('.');
const CODE_PARTS_DIR = path.join(HTML_BASE_DIR, 'code-parts', 'guides-slug');
const languageDirs = ['.', 'ru', 'tr', 'es', 'pt', 'hi'];

function extractMeta(html, key) {
  const regex = new RegExp(`<meta\s+([^>]*\b(?:name|property)=["']${key}["'][^>]*)>`, 'i');
  const match = html.match(regex);
  if (match) {
    const contentMatch = match[1].match(/\bcontent=["']([^"']+)["']/i);
    return contentMatch ? contentMatch[1] : null;
  }
  return null;
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

function getWordCountFromOl(html) {
  try {
    const dom = new JSDOM(html);
    const ol = dom.window.document.querySelector('ol.text-col-info-box');
    if (!ol) return 0;
    return ol.textContent.trim().split(/\s+/).length;
  } catch {
    return 0;
  }
}

function stripDateModified(json) {
  try {
    const obj = JSON.parse(json);
    if (obj['@graph'] && obj['@graph'][0]) {
      delete obj['@graph'][0]['dateModified'];
    }
    return JSON.stringify(obj);
  } catch {
    return '';
  }
}

function injectSchemaForGuide(htmlPath, slug) {
  const html = fs.readFileSync(htmlPath, 'utf-8');
  const langFull = detectLanguageFromContent(html);
  const langCode = langFull.split('-')[0];

  const jsonPath = path.join(CODE_PARTS_DIR, `${slug}.json`);
  if (!fs.existsSync(jsonPath)) {
    console.log(`⚠️ Missing JSON: ${jsonPath}`);
    return;
  }

  const jsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

  const title = jsonData[`title-${langCode}`] || jsonData.title;
  const headline = jsonData[`headline-${langCode}`] || jsonData.headline;
  const description = jsonData[`description-${langCode}`] || jsonData.description;
  const websiteDescription = jsonData[`websiteDescription-${langCode}`] || jsonData.websiteDescription;
  const keywords = jsonData[`keywords-${langCode}`] || jsonData.keywords;
  const authorDescription = jsonData.author[`description-${langCode}`] || jsonData.author.description;

  const datePublished = getPublishedDate(htmlPath);
  const pagePath = '/' + path.relative(HTML_BASE_DIR, htmlPath).replace(/\\/g, '/').replace(/\/index\.html$/, '').replace(/\.html$/, '');
  const pageUrl = `https://csgobroker.co${pagePath}`;
  const image = extractMeta(html, 'og:image') || jsonData.thumbnail;
  const imageWidth = parseInt(extractMeta(html, 'og:image:width')) || 1728;
  const imageHeight = parseInt(extractMeta(html, 'og:image:height')) || 1080;
  const wordCount = getWordCountFromOl(html);

  const caption = `${title} - Guide by ${jsonData.author.name}`;
  const breadcrumb = [
    { "@type": "ListItem", position: 1, name: "CSGOBroker", item: "https://csgobroker.co" },
    { "@type": "ListItem", position: 2, name: "Guides", item: "https://csgobroker.co/topic/guides/" },
    { "@type": "ListItem", position: 3, name: title }
  ];

  const baseSchema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "@id": `${pageUrl}#article`,
        "isPartOf": { "@id": pageUrl },
        "author": {
          "@type": "Person",
          "@id": `https://csgobroker.co/#/schema/person/${jsonData.author.id}`,
          "name": jsonData.author.name
        },
        "headline": headline,
        "datePublished": datePublished,
        "mainEntityOfPage": { "@id": pageUrl },
        "wordCount": wordCount,
        "publisher": { "@id": "https://csgobroker.co/#organization" },
        "image": { "@id": `${pageUrl}#primaryimage` },
        "thumbnailUrl": jsonData.thumbnail,
        "keywords": keywords,
        "articleSection": jsonData.articleSection,
        "inLanguage": langFull
      },
      {
        "@type": "WebPage",
        "@id": pageUrl,
        "url": pageUrl,
        "name": `${headline} | CSGOBROKER`,
        "isPartOf": { "@id": "https://csgobroker.co/#website" },
        "primaryImageOfPage": { "@id": `${pageUrl}#primaryimage` },
        "image": { "@id": `${pageUrl}#primaryimage` },
        "thumbnailUrl": jsonData.thumbnail,
        "datePublished": datePublished,
        "description": description,
        "breadcrumb": { "@id": `${pageUrl}#breadcrumb` },
        "inLanguage": langFull,
        "potentialAction": [
          { "@type": "ReadAction", "target": [pageUrl] }
        ]
      },
      {
        "@type": "ImageObject",
        "inLanguage": langFull,
        "@id": `${pageUrl}#primaryimage`,
        "url": image,
        "contentUrl": image,
        "width": imageWidth,
        "height": imageHeight,
        "caption": caption
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${pageUrl}#breadcrumb`,
        "itemListElement": breadcrumb
      },
      {
        "@type": "WebSite",
        "@id": "https://csgobroker.co/#website",
        "url": "https://csgobroker.co",
        "name": "CSGOBroker",
        "description": websiteDescription,
        "publisher": { "@id": "https://csgobroker.co/#organization" },
        "inLanguage": langFull
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
          "url": jsonData.author.avatar,
          "contentUrl": jsonData.author.avatar,
          "width": 512,
          "height": 512,
          "caption": "CSGOBroker"
        },
        "image": { "@id": "https://csgobroker.co/#/schema/logo/image/" }
      },
      {
        "@type": "Person",
        "@id": `https://csgobroker.co/#/schema/person/${jsonData.author.id}`,
        "name": jsonData.author.name,
        "image": {
          "@type": "ImageObject",
          "inLanguage": langFull,
          "@id": "https://csgobroker.co/#/schema/person/image/",
          "url": jsonData.author.avatar,
          "contentUrl": jsonData.author.avatar,
          "caption": jsonData.author.name
        },
        "description": authorDescription,
        "gender": jsonData.author.gender
      }
    ]
  };

  const newJsonClean = stripDateModified(JSON.stringify(baseSchema));

  const existing = html.match(/<script type="application\/ld\+json" class="yoast-schema-graph">([\s\S]*?)<\/script>/);
  const currentBlock = existing ? existing[1].trim() : '';
  const isSame = stripDateModified(currentBlock) === newJsonClean;

  if (isSame) return;

  baseSchema['@graph'][0]['dateModified'] = new Date().toISOString();
  const finalJson = JSON.stringify(baseSchema, null, 2);
  const tagged = `<script type="application/ld+json" class="yoast-schema-graph">\n${finalJson}\n</script>`;

  const updatedHtml = existing
    ? html.replace(existing[0], tagged)
    : html.replace(/(\s*)<\/head>/i, `\n${tagged}\n$1</head>`);

  fs.writeFileSync(htmlPath, updatedHtml, 'utf-8');
  console.log(`✅ Injected schema for: ${htmlPath}`);
}

languageDirs.forEach(langDir => {
  const baseDir = path.join(HTML_BASE_DIR, langDir, 'topic', 'guides');
  if (!fs.existsSync(baseDir)) return;

  fs.readdirSync(baseDir).forEach(file => {
    if (!file.endsWith('.html')) return;

    const slug = file.replace(/\.html$/, '');
    const htmlPath = path.join(baseDir, `${slug}.html`);
    injectSchemaForGuide(htmlPath, slug);
  });
});
