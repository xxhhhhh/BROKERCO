// File: more-content.js
// Usage: node more-content.js [--root path] [--dry-run]
const fs = require("fs/promises");
const path = require("path");

// ---- Config ----
const CATEGORIES = ["csgo", "rust", "dota", "crypto"];
const KNOWN_LANGS = new Set(["ru","en","es","pt","tr","hi","de","fr","pl","it","ua","uk","ar","id","th","vi","nl","sv","fi","no","da","ro","cs","sk","sr","bg","el","hu","he","ko","ja","zh","zh-cn","zh-tw"]);
const IMG_SRC = {
  csgo: "/img/icons/main-modes/cs2-logo.png",
  rust: "/img/icons/main-modes/rust-logo.png",
  dota: "/img/icons/main-modes/dota2-logo.png",
  crypto: "/img/icons/main-modes/crypto-logo.png",
};
const IMG_ALT = {
  csgo: "CS2 logo",
  rust: "Rust logo",
  dota: "Dota 2 logo",
  crypto: "Crypto logo",
};
const TITLE_RU = { csgo: "Подобные CS2", rust: "Подобные Rust", dota: "Подобные Dota 2", crypto: "Подобные Крипто" };
const TITLE_EN = { csgo: "Similar CS2", rust: "Similar Rust", dota: "Similar Dota 2", crypto: "Similar Crypto" };

// ---- CLI/main ----
(async function main() {
  const { root, dry } = parseArgs(process.argv.slice(2));
  const files = await listHtmlFiles(root);

  let updated = 0, skipped = 0;
  for (const file of files) {
    const original = await fs.readFile(file, "utf8");
    const newline = original.includes("\r\n") ? "\r\n" : "\n";

    const urlPath = fileToUrlPath(root, file);
    if (!shouldProcess(urlPath)) { skipped++; continue; }

    const { lang, prefix } = detectLang(urlPath);
    const category = detectCategory(urlPath);
    if (!category) { skipped++; continue; }

    const suffix = extractSuffix(urlPath, category);
    const keepSlash = urlPath.endsWith("/");

    const targets = await resolveTargets(root, prefix, suffix, category, keepSlash);
    const needInsert = targets.length > 1;

    const changed = updateHtmlInsideBoxesHolder(original, targets, category, lang, newline, needInsert);
    if (changed !== null && changed !== original) {
      if (!dry) await fs.writeFile(file, changed, "utf8");
      updated++;
      console.log(`${dry ? "[DRY]" : "[OK] "} ${path.relative(root, file)}`);
    } else {
      skipped++;
    }
  }
  console.log(`\nDone. Updated: ${updated}, skipped: ${skipped}, total: ${files.length}`);
})().catch((e) => { console.error(e); process.exit(1); });

// ---- FS helpers ----
function parseArgs(argv) {
  const idx = argv.indexOf("--root");
  const root = path.resolve(idx >= 0 ? argv[idx + 1] : process.cwd());
  const dry = argv.includes("--dry-run");
  return { root, dry };
}
async function listHtmlFiles(root) {
  const out = [];
  async function walk(dir) {
    const ents = await fs.readdir(dir, { withFileTypes: true });
    for (const e of ents) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile() && e.name.toLowerCase().endsWith(".html")) out.push(full);
    }
  }
  await walk(root);
  return out;
}
function fileToUrlPath(root, file) {
  const rel = path.relative(root, file).split(path.sep).join("/");
  if (rel.toLowerCase().endsWith("/index.html")) {
    const base = "/" + rel.slice(0, -"/index.html".length);
    return (base.endsWith("/") ? base : base + "/");
  }
  if (rel.toLowerCase().endsWith(".html")) {
    return "/" + rel.slice(0, -".html".length).replace(/\/{2,}/g, "/");
  }
  return "/" + rel.replace(/\/{2,}/g, "/");
}

