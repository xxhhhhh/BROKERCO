// inject-review-schema.js
const fs = require('fs');
const path = require('path');

const HTML_BASE_DIR = path.resolve('.')
const SITE_INFO_DIR = path.join(HTML_BASE_DIR, 'code-parts', 'site-infos');
const IMAGE_DIR = path.join(HTML_BASE_DIR, 'img');

function getRatingAvg(ratingsObj) {
  const values = Object.values(ratingsObj || {});
  const numeric = values.map(r => parseFloat(r)).filter(r => !isNaN(r));
  return (numeric.reduce((sum, r) => sum + r, 0) / numeric.length).toFixed(1);
}

function findLogoImage(siteKey) {
  const extensions = ['webp', 'png', 'svg'];
  for (const ext of extensions) {
    const imgPath = path.join(IMAGE_DIR, `${siteKey}-logo.${ext}`);
    if (fs.existsSync(imgPath)) {
      return `https://csgobroker.co/img/${siteKey}-logo.${ext}`;
    }
  }
  return null;
}

function normalizeSchemaBlock(block) {
  return block.replace(/\s+/g, '').trim();
}

function injectReviewSchema(filePath) {
  let html = fs.readFileSync(filePath, 'utf-8');
  const isReviewPage = filePath.includes(`${path.sep}reviews${path.sep}`);
  if (!isReviewPage) return;

  const relativeUrl = '/' + path.relative(HTML_BASE_DIR, filePath).replace(/\\/g, '/').replace(/\/index\.html$/, '').replace(/\.html$/, '');
  const siteKey = relativeUrl.split('/').pop();
  const infoPath = path.join(SITE_INFO_DIR, `${siteKey}.json`);

  if (!fs.existsSync(infoPath)) {
    console.warn(`⚠️  Missing site info JSON: ${infoPath}`);
    return;
  }

  let siteInfo;
  try {
    siteInfo = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
  } catch {
    console.warn(`⚠️  Error parsing JSON: ${infoPath}`);
    return;
  }

  const logoUrl = findLogoImage(siteKey);
  if (!logoUrl) {
    console.warn(`⚠️  Logo not found for: ${siteKey}`);
    return;
  }

  const avgRating = getRatingAvg(siteInfo.ratings);
  if (isNaN(avgRating)) {
    console.warn(`⚠️  Invalid ratings in JSON: ${siteKey}`);
    return;
  }

  const newSchemaObj = {
    "@context": "http://schema.org/",
    "@type": "Review",
    "itemReviewed": {
      "@type": "Organization",
      "name": siteInfo.name,
      "image": logoUrl
    },
    "author": {
      "@type": "Person",
      "name": "CSGOBroker",
      "url": "https://csgobroker.co"
    },
    "reviewRating": {
      "@type": "Rating",
      "ratingValue": avgRating,
      "bestRating": "5",
      "worstRating": "0"
    }
  };

  const newSchemaStrRaw = `<script type="application/ld+json">\n${JSON.stringify(newSchemaObj, null, 2)}\n</script>`;
  const newSchemaNormalized = normalizeSchemaBlock(newSchemaStrRaw);

  const scriptRegex = /<script type="application\/ld\+json">\s*({[\s\S]*?})\s*<\/script>/g;
  let hasChanges = false;
  let existingNormalized = null;

  let cleanedHtml = html.replace(scriptRegex, (match, jsonStr) => {
    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed['@type'] === 'Review' && parsed.author?.name === 'CSGOBroker') {
        existingNormalized = normalizeSchemaBlock(match);
        hasChanges = true;
        return '';
      }
    } catch {}
    return match;
  });

  if (existingNormalized === newSchemaNormalized) return; // nothing changed

  if (!cleanedHtml.includes(newSchemaStrRaw)) {
    cleanedHtml = cleanedHtml.replace(/(\s*)<\/head>/, `\n${newSchemaStrRaw}\n$1</head>`);
    fs.writeFileSync(filePath, cleanedHtml, 'utf-8');
    console.log(`✅ Review schema updated in ${filePath}`);
    return;
  }

  if (hasChanges) {
    fs.writeFileSync(filePath, cleanedHtml, 'utf-8');
    console.log(`✅ Duplicate schema removed in ${filePath}`);
  }
}

function walk(dir) {
  if (!fs.existsSync(dir)) return;

  fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith('.html')) {
      injectReviewSchema(fullPath);
    } else if (entry.isDirectory()) {
      walk(fullPath);
    }
  });
}

walk(HTML_BASE_DIR);