// ---- URL logic ----
function shouldProcess(urlPath) {
  const segs = urlPath.split("/").filter(Boolean);
  return segs.some(s => CATEGORIES.includes(s)) || /(^|\/)cs2(\.html|\/|$)/.test(urlPath);
}
function detectLang(urlPath) {
  const segs = urlPath.split("/").filter(Boolean);
  const langSeg = (segs[0] || "").toLowerCase();
  const lang = KNOWN_LANGS.has(langSeg) ? langSeg : "en";
  const prefix = KNOWN_LANGS.has(langSeg) ? `/${lang}/` : "/";
  return { lang, prefix };
}
function detectCategory(urlPath) {
  const segs = urlPath.toLowerCase().split("/").filter(Boolean);
  if (segs.includes("cs2")) return "csgo"; // корневой cs2.html трактуем как категория csgo
  return CATEGORIES.find(c => segs.includes(c)) || null;
}
function extractSuffix(urlPath, category) {
  const segs = urlPath.split("/").filter(Boolean);
  const idx = segs.findIndex(s => s.toLowerCase() === category || (category === "csgo" && s.toLowerCase() === "cs2"));
  if (idx === -1) return "";
  const tail = segs.slice(idx + 1).join("/");
  if (!tail) return "";
  return urlPath.endsWith("/") ? `${tail}/` : tail;
}
function joinUrl(...parts) {
  const joined = parts.join("/").replace(/\/{2,}/g, "/");
  return joined.startsWith("/") ? joined : "/" + joined;
}
async function resolveTargets(root, prefix, suffix, currentCat, keepSlash) {
  const urls = [];

  // Всегда добавляем текущую
  const currentPretty = buildPretty(prefix, currentCat, suffix, keepSlash, /*allowCs2*/ true);
  urls.push({ cat: currentCat, href: currentPretty || "/" });

  for (const cat of CATEGORIES) {
    if (cat === currentCat) continue;

    const candidates = preferredCsgoCandidates(cat, prefix, suffix, keepSlash);
    let chosen = null;
    for (const cand of candidates) {
      if (await fileExistsForUrlPath(root, cand)) { chosen = cand; break; }
    }
    if (chosen) urls.push({ cat, href: chosen || "/" });
  }
  return urls;
}
function preferredCsgoCandidates(cat, prefix, suffix, keepSlash) {
  // Для корневых страниц (dota.html/rust.html/crypto.html): CSGO -> cs2.html, затем csgo.html
  const base = buildPretty(prefix, cat, suffix, keepSlash, /*allowCs2*/ false);
  if (cat !== "csgo") return [base];

  const isTopLevelFileStyle = (suffix === "" && !keepSlash);
  if (isTopLevelFileStyle) {
    const cs2 = joinUrl(prefix, "cs2");
    const csgo = joinUrl(prefix, "csgo");
    return [cs2, csgo];
  }
  return [base]; // путевые/директории -> /csgo/...
}
function buildPretty(prefix, cat, suffix, keepSlash, allowCs2) {
  // allowCs2: если текущая корневая cs2.html → корректно строим /cs2
  const baseName = (cat === "csgo" && allowCs2 && suffix === "" && !keepSlash) ? "cs2" : cat;
  const raw = joinUrl(prefix, `${baseName}/${suffix}`);
  return keepSlash ? (raw.endsWith("/") ? raw : raw + "/") : raw.replace(/\/+$/, "");
}
async function fileExistsForUrlPath(root, urlPath) {
  const candidates = [];
  if (urlPath.endsWith("/")) {
    candidates.push(path.join(root, "." + urlPath, "index.html"));
  } else {
    candidates.push(path.join(root, "." + urlPath + ".html"));
    candidates.push(path.join(root, "." + urlPath, "index.html"));
  }
  for (const f of candidates) {
    try { await fs.access(f); return true; } catch {}
  }
  return false;
}

// ---- HTML surgery (idempotent, semantic-compare) ----
function updateHtmlInsideBoxesHolder(html, targets, currentCat, lang, newline, needInsert) {
  const masked = maskSegments(html);
  const holders = findAllDivByClass(masked, "boxes-holder");
  if (holders.length === 0) return null;

  const h = holders[holders.length - 1];
  const inner = html.slice(h.openEnd, h.closeStart);
  const innerMasked = masked.slice(h.openEnd, h.closeStart);

  const blocks = findAllBlocks(innerMasked, "more-content");

  // Если один блок — сверяем семантику и пропускаем при полном совпадении
  if (blocks.length === 1) {
    const b = blocks[0];
    const existing = inner.slice(b.openStart, b.closeEnd);

    if (needInsert) {
      const parsed = parseMoreContent(existing);
      const expected = buildExpectedModel(targets, currentCat, lang);
      if (modelsEqual(parsed, expected)) {
        return html; // skip: уже корректно
      }
    }

    // либо нужно удалить (нет альтернатив), либо заменить на корректный
    if (!needInsert) {
      const newInner = inner.slice(0, b.openStart) + inner.slice(b.closeEnd);
      return html.slice(0, h.openEnd) + newInner + html.slice(h.closeStart);
    }

    const blockIndent = indentBefore(html, h.openEnd + b.openStart, newline);
    const expectedStr = buildBlockString(targets, currentCat, lang, newline, blockIndent);
    const replacedInner = inner.slice(0, b.openStart) + expectedStr + inner.slice(b.closeEnd);
    return html.slice(0, h.openEnd) + replacedInner + html.slice(h.closeStart);
  }

  // 0 или >1 блоков: нормализуем
  const prunedInner = removeAllMoreContent(inner, innerMasked);

  if (!needInsert) {
    return html.slice(0, h.openEnd) + prunedInner + html.slice(h.closeStart);
  }

  // вставка нового блока в конец контейнера
  const baseIndent = indentBefore(html, h.closeStart, newline);
  const childIndent = baseIndent + "  ";
  const block = buildBlockString(targets, currentCat, lang, newline, childIndent);

  const tailMatch = prunedInner.match(/[ \t\r\n]*$/);
  const tailLen = tailMatch ? tailMatch[0].length : 0;
  const content = prunedInner.slice(0, prunedInner.length - tailLen);
  const tail = prunedInner.slice(prunedInner.length - tailLen);

  const needsLeading = !(content.endsWith("\n") || content.endsWith("\r\n"));
  const prefix = needsLeading ? (content + newline + baseIndent) : content;

  const newInner = prefix + block + tail;
  return html.slice(0, h.openEnd) + newInner + html.slice(h.closeStart);
}

// ---- Semantic compare helpers ----
function buildExpectedModel(targets, currentCat, lang) {
  const titles = (lang === "ru") ? TITLE_RU : TITLE_EN;
  const model = [];
  for (const cat of CATEGORIES) {
    const t = targets.find(x => x.cat === cat);
    if (!t) continue;
    model.push({
      cat,
      href: t.href === "/" ? "/" : t.href,
      active: cat === currentCat,
      title: titles[cat],
    });
  }
  return model;
}
function parseMoreContent(blockHtml) {
  const boxes = [];
  // быстрый проход по singlemod-box
  const reBox = /<div\b[^>]*class\s*=\s*(['"])(?:(?:(?!\1).))*\bsinglemod-box\b(?:(?:(?!\1).))*\1[^>]*>[\s\S]*?<\/div>/gi;
  let m;
  while ((m = reBox.exec(blockHtml)) !== null) {
    const boxStr = m[0];

    const cls = attrValue(boxStr, "class") || "";
    const active = /\bactive\b/i.test(cls);

    const title = attrValue(boxStr, "data-title") || "";

    const hrefMatch = boxStr.match(/<a\b[^>]*\bhref\s*=\s*(['"])(.*?)\1/i);
    const href = hrefMatch ? hrefMatch[2] : "";

    const imgSrcMatch = boxStr.match(/<img\b[^>]*\bsrc\s*=\s*(['"])(.*?)\1/i);
    const img = imgSrcMatch ? imgSrcMatch[2] : "";

    const cat = catFromImg(img) || catFromTitle(title);

    if (cat) {
      boxes.push({ cat, href, active, title });
    }
  }
  return boxes;
}
function modelsEqual(parsed, expected) {
  if (parsed.length !== expected.length) return false;
  for (let i = 0; i < expected.length; i++) {
    const a = parsed[i], b = expected[i];
    if (!a || a.cat !== b.cat) return false;
    if (normalizeUrl(a.href) !== normalizeUrl(b.href)) return false;
    if (!!a.active !== !!b.active) return false;
    if (a.title !== b.title) return false;
  }
  return true;
}
function normalizeUrl(u) {
  return (u || "").replace(/\/{2,}/g, "/");
}
function catFromImg(src = "") {
  if (src.endsWith("/cs2-logo.png")) return "csgo";
  if (src.endsWith("/rust-logo.png")) return "rust";
  if (src.endsWith("/dota2-logo.png")) return "dota";
  if (src.endsWith("/crypto-logo.png")) return "crypto";
  return null;
}
function catFromTitle(title = "") {
  const t = title.toLowerCase();
  if (t.includes("cs2")) return "csgo";
  if (t.includes("rust")) return "rust";
  if (t.includes("dota")) return "dota";
  if (t.includes("крипто") || t.includes("crypto")) return "crypto";
  return null;
}
function attrValue(tagText, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i");
  const m = tagText.match(re);
  return m ? (m[2] ?? m[3] ?? "") : null;
}

// ---- Low-level HTML helpers (format-preserving) ----
function maskSegments(s) {
  return s
    .replace(/<!--[\s\S]*?-->/g, m => " ".repeat(m.length))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, m => " ".repeat(m.length))
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, m => " ".repeat(m.length));
}
function readTag(s, start) {
  let i = start, inS=false, inD=false;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "'" && !inD) inS = !inS;
    else if (ch === '"' && !inS) inD = !inD;
    if (ch === ">" && !inS && !inD) { i++; break; }
    i++;
  }
  const tagText = s.slice(start, i);
  const attrs = tagText.replace(/^<\w+\s*|\s*>$/g, "");
  return { end: i, attrs };
}
function parseClassAttr(attrs) {
  const m = attrs.match(/\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
  const val = m ? (m[1] ?? m[2] ?? "") : "";
  return new Set(val.split(/\s+/).filter(Boolean));
}
function findMatchingClose(masked, from, tagName) {
  const openRe = new RegExp(`<${tagName}\\b`, "gi");
  const closeRe = new RegExp(`</${tagName}\\s*>`, "gi");
  let depth = 1, i = from;
  while (i < masked.length) {
    const nextOpen = masked.slice(i).search(openRe);
    const nextClose = masked.slice(i).search(closeRe);
    if (nextClose === -1) return -1;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      const openAbs = i + nextOpen;
      const { end } = readTag(masked, openAbs);
      depth++; i = end; continue;
    }
    const closeAbs = i + nextClose;
    depth--;
    if (depth === 0) return closeAbs;
    i = closeAbs + (`</${tagName}>`).length;
  }
  return -1;
}
function findAllDivByClass(masked, requiredClass) {
  const out = [];
  let idx = 0;
  while (true) {
    const openStart = masked.indexOf("<div", idx);
    if (openStart === -1) break;
    const { end: openEnd, attrs } = readTag(masked, openStart);
    const cls = parseClassAttr(attrs);
    if (cls.has(requiredClass)) {
      const closeStart = findMatchingClose(masked, openEnd, "div");
      if (closeStart === -1) break;
      out.push({ openStart, openEnd, closeStart, closeEnd: closeStart + "</div>".length });
      idx = closeStart + 6;
    } else {
      idx = openEnd;
    }
  }
  return out;
}
function findAllBlocks(innerMasked, className) {
  const blocks = [];
  let pos = 0;
  while (true) {
    const start = innerMasked.indexOf("<div", pos);
    if (start === -1) break;
    const { end: openEnd, attrs } = readTag(innerMasked, start);
    const cls = parseClassAttr(attrs);
    if (cls.has(className)) {
      const closeStart = findMatchingClose(innerMasked, openEnd, "div");
      if (closeStart === -1) break;
      blocks.push({ openStart: start, openEnd, closeStart, closeEnd: closeStart + "</div>".length });
      pos = closeStart + 6;
    } else {
      pos = openEnd;
    }
  }
  return blocks;
}
function removeAllMoreContent(inner, innerMasked) {
  let result = inner;
  let masked = innerMasked;
  while (true) {
    const blocks = findAllBlocks(masked, "more-content");
    if (!blocks.length) break;
    const b = blocks[0];
    result = result.slice(0, b.openStart) + result.slice(b.closeEnd);
    masked = masked.slice(0, b.openStart) + " ".repeat(b.closeEnd - b.openStart) + masked.slice(b.closeEnd);
  }
  return result;
}
function indentBefore(s, idx, newline) {
  const ls = s.lastIndexOf(newline, idx - 1);
  const lineStart = ls === -1 ? 0 : ls + newline.length;
  const m = s.slice(lineStart, idx).match(/^[\t ]*/);
  return m ? m[0] : "";
}

// Генерация блока (многострочно)
function buildBlockString(targets, currentCat, lang, nl, indent) {
  const titles = (lang === "ru") ? TITLE_RU : TITLE_EN;
  const lines = [];
  lines.push(`${indent}<div class="more-content">`);
  lines.push(`${indent}  <div class="more-content-list">`);
  for (const cat of CATEGORIES) {
    const t = targets.find(x => x.cat === cat);
    if (!t) continue;
    const active = (cat === currentCat) ? " active" : "";
    const title = titles[cat];
    const href = t.href === "/" ? "/" : t.href;
    lines.push(`${indent}    <div class="singlemod-box${active}" data-title="${escapeHtml(title)}">`);
    lines.push(`${indent}      <a href="${escapeAttr(href)}" class="singlemod-select">`);
    lines.push(`${indent}        <img src="${IMG_SRC[cat]}" alt="${IMG_ALT[cat]}">`);
    lines.push(`${indent}      </a>`);
    lines.push(`${indent}    </div>`);
  }
  lines.push(`${indent}  </div>`);
  lines.push(`${indent}</div>`);
  return lines.join(nl);
}

// Важно: не трогаем амперсанды в документе — экранируем только то, что генерируем сами.
function escapeHtml(s = "") { return s.replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function escapeAttr(s = "") { return escapeHtml(s).replace(/'/g,"&#39;"); }

// ======================================================================
