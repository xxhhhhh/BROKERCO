// ============================================================================
// File: scripts/static-pages-fill.js
// Usage: node scripts/static-pages-fill.js [--root path] [--dry-run] [--ratings path] [--verbose]
// Note: Встроена логика "more-content" с авто-детектом доступных языков + серверная
//       генерация main-infobox (без client-side JS/localStorage).
//       + ОФФЛАЙН рендер мод-боксов (.mods-box / .skins-box) на основе insert-mods-box.json
// ============================================================================

const fs = require("fs/promises");
const path = require("path");

/* --------- CONFIG --------- */
const SITE_INFOS        = "/code-parts/site-infos";
const ALT_SITES         = "/code-parts/site-infos/sites-alts";
const FILTER_SETTINGS   = "/code-parts/filter-settings.json";
const REVIEW_SETTINGS   = "/code-parts/review-settings.json";
const SITES_SETTINGS    = "/code-parts/sites-settings.json";
const TRANSLATIONS_PATH = "/code-parts/review-translations.json";
// + инфобокс переводы
const INFOBOX_TRANSLATIONS = "/code-parts/micro-parts/main-infobox/infobox-translations.json";
// + mods-boxes JSON (из вашей client-side логики)
const MODS_BOXES_PATH  = "/code-parts/micro-parts/insert-mods-box.json";

// NB: Базовый список. Для маршрутизации ссылок в основой логике он остаётся.
// "More Content" использует динамически обнаруженные языки (см. detectAvailableLangs).
const KNOWN_LANGS = new Set([
  "ru","en","es","pt","tr","hi","de","fr","pl","it","ua","uk","ar","id","th","vi","nl","sv","fi","no","da","ro","cs","sk","sr","bg","el","hu","he","ko","ja","zh","zh-cn","zh-tw"
]);
const PREFIX_LANGS = new Set(["ru","es","pt","tr","hi"]); // языки, где добавляем /{lang}
const REVIEW_PREFIX_LANGS = new Set(["ru","tr","es"]);

// Инфобокс показываем только для языков: PREFIX_LANGS + en
const INFOBOX_LANGS = new Set([...PREFIX_LANGS, "en"]);

/** Разделяет base и хвост (?/ #) */
function splitHrefParts(href){
  const clean = String(href || "").replace(/\/{2,}/g, "/");
  const q = clean.indexOf("?");
  const h = clean.indexOf("#");
  const cut = [q === -1 ? clean.length : q, h === -1 ? clean.length : h].reduce((a,b)=>Math.min(a,b), clean.length);
  const base = clean.slice(0, cut);
  const tail = clean.slice(cut);
  return { base, tail };
}

/** Удалить ЛЮБОЙ языковой префикс из относительного href */
function stripKnownLangPrefix(href){
  if (!href) return href;
  if (isExternal(href) || href.startsWith("#")) return href;

  const { base, tail } = splitHrefParts(href);
  const pathOnly = base.startsWith("/") ? base : "/" + base;
  const segs = pathOnly.split("/").filter(Boolean);

  if (segs.length && KNOWN_LANGS.has(segs[0])) segs.shift();

  const rebuilt = "/" + segs.join("/");
  return (rebuilt === "/" ? "/" : rebuilt) + (tail || "");
}

/** Обеспечить нужный языковой префикс; для en — префикс убираем */
function ensureLangPrefixFor(href, lang){
  const L = String(lang || "en").toLowerCase();
  if (L === "en") return stripKnownLangPrefix(href); // en — без тегов

  if (!href) return href;
  if (isExternal(href) || href.startsWith("#")) return href;

  const { base, tail } = splitHrefParts(href);
  const pathOnly = base.startsWith("/") ? base : "/" + base;
  const segs = pathOnly.split("/").filter(Boolean);

  if (segs.length && KNOWN_LANGS.has(segs[0])) segs.shift();
  segs.unshift(L);

  const rebuilt = "/" + segs.join("/");
  return (rebuilt === "/" ? "/" : rebuilt) + (tail || "");
}

/** Similar: всегда язык, КРОМЕ en (у en — без префикса) */
function withLangForSimilar(href, lang){
  return ensureLangPrefixFor(href, lang);
}

/** Review: язык только для ru|tr|es; иначе (включая en) — без префикса */
function withLangForReview(href, lang){
  const L = String(lang || "en").toLowerCase();
  return REVIEW_PREFIX_LANGS.has(L)
    ? ensureLangPrefixFor(href, L)
    : stripKnownLangPrefix(href);
}

/* --------- MAIN --------- */
(async function main() {
  const { root, dry, ratingsPath, verbose } = parseArgs(process.argv.slice(2));
  const files = await listHtmlFiles(root);
  const presets = await loadPresets(root);
  const siteSettings = await safeJson(abs(root, SITES_SETTINGS));
  const ratingsMap = ratingsPath ? await safeJson(abs(root, ratingsPath)) : null;

  // Авто-детект доступных языков в проекте для блока "more-content"
  const AVAILABLE_LANGS = await detectAvailableLangs(root); // Set<string>

  let updated = 0, skipped = 0;
  for (const file of files) {
    const rel = path.relative(root, file);
    let html = await fs.readFile(file, "utf8");
    const nl = html.includes("\r\n") ? "\r\n" : "\n";
    const urlPath = fileToUrlPath(root, file);
    const { lang } = detectLang(urlPath);

    const masked = maskSegments(html);
    const hasBoxesHolder = findAllDivByClass(masked, "boxes-holder").length > 0;
    const isReviewPage   = /\/(reviews|mirrors)\//.test(urlPath);

    if (!hasBoxesHolder && !isReviewPage) { skipped++; continue; }

    let changed = false;

    if (hasBoxesHolder) {
      // существующая логика
      const newHtml = await processListingsGlobal(html, urlPath, lang, root, presets, nl, siteSettings);
      if (newHtml !== html) { html = newHtml; changed = true; }

      // NEW: серверный оффлайн-вставщик мод-боксов
      // ⚠ только для ru/en, чтобы не лезть в alt-языки (es/pt/tr/hi и т.д.)
      if ((lang === "en" || lang === "ru") && presets.modsBoxes) {
        const mbxHtml = upsertModsBoxesFromJSON(html, urlPath, lang, nl, presets.modsBoxes);
        if (mbxHtml !== html) { html = mbxHtml; changed = true; }
      }
    }

    if (isReviewPage) {
      const res = await processReviewMirrors(html, urlPath, lang, root, presets, ratingsMap, nl, verbose, siteSettings);
      if (res !== html) { html = res; changed = true; }
    }

    // ----- Integrated "more-content" pass (idempotent), with dynamic languages -----
    const mcChanged = await applyMoreContentIfNeeded(html, urlPath, lang, nl, root, AVAILABLE_LANGS);
    if (mcChanged !== null && mcChanged !== html) {
      html = mcChanged;
      changed = true;
    }

    // ----- Integrated "main-infobox" pass (server-side, idempotent) -----
    if (presets.infobox && INFOBOX_LANGS.has(lang)) {
      const ibNew = upsertMainInfobox(html, urlPath, lang, nl, presets.infobox);
      if (ibNew !== null && ibNew !== html) {
        html = ibNew;
        changed = true;
      }
    }

    if (changed) {
      if (!dry) await fs.writeFile(file, html, "utf8");
      console.log(`${dry ? "[DRY]" : "[OK] "} ${rel}`);
      updated++;
    } else {
      skipped++;
    }
  }
  console.log(`\nDone. Updated: ${updated}, skipped: ${skipped}, total: ${files.length}`);
})().catch(e=>{ console.error(e); process.exit(1); });

/* --------- FS/ARGS --------- */
function parseArgs(argv){ const get=f=>{const i=argv.indexOf(f); return i>=0? argv[i+1]:null;};
  const root = path.resolve(get("--root") ?? process.cwd());
  return { root, dry: argv.includes("--dry-run"), ratingsPath: get("--ratings"), verbose: argv.includes("--verbose") };
}
async function listHtmlFiles(root){ const out=[]; async function walk(d){ for (const e of await fs.readdir(d,{withFileTypes:true})) {
  const p=path.join(d,e.name); if (e.isDirectory()) await walk(p);
  else if (e.isFile() && e.name.toLowerCase().endsWith(".html")) out.push(p);
}} await walk(root); return out;}
function abs(root, p){ return p && p.startsWith("/") ? path.join(root,"."+p) : path.join(root,p); }
async function loadPresets(root){
  const filter       = await safeJson(abs(root, FILTER_SETTINGS));
  const review       = await safeJson(abs(root, REVIEW_SETTINGS));
  const translation  = await safeJson(abs(root, TRANSLATIONS_PATH));
  const infobox      = await safeJson(abs(root, INFOBOX_TRANSLATIONS));
  const modsBoxes    = await safeJson(abs(root, MODS_BOXES_PATH)); // NEW
  return { filter, review, translation, infobox, modsBoxes };
}
async function safeJson(p){ try { return JSON.parse(await fs.readFile(p,"utf8")); } catch { return null; } }

/* --------- URL/LANG --------- */
function fileToUrlPath(root, file){
  const rel = path.relative(root, file).split(path.sep).join("/");
  if (rel.toLowerCase().endsWith("/index.html")) {
    const base = "/" + rel.slice(0, -"/index.html".length);
    return base.endsWith("/")? base: base + "/";
  }
  if (rel.toLowerCase().endsWith(".html")) return "/" + rel.slice(0, -".html".length).replace(/\/{2,}/g,"/");
  return "/" + rel.replace(/\/{2,}/g,"/");
}
function detectLang(urlPath){ const seg=(urlPath.split("/").filter(Boolean)[0]||"").toLowerCase(); return { lang: KNOWN_LANGS.has(seg)? seg : "en" }; }

/* --------- HTML CORE --------- */
function maskSegments(s){
  return s
    .replace(/<!--[\s\S]*?-->/g, m => " ".repeat(m.length))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, m => " ".repeat(m.length))
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,  m => " ".repeat(m.length));
}
function readTag(s,start){
  let i=start,inS=false,inD=false;
  while(i<s.length){
    const ch=s[i];
    if (ch==="'" && !inD) inS=!inS; else if (ch==="\"" && !inS) inD=!inD;
    if (ch===">" && !inS && !inD){ i++; break; }
    i++;
  }
  const tagText=s.slice(start,i);
  const attrs=tagText.replace(/^<\w+\s*|\s*>$/g,"");
  return { end:i, attrs, tagText };
}
function parseClassAttr(attrs){ const m=attrs.match(/\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i); const val=m?(m[1]??m[2]??""):""; return new Set(val.split(/\s+/).filter(Boolean)); }
function findMatchingClose(masked, from, tag){
  const openRe=new RegExp(`<${tag}\\b`,"gi"), closeRe=new RegExp(`</${tag}\\s*>`,"gi");
  let depth=1, i=from;
  while(i<masked.length){
    const nOpen=masked.slice(i).search(openRe), nClose=masked.slice(i).search(closeRe);
    if (nClose===-1) return -1;
    if (nOpen!==-1 && nOpen<nClose){ const abs=i+nOpen; const {end}=readTag(masked,abs); depth++; i=end; continue; }
    const cabs=i+nClose; depth--; if (depth===0) return cabs; i=cabs+(`</${tag}>`).length;
  } return -1;
}
function findAllDivByClass(masked, clsName, from=0, to=masked.length){
  const out=[]; let idx=from;
  while(true){
    const pos=masked.indexOf("<div", idx); if (pos===-1 || pos>=to) break;
    const { end, attrs }=readTag(masked,pos); const cls=parseClassAttr(attrs);
    if (cls.has(clsName)){
      const closeStart=findMatchingClose(masked,end,"div"); if (closeStart===-1) break;
      out.push({ openStart:pos, openEnd:end, closeStart, closeEnd:closeStart + "</div>".length });
      idx=closeStart+6;
    } else idx=end;
  }
  return out;
}
function findFirstByClass(masked, clsName, from=0, to=masked.length){
  const arr=findAllDivByClass(masked, clsName, from, to); return arr.length? arr[0] : null;
}
function indentBefore(s, idx, nl){
  const ls = s.lastIndexOf(nl, idx-1);
  const lineStart = ls===-1?0:ls+nl.length;
  const m = s.slice(lineStart, idx).match(/^[\t ]*/);
  return m? m[0] : "";
}
function replaceWithin(s, a, b, repl){ return s.slice(0,a) + repl + s.slice(b); }
function escapeHtml(s=""){ return s.replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function escapeAttr(s=""){ return escapeHtml(s).replace(/'/g,"&#39;"); }
function collapseWS(s){ return s.replace(/[ \t]+$/gm,"").replace(/\r?\n{3,}/g,"\n\n"); }

/* --------- WS HELPERS --------- */
function lstripBlankLines(s, nl){
  let i=0;
  while(true){
    const j = s.indexOf(nl, i);
    if (j===-1) break;
    const line = s.slice(i, j);
    if (/^[ \t]*$/.test(line)){ i=j+nl.length; continue; }
    break;
  } return s.slice(i);
}
function rstripBlankLinesToOne(s, nl){
  let i=s.length;
  while(true){
    const k = s.lastIndexOf(nl, i - nl.length);
    if (k===-1) break;
    const line = s.slice(k+nl.length, i);
    if (/^[ \t]*$/.test(line)){ i=k; continue; }
    break;
  }
  s = s.slice(0, i).replace(/[ \t]+$/g,"");
  if (!s.endsWith(nl)) s += nl;
  return s;
}
function joinBlocksNoBlank(before, block, after, nl){
  const left  = rstripBlankLinesToOne(before, nl);
  const right = lstripBlankLines(after, nl);
  return left + block + nl + right;
}
function joinBlocksPreserveTop(before, block, after, nl){
  const left  = before.replace(/[ \t]+$/g, "");
  const right = lstripBlankLines(after, nl);
  return left + block + nl + right;
}
function joinAfterOpenNoBlank(openPart, block, body, nl){
  const left  = rstripBlankLinesToOne(openPart, nl);
  const right = lstripBlankLines(body, nl);
  return left + block + nl + right;
}
function joinBeforeCloseKeepIndent(before, block, after, nl){
  // базовый отступ строки, на которой будет закрытие
  const ls = before.lastIndexOf(nl);
  const lineStart = ls===-1 ? 0 : ls + nl.length;
  const indent = before.slice(lineStart).match(/^[\t ]*/)?.[0] ?? "";

  // слева оставляем не больше одной пустой строки
  const left = rstripBlankLinesToOne(before, nl);

  // справа убираем вообще всё ведущее пустое/пробельное — дадим своё \n + indent
  const afterClean = after.replace(/^\s+/, "");

  return left + block + nl + indent + afterClean;
}
function averageFirstFour(ratings) {
  if (!ratings || typeof ratings !== "object") return null;
  const vals = Object.values(ratings).map(Number).filter(Number.isFinite);
  if (!vals.length) return null;
  const take = vals.slice(0, 4);
  const avg = take.reduce((a,b)=>a+b,0) / take.length;
  return avg;
}

// REPLACE computeGoKey with this version
function computeGoKey(baseKey, urlPath = "", lang = "en", data = {}) {
  const p = String(urlPath || "").toLowerCase();
  const base = String(baseKey || "").trim();
  if (!base) return "";

  const hasPlain = (k) => k && typeof data === "object" && Object.prototype.hasOwnProperty.call(data, k) && !!data[k];
  const hasSeg = (seg) => new RegExp(`(?:^|/)${seg}(?:/|$)`).test(p);

  if (hasSeg("marketplaces") && hasPlain("marketplaces")) return `${base}-marketplaces`;
  if (hasSeg("instant-sell") && hasPlain("instant-sell")) return `${base}-instant-sell`;
  if (hasSeg("buy-skins")    && hasPlain("buy-skins"))    return `${base}-buy-skins`;
  if (hasSeg("sell-skins")   && hasPlain("sell-skins"))   return `${base}-sell-skins`;

  if ((/\/ru(?:\/|$)/.test(p)) && (p.includes("/earning/earn-by-play") || p.includes("/csgo/earn-by-play-csgo")) && hasPlain("earn-by-play")) {
    return `${base}-earn-by-play`;
  }
  if (!/\/ru(?:\/|$)/.test(p) && hasSeg("earn-by-play") && hasPlain("earn-by-play-en")) {
    return `${base}-earn-by-play-en`;
  }

  if (String(lang).toLowerCase() !== "ru") {
    if (hasPlain(`${base}-en`)) return `${base}-en`;
    if (hasPlain("link-en"))    return `${base}-en`;
  }
  return base;
}

/* ======================================================================= */
/* === NEW: ОФФЛАЙН РЕНДЕР МОД-БОКСОВ (перенос client-side forcemodsboxes) === */
/* ======================================================================= */

function mbxCleanUrl(url){ return String(url||"").split("?")[0].toLowerCase(); }
function mbxEnds(u, suf){ const x = mbxCleanUrl(u); return x.endsWith(suf.toLowerCase()); }
function mbxHas(u, seg){ return mbxCleanUrl(u).includes(`/${seg.toLowerCase()}/`); }

function mbxGetPageType(url){
  const u = mbxCleanUrl(url);
  const types = ["csgo", "rust", "dota", "tf2", "freebies", "crypto"];
  for (const t of types){
    if (u.includes(`/${t}/`) || u.endsWith(`/${t}`) || u.endsWith(`/${t}.html`)) return t;
  }
  if (u.endsWith("/cs2") || u.endsWith("/cs2.html")) return "csgo";
  return "other";
}
function mbxIsMulti(url){
  const patterns = [
    "buy-skins","buy-items","sell-items","trade-items",
    "sell-skins","trade-skins","instant-sell","marketplaces"
  ];
  const u = mbxCleanUrl(url);
  return patterns.some(p => u.endsWith(`/${p}`) || u.endsWith(`/${p}.html`));
}
function mbxGetBoxesToLoad(type, isMulti, url){
  const multi = { csgo:["csgo-skins","csgo"], rust:["rust-skins","rust"], dota:["dota-items","dota"] };
  const single= { csgo:["csgo"], rust:["rust"], dota:["dota"], tf2:["tf2-items"], freebies:["freebies"], crypto:["crypto"] };

  if (multi[type] && isMulti) return multi[type];
  if (single[type]) return single[type];

  const u = mbxCleanUrl(url);
  if (u.includes("/csgo/") || u.endsWith("/cs2") || u.endsWith("/cs2.html") || u.endsWith("/") || u.endsWith("index.html")) return ["csgo"];
  if (u.includes("/rust/") || u.endsWith("/rust")) return ["rust"];
  if (u.includes("/dota/") || u.endsWith("/dota")) return ["dota"];
  return [];
}
function mbxIsHome(url){
  const u = mbxCleanUrl(url).replace(/\/+$/,"/");
  return u === "/" || u === "/ru/" || u === "/ru";
}

const MBX_TRANSLATIONS = {
  "Buy Skins": { ru: "Купить скины" },
  "Sell Skins": { ru: "Продать скины" },
  "Trade Skins": { ru: "Обменять скины" },
  "Buy Items": { ru: "Купить предметы" },
  "Sell Items": { ru: "Продать предметы" },
  "Trade Items": { ru: "Обменять предметы" },
  "Instant Sell": { ru: "Быстрая Продажа" },
  "Marketplaces": { ru: "Торговые Площадки" },
  "Daily Rewards": { ru: "Ежедневные Награды" },
  "Deposit Bonuses": { ru: "Бонусы к Пополнению" },
  "Giveaways": { ru: "Розыгрыши" },
  "Sign Up Bonuses": { ru: "Бонусы за Регистрацию" },
  "Bonuses to Sale": { ru: "Бонусы к Продаже" },
  "Match Betting": { ru: "Ставки на Матчи" },
  Roulette: { ru: "Рулетка" },
  "Case Opening": { ru: "Открытие Кейсов" },
  Crash: { ru: "Краш" },
  Jackpot: { ru: "Джекпот" },
  Coinflip: { ru: "Монетка" },
  "Case Battle": { ru: "" },
  Slots: { ru: "" },
  More: { ru: "" },
  "Popular CS2 Gambling Sites": { ru: "" },
  "Popular Rust Gambling Sites": { ru: "" },
  "Popular CS2 Trading Sites": { ru: "" },
  "Instant Sell Platforms": { ru: "" },
  "Best Task Services": { ru: "" },
};

function mbxNormalize(text, lang){
  if (String(lang).toLowerCase() === "tr") {
    return String(text || "").toLocaleLowerCase("tr-TR");
  }
  return String(text || "").toLowerCase();
}

function mbxTranslate(title, lang){
  if (!title) return title;
  // В основном скрипте теперь переводим только на ru.
  const L = String(lang || "en").toLowerCase();
  if (L !== "ru") return title;

  const keys = Object.keys(MBX_TRANSLATIONS);
  const key = keys.find(k => mbxNormalize(k, L) === mbxNormalize(title, L));
  const map = key ? MBX_TRANSLATIONS[key] : null;
  const res = map && map[L];
  return res || title;
}

function mbxRenderBox(boxId, boxData, urlPath, lang, indent, nl){
  const items = Array.isArray(boxData?.items) ? boxData.items : (Array.isArray(boxData) ? boxData : []);
  if (!Array.isArray(items) || !items.length) return "";

  const lines = [];
  const classes = ["mods-box"];
  if (boxData && boxData.horizontal) classes.push("skins-box");

  lines.push(`${indent}<div class="${classes.join(" ")}" data-box-id="${escapeAttr(boxId)}">`);
  lines.push(`${indent}  <div class="mods-main-box">`);

  const cur = mbxCleanUrl(urlPath);
  for (const it of items){
    const href = String(it.href || "#");
    const active = href ? cur.includes(mbxCleanUrl(href)) : false;
    const itemCls = active ? 'singlemod-box active' : 'singlemod-box';

    if (boxData.horizontal){
      const title = mbxTranslate(it.title || "", lang);
      lines.push(`${indent}    <div class="${itemCls}">`);
      lines.push(`${indent}      <a class="singlemod-select" href="${escapeAttr(href)}">`);
      if (it.img){
        lines.push(`${indent}        <img src="${escapeAttr(it.img.src||"")}" alt="${escapeAttr(it.img.alt||"")}">`);
      } else if (it.icon){
        lines.push(`${indent}        <div class="singlemod-icon officon ${escapeAttr(it.icon)}"></div>`);
      }
      lines.push(`${indent}        <span>${escapeHtml(title)}</span>`);
      lines.push(`${indent}      </a>`);
      lines.push(`${indent}    </div>`);
    } else {
      const title = mbxTranslate(it.title || "", lang);
      lines.push(`${indent}    <div class="${itemCls}" data-title="${escapeAttr(title)}">`);
      lines.push(`${indent}      <a class="singlemod-select" href="${escapeAttr(href)}">`);
      if (it.img){
        lines.push(`${indent}        <img src="${escapeAttr(it.img.src||"")}" alt="${escapeAttr(it.img.alt||"")}">`);
      } else if (it.icon){
        lines.push(`${indent}        <div class="singlemod-icon officon ${escapeAttr(it.icon)}"></div>`);
      }
      lines.push(`${indent}      </a>`);
      lines.push(`${indent}    </div>`);
    }
  }

  lines.push(`${indent}  </div>`);
  lines.push(`${indent}</div>`);
  return lines.join(nl);
}

function mbxAttr(name, attrsText){
  const re = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i");
  const m = re.exec(attrsText||"");
  return m ? (m[2]||"") : null;
}

function upsertModsBoxesFromJSON(originalHtml, urlPath, lang, nl, modsData){
  if (!modsData) return originalHtml;

  const masked = maskSegments(originalHtml);
  const holders = findAllDivByClass(masked, "boxes-holder");
  if (!holders.length) return originalHtml;

  // Берём ПЕРВЫЙ .boxes-holder, как в client-side скрипте (querySelector)
  const holder = holders[0];

  let out = originalHtml;
  const regionStart = holder.openEnd;
  const regionEnd   = holder.closeStart;

  let inner = out.slice(regionStart, regionEnd);
  let innerMasked = maskSegments(inner);

  // index/home спец-вставка: csgo-skins ПОСЛЕ .main-mode-selection
  const shouldInsertHomeSkins = mbxIsHome(urlPath);
  if (shouldInsertHomeSkins && modsData["csgo-skins"]){
    const boxId = "csgo-skins";

    // если уже есть такой data-box-id — заменим
    // (htmlBox построим ниже уже с корректным отступом)
    const probeIndent = indentBefore(out, regionStart, nl) + "  ";
    let htmlBox = mbxRenderBox(boxId, modsData[boxId], urlPath, lang, probeIndent, nl);

    if (htmlBox){
      const rep = mbxReplaceExistingModsBox(inner, innerMasked, boxId, htmlBox, nl);
      if (rep.changed){
        inner = rep.html; innerMasked = maskSegments(inner);
      } else {
        // иначе вставим после .main-mode-selection; отступ берём от самого якоря
        const mms = findFirstByClass(innerMasked, "main-mode-selection");
        if (mms){
          const blockIndent = indentBefore(inner, mms.openStart, nl);
          htmlBox = mbxRenderBox(boxId, modsData[boxId], urlPath, lang, blockIndent, nl);

          const before = inner.slice(0, mms.closeEnd);
          const after  = inner.slice(mms.closeEnd);
          inner = joinBlocksNoBlank(before, htmlBox, after, nl);
        } else {
          // fallback — просто в конец, с базовым отступом региона
          const fallbackIndent = indentBefore(out, regionStart, nl) + "  ";
          htmlBox = mbxRenderBox(boxId, modsData[boxId], urlPath, lang, fallbackIndent, nl);
          inner = joinBlocksNoBlank(inner, htmlBox, "", nl);
        }
        innerMasked = maskSegments(inner);
      }
    }
  }


  // Основная логика выбора боксoв для остальных страниц
  const pageType = mbxGetPageType(urlPath);
  const isMulti  = mbxIsMulti(urlPath);
  const boxesToLoad = mbxGetBoxesToLoad(pageType, isMulti, urlPath);

  const inserted = new Set();

  for (const boxId of boxesToLoad){
    if (inserted.has(boxId)) continue;
    const data = modsData[boxId]; if (!data) continue;

    const indent = indentBefore(out, regionStart, nl) + "  ";
    const htmlBox = mbxRenderBox(boxId, data, urlPath, lang, indent, nl);
    if (!htmlBox) continue;

    // если уже есть — заменить; иначе PREPEND (как в client-side)
    const rep = mbxReplaceExistingModsBox(inner, innerMasked, boxId, htmlBox, nl);
    if (rep.changed){
      inner = rep.html; innerMasked = maskSegments(inner);
    } else {
      const openPart = out.slice(0, regionStart);
      const bodyPart = inner;
      inner = joinAfterOpenNoBlank(openPart, htmlBox, bodyPart, nl).slice(openPart.length);
      innerMasked = maskSegments(inner);
    }
    inserted.add(boxId);
  }

  // собрать итог
  return out.slice(0, regionStart) + inner + out.slice(regionEnd);
}

function mbxReplaceExistingModsBox(inner, innerMasked, boxId, htmlBox, nl){
  function reindentTo(block, newIndent, nl){
    const lines = block.split(nl);
    if (!lines.length) return block;
    const curIndent = (lines[0].match(/^[\t ]*/) || [""])[0];
    if (curIndent === newIndent) return block;
    const esc = curIndent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rx = new RegExp("^" + esc);
    return lines.map(l => l.replace(rx, newIndent)).join(nl);
  }

  const modsBlocks = findAllDivByClass(innerMasked, "mods-box");
  for (const b of modsBlocks){
    const open = readTag(inner, b.openStart);
    const id = mbxAttr("data-box-id", open.attrs);
    if (id === boxId){
      const beforeRaw = inner.slice(0, b.openStart);
      const before    = beforeRaw.replace(/[ \t]+$/g, "");
      const after     = inner.slice(b.closeEnd);

      const desiredIndent = indentBefore(inner, b.openStart, nl);
      const patched = reindentTo(htmlBox, desiredIndent, nl);
      return { changed: true, html: before + patched + after };
    }
  }
  return { changed:false, html: inner };
}

/* ========================================================================== */
/* =================== ДАЛЕЕ — существующая логика проекта =================== */
/* ========================================================================== */

function buttonSpanLabel(lang = "en", type = "review") {
  const L = String(lang || "en").toLowerCase();

  const dict = {
    en: { visit: "Visit",    similar: "Similar",     review: "Read More" },
    ru: { visit: "Перейти",  similar: "Похожие",     review: "Подробнее" },
    es: { visit: "Visitar",  similar: "Similares",   review: "Leer más"  },
    tr: { visit: "Ziyaret et", similar: "Benzer",    review: "Devamını oku" }
  };

  if (!dict[L]) return null;

  if (type === "visit") return dict[L].visit;
  if (type === "similar") return dict[L].similar;
  return dict[L].review;
}


function updateVisitLinkInBoxHtml(boxHtml, visitHref, nl, siteName = "", lang = "en"){
  if (!visitHref) return boxHtml;
  const hrefValue = String(visitHref).replace(/\/{2,}/g, (m)=> m === "//" ? "//" : "/");

  const masked = maskSegments(boxHtml);
  const content = findFirstByClass(masked, "content");
  if (!content) return boxHtml;

  const cOpenEnd = content.openEnd;
  const cCloseStart = content.closeStart;
  let segment = boxHtml.slice(cOpenEnd, cCloseStart);

  const segMasked = maskSegments(segment);
  const cb = findFirstByClass(segMasked, "content-buttons");
  if (!cb) return boxHtml;

  const regionStart = cb.openEnd;
  const regionEnd   = cb.closeStart;
  const before = segment.slice(0, regionStart);
  const region = segment.slice(regionStart, regionEnd);
  const after  = segment.slice(regionEnd);

  const isRu = String(lang).toLowerCase() === "ru";
  const visitLabel = siteName
    ? (isRu ? `Перейти на ${siteName}` : `Visit ${siteName}`)
    : (isRu ? "Перейти на сайт" : "Visit Site");

  const btnSpan = buttonSpanLabel(lang, "visit");
  const spanHtml = btnSpan ? `<span>${escapeHtml(btnSpan)}</span>` : null;

  const newRegion = region.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, (full) => {
    const open = full.match(/^<a\b[^>]*>/i)?.[0]; if (!open) return full;

    const clsMatch = open.match(/\bclass\s*=\s*(["'])([^"']*)\1/i);
    const classes = new Set((clsMatch ? clsMatch[2] : "").split(/\s+/).filter(Boolean));
    if (!classes.has("visit")) return full;

    let newOpen = upsertAttrInTag(open, "href", hrefValue);
    newOpen = upsertAttrInTag(newOpen, "target", "_blank");
    newOpen = upsertAttrInTag(newOpen, "rel", "noopener");
    newOpen = upsertAttrInTag(newOpen, "aria-label", visitLabel);

    if (spanHtml) return newOpen + spanHtml + `</a>`;
    return newOpen + full.slice(open.length);
  });

  if (newRegion === region) return boxHtml;

  const rebuiltSegment = before + newRegion + after;
  return boxHtml.slice(0, cOpenEnd) + rebuiltSegment + boxHtml.slice(cCloseStart);
}

function extractLogobgHref(boxHtml){
  const m = maskSegments(boxHtml);
  const lb = findFirstByClass(m, "logobg");
  if (!lb) return "";
  const region = boxHtml.slice(lb.openEnd, lb.closeStart);
  const a = region.match(/<a\b[^>]*href\s*=\s*(["'])(.*?)\1/i);
  return a ? a[2] : "";
}

function buildReviewAriaLabel(siteName = "", lang = "en", mode = "review") {
  const L = String(lang || "en").toLowerCase();
  const name = String(siteName || "").trim();
  if (mode === "similar") {
    return L === "ru" ? `Альтернативы ${name}` : `Similar Sites of ${name}`;
  }
  return L === "ru" ? `Читать Обзор ${name}` : `Read Review ${name}`;
}

function ensureFirstReviewAnchorInBoxHtml(boxHtml, nl, opts) {
  const { lang = "en", siteName = "", mode = "review", reviewHref = "" } = opts || {};
  const isRu = String(lang).toLowerCase() === "ru";

  const masked  = maskSegments(boxHtml);
  const content = findFirstByClass(masked, "content");
  if (!content) return boxHtml;

  const cOpenEnd    = content.openEnd;
  const cCloseStart = content.closeStart;
  let   segment     = boxHtml.slice(cOpenEnd, cCloseStart);

  const segMasked = maskSegments(segment);
  const cb = findFirstByClass(segMasked, "content-buttons");
  if (!cb) return boxHtml;

  const regionStart = cb.openEnd;
  const regionEnd   = cb.closeStart;
  const before      = segment.slice(0, regionStart);
  let   region      = segment.slice(regionStart, regionEnd);
  let   after       = segment.slice(regionEnd);

  const hrefRaw = reviewHref || extractLogobgHref(boxHtml) || "#";
  const href    = (mode === "similar")
    ? withLangForSimilar(hrefRaw, lang)
    : withLangForReview(hrefRaw, lang);

  const aria = buildReviewAriaLabel(siteName, lang, mode);

  const spanTxt = buttonSpanLabel(lang, mode === "similar" ? "similar" : "review");
  const spanHtml = spanTxt ? `<span>${escapeHtml(spanTxt)}</span>` : null;

  region = region.replace(/\s+$/,'');

  let patched = false;
  region = region.replace(/<a\b([^>]*?)>([\s\S]*?)<\/a>/gi, (full, attrs, inner) => {
    if (patched) return full;

    const clsM = String(attrs).match(/\bclass\s*=\s*(["'])([^"']*)\1/i);
    const classes = new Set((clsM ? clsM[2] : "").split(/\s+/).filter(Boolean));
    const isReviewBtn = classes.has("review-button") && !classes.has("visit") && !classes.has("mirror-visit");

    if (!isReviewBtn) return full;

    let open = `<a${attrs}>`;
    open = upsertAttrInTag(open, "href", href);
    open = upsertAttrInTag(open, "aria-label", aria);

    patched = true;
    if (spanHtml) return open + spanHtml + `</a>`;
    return open + inner + `</a>`;
  });

  if (!patched) {
    const baseIndent = indentBefore(segment, cb.openStart, nl);
    const linkIndent = baseIndent + "  ";
    const inner = spanHtml ? spanHtml : "";
    const line = `${linkIndent}<a href="${escapeAttr(href)}" aria-label="${escapeAttr(aria)}" class="review-button">${inner}</a>`;
    region = region ? (line + nl + region) : line;
  }

  const baseIndent = indentBefore(segment, cb.openStart, nl);
  after = after.replace(/^\s*<\/div>/, nl + baseIndent + "</div>");

  const rebuilt = before + region + after;
  return boxHtml.slice(0, cOpenEnd) + rebuilt + boxHtml.slice(cCloseStart);
}

function removeMirrorVisitFromBoxHtml(boxHtml, nl){
  const masked  = maskSegments(boxHtml);
  const content = findFirstByClass(masked, "content");
  if (!content) return boxHtml;

  const cOpenEnd = content.openEnd;
  const cCloseStart = content.closeStart;
  let segment = boxHtml.slice(cOpenEnd, cCloseStart);

  const segMasked = maskSegments(segment);
  const cb = findFirstByClass(segMasked, "content-buttons");
  if (!cb) return boxHtml;

  const regionStart = cb.openEnd;
  const regionEnd   = cb.closeStart;
  const before = segment.slice(0, regionStart);
  let   region = segment.slice(regionStart, regionEnd);
  let   after  = segment.slice(regionEnd);

  const old = region;
  region = region.replace(/<a\b[^>]*\bmirror-visit\b[^>]*>[\s\S]*?<\/a>\s*/gi, "");

  if (region === old) return boxHtml;

  const baseIndent = indentBefore(segment, cb.openStart, nl);
  after = after.replace(/^\s*<\/div>/, nl + baseIndent + "</div>");

  const rebuilt = before + region + after;
  return boxHtml.slice(0, cOpenEnd) + rebuilt + boxHtml.slice(cCloseStart);
}

function ensureVisitAnchorMaybeAdd(boxHtml, nl){
  const masked  = maskSegments(boxHtml);
  const content = findFirstByClass(masked, "content");
  if (!content) return boxHtml;

  const cOpenEnd = content.openEnd;
  const cCloseStart = content.closeStart;
  let segment = boxHtml.slice(cOpenEnd, cCloseStart);

  const segMasked = maskSegments(segment);
  const cb = findFirstByClass(segMasked, "content-buttons");
  if (!cb) return boxHtml;

  const regionStart = cb.openEnd;
  const regionEnd   = cb.closeStart;
  const before = segment.slice(0, regionStart);
  let   region = segment.slice(regionStart, regionEnd);
  let   after  = segment.slice(regionEnd);

  if (/\breview-button\b[^>]*\bvisit\b/i.test(region)) return boxHtml;

  const baseIndent = indentBefore(segment, cb.openStart, nl);
  const linkIndent = baseIndent + "  ";
  const visitLine = `${linkIndent}<a href="#" aria-label="Visit" class="review-button visit" target="_blank" rel="noopener"></a>`;

  if (/<a\b/i.test(region)){
    region = region.replace(/(<a\b[\s\S]*?<\/a>)/i, (_m) => _m + nl + visitLine);
  } else {
    region = region ? (visitLine + nl + region) : visitLine;
  }

  after = after.replace(/^\s*<\/div>/, nl + baseIndent + "</div>");
  const rebuilt = before + region + after;
  return boxHtml.slice(0, cOpenEnd) + rebuilt + boxHtml.slice(cCloseStart);
}

function ensureMainBoxButtonsOnReviewMirrors(html, lang, data, urlPath, reviewSettings, visitHrefMain, nl){
  if (!data) return html;
  const isReviewCtx = /\/(reviews|mirrors)\//.test(String(urlPath));
  if (!isReviewCtx) return html;

  let out = html;
  const masked = maskSegments(out);
  const boxes = findAllDivByClass(masked, "box");
  if (!boxes.length) return out;

  for (const b of boxes){
    const open = readTag(out, b.openStart);
    const cls = parseClassAttr(open.attrs);
    if (!cls.has("main")) continue;

    const boxHtml = out.slice(b.openStart, b.closeEnd);

    let cur = removeMirrorVisitFromBoxHtml(boxHtml, nl);

    const mmPath = reviewSettings?.mainModeLinks?.[data["Main Mode"]] || "/csgo/caseopening";
    cur = ensureFirstReviewAnchorInBoxHtml(cur, nl, {
      lang, siteName: data.name || "", mode: "similar", reviewHref: mmPath
    });

    cur = ensureVisitAnchorMaybeAdd(cur, nl);
    cur = updateVisitLinkInBoxHtml(cur, visitHrefMain, nl, data.name || "", lang);

    cur = ensureCopyButtonInBoxHtml(cur, data.code ?? "", nl, lang);

    if (cur !== boxHtml){
      out = out.slice(0, b.openStart) + cur + out.slice(b.closeEnd);
    }
    break;
  }
  return out;
}

// REPLACED ensureNumericRatingInLogobg (new version)
function ensureNumericRatingInLogobg(boxHtml, ratingValue, nl){
  if (ratingValue == null) return boxHtml;

  const masked = maskSegments(boxHtml);
  const lb = findFirstByClass(masked, "logobg");
  if (!lb) return boxHtml;

  const before = boxHtml.slice(0, lb.openEnd);
  let   region = boxHtml.slice(lb.openEnd, lb.closeStart);
  const after  = boxHtml.slice(lb.closeStart);

  const fmt = (n) => (Number.isFinite(n) ? (Math.round(n*100)/100).toFixed(2) : "0.00");

  if (/<div\b[^>]*class\s*=\s*["'][^"']*\brating-case-single\b/i.test(region)){
    region = region.replace(
      /(<div\b[^>]*class\s*=\s*["'][^"']*\brating-summ\b[^"']*["'][^>]*>)[\s\S]*?(<\/div>)/i,
      (_, a, c) => a + fmt(ratingValue) + c
    );

    const reNL = new RegExp(`(?:\\r?\\n)[\\t ]*(?:\\r?\\n)+([\\t ]*)(?=<div\\b[^>]*\\brating-case-single\\b)`, "i");
    region = region.replace(reNL, nl + "$1");

    return before + region + after;
  }

  const closeIndent = indentBefore(boxHtml, lb.closeStart, nl);
  const lineIndent  = closeIndent + "  ";

  region = region.replace(/[ \t]+$/g, "").replace(/(?:\r?\n)+$/g, "");

  const block = [
    `${lineIndent}<div class="rating-case-single">`,
    `${lineIndent}  <div class="star_rating officon"></div>`,
    `${lineIndent}  <div class="rating-summ">${fmt(ratingValue)}</div>`,
    `${lineIndent}</div>`
  ].join(nl);

  return before + region + nl + block + nl + closeIndent + after;
}

function ensureVisitLinkInMainBox(html, visitHref, nl, siteName = "", lang = "en"){
  if (!visitHref) return html;
  let out = html;

  const masked = maskSegments(out);
  const boxes = findAllDivByClass(masked, "box");
  if (!boxes.length) return out;

  for (const b of boxes){
    const open = readTag(out, b.openStart);
    const cls = parseClassAttr(open.attrs);
    if (!cls.has("main")) continue;

    const boxHtml = out.slice(b.openStart, b.closeEnd);
    const updated = updateVisitLinkInBoxHtml(boxHtml, visitHref, nl, siteName, lang);
    if (updated !== boxHtml){
      out = out.slice(0, b.openStart) + updated + out.slice(b.closeEnd);
    }
    break;
  }
  return out;
}

// REPLACE: upsertRouteForBoxHtml
function upsertRouteForBoxHtml(boxHtml, type /* 'required'|'maybe' */, inSection, nl){
  if (!boxHtml) return boxHtml;

  let cleaned = boxHtml;
  cleaned = removeAllBlocksByClass(cleaned, "route");
  cleaned = removeAllBlocksByClass(cleaned, "route-semi");

  function buildRouteBlock(indent){
    if (type === "required") {
      return `${indent}<div class="route">Доступ ограничен</div>`;
    }
    return [
      `${indent}<div class="route-semi">`,
      `${indent}  <div class="officon globe"></div>`,
      `${indent}</div>`
    ].join(nl);
  }

  const masked = maskSegments(cleaned);
  const lb = findFirstByClass(masked, "logobg");
  if (lb) {
    const lbInnerStart = lb.openEnd;
    const lbInnerEnd   = lb.closeStart;

    const beforeLB = cleaned.slice(0, lbInnerStart);
    let   body     = cleaned.slice(lbInnerStart, lbInnerEnd);
    const afterLB  = cleaned.slice(lbInnerEnd);

    (function stripLocalRoutes(){
      while (true){
        const m1 = maskSegments(body);
        const r  = findFirstByClass(m1, "route");
        const rs = findFirstByClass(m1, "route-semi");
        const b  = r || rs;
        if (!b) break;
        body = body.slice(0, b.openStart) + body.slice(b.closeEnd);
      }
    })();

    const bodyMasked = maskSegments(body);
    const mm = findFirstByClass(bodyMasked, "main-mode");

    let lineStart, before, after, indent;

    if (mm){
      const ls = body.lastIndexOf(nl, mm.openStart);
      lineStart = (ls === -1) ? 0 : ls + nl.length;

      before = body.slice(0, lineStart);
      after  = body.slice(lineStart);

      const indentMatch = body.slice(lineStart, mm.openStart).match(/^[\t ]*/);
      indent = indentMatch ? indentMatch[0] : "";
    } else {
      const ls = body.lastIndexOf(nl);
      lineStart = (ls === -1) ? 0 : ls + nl.length;

      before = body.slice(0, lineStart);
      after  = body.slice(lineStart);

      const indentMatch = after.match(/^[\t ]*/);
      indent = indentMatch ? indentMatch[0] : "";
    }

    const block = buildRouteBlock(indent);
    const newBody = joinBlocksNoBlank(before, block, after, nl);

    return beforeLB + newBody + afterLB;
  }

  if (inSection){
    const closeIdx = cleaned.lastIndexOf("</div>");
    if (closeIdx === -1) return cleaned;

    const ls = cleaned.lastIndexOf(nl, closeIdx);
    const lineStart = ls === -1 ? 0 : ls + nl.length;

    const before = cleaned.slice(0, lineStart);
    const after  = cleaned.slice(lineStart);

    const indentMatch = cleaned.slice(lineStart, closeIdx).match(/^[\t ]*/);
    const indent = indentMatch ? indentMatch[0] : "";

    const block = buildRouteBlock(indent);
    return joinBlocksNoBlank(before, block, after, nl);
  }

  return cleaned;
}

/* --- Маркеры маршрутов по всей странице (только RU), игнор freebies --- */
function ensureRouteMarkersForPage(html, lang, siteSettings, nl, urlPath){
  const L = String(lang || "ru").toLowerCase();
  if (L !== "ru" || !siteSettings) return html;

  const p = String(urlPath || "").toLowerCase();

  if (p.includes("/freebies/") || /(?:^|\/)freebies$/.test(p)) {
    return html;
  }

  const req = new Set(siteSettings.RequiredRoute || siteSettings.requiredRoute || []);
  const may = new Set(siteSettings.MaybeRoute    || siteSettings.maybeRoute    || []);
  if (!req.size && !may.size) return html;

  let out = html;
  const masked = maskSegments(out);
  const boxes = findAllDivByClass(masked, "box");
  if (!boxes.length) return out;

  const sections = findAllDivByClass(masked, "boxes-holder-section");

  let shift = 0;
  for (const b of boxes){
    const bOpenAbs  = b.openStart + shift;
    const bCloseAbs = b.closeEnd   + shift;

    const openTag = readTag(out, bOpenAbs);
    const idMatch = openTag.tagText.match(/\bid\s*=\s*(["'])([^"']+)\1/i);
    const boxId = idMatch ? idMatch[2] : "";

    const inSection = sections.some(sec =>
      (sec.openStart + shift) <= bOpenAbs && (sec.closeEnd + shift) >= bCloseAbs
    );

    const needReq = boxId && req.has(boxId);
    const needMay = boxId && may.has(boxId);

    if (!needReq && !needMay) continue;

    const boxHtml = out.slice(bOpenAbs, bCloseAbs);
    const next = upsertRouteForBoxHtml(boxHtml, needReq ? "required" : "maybe", inSection, nl);
    if (next !== boxHtml){
      out = out.slice(0, bOpenAbs) + next + out.slice(bCloseAbs);
      shift += next.length - (bCloseAbs - bOpenAbs);
    }
  }
  return out;
}

/* ======================================================================= */

/* --------- SMALL HELPERS --------- */
function computeVisitHref(urlPath, lang, baseKey, data = {}) {
  const p = String(urlPath || "").toLowerCase();
  const L = String(lang || "en").toLowerCase();
  const has = (k) => k && Object.prototype.hasOwnProperty.call(data, k) && !!data[k];
  const seg = (s) => new RegExp(`(?:^|/)${s}(?:/|$)`).test(p);

  if (seg("marketplaces") && has("marketplaces")) return String(data["marketplaces"]);
  if (seg("instant-sell") && has("instant-sell")) return String(data["instant-sell"]);
  if (seg("buy-skins")    && has("buy-skins"))    return String(data["buy-skins"]);
  if (seg("sell-skins")   && has("sell-skins"))   return String(data["sell-skins"]);

  const isEarnByPlay = seg("earn-by-play") || p.includes("/csgo/earn-by-play-csgo");
  if (isEarnByPlay) {
    if (L === "ru"  && has("earn-by-play"))    return String(data["earn-by-play"]);
    if (L !== "ru" && has("earn-by-play-en"))  return String(data["earn-by-play-en"]);
  }

  if (L === "ru"  && has("link"))     return String(data["link"]);
  if (L !== "ru" && has("link-en"))   return String(data["link-en"]);

  return String(data["link"] || data["link-en"] || "#");
}

function getPageKeyFromHref(hrefRaw){
  if (!hrefRaw) return null;
  const href = hrefRaw.split("#")[0].split("?")[0].replace(/\/+$/,"");
  const segs = href.split("/").filter(Boolean);
  return segs[segs.length-1] || null;
}
function isExternal(href){ return /^https?:\/\//i.test(href); }
function normalizeUrl(u){ return (u||"").replace(/\/{2,}/g,"/"); }

/* --------- JSON LOADERS --------- */
async function siteJson(root, key){ return await safeJson(abs(root, `${SITE_INFOS}/${key}.json`)); }
async function altJson (root, key){ return await safeJson(abs(root, `${ALT_SITES}/${key}.json`)); }

/* --------- LISTINGS --------- */
async function processListingsGlobal(html, urlPath, lang, root, presets, nl, siteSettings){
  const masked = maskSegments(html);
  const holders = findAllDivByClass(masked, "boxes-holder");
  if (!holders.length) return html;

  let out = html, shift = 0;
  for (const holder of holders){
    const hStart = holder.openEnd + shift, hEnd = holder.closeStart + shift;
    const innerMasked = maskSegments(out.slice(hStart, hEnd));
    const boxes = findAllDivByClass(innerMasked, "box");
    let delta = 0;

    for (const b of boxes){
      const absOpen = hStart + b.openStart + delta;
      const absClose= hStart + b.closeEnd  + delta;
      let boxHtml = out.slice(absOpen, absClose);

      const boxMasked = maskSegments(boxHtml);
      const logobg = findFirstByClass(boxMasked, "logobg"); if (!logobg) continue;

      const region = boxHtml.slice(logobg.openStart, logobg.closeStart);
      const aIdx = region.indexOf("<a"); if (aIdx===-1) continue;
      const { tagText } = readTag(region, aIdx);
      const href = (tagText.match(/\bhref\s*=\s*(['"])(.*?)\1/i)?.[2]) || "";
      const key = getPageKeyFromHref(href); if (!key) continue;

      const data = await siteJson(root, key); if (!data) continue;

      if (data["Main Mode"]) {
        const rebuilt = rebuildMainModeInMainBox(boxHtml, logobg, data["Main Mode"], lang, nl);
        if (collapseWS(rebuilt) !== collapseWS(boxHtml)) boxHtml = rebuilt;
      }

      const visitHref = computeVisitHref(urlPath, lang, key, data);

      boxHtml = updateVisitLinkInBoxHtml(boxHtml, visitHref, nl, data.name || "", lang);

      const reviewHrefBase = extractLogobgHref(boxHtml) || `/reviews/${key}`;
      boxHtml = ensureFirstReviewAnchorInBoxHtml(boxHtml, nl, {
        lang,
        siteName: data.name || "",
        mode: "review",
        reviewHref: reviewHrefBase
      });

      boxHtml = ensureMirrorVisitButtonInBoxHtml(boxHtml, lang, key, data.mirror, nl);

      const firstOpen = readTag(boxHtml, 0);
      const isMain = parseClassAttr(firstOpen.attrs).has("main");
      if (isMain) boxHtml = updateLogobgAnchorInBoxHtml(boxHtml, visitHref, nl);

      boxHtml = ensureTGButtonInBoxHtml(boxHtml, data, lang, nl);
      boxHtml = ensureCopyButtonInBoxHtml(boxHtml, data.code ?? "", nl, lang);

      const avg = averageFirstFour(data.ratings);
      boxHtml = ensureNumericRatingInLogobg(boxHtml, avg, nl);

      if (collapseWS(boxHtml) !== collapseWS(out.slice(absOpen, absClose))) {
        out = replaceWithin(out, absOpen, absClose, boxHtml);
        delta += boxHtml.length - (absClose - absOpen);
      }
    }
    shift += delta;
  }

  out = ensureRouteMarkersForPage(out, lang, siteSettings, nl, urlPath);
  return out;
}

/* --------- REVIEWS/MIRRORS --------- */
async function processReviewMirrors(html, urlPath, lang, root, presets, ratingsMap, nl, verbose, siteSettings){
  let out = html;

  const masked2 = maskSegments(out);
  const hasReview = !!findFirstByClass(masked2, "boxreview");
  const pageKey = urlPath.replace(/\/(?:index)?\.html$/,"").split("/").filter(Boolean).pop();
  const data = await siteJson(root, pageKey); if (!data) return out;

  if (hasReview){
    let boxreview = findFirstByClass(masked2, "boxreview");
    out = upsertGamemodesInScreentable(out, boxreview, lang, data, presets.review, nl);
    boxreview = findFirstByClass(maskSegments(out), "boxreview"); if (!boxreview) return out;

    out = upsertFeaturesShortinfo(out, boxreview, lang, data.featuresContent || [], presets.filter, presets.review, nl);
    boxreview = findFirstByClass(maskSegments(out), "boxreview"); if (!boxreview) return out;

    out = upsertSitedetails(out, boxreview, lang, data, presets.review, nl);
    boxreview = findFirstByClass(maskSegments(out), "boxreview"); if (!boxreview) return out;

    out = upsertRatings(out, boxreview, data, nl);
    boxreview = findFirstByClass(maskSegments(out), "boxreview"); if (!boxreview) return out;

    out = await upsertAlternatives(out, boxreview, root, lang, urlPath, data["Sites Alternatives"] || [], ratingsMap, nl, { forceAfterCriteria: true });
  }

  if (presets.translation && presets.translation[lang]) {
    out = applyReviewTranslations(out, lang, presets.translation[lang], nl);
  }

  out = ensureMainModeInLogobg(out, lang, data["Main Mode"] || "", nl);
  out = upsertSiteCodes(out, data, nl);
  out = upsertPromoBoxesInSitepage(out, urlPath, lang, pageKey, data, presets.review, nl);

  const visitHrefMain = computeVisitHref(urlPath, lang, pageKey, data);

  out = ensureVisitLinkInMainBox(out, visitHrefMain, nl, data.name || "", lang);

  (function normalizeCopyButtonsInAllBoxes(){
    let masked = maskSegments(out);
    let boxes = findAllDivByClass(masked, "box");
    if (!boxes.length) return;

    let shift = 0;
    for (const b of boxes){
      const open = b.openStart + shift, close = b.closeEnd + shift;
      const boxHtml = out.slice(open, close);
      const upd = ensureCopyButtonInBoxHtml(boxHtml, "", nl, lang);
      if (upd !== boxHtml){
        out = out.slice(0, open) + upd + out.slice(close);
        shift += upd.length - (close - open);
      }
    }
  })();

  out = ensureMainLogobgLink(out, visitHrefMain, nl);
  out = upsertInstructionSiteLinks(out, visitHrefMain);
  out = ensureTGButtonInMainBox(out, data, lang, nl);
  out = ensureMainBoxLiverating(out, data.ratings || {}, nl);

  out = localizeLanguageLinks(out, lang);
  out = enforceShortinfoEmptyState(out);

  out = ensureMainBoxButtonsOnReviewMirrors(out, lang, data, urlPath, presets.review, visitHrefMain, nl);

  out = ensureCopyButtonInMainBox(out, data.code ?? "", nl, lang);

  out = cleanupNestedBoxreview(out);
  out = normalizeIntertagSpaces(out);
  out = compressLooseWhitespace(out);

  return out;
}

/* --------- RENDER: main-mode для листингов --------- */
function rebuildMainModeInMainBox(boxHtml, _logobgRegion, mainMode, lang, nl) {
  let out = boxHtml;

  while (true) {
    const m = maskSegments(out);
    const mm = findFirstByClass(m, "main-mode");
    if (!mm) break;
    out = out.slice(0, mm.openStart) + out.slice(mm.closeEnd);
  }

  const maskedAfter = maskSegments(out);
  const logobg = findFirstByClass(maskedAfter, "logobg");
  if (!logobg) return out;

  const insertPos = logobg.closeStart;
  const indent = indentBefore(out, insertPos, nl);
  const baseIndent = indent + "  ";

  const block = buildMainModeBlock(mainMode, lang, baseIndent, nl);
  const before = out.slice(0, insertPos);
  const after  = out.slice(insertPos);
  return joinBeforeCloseKeepIndent(before, block, after, nl);
}

/* --------- NEW: main-mode для reviews/mirrors --------- */
function buildMainModeBlock(mainMode, lang, baseIndent, nl){
  const lines = [
    `${baseIndent}<div class="main-mode ${mainMode} lang-${lang}">`,
    `${baseIndent}  <div class="main-mode-box">`,
    `${baseIndent}    <div class="main-mode-icon"></div>`,
    `${baseIndent}  </div>`,
    `${baseIndent}</div>`
  ];
  return lines.join(nl);
}
function extractMainModeClass(block){
  const m = String(block).match(/<div\b[^>]*class\s*=\s*["']([^"']*\bmain-mode\b[^"']*)["']/i);
  if (!m) return "";
  const tokens = m[1].split(/\s+/).filter(Boolean);
  return tokens.filter(t=>t!=="main-mode" && !/^lang-/.test(t)).join(" ").trim();
}
function relocateOrInsertMainMode(boxHtml, lang, mainModeFromData, nl){
  const preMasked = maskSegments(boxHtml);
  const preLogobg = findFirstByClass(preMasked, "logobg");
  if (!preLogobg) return boxHtml;

  let savedBlock = null;
  let work = boxHtml;

  while (true){
    const m = maskSegments(work);
    const mm = findFirstByClass(m, "main-mode");
    if (!mm) break;
    const block = work.slice(mm.openStart, mm.closeEnd);
    if (!savedBlock) savedBlock = block;
    work = work.slice(0, mm.openStart) + work.slice(mm.closeEnd);
  }

  const modeFromSaved = savedBlock ? extractMainModeClass(savedBlock) : "";
  let mode = modeFromSaved || mainModeFromData || "";

  const { attrs } = readTag(boxHtml, 0);
  const cls = parseClassAttr(attrs);
  if (!mode && !cls.has("main")) return boxHtml;

  const maskedAfter = maskSegments(work);
  const logobg = findFirstByClass(maskedAfter, "logobg");
  if (!logobg) return boxHtml;

  const insertPos = logobg.closeStart;
  const indent = indentBefore(work, insertPos, nl);
  const baseIndent = indent + "  ";
  const block = buildMainModeBlock(mode, lang, baseIndent, nl);

  const before = work.slice(0, insertPos);
  const after  = work.slice(insertPos);
  return joinBeforeCloseKeepIndent(before, block, after, nl);
}
function ensureMainModeInLogobg(html, lang, mainMode, nl){
  const masked = maskSegments(html);
  const sitepage = findFirstByClass(masked, "sitepage");

  const regionStart = sitepage ? sitepage.openEnd : 0;
  const regionEnd   = sitepage ? sitepage.closeStart: html.length;
  let inner = html.slice(regionStart, regionEnd);

  let searchFrom = 0;
  while (true){
    const mNow = maskSegments(inner);
    const box = findFirstByClass(mNow, "box", searchFrom, inner.length);
    if (!box) break;

    const boxHtml = inner.slice(box.openStart, box.closeEnd);
    const moved   = relocateOrInsertMainMode(boxHtml, lang, mainMode, nl);

    if (moved !== boxHtml){
      inner = replaceWithin(inner, box.openStart, box.closeEnd, moved);
      searchFrom = box.openStart + moved.length;
    } else {
      searchFrom = box.closeEnd;
    }
  }

  if (!sitepage) return inner;
  return html.slice(0, regionStart) + inner + html.slice(regionEnd);
}

/* --------- PROMO + MIRROR + NAV --------- */
function upsertSiteCodes(html, data, nl) {
  if (!data) return html;

  const base = getPromoBaseCode(data); // data.code (или fallback на code-2/3...)
  if (!base) return html;

  let out = html;

  // --- (опционально) поддержка старого варианта: id="site-code" ---
  out = out.replace(
    /(<code\b[^>]*\bid\s*=\s*["']site-code["'][^>]*>)[\s\S]*?(<\/code>)/gi,
    (_m, a, c) => a + escapeHtml(String(base)) + c
  );

  // --- основной вариант: <code class="site-code ..."> ---
  let pos = 0;

  while (true) {
    const masked = maskSegments(out);
    const idx = masked.indexOf("<code", pos);
    if (idx === -1) break;

    const { end: openEnd, attrs } = readTag(out, idx);
    const classes = parseClassAttr(attrs);

    if (!classes.has("site-code")) {
      pos = openEnd;
      continue;
    }

    const closeStart = masked.indexOf("</code>", openEnd);
    if (closeStart === -1) {
      pos = openEnd;
      continue;
    }

    // определяем N из code-N (если нет — считаем N=1)
    let n = 1;
    for (const c of classes) {
      const m = /^code-(\d+)$/.exec(c);
      if (m) { n = parseInt(m[1], 10) || 1; break; }
    }

    const desired = getPromoCodeByIndex(data, n) || base;
    const escaped = escapeHtml(String(desired));

    // заменяем содержимое <code>...</code>
    out = out.slice(0, openEnd) + escaped + out.slice(closeStart);

    // после замены считаем новое положение закрывающего </code>
    const closeEnd = openEnd + escaped.length + "</code>".length;

    // проставим code="..." на ближайшую кнопку .site-promo-copy (обычно сразу после </code>)
    const liEnd = out.indexOf("</li>", closeEnd);
    const searchEnd = liEnd !== -1 ? liEnd : Math.min(out.length, closeEnd + 500);
    const tail = out.slice(closeEnd, searchEnd);

    const btnMatch = tail.match(/<button\b[^>]*\bsite-promo-copy\b[^>]*>/i);
    if (btnMatch) {
      const btnAbs = closeEnd + btnMatch.index;
      const btnOpen = btnMatch[0];
      const btnNew = upsertAttrInTag(btnOpen, "code", String(desired));

      out = out.slice(0, btnAbs) + btnNew + out.slice(btnAbs + btnOpen.length);
      pos = btnAbs + btnNew.length;
    } else {
      pos = closeEnd;
    }
  }

  return out;
}


function getPromoBaseCode(data){
  const pick = (k) => String((data && data[k]) ?? "").trim();

  const base = pick("code");
  if (base) return base;

  // если вдруг "code" не задан, но задан "code-2/3..." — пусть хотя бы что-то покажем
  for (let i = 2; i <= 10; i++){
    const v = pick(`code-${i}`);
    if (v) return v;
  }
  return "";
}

function getPromoCodeByIndex(data, idx /* 1..N */){
  const base = getPromoBaseCode(data);
  if (idx <= 1) return base;

  const v = String((data && data[`code-${idx}`]) ?? "").trim();
  return v || base;
}

function upsertPromoBoxesInSitepage(html, urlPath, lang, pageKey, data, reviewSettings, nl){
  const sitepage = findFirstByClass(maskSegments(html), "sitepage");
  if (!sitepage) return html;

  const isMirrors = /\/mirrors\//.test(urlPath);

  const spOpen = sitepage.openStart;
  const spClose= sitepage.closeStart;
  let inner = html.slice(spOpen, spClose);

  const spMasked = maskSegments(inner);
  const mainBox = findAllDivByClass(spMasked, "box").find(b=>{
    const { attrs } = readTag(spMasked, b.openStart);
    return /\bclass\s*=\s*["'][^"']*\bmain\b/i.test(attrs);
  });

  inner = removeAllBlocksByClass(inner, "box-extra-links");

  const codes = data.codes || {};
  const basePromoCode = getPromoBaseCode(data);
  const hasCodes = codes && Object.keys(codes).length > 0 && !!basePromoCode;
  const hasAnything = hasCodes || (!isMirrors && truthy(data.mirror)) || true;

  if (!hasAnything){
    return html.slice(0, spOpen) + inner + html.slice(spClose);
  }

  const localIndent = indentBefore(inner, mainBox ? mainBox.closeEnd : 0, nl);
  const extraBlock  = renderPromoNavMirrorBlock(inner, urlPath, lang, pageKey, data, reviewSettings, nl, localIndent, isMirrors);

  if (!extraBlock) return html.slice(0, spOpen) + inner + html.slice(spClose);

  if (mainBox){
    const insertPos = mainBox.closeEnd;
    const before = inner.slice(0, insertPos);
    const after  = inner.slice(insertPos);
    const newInner = joinBlocksNoBlank(before, extraBlock, after, nl);
    return html.slice(0, spOpen) + newInner + html.slice(spClose);
  } else {
    const newInner = joinBlocksNoBlank(inner, extraBlock, "", nl);
    return html.slice(0, spOpen) + newInner + html.slice(spClose);
  }
}
function truthy(v){ return v===true || v==="true" || v===1 || v==="1"; }

function renderPromoNavMirrorBlock(fullHtmlAfterSections, urlPath, lang, pageKey, data, reviewSettings, nl, indent, isMirrors){
  const lines = [];
  lines.push(`${indent}<div class="box-extra-links">`);

  const codes = data.codes || {};
  const basePromoCode = getPromoBaseCode(data);
  const hasCodes = codes && Object.keys(codes).length > 0 && !!basePromoCode;

  if (hasCodes){
    let idx = 1;

    for (const [codeName, codeDisplay] of Object.entries(codes)){
      const cls = (reviewSettings?.codesBinding || {})[codeName] || "default-bonus";
      const cnt = `counter-${idx}`;

      // ✅ N-й бонус → code / code-2 / code-3 ... (fallback на base code)
      const promoCodeValue = getPromoCodeByIndex(data, idx);

      const promoText = (lang==="ru") ? "Промокод" : "Promo";

      lines.push(`${indent}  <div class="promo-box extra-abox ${cls} ${cnt}">`);
      lines.push(`${indent}    <div class="content">`);
      lines.push(`${indent}      <p>${promoText}</p>`);
      lines.push(`${indent}      <code class="promo-code">${escapeHtml(String(promoCodeValue))}</code>`);
      lines.push(`${indent}      <div class="promo-code-desc"><span>${escapeHtml(String(codeDisplay))}</span></div>`);
      lines.push(`${indent}      <div class="bonus-type"><i class="officon"></i></div>`);

      // (опционально, но полезно) — кладём код ещё и в атрибут для копирования
      lines.push(
        `${indent}      <button class="copy site-promo-copy defbutton" aria-label="Copy Code" code="${escapeAttr(String(promoCodeValue))}"></button>`
      );

      lines.push(`${indent}    </div>`);
      lines.push(`${indent}  </div>`);

      idx++;
    }
  }

  if (!isMirrors && truthy(data.mirror)){
    const href = (`${lang==="ru" ? "/ru" : ""}/mirrors/${pageKey}`).replace(/\/{2,}/g,"/");
    const span = (lang==="ru") ? "Не переходит на сайт?"
              : (lang==="tr") ? "Siteye erişemiyor musun?"
              : (lang==="es") ? "¿No puedes acceder al sitio?"
              : "Can't Access the Site?";
    lines.push(`${indent}  <a href="${escapeAttr(href)}" class="mirror-redirect extra-abox">`);
    lines.push(`${indent}    <div class="officon mirror"></div>`);
    lines.push(`${indent}    <span>${escapeHtml(span)}</span>`);
    lines.push(`${indent}  </a>`);
  }

  if (!isMirrors){
    const nav = renderNavReviewBlock(fullHtmlAfterSections, lang, indent+"  ", nl);
    if (nav) lines.push(nav);
  }

  lines.push(`${indent}</div>`);
  return lines.join(nl);
}

function renderNavReviewBlock(fullHtml, lang, indent, nl){
  const masked = maskSegments(fullHtml);
  const hasPlus = !!findFirstByClass(masked, "plusminus");
  const hasScreen = !!findFirstByClass(masked, "screentable");
  const hasDetails= !!findFirstByClass(masked, "sitedetails");
  const hasAlts   = !!findFirstByClass(masked, "sitealternates");

  const h2m = fullHtml.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
  const h3m = fullHtml.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
  const strip = s => String(s||"").replace(/<[^>]*>/g,"").trim();

  const T = {
    en:{plusminus:'Pros and Cons', screentable:'Screenshots and Modes', sitedetails:'Payment Methods', sitealternates:'Similar Sites'},
    ru:{plusminus:'Плюсы и Минусы Сайта', screentable:'Скриншоты и Режимы', sitedetails:'Платежные Способы', sitealternates:'Похожие Сайты'},
    tr:{plusminus:'Artılar ve Eksiler', screentable:'Ekran Görüntüleri ve Modlar', sitedetails:'Ödeme Yöntемleri', sitealternates:'Benzer Siteler'},
    es:{plusminus:'Pros y Contras', screentable:'Capturas y Modos', sitedetails:'Métodos de Pago', sitealternates:'Sitios Similares'},
    pl:{plusminus:'Pros and Cons', screentable:'Screenshots and Modes', sitedetails:'Payment Methods', sitealternates:'Similar Sites'}
  }[lang] || {plusminus:'Pros and Cons', screentable:'Screenshots and Modes', sitedetails:'Payment Methods', sitealternates:'Similar Sites'};

  const entries = [];
  if (hasPlus)    entries.push({text:T.plusminus, target:'.plusminus'});
  if (h2m)        entries.push({text:strip(h2m[1]), target:'.smallreview'});
  if (h3m)        entries.push({text:strip(h3m[1]), target:'.instruction'});
  if (hasScreen)  entries.push({text:T.screentable, target:'.screentable'});
  if (hasDetails) entries.push({text:T.sitedetails,  target:'.sitedetails'});
  if (hasAlts)    entries.push({text:T.sitealternates, target:'.sitealternates'});

  if (!entries.length) return "";

  const lines=[];
  lines.push(`${indent}<div class="nav-review">`);
  lines.push(`${indent}  <ol>`);
  entries.forEach((e,idx)=>{
    const cur = idx===0 ? ' class="current"' : '';
    lines.push(`${indent}    <li${cur} data-target="${escapeAttr(e.target)}">${escapeHtml(e.text)}</li>`);
  });
  lines.push(`${indent}  </ol>`);
  lines.push(`${indent}</div>`);
  return lines.join(nl);
}

/* --------- GAMEMODES --------- */
function rewriteAnchorsInRegion(region, lang){
  return region.replace(/<a\b([^>]*?)href\s*=\s*(["'])([^"']+)\2([^>]*)>/gi, (m, pre, q, href, post)=>{
    const newHref = addLangPrefixToHref(href, lang);
    if (newHref === href) return m;
    return `<a${pre}href=${q}${escapeAttr(newHref)}${q}${post}>`;
  });
}

function upsertGamemodesInScreentable(html, boxreview, lang, data, reviewSettings, nl){
  const { start, inner } = sliceBoxreviewInner(html, boxreview);
  let content = removeNestedBoxreview(inner);

  const masked = maskSegments(content);
  const screentable = findFirstByClass(masked, "screentable");
  if (!screentable) return html;

  const stAbsOpen      = start + screentable.openStart;
  const stAbsOpenEnd   = start + screentable.openEnd;
  const stAbsCloseStart= start + screentable.closeStart;
  const stAbsCloseEnd  = start + screentable.closeEnd;

  const stOpen  = html.slice(stAbsOpen, stAbsOpenEnd);
  let   stBody  = html.slice(stAbsOpenEnd, stAbsCloseStart);
  const stClose = html.slice(stAbsCloseStart, stAbsCloseEnd);

  while (true){
    const m = maskSegments(stBody);
    const gm = findFirstByClass(m, "gamemodes");
    if (!gm) break;
    stBody = stBody.slice(0, gm.openStart) + stBody.slice(gm.closeEnd);
  }

  const gmArr = Array.isArray(data.gamemodesContent) ? data.gamemodesContent : [];
  if (!gmArr.length){
    const newSt = stOpen + stBody + stClose;
    return replaceWithin(html, stAbsOpen, stAbsCloseEnd, newSt);
  }

  const order = reviewSettings?.gamemodesOrder || [];
  const sorted = [...gmArr].sort((a,b)=>{
    const classA = (String(a).match(/class="([^"]+)"/)?.[1]||"");
    const classB = (String(b).match(/class="([^"]+)"/)?.[1]||"");
    const ia = order.indexOf(classA), ib = order.indexOf(classB);
    return (ia<0?order.length:ia) - (ib<0?order.length:ib);
  });

  const baseIndent = indentBefore(html, stAbsOpenEnd, nl) + "  ";
  const block = renderGamemodesInsideScreentable(baseIndent, nl, sorted, lang);

  const inside = joinAfterOpenNoBlank(stOpen, block, stBody, nl);
  const newStHtml = inside + stClose;
  return replaceWithin(html, stAbsOpen, stAbsCloseEnd, newStHtml);
}
function renderGamemodesInsideScreentable(indent, nl, itemsHtml, lang){
  const lines = [];
  lines.push(`${indent}<div class="gamemodes">`);
  lines.push(`${indent}  <div class="featuresbox">`);
  lines.push(`${indent}    <div class="typesinside">`);
  for (const it of itemsHtml){
    const clean = String(it).trim();
    if (clean) lines.push(`${indent}      ${rewriteAnchorsInRegion(clean, lang)}`);
  }
  lines.push(`${indent}    </div>`);
  lines.push(`${indent}  </div>`);
  lines.push(`${indent}</div>`);
  return lines.join(nl);
}

/* --------- BOXREVIEW helpers --------- */
function sliceBoxreviewInner(html, boxreview) {
  return { start: boxreview.openEnd, end: boxreview.closeStart, inner: html.slice(boxreview.openEnd, boxreview.closeStart) };
}
function replaceBoxreviewInner(html, boxreview, newInner) {
  return html.slice(0, boxreview.openEnd) + newInner + html.slice(boxreview.closeStart);
}
function removeNestedBoxreview(inner) {
  while (true) {
    const masked = maskSegments(inner);
    theNested = findFirstByClass(masked, "boxreview");
    if (!theNested) break;
    inner = inner.slice(0, theNested.openStart) + inner.slice(theNested.openEnd, theNested.closeStart) + inner.slice(theNested.closeEnd);
  }
  return inner;
}
function removeAllBlocksByClass(inner, className) {
  while (true) {
    const masked = maskSegments(inner);
    const b = findFirstByClass(masked, className);
    if (!b) break;
    inner = inner.slice(0, b.openStart) + inner.slice(b.closeEnd);
  }
  return inner;
}
function cleanupNestedBoxreview(html){
  const masked = maskSegments(html);
  const main = findFirstByClass(masked, "boxreview");
  if (!main) return html;
  const inner = html.slice(main.openEnd, main.closeStart);
  const cleaned = removeNestedBoxreview(inner);
  if (cleaned === inner) return html;
  return html.slice(0, main.openEnd) + cleaned + html.slice(main.closeStart);
}
function normalizeIntertagSpaces(html) { return html.replace(/>[ \t]{2,}</g, ">\n<"); }
function compressLooseWhitespace(html) { return html.replace(/[ \t]+$/gm, "").replace(/\r?\n{3,}/g, "\n\n"); }

/* ---- INDENT ---- */
function baseIndentForBoxreviewChild(html, boxreview, nl){ return indentBefore(html, boxreview.openEnd, nl) + "  "; }

/* ---- FEATURES (shortinfo) ---- */
function upsertFeaturesShortinfo(html, boxreview, lang, featuresArr, filterSettings, reviewSettings, nl) {
  if (!Array.isArray(featuresArr) || !filterSettings || !reviewSettings?.featureOrder) return html;

  const { inner } = sliceBoxreviewInner(html, boxreview);
  let content = removeNestedBoxreview(inner);

  const masked = maskSegments(content);
  const existing = findFirstByClass(masked, "shortinfo");

  const stableIndent = baseIndentForBoxreviewChild(html, boxreview, nl);
  const rebuilt = renderFeaturesShortinfoBlock(stableIndent, nl, featuresArr, filterSettings, reviewSettings);

  if (existing) {
    const before = content.slice(0, existing.openStart);
    const after  = content.slice(existing.closeEnd);
    let newContent = joinBlocksPreserveTop(before, rebuilt, after, nl);
    newContent = removeBlocksByClassAfter(newContent, "shortinfo", existing.openStart + rebuilt.length);
    return replaceBoxreviewInner(html, boxreview, newContent);
  }

  const newInner = rebuilt + nl + lstripBlankLines(content, nl);
  return replaceBoxreviewInner(html, boxreview, newInner);
}
function renderFeaturesShortinfoBlock(indent, nl, featuresArr, filterSettings, reviewSettings){
  const order = reviewSettings.featureOrder;
  const sorted = [...featuresArr].sort((a,b)=>{
    const ia=order.indexOf(a), ib=order.indexOf(b);
    return (ia<0?order.length:ia) - (ib<0?order.length:ib);
  });
  const lines=[];
  lines.push(`${indent}<div class="shortinfo">`);
  lines.push(`${indent}  <div class="features">`);
  lines.push(`${indent}    <div class="featuresbox">`);
  lines.push(`${indent}      <div class="typesinside">`);
  for (const feature of sorted) {
    const cfg = filterSettings[feature]; if (!cfg) continue;
    const name = cfg.name || feature;
    const href = cfg.path || "#";
    const icon = cfg.icon ? `<i class="${cfg.icon}"></i> ` : "";
    const cls  = String(feature).toLowerCase().replace(/\s+/g,"-");
    lines.push(`${indent}        <a href="${escapeAttr(href)}" class="${cls}">${icon}${escapeHtml(name)}</a>`);
  }
  lines.push(`${indent}      </div>`);
  lines.push(`${indent}    </div>`);
  lines.push(`${indent}  </div>`);
  lines.push(`${indent}</div>`);
  return lines.join(nl);
}
function removeBlocksByClassAfter(inner, className, fromIndex) {
  let out = inner, offset = fromIndex;
  while (true) {
    const maskedTail = maskSegments(out.slice(offset));
    const b = findFirstByClass(maskedTail, className);
    if (!b) break;
    const absS = offset + b.openStart;
    const absE = offset + b.closeEnd;
    out = out.slice(0, absS) + out.slice(absE);
  }
  return out;
}

/* ---- SITEDetails ---- */
function upsertSitedetails(html, boxreview, lang, data, reviewSettings, nl) {
  const { inner } = sliceBoxreviewInner(html, boxreview);
  const masked = maskSegments(inner);
  const scr = findFirstByClass(masked, "screentable");
  if (!scr) return html;

  const hasFirst = Array.isArray(data.firstMethodContent) && data.firstMethodContent.length;
  const hasSecond = Array.isArray(data.secondMethodContent) && data.secondMethodContent.length;

  let content = removeNestedBoxreview(inner);
  content = removeAllBlocksByClass(content, "sitedetails");

  if (!hasFirst && !hasSecond) return replaceBoxreviewInner(html, boxreview, content);

  const insertPos = scr.closeEnd;
  const localIndent = indentBefore(content, insertPos, nl);
  const expected = renderSitedetailsBlock(localIndent, nl, lang, data, reviewSettings);

  const before = content.slice(0, insertPos);
  const after  = content.slice(insertPos);
  const newInner = joinBlocksNoBlank(before, expected, after, nl);
  return replaceBoxreviewInner(html, boxreview, newInner);
}
function renderSitedetailsBlock(indent, nl, lang, data, reviewSettings){
  const lines=[], order = reviewSettings?.paymentMethodsOrder || [];
  lines.push(`${indent}<div class="sitedetails">`);
  if (Array.isArray(data.firstMethodContent) && data.firstMethodContent.length){
    lines.push(`${indent}  <div class="sitepros">`);
    lines.push(`${indent}    <span>${lang==="ru" ? "Способы Пополнения" : "Deposit Methods"}</span>`);
    lines.push(`${indent}    <div class="methodlist" id="first">`);
    for (const it of sortByOrderHtml(data.firstMethodContent, order)) {
      const item = rewriteAnchorsInRegion(it.trim(), lang);
      lines.push(indent+"      "+item);
    }
    lines.push(`${indent}    </div>`);
    lines.push(`${indent}  </div>`);
  }
  if (Array.isArray(data.secondMethodContent) && data.secondMethodContent.length){
    lines.push(`${indent}  <div class="sitepros">`);
    lines.push(`${indent}    <span>${lang==="ru" ? "Способы Вывода" : "Withdraw Methods"}</span>`);
    lines.push(`${indent}    <div class="methodlist" id="second">`);
    for (const it of sortByOrderHtml(data.secondMethodContent, order)) {
      const item = rewriteAnchorsInRegion(it.trim(), lang);
      lines.push(indent+"      "+item);
    }
    lines.push(`${indent}    </div>`);
    lines.push(`${indent}  </div>`);
  }
  lines.push(`${indent}</div>`); return lines.join(nl);
}

/* ---- Ratings ---- */
function upsertRatings(html, boxreview, data, nl) {
  const { inner } = sliceBoxreviewInner(html, boxreview);

  let content = removeNestedBoxreview(inner);
  const maskedA = maskSegments(content);
  const after = findFirstByClass(maskedA, "sitedetails") || findFirstByClass(maskedA, "screentable");
  if (!after) return html;

  content = removeAllBlocksByClass(content, "ratingsumm");
  if (!data.ratings || typeof data.ratings !== "object") return replaceBoxreviewInner(html, boxreview, content);

  const insertPos = after.closeEnd;
  const localIndent = indentBefore(content, insertPos, nl);
  const expected = renderRatingsBlock(localIndent, nl, data.ratings);

  const before = content.slice(0, insertPos);
  const afterStr  = content.slice(insertPos);
  const newInner = joinBlocksNoBlank(before, expected, afterStr, nl);
  return replaceBoxreviewInner(html, boxreview, newInner);
}
function renderRatingsBlock(indent, nl, ratings){
  const lines=[];
  lines.push(`${indent}<div class="ratingsumm">`);
  lines.push(`${indent}  <div class="ratingsection">`);
  for (const [cat, rating] of Object.entries(ratings)) {
    const w = Math.max(0, Math.min(100, (Number(rating)/5)*100));
    lines.push(`${indent}    <div class="ratingway">`);
    lines.push(`${indent}      <span>${escapeHtml(cat)}</span>`);
    lines.push(`${indent}      <div class="rating"><div class="star_rating" style="width: ${w}%;"></div></div>`);
    lines.push(`${indent}    </div>`);
  }
  lines.push(`${indent}  </div>`);
  const vals = Object.values(ratings).map(Number).filter(n=>!isNaN(n));
  if (vals.length){
    const avg = vals.reduce((a,b)=>a+b,0)/vals.length;
    const w = Math.max(0, Math.min(100, (avg/5)*100));
    lines.push(`${indent}  <div class="liverating"><div class="star_rating" style="width: ${w}%;"></div></div>`);
  }
  lines.push(`${indent}</div>`);
  return lines.join(nl);
}

/* ---- Alternatives ---- */
async function upsertAlternatives(html, boxreview, root, lang, urlPath, alts, ratingsMap, nl, opt={}) {
  const { inner } = sliceBoxreviewInner(html, boxreview);

  let content = removeNestedBoxreview(inner);
  content = removeAllBlocksByClass(content, "sitealternates");

  if (!Array.isArray(alts) || !alts.length) return replaceBoxreviewInner(html, boxreview, content);

  const masked = maskSegments(content);
  const criteria = findFirstByClass(masked, "criteria-descriptions");
  const anchor = criteria || (!opt.forceAfterCriteria && (findFirstByClass(masked, "ratingsumm")));
  if (!anchor) return replaceBoxreviewInner(html, boxreview, content);

  const nameMatch = html.match(/<div\b[^>]*class\s*=\s*["'][^"']*\bbox main\b[\s\S]*?<div\b[^>]*class\s*=\s*["'][^"']*\bcontent\b[\s\S]*?<h4[^>]*>([^<]+)<\/h4>/i);
  const mainName = nameMatch ? nameMatch[1].trim() : "Site";

  const insertPos = anchor.closeEnd;
  const localIndent = indentBefore(content, insertPos, nl);
  const expected = await renderAlternatesBlock(localIndent, nl, root, lang, urlPath, mainName, alts, ratingsMap);

  const before = content.slice(0, insertPos);
  const after  = content.slice(insertPos);
  const newInner = joinBlocksNoBlank(before, expected, after, nl);
  return replaceBoxreviewInner(html, boxreview, newInner);
}

function decodeHtmlEntities(s = "") {
  return String(s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

async function renderAlternatesBlock(indent, nl, root, lang, urlPath, mainName, alts, ratingsMap){
  const title = (lang==="ru" ? `Похожие Сайты на ${mainName}` : `Best ${mainName} Alternatives`);
  const lines=[];
  lines.push(`${indent}<div class="sitealternates">`);
  lines.push(`${indent}  <div class="alternates-title">${escapeHtml(title)}</div>`);
  lines.push(`${indent}  <div class="sitealternatesboxes">`);

  // ✨ precompute button texts for en|ru
  const reviewTxt = buttonSpanLabel(lang, "review");
  const visitTxt  = buttonSpanLabel(lang, "visit");
  const reviewSpan = reviewTxt ? `<span>${escapeHtml(reviewTxt)}</span>` : "";
  const visitSpan  = visitTxt  ? `<span>${escapeHtml(visitTxt)}</span>`  : "";

  for (const alt of alts) {
    const aj = await altJson(root, alt); if (!aj) continue;
    const sj = await siteJson(root, alt);
    const baseReview = `/reviews/${alt}`;
    const reviewLink = withLangForReview(baseReview, lang);

    // ✅ reward как HTML, без экранирования
    const rewardRaw = pickReward(lang, aj) || "";
    const reward    = decodeHtmlEntities(rewardRaw);

    const avg = averageFirstFour(sj?.ratings) ?? null;
    const visitHref = computeVisitHref(urlPath, lang, alt, aj);
    const ariaReview = buildReviewAriaLabel(aj.name || "", lang, "review");

    lines.push(`${indent}    <div class="box" id="${escapeAttr(aj.name)}">`);
    lines.push(`${indent}      <div class="logobg">`);
    lines.push(`${indent}        <a href="${reviewLink}"><img src="${escapeAttr(aj.logo)}" loading="lazy" draggable="false" alt="${escapeAttr(aj.name)}"></a>`);
    if (avg != null) {
      lines.push(`${indent}        <div class="rating-case-single">`);
      lines.push(`${indent}          <div class="star_rating officon"></div>`);
      lines.push(`${indent}          <div class="rating-summ">${(Math.round(avg*100)/100).toFixed(2)}</div>`);
      lines.push(`${indent}        </div>`);
    }
    lines.push(`${indent}      </div>`);
    lines.push(`${indent}      <div class="content">`);
    lines.push(`${indent}        <a class="boxtitle" href="${reviewLink}">${escapeHtml(aj.name)}</a>`);
    // reward вставляем как HTML
    lines.push(`${indent}        <div class="site-reward"><p>${reward}</p></div>`);
    lines.push(`${indent}        <div class="content-buttons">`);
    // Review
    lines.push(`${indent}          <a href="${reviewLink}" aria-label="${escapeAttr(ariaReview)}" class="review-button">${reviewSpan}</a>`);
    // Visit
    lines.push(`${indent}          <a href="${escapeAttr(visitHref)}" aria-label="Visit ${escapeHtml(aj.name)}" class="review-button visit" target="_blank" rel="noopener">${visitSpan}</a>`);
    lines.push(`${indent}        </div>`);
    lines.push(`${indent}      </div>`);
    lines.push(`${indent}    </div>`);
  }
  for (let i=alts.length;i<4;i++) lines.push(`${indent}    <div class="box"></div>`);
  lines.push(`${indent}  </div>`);
  lines.push(`${indent}</div>`);
  return lines.join(nl);
}

/* ---- translations ---- */
function applyReviewTranslations(html, lang, map, nl){
  let out = html;

  out = out.replace(/(<div\b[^>]*class\s*=\s*["'][^"']*\bsitepros\b[^"']*["'][\s\S]*?<span>)([^<]+)(<\/span>)/gi,
    (m, a, txt, c) => a + (map[txt.trim()] ?? txt) + c);

  out = out.replace(/(<div\b[^>]*class\s*=\s*["'][^"']*\bcriteria\b[^"']*["'][\s\S]*?<p>)([^<]+)(<\/p>)/gi,
    (m, a, txt, c) => a + (map[txt.trim()] ?? txt) + c);

  out = out.replace(/(<div\b[^>]*class\s*=\s*["'][^"']*\bsmallreview\b[^"']*\bcriteria\b[^"']*["'][\s\S]*?<h3>)([^<]+)(<\/h3>)/gi,
    (m, a, txt, c) => a + (map[txt.trim()] ?? txt) + c);

  out = out.replace(/(<div\b[^>]*class\s*=\s*["'][^"']*\bratingway\b[^"']*["'][\s\S]*?<span>)([^<]+)(<\/span>)/gi,
    (m, a, txt, c) => a + (map[txt.trim()] ?? txt) + c);

  out = translateTypesinsideAnchors(out, map);

  out = out.replace(/(<div\b[^>]*class\s*=\s*["'][^"']*\binstruction\b[^"']*["'][\s\S]*?<li>)([\s\S]*?)(<\/li>)/gi,
    (m,a,txt,c)=> {
      const clean = txt.replace(/<[^>]*>/g,"").trim();
      if (!clean) return m;
      const rep = map[clean] ?? clean;
      return a + txt.replace(clean, rep) + c;
    });

  return out;
}

/* ---- translate all anchors in .typesinside ---- */
function translateTypesinsideAnchors(html, map){
  let out = html;
  const masked = maskSegments(out);
  const blocks = findAllDivByClass(masked, "typesinside");
  if (!blocks.length) return out;

  let shift = 0;
  for (const b of blocks){
    const openEnd = b.openEnd + shift;
    const closeStart = b.closeStart + shift;
    const region = out.slice(openEnd, closeStart);

    const newRegion = region.replace(/(<a\b[^>]*>)([\s\S]*?)(<\/a>)/gi, (m, a, inner, c) => {
      const plain = inner.replace(/<[^>]*>/g,"").trim();
      if (!plain) return m;
      const rep = map[plain] ?? plain;
      if (rep === plain) return m;
      return a + inner.replace(plain, rep) + c;
    });

    if (newRegion !== region){
      out = out.slice(0, openEnd) + newRegion + out.slice(closeStart);
      shift += newRegion.length - region.length;
    }
  }
  return out;
}

/* ---- link localization helpers ---- */
function addLangPrefixToHref(href, lang){
  if (!href) return href;
  if (isExternal(href)) return href;
  if (/^#/.test(href)) return href;

  const clean = href.replace(/\/{2,}/g, "/");
  const pathOnly = clean.split("#")[0].split("?")[0];
  const suffix   = clean.slice(pathOnly.length);
  const firstSeg = (pathOnly.split("/").filter(Boolean)[0] || "").toLowerCase();

  if (firstSeg === lang) {
    if (pathOnly === `/${lang}/`) return `/${lang}${suffix}`;
    return href;
  }
  if (pathOnly === "/") {
    if (!PREFIX_LANGS.has(lang)) return href;
    return `/${lang}${suffix}`;
  }
  if (KNOWN_LANGS.has(firstSeg)) return href;
  if (!PREFIX_LANGS.has(lang)) return href;

  const withSlash = pathOnly.startsWith("/") ? pathOnly : `/${pathOnly}`;
  if (withSlash === "/") return `/${lang}${suffix}`;
  const prefixed = normalizeUrl(`/${lang}${withSlash}`);
  if (prefixed === `/${lang}/`) return `/${lang}${suffix}`;
  return prefixed + suffix;
}
function containsBlock(parent, child){
  return parent.openStart <= child.openStart && parent.closeEnd >= child.closeEnd;
}

/* Префикс только в shortinfo .typesinside a, игнорируя .gamemodes */
function localizeTypesinsideFeatureLinks(html, lang){
  if (!PREFIX_LANGS.has(lang)) return html;
  let out = html;

  const masked = maskSegments(out);
  const types = findAllDivByClass(masked, "typesinside");
  if (!types.length) return out;

  const shorts = findAllDivByClass(masked, "shortinfo");
  const gms    = findAllDivByClass(masked, "gamemodes");

  let shift = 0;
  for (const tb of types){
    const tBlock = { openStart: tb.openStart + shift, openEnd: tb.openEnd + shift, closeStart: tb.closeStart + shift, closeEnd: tb.closeEnd + shift };

    const isInShort = shorts.some(p=> containsBlock(p, {openStart:tBlock.openStart, closeEnd:tBlock.closeEnd}));
    const isInGm    = gms.some(p=> containsBlock(p, {openStart:tBlock.openStart, closeEnd:tBlock.closeEnd}));
    if (!isInShort || isInGm) continue;

    const region = out.slice(tBlock.openEnd, tBlock.closeStart);
    const newRegion = rewriteAnchorsInRegion(region, lang);

    if (newRegion !== region){
      out = out.slice(0, tBlock.openEnd) + newRegion + out.slice(tBlock.closeStart);
      shift += newRegion.length - region.length;
    }
  }
  return out;
}

/* NEW: Префикс в .gamemodes .featuresbox .typesinside a */
function localizeGamemodesTypesinsideLinks(html, lang){
  if (!PREFIX_LANGS.has(lang)) return html;
  let out = html;

  const masked = maskSegments(out);
  const types = findAllDivByClass(masked, "typesinside");
  if (!types.length) return out;

  const gms = findAllDivByClass(masked, "gamemodes");
  const fbx = findAllDivByClass(masked, "featuresbox");

  let shift = 0;
  for (const tb of types){
    const tBlock = { openStart: tb.openStart + shift, openEnd: tb.openEnd + shift, closeStart: tb.closeStart + shift, closeEnd: tb.closeEnd + shift };
    const isInGm = gms.some(p=> containsBlock(p, {openStart:tBlock.openStart, closeEnd:tBlock.closeEnd}));
    const isInFb = fbx.some(p=> containsBlock(p, {openStart:tBlock.openStart, closeEnd:tBlock.closeEnd}));
    if (!isInGm || !isInFb) continue;

    const region = out.slice(tBlock.openEnd, tBlock.closeStart);
    const newRegion = rewriteAnchorsInRegion(region, lang);

    if (newRegion !== region){
      out = out.slice(0, tBlock.openEnd) + newRegion + out.slice(tBlock.closeStart);
      shift += newRegion.length - region.length;
    }
  }
  return out;
}

/* Префикс в .box.main .content-buttons a, исключая .review-button.visit и .mirror-visit */
function localizeMainBoxContentButtons(html, lang){
  if (!PREFIX_LANGS.has(lang)) return html;
  let out = html;

  const masked = maskSegments(out);
  const boxes = findAllDivByClass(masked, "box");
  if (!boxes.length) return out;

  let shiftBoxes = 0;
  for (const b of boxes){
    const bOpen = b.openStart + shiftBoxes, bEnd = b.closeEnd + shiftBoxes;
    const openTag = readTag(out, bOpen);
    const cls = parseClassAttr(openTag.attrs);
    if (!cls.has("main")) continue;

    const boxInnerStart = b.openEnd + shiftBoxes;
    const boxInnerEnd   = b.closeStart + shiftBoxes;
    let inner = out.slice(boxInnerStart, boxInnerEnd);

    const innerMasked = maskSegments(inner);
    const contentBtns = findAllDivByClass(innerMasked, "content-buttons");
    if (!contentBtns.length) continue;

    let innerShift = 0;
    for (const cb of contentBtns){
      const cOpen = cb.openEnd + innerShift;
      const cClose= cb.closeStart + innerShift;
      const region = inner.slice(cOpen, cClose);

      const newRegion = region.replace(/<a\b([^>]*?)href\s*=\s*(["'])([^"']+)\2([^>]*)>/gi, (m, pre, q, href, post)=>{
        const clsMatch = (pre+post).match(/\bclass\s*=\s*(["'])([^"']+)\1/i);
        const classes = new Set((clsMatch ? (clsMatch[2]||"") : "").split(/\s+/).filter(Boolean));

        if (classes.has("visit") || classes.has("mirror-visit")) return m;

        const newHref = addLangPrefixToHref(href, lang);
        if (newHref === href) return m;
        return `<a${pre}href=${q}${escapeAttr(newHref)}${q}${post}>`;
      });

      if (newRegion !== region){
        inner = inner.slice(0, cOpen) + newRegion + inner.slice(cClose);
        innerShift += newRegion.length - region.length;
      }
    }

    const newOut = out.slice(0, boxInnerStart) + inner + out.slice(boxInnerEnd);
    shiftBoxes += newOut.length - out.length;
    out = newOut;
  }
  return out;
}

/* NEW: Префикс в .sitedetails .methodlist a */
function localizeSitedetailsLinks(html, lang){
  if (!PREFIX_LANGS.has(lang)) return html;
  let out = html;

  const masked = maskSegments(out);
  const sds = findAllDivByClass(masked, "sitedetails");
  if (!sds.length) return out;

  let shift = 0;
  for (const sd of sds){
    const sdOpen = sd.openEnd + shift;
    const sdClose= sd.closeStart + shift;
    let region = out.slice(sdOpen, sdClose);

    const rm = maskSegments(region);
    const lists = findAllDivByClass(rm, "methodlist");
    if (!lists.length) continue;

    let innerShift = 0;
    for (const ml of lists){
      const mlOpen = ml.openEnd + innerShift;
      const mlClose= ml.closeStart + innerShift;
      const chunk = region.slice(mlOpen, mlClose);
      const newChunk = rewriteAnchorsInRegion(chunk, lang);
      if (newChunk !== chunk){
        region = region.slice(0, mlOpen) + newChunk + region.slice(mlClose);
        innerShift += newChunk.length - chunk.length;
      }
    }

    if (region !== out.slice(sdOpen, sdClose)){
      out = out.slice(0, sdOpen) + region + out.slice(sdClose);
      shift += region.length - (sdClose - sdOpen);
    }
  }
  return out;
}

/* Объединённая локализация */
function localizeLanguageLinks(html, lang){
  let out = html;
  out = localizeTypesinsideFeatureLinks(out, lang);
  out = localizeGamemodesTypesinsideLinks(out, lang);
  out = localizeSitedetailsLinks(out, lang);
  out = localizeMainBoxContentButtons(out, lang);
  return out;
}

/* ---- misc ---- */
function sortByOrderHtml(arr, order){
  const rank = (s)=>{ const m=String(s).match(/class\s*=\s*["']([^"']+)["']/i); const cls=m?m[1]:""; const i=order.indexOf(cls); return i<0?order.length:i; };
  return [...arr].sort((a,b)=>rank(a)-rank(b));
}
function pickReward(lang, aj){
  if (lang==="ru" && aj.reward_ru) return aj.reward_ru;
  if (lang==="tr" && aj.reward_tr) return aj.reward_tr;
  if (lang==="es" && aj.reward_es) return aj.reward_es;
  if (lang==="pl" && aj.reward_pl) return aj.reward_pl;
  return aj.reward;
}

/* ---- NEW: shortinfo.empty авто-менеджер ---- */
function enforceShortinfoEmptyState(html){
  let out = html;
  const masked = maskSegments(out);
  const shorts = findAllDivByClass(masked, "shortinfo");
  if (!shorts.length) return out;

  let shift = 0;
  for (const s of shorts){
    const absOpenStart = s.openStart + shift;
    const { end: openEndActual, tagText } = readTag(out, absOpenStart);

    const absInnerStart = openEndActual;
    const absInnerEnd   = s.closeStart + shift;

    const inner = out.slice(absInnerStart, absInnerEnd);
    const innerMasked = maskSegments(inner);
    const types = findFirstByClass(innerMasked, "typesinside");

    let hasLinks = false;
    if (types){
      const tRegion = inner.slice(types.openEnd, types.closeStart);
      hasLinks = /<a\b/i.test(tRegion);
    }

    const newOpen = (() => {
      const re = /\bclass\s*=\s*(["'])([^"']*)\1/i;
      const m = re.exec(tagText);
      const classes = new Set((m ? m[2] : "").split(/\s+/).filter(Boolean));
      if (hasLinks) classes.delete("empty"); else classes.add("empty");

      const newVal = Array.from(classes).join(" ");
      if (m){
        if (newVal){
          return tagText.slice(0, m.index) + `class=${m[1]}${newVal}${m[1]}` + tagText.slice(m.index + m[0].length);
        } else {
          const removed = tagText.slice(0, m.index) + tagText.slice(m.index + m[0].length);
          return removed.replace(/\s{2,}/g, " ");
        }
      } else {
        if (!newVal) return tagText;
        return tagText.replace(/>$/, ` class="${newVal}">`);
      }
    })();

    if (newOpen !== tagText){
      out = out.slice(0, absOpenStart) + newOpen + out.slice(openEndActual);
      shift += newOpen.length - (openEndActual - absOpenStart);
    }
  }
  return out;
}

// ================== FIX 2: ensureMirrorVisitButtonInBoxHtml ==================
function ensureMirrorVisitButtonInBoxHtml(boxHtml, lang, siteKey, mirrorFlag, nl){
  if (!truthy(mirrorFlag) || !siteKey) return boxHtml;

  const masked  = maskSegments(boxHtml);
  const content = findFirstByClass(masked, "content");
  if (!content) return boxHtml;

  const cOpenEnd    = content.openEnd;
  const cCloseStart = content.closeStart;
  let seg = boxHtml.slice(cOpenEnd, cCloseStart);

  const cm = maskSegments(seg);
  let cb = findFirstByClass(cm, "content-buttons");

  const href  = (`${lang==="ru" ? "/ru" : ""}/mirrors/${siteKey}`).replace(/\/{2,}/g,"/");
  const text  = (lang==="ru") ? "Зеркала" : "Mirrors";
  const label = text;

  if (!cb){
    const baseIndent = indentBefore(boxHtml, cOpenEnd, nl) + "  ";
    const btnIndent  = baseIndent + "  ";
    const block =
      `${baseIndent}<div class="content-buttons">` + nl +
      `${btnIndent}<a href="${escapeAttr(href)}" class="review-button mirror-visit" aria-label="${escapeAttr(label)}"><span>${escapeHtml(text)}</span></a>` + nl +
      `${baseIndent}</div>`;
    const before = boxHtml.slice(0, cOpenEnd);
    const after  = boxHtml.slice(cCloseStart);
    return joinAfterOpenNoBlank(before, block, after, nl);
  }

  const cbOpenStart  = cb.openStart, cbOpenEnd = cb.openEnd, cbCloseStart = cb.closeStart;
  const before = seg.slice(0, cbOpenEnd);
  let   region = seg.slice(cbOpenEnd, cbCloseStart);
  let   after  = seg.slice(cbCloseStart);

  region = region.replace(/\s+$/,'');

  if (/\breview-button\b[^>]*\bmirror-visit\b/i.test(region)) {
    const baseIndent = indentBefore(seg, cbOpenStart, nl);
    after = after.replace(/^\s*<\/div>/, nl + baseIndent + "</div>");
    const rebuilt = before + region + after;
    return boxHtml.slice(0, cOpenEnd) + rebuilt + boxHtml.slice(cCloseStart);
  }

  const baseIndent = indentBefore(seg, cbOpenStart, nl);
  const linkIndent = baseIndent + "  ";
  const btnLine = `${linkIndent}<a href="${escapeAttr(href)}" class="review-button mirror-visit" aria-label="${escapeAttr(label)}"><span>${escapeHtml(text)}</span></a>`;

  region = region ? (region + nl + btnLine) : btnLine;
  after = after.replace(/^\s*<\/div>/, nl + baseIndent + "</div>");

  const newSeg = before + region + after;
  return boxHtml.slice(0, cOpenEnd) + newSeg + boxHtml.slice(cCloseStart);
}


/* ==== REPLACE ensureCopyButtonInBoxHtml ==== */
function ensureCopyButtonInBoxHtml(boxHtml, codeValue, nl, lang = "en"){
  const masked  = maskSegments(boxHtml);
  const content = findFirstByClass(masked, "content");
  if (!content) return boxHtml;

  const cOpenEnd    = content.openEnd;
  const cCloseStart = content.closeStart;
  let segment       = boxHtml.slice(cOpenEnd, cCloseStart);

  const segMasked = maskSegments(segment);
  const cb = findFirstByClass(segMasked, "content-buttons");
  if (!cb) return boxHtml;

  const cbOpenStart  = cb.openStart;
  const cbOpenEnd    = cb.openEnd;
  const cbCloseStart = cb.closeStart;

  const before = segment.slice(0, cbOpenEnd);
  let   region = segment.slice(cbOpenEnd, cbCloseStart);
  let   after  = segment.slice(cbCloseStart);

  const isRu = String(lang).toLowerCase() === "ru";
  const spanLabel = isRu ? "Промокод" : "Copy Code";
  const ariaLabel = "Copy Code";

  region = region.replace(/\s+$/,'');

  let hasCopyBtn = false;

  region = region.replace(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi, (full, attrs, inner) => {
    const clsM = attrs.match(/\bclass\s*=\s*(["'])([^"']*)\1/i);
    const classes = new Set((clsM ? clsM[2] : "").split(/\s+/).filter(Boolean));
    if (!classes.has("copy") || classes.has("site-promo-copy")) return full;

    hasCopyBtn = true;

    let open = `<button${attrs}>`;
    if (codeValue) open = upsertAttrInTag(open, "code", String(codeValue));
    open = upsertAttrInTag(open, "aria-label", ariaLabel);
    if (!classes.has("defbutton")){
      const newClass = (clsM ? clsM[2] + " defbutton" : "copy defbutton").trim();
      open = open.replace(/\bclass\s*=\s*(["'])([^"']*)\1/i, (_m, q, v)=>`class=${q}${newClass}${q}`);
    }

    if (/<span\b/i.test(inner)) {
      inner = inner.replace(/(<span\b[^>]*>)([\s\S]*?)(<\/span>)/i, (_m,a,_txt,c)=> a + escapeHtml(spanLabel) + c);
    } else {
      inner = `<span>${escapeHtml(spanLabel)}</span>`;
    }

    return open + inner + `</button>`;
  });

  if (!hasCopyBtn && codeValue){
    const baseIndent = indentBefore(segment, cbOpenStart, nl);
    const lineIndent = baseIndent + "  ";
    const btnLine =
      `${lineIndent}<button class="copy defbutton" aria-label="${escapeAttr(ariaLabel)}" code="${escapeAttr(String(codeValue))}"><span>${escapeHtml(spanLabel)}</span></button>`;
    region = region ? (region + nl + btnLine) : btnLine;
  }

  const baseIndent = indentBefore(segment, cbOpenStart, nl);
  after = after.replace(/^\s*<\/div>/, nl + baseIndent + "</div>");

  const newSegment = before + region + after;
  if (newSegment === segment) return boxHtml;
  return boxHtml.slice(0, cOpenEnd) + newSegment + boxHtml.slice(cCloseStart);
}

function ensureCopyButtonInMainBox(html, codeValue, nl, lang){
  if (!codeValue && !lang) return html;
  let out = html;

  const masked = maskSegments(out);
  const boxes = findAllDivByClass(masked, "box");
  if (!boxes.length) return out;

  for (const b of boxes){
    const open = readTag(out, b.openStart);
    const cls = parseClassAttr(open.attrs);
    if (!cls.has("main")) continue;

    const boxHtml = out.slice(b.openStart, b.closeEnd);
    const updated = ensureCopyButtonInBoxHtml(boxHtml, codeValue, nl, lang);
    if (updated !== boxHtml){
      out = out.slice(0, b.openStart) + updated + out.slice(b.closeEnd);
    }
    break;
  }
  return out;
}

/* ---- TG button ---- */
function ensureTGButtonInBoxHtml(boxHtml, data, lang, nl){
  const langNorm = String(lang || "").toLowerCase();

  const tgHref = (langNorm !== "ru" && data && data["tg-app-en"])
    ? String(data["tg-app-en"])
    : (data && data["tg-app"] ? String(data["tg-app"]) : "");

  if (!tgHref) return boxHtml;

  const masked = maskSegments(boxHtml);
  const content = findFirstByClass(masked, "content");
  if (!content) return boxHtml;

  const cOpenEnd = content.openEnd, cCloseStart = content.closeStart;
  let segment = boxHtml.slice(cOpenEnd, cCloseStart);

  const cm = maskSegments(segment);
  const cb = findFirstByClass(cm, "content-buttons");
  if (!cb) return boxHtml;

  const regionStart = cb.openEnd, regionEnd = cb.closeStart;
  const before = segment.slice(0, regionStart);
  let   region = segment.slice(regionStart, regionEnd);
  const after  = segment.slice(regionEnd);

  region = region.replace(
    /<a\b([^>]*\bclass\s*=\s*["'][^"']*\btg-app\b[^"']*["'][^>]*)>([\s\S]*?)<\/a>/i,
    (m, pre, inner)=>{
      let open = `<a${pre}>`;
      open = upsertAttrInTag(open, "href", tgHref);
      open = upsertAttrInTag(open, "target", "_blank");
      open = upsertAttrInTag(open, "rel", "noopener");
      const label = langNorm === "ru" ? "Telegram Приложение" : "Telegram App";
      const body  = `<span>${escapeHtml(label)}</span>`;
      return open + body + `</a>`;
    }
  );

  if (/<a\b[^>]*\btg-app\b/i.test(region)) {
    return boxHtml.slice(0, cOpenEnd) + before + region + after + boxHtml.slice(cCloseStart);
  }

  const visitRe = /<a\b[^>]*\bclass\s*=\s*["'][^"']*\breview-button\b[^"']*\bvisit\b[^"']*["'][^>]*>[\s\S]*?<\/a>/i;
  const match = visitRe.exec(region);
  if (!match) return boxHtml;

  const insAt = match.index + match[0].length;
  const indent = (()=>{
    const ln = region.lastIndexOf(nl, match.index);
    const lineStart = ln === -1 ? 0 : ln + nl.length;
    return region.slice(lineStart, match.index).match(/^[\t ]*/)?.[0] ?? "";
  })();

  const label = langNorm === "ru" ? "Telegram Приложение" : "Telegram App";
  const tgBtn = `<a href="${escapeAttr(tgHref)}" class="tg-app defbutton" target="_blank" rel="noopener"><span>${escapeHtml(label)}</span></a>`;

  const newRegion = region.slice(0, insAt) + nl + indent + tgBtn + region.slice(insAt);
  segment = before + newRegion + after;
  return boxHtml.slice(0, cOpenEnd) + segment + boxHtml.slice(cCloseStart);
}

function ensureTGButtonInMainBox(html, data, lang, nl){
  let out = html;
  const masked = maskSegments(out);
  const boxes = findAllDivByClass(masked, "box");
  if (!boxes.length) return out;

  for (const b of boxes){
    const open = readTag(out, b.openStart);
    const cls = parseClassAttr(open.attrs);
    if (!cls.has("main")) continue;

    const boxHtml = out.slice(b.openStart, b.closeEnd);
    const updated = ensureTGButtonInBoxHtml(boxHtml, data, lang, nl);
    if (updated !== boxHtml){
      out = out.slice(0, b.openStart) + updated + out.slice(b.closeEnd);
    }
    break;
  }
  return out;
}

/* ---- liverating в .box.main ---- */
function computeLiveratingPercent(ratings){
  if (!ratings || typeof ratings !== "object") return null;
  const nums = Object.values(ratings).map(Number).filter(n => Number.isFinite(n));
  if (!nums.length) return null;
  const take = nums.slice(0, 4);
  const avg  = take.reduce((a,b)=>a+b,0) / take.length;
  const pct  = Math.max(0, Math.min(100, (avg / 5) * 100));
  return Math.round(pct * 100) / 100;
}
function upsertWidthInOpenTag(tagOpen, percent){
  const pct = String(percent).replace(/%$/,"");
  if (!/style\s*=/.test(tagOpen)) {
    return tagOpen.replace(/>$/, ` style="width: ${pct}%;">`);
  }
  return tagOpen.replace(/style\s*=\s*(["'])(.*?)\1/i, (m,q,css)=>{
    const noWidth = css.replace(/(^|;)\s*width\s*:[^;]*;?/gi, '$1').replace(/;;+/g,';').replace(/^\s*;\s*|\s*;\s*$/g,'');
    const merged = (noWidth ? noWidth + '; ' : '') + `width: ${pct}%;`;
    return `style=${q}${merged}${q}`;
  });
}
function ensureMainBoxLiverating(html, ratings, nl){
  const percent = computeLiveratingPercent(ratings);
  if (percent == null) return html;

  let out = html;
  const masked = maskSegments(out);
  const boxes = findAllDivByClass(masked, "box");
  if (!boxes.length) return out;

  for (const b of boxes){
    const open = readTag(out, b.openStart);
    const cls = parseClassAttr(open.attrs);
    if (!cls.has("main")) continue;

    const boxSeg = out.slice(b.openStart, b.closeEnd);
    const bm = maskSegments(boxSeg);
    const logobg = findFirstByClass(bm, "logobg");
    if (!logobg) return out;

    const lbAbsOpenEnd   = b.openStart + logobg.openEnd;
    const lbAbsCloseStart= b.openStart + logobg.closeStart;
    let logSeg = out.slice(lbAbsOpenEnd, lbAbsCloseStart);

    const lm = maskSegments(logSeg);
    const rating = findFirstByClass(lm, "rating");

    if (rating){
      const rOpen = rating.openEnd, rClose = rating.closeStart;
      let rBody = logSeg.slice(rOpen, rClose);

      const rm = maskSegments(rBody);
      const lv = findFirstByClass(rm, "liverating");

      if (lv){
        const lvOpen = lv.openEnd, lvClose = lv.closeStart;
        let lvBody = rBody.slice(lvOpen, lvClose);

        const m = lvBody.match(/<div\b([^>]*\bclass\s*=\s*["'][^"']*\bstar_rating\b[^"']*["'][^>]*)>/i);
        if (m){
          const start = m.index;
          const openTag = m[0];
          const updatedOpen = upsertWidthInOpenTag(openTag, percent);
          if (updatedOpen !== openTag){
            lvBody = lvBody.slice(0, start) + updatedOpen + lvBody.slice(start + openTag.length);
            rBody  = rBody.slice(0, lvOpen) + lvBody + rBody.slice(lvClose);
            logSeg = logSeg.slice(0, rOpen) + rBody + logSeg.slice(rClose);
            out    = out.slice(0, lbAbsOpenEnd) + logSeg + out.slice(lbAbsCloseStart);
          }
          return out;
        } else {
          const baseIndent = indentBefore(logSeg, rOpen, nl) + "    ";
          const inject = `${baseIndent}<div class="star_rating" style="width: ${percent}%;"></div>`;
          const before = logSeg.slice(0, rOpen + lvOpen);
          const after  = logSeg.slice(rOpen + lvOpen);
          logSeg = before + inject + nl + after;
          out = out.slice(0, lbAbsOpenEnd) + logSeg + out.slice(lbAbsCloseStart);
          return out;
        }
      } else {
        const indent = indentBefore(logSeg, rOpen, nl) + "  ";
        const block =
          `${indent}<div class="star_rating"></div>${nl}` +
          `${indent}<div class="liverating fadein">${nl}` +
          `${indent}  <div class="star_rating" style="width: ${percent}%;"></div>${nl}` +
          `${indent}</div>`;
        logSeg = logSeg.slice(0, rOpen) + block + logSeg.slice(rClose);
        out = out.slice(0, lbAbsOpenEnd) + logSeg + out.slice(lbAbsCloseStart);
        return out;
      }
    }

    const aMatch = /<a\b[^>]*>[\s\S]*?<\/a>/i.exec(logSeg);
    const insPos = aMatch ? (aMatch.index + aMatch[0].length) : 0;
    const baseIndent = indentBefore(logSeg, insPos, nl) + "  ";
    const block = [
      `${baseIndent}<div class="rating">`,
      `${baseIndent}  <div class="star_rating"></div>`,
      `${baseIndent}  <div class="liverating fadein">`,
      `${baseIndent}    <div class="star_rating" style="width: ${percent}%;"></div>`,
      `${baseIndent}  </div>`,
      `${baseIndent}</div>`
    ].join(nl);

    const before = logSeg.slice(0, insPos);
    const after  = logSeg.slice(insPos);
    const newLogSeg = joinBlocksNoBlank(before, block, after, nl);
    out = out.slice(0, lbAbsOpenEnd) + newLogSeg + out.slice(lbAbsCloseStart);
    return out;
  }
  return out;
}

function removeAttrInTag(tagText, name){
  const re = new RegExp(`\\s+${name}\\s*=\\s*(['"]).*?\\1`, 'i');
  return tagText.replace(re, '');
}

function upsertAttrInTag(tagText, name, value){
  const re = new RegExp(`\\b${name}\\s*=\\s*(['"])(.*?)\\1`, "i");
  if (re.test(tagText)){
    return tagText.replace(re, (_m, q)=> `${name}=${q}${escapeAttr(value)}${q}`);
  }
  return tagText.replace(/>$/, ` ${name}="${escapeAttr(value)}">`);
}

function updateLogobgAnchorInBoxHtml(boxHtml, visitHref, nl){
  if (!visitHref) return boxHtml;
  const hrefValue = String(visitHref);

  const masked = maskSegments(boxHtml);
  const lb = findFirstByClass(masked, "logobg");
  if (!lb) return boxHtml;

  const regionStart = lb.openEnd;
  const regionEnd   = lb.closeStart;
  const before = boxHtml.slice(0, regionStart);
  const region = boxHtml.slice(regionStart, regionEnd);
  const after  = boxHtml.slice(regionEnd);

  const aIdx = region.search(/<a\b/i);
  if (aIdx === -1) return boxHtml;

  const { end: aEnd, tagText: aOpen } = readTag(region, aIdx);
  let newOpen = upsertAttrInTag(aOpen, "href", hrefValue);
  newOpen = upsertAttrInTag(newOpen, "target", "_blank");
  newOpen = upsertAttrInTag(newOpen, "rel", "noopener");

  const newRegion = region.slice(0, aIdx) + newOpen + region.slice(aEnd);
  return before + newRegion + after;
}

function ensureMainLogobgLink(html, visitHref, nl){
  if (!visitHref) return html;
  let out = html;

  const masked = maskSegments(out);
  const boxes = findAllDivByClass(masked, "box");
  if (!boxes.length) return out;

  for (const b of boxes){
    const open = readTag(out, b.openStart);
    const cls = parseClassAttr(open.attrs);
    if (!cls.has("main")) continue;

    const boxHtml = out.slice(b.openStart, b.closeEnd);
    const updated = updateLogobgAnchorInBoxHtml(boxHtml, visitHref, nl);
    if (updated !== boxHtml){
      out = out.slice(0, b.openStart) + updated + out.slice(b.closeEnd);
    }
    break;
  }
  return out;
}

function upsertInstructionSiteLinks(html, visitHref){
  if (!visitHref) return html;
  const hrefValue = String(visitHref);

  let out = html;
  const masked = maskSegments(out);
  const blocks = findAllDivByClass(masked, "instruction");
  if (!blocks.length) return out;

  let shift = 0;
  for (const b of blocks){
    const openEnd  = b.openEnd  + shift;
    const closePos = b.closeStart + shift;
    const region = out.slice(openEnd, closePos);

    const newRegion = region.replace(/<a\b[^>]*>/gi, (open) => {
      const m = open.match(/\bclass\s*=\s*(["'])([^"']*)\1/i);
      const classes = new Set((m ? m[2] : "").split(/\s+/).filter(Boolean));
      if (!classes.has("site-link")) return open;
      let tag = upsertAttrInTag(open, "href", hrefValue);
      tag = upsertAttrInTag(tag, "target", "_blank");
      tag = upsertAttrInTag(tag, "rel", "noopener");
      return tag;
    });

    if (newRegion !== region){
      out = out.slice(0, openEnd) + newRegion + out.slice(closePos);
      shift += newRegion.length - region.length;
    }
  }
  return out;
}

/* ========================================================================== */
/* ===================== INTEGRATED "MORE-CONTENT" PASS ====================== */
/* ========================================================================== */

const MC_CATEGORIES = ["csgo", "rust", "dota", "crypto"];
const MC_IMG_SRC = {
  csgo: "/img/icons/main-modes/cs2-logo.png",
  rust: "/img/icons/main-modes/rust-logo.png",
  dota: "/img/icons/main-modes/dota2-logo.png",
  crypto: "/img/icons/main-modes/crypto-logo.png",
};
const MC_IMG_ALT = {
  csgo: "CS2 logo",
  rust: "Rust logo",
  dota: "Dota 2 logo",
  crypto: "Crypto logo",
};
const MC_TITLE_RU = { csgo: "Подобные CS2", rust: "Подобные Rust", dota: "Подобные Dota 2", crypto: "Подобные Крипто" };
const MC_TITLE_EN = { csgo: "Similar CS2", rust: "Similar Rust", dota: "Similar Dota 2", crypto: "Similar Crypto" };

async function detectAvailableLangs(root){
  const langs = new Set(["en"]); // en всегда допустим
  try {
    const ents = await fs.readdir(root, { withFileTypes: true });
    for (const e of ents) {
      if (!e.isDirectory()) continue;
      const name = e.name.toLowerCase();
      if (!/^[a-z]{2,3}(?:-[a-z]{2,3})?$/.test(name)) continue;
      // наличие index.html в папке — бонус; но достаточно папки
      langs.add(name);
    }
  } catch {}
  return langs;
}

function mcShouldProcess(urlPath) {
  const segs = urlPath.split("/").filter(Boolean);
  return segs.some(s => MC_CATEGORIES.includes(s.toLowerCase())) || /(^|\/)cs2(\.html|\/|$)/i.test(urlPath);
}
function mcDetectCategory(urlPath) {
  const segs = urlPath.toLowerCase().split("/").filter(Boolean);
  if (segs.includes("cs2")) return "csgo";
  return MC_CATEGORIES.find(c => segs.includes(c)) || null;
}
function mcExtractSuffix(urlPath, category) {
  const segs = urlPath.split("/").filter(Boolean);
  const idx = segs.findIndex(s => s.toLowerCase() === category || (category === "csgo" && s.toLowerCase() === "cs2"));
  if (idx === -1) return "";
  const tail = segs.slice(idx + 1).join("/");
  if (!tail) return "";
  return urlPath.endsWith("/") ? `${tail}/` : tail;
}
function mcJoinUrl(...parts) {
  const joined = parts.join("/").replace(/\/{2,}/g, "/");
  return joined.startsWith("/") ? joined : "/" + joined;
}
function mcBuildPretty(prefix, cat, suffix, keepSlash, allowCs2) {
  const baseName = (cat === "csgo" && allowCs2 && suffix === "" && !keepSlash) ? "cs2" : cat;
  const raw = mcJoinUrl(prefix, `${baseName}/${suffix}`);
  return keepSlash ? (raw.endsWith("/") ? raw : raw + "/") : raw.replace(/\/+$/, "");
}
function mcPreferredCsgoCandidates(cat, prefix, suffix, keepSlash) {
  const base = mcBuildPretty(prefix, cat, suffix, keepSlash, /*allowCs2*/ false);
  if (cat !== "csgo") return [base];

  const isTopLevelFileStyle = (suffix === "" && !keepSlash);
  if (isTopLevelFileStyle) {
    const cs2 = mcJoinUrl(prefix, "cs2");
    const csgo = mcJoinUrl(prefix, "csgo");
    return [cs2, csgo];
  }
  return [base];
}
async function mcResolveTargets(root, prefix, suffix, currentCat, keepSlash) {
  const urls = [];
  const currentPretty = mcBuildPretty(prefix, currentCat, suffix, keepSlash, /*allowCs2*/ true);
  urls.push({ cat: currentCat, href: currentPretty || "/" });

  for (const cat of MC_CATEGORIES) {
    if (cat === currentCat) continue;

    const candidates = mcPreferredCsgoCandidates(cat, prefix, suffix, keepSlash);
    let chosen = null;
    for (const cand of candidates) {
      if (await mcFileExistsForUrlPath(root, cand)) { chosen = cand; break; }
    }
    if (chosen) urls.push({ cat, href: chosen || "/" });
  }
  return urls;
}
async function mcFileExistsForUrlPath(root, urlPath) {
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

function mcFindAllBlocks(innerMasked, className) {
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
function mcRemoveAllMoreContent(inner, innerMasked) {
  let result = inner;
  let masked = innerMasked;
  while (true) {
    const blocks = mcFindAllBlocks(masked, "more-content");
    if (!blocks.length) break;
    const b = blocks[0];
    result = result.slice(0, b.openStart) + result.slice(b.closeEnd);
    masked = masked.slice(0, b.openStart) + " ".repeat(b.closeEnd - b.openStart) + masked.slice(b.closeEnd);
  }
  return result;
}

function mcBuildExpectedModel(targets, currentCat, lang) {
  const titles = (lang === "ru") ? MC_TITLE_RU : MC_TITLE_EN;
  const model = [];
  for (const cat of MC_CATEGORIES) {
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
function mcAttrValue(tagText, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i");
  const m = tagText.match(re);
  return m ? (m[2] ?? m[3] ?? "") : null;
}
function mcCatFromImg(src = "") {
  if (src.endsWith("/cs2-logo.png")) return "csgo";
  if (src.endsWith("/rust-logo.png")) return "rust";
  if (src.endsWith("/dota2-logo.png")) return "dota";
  if (src.endsWith("/crypto-logo.png")) return "crypto";
  return null;
}
function mcCatFromTitle(title = "") {
  const t = title.toLowerCase();
  if (t.includes("cs2")) return "csgo";
  if (t.includes("rust")) return "rust";
  if (t.includes("dota")) return "dota";
  if (t.includes("крипто") || t.includes("crypto")) return "crypto";
  return null;
}
function mcParseMoreContent(blockHtml) {
  const boxes = [];
  const reBox = /<div\b[^>]*class\s*=\s*(['"])(?:(?:(?!\1).))*\bsinglemod-box\b(?:(?:(?!\1).))*\1[^>]*>[\s\S]*?<\/div>/gi;
  let m;
  while ((m = reBox.exec(blockHtml)) !== null) {
    const boxStr = m[0];

    const cls = mcAttrValue(boxStr, "class") || "";
    const active = /\bactive\b/i.test(cls);

    const title = mcAttrValue(boxStr, "data-title") || "";

    const hrefMatch = boxStr.match(/<a\b[^>]*\bhref\s*=\s*(['"])(.*?)\1/i);
    const href = hrefMatch ? hrefMatch[2] : "";

    const imgSrcMatch = boxStr.match(/<img\b[^>]*\bsrc\s*=\s*(['"])(.*?)\1/i);
    const img = imgSrcMatch ? imgSrcMatch[2] : "";

    const cat = mcCatFromImg(img) || mcCatFromTitle(title);

    if (cat) {
      boxes.push({ cat, href, active, title });
    }
  }
  return boxes;
}
function mcModelsEqual(parsed, expected) {
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

function mcBuildBlockString(targets, currentCat, lang, nl, indent) {
  const titles = (lang === "ru") ? MC_TITLE_RU : MC_TITLE_EN;
  const lines = [];
  lines.push(`${indent}<div class="more-content">`);
  lines.push(`${indent}  <div class="more-content-list">`);
  for (const cat of MC_CATEGORIES) {
    const t = targets.find(x => x.cat === cat);
    if (!t) continue;
    const active = (cat === currentCat) ? " active" : "";
    const title = titles[cat];
    const href = t.href === "/" ? "/" : t.href;
    lines.push(`${indent}    <div class="singlemod-box${active}" data-title="${escapeHtml(title)}">`);
    lines.push(`${indent}      <a href="${escapeAttr(href)}" class="singlemod-select">`);
    lines.push(`${indent}        <img src="${MC_IMG_SRC[cat]}" alt="${MC_IMG_ALT[cat]}">`);
    lines.push(`${indent}      </a>`);
    lines.push(`${indent}    </div>`);
  }
  lines.push(`${indent}  </div>`);
  lines.push(`${indent}</div>`);
  return lines.join(nl);
}

async function applyMoreContentIfNeeded(originalHtml, urlPath, lang, nl, root, AVAILABLE_LANGS) {
  if (!originalHtml) return null;
  if (!mcShouldProcess(urlPath)) return originalHtml;

  const segs = urlPath.split("/").filter(Boolean);
  const first = (segs[0] || "").toLowerCase();
  const prefix = AVAILABLE_LANGS.has(first) ? `/${first}/` : "/";

  const category = mcDetectCategory(urlPath);
  if (!category) return originalHtml;

  const suffix = mcExtractSuffix(urlPath, category);
  const keepSlash = urlPath.endsWith("/");

  const targets = await mcResolveTargets(root, prefix, suffix, category, keepSlash);
  const needInsert = targets.length > 1;

  const masked = maskSegments(originalHtml);
  const holders = findAllDivByClass(masked, "boxes-holder");
  if (!holders.length) return originalHtml;

  const h = holders[holders.length - 1];
  const inner = originalHtml.slice(h.openEnd, h.closeStart);
  const innerMasked = masked.slice(h.openEnd, h.closeStart);

  const blocks = mcFindAllBlocks(innerMasked, "more-content");

  if (blocks.length === 1) {
    const b = blocks[0];
    const existing = inner.slice(b.openStart, b.closeEnd);

    if (needInsert) {
      const parsed = mcParseMoreContent(existing);
      const expected = mcBuildExpectedModel(targets, category, lang);
      if (mcModelsEqual(parsed, expected)) {
        return originalHtml;
      }
    }

    if (!needInsert) {
      const newInner = inner.slice(0, b.openStart) + inner.slice(b.closeEnd);
      return originalHtml.slice(0, h.openEnd) + newInner + originalHtml.slice(h.closeStart);
    }

    const blockIndent = indentBefore(originalHtml, h.openEnd + b.openStart, nl);
    const expectedStr = mcBuildBlockString(targets, category, lang, nl, blockIndent);
    const replacedInner = inner.slice(0, b.openStart) + expectedStr + inner.slice(b.closeEnd);
    return originalHtml.slice(0, h.openEnd) + replacedInner + originalHtml.slice(h.closeStart);
  }

  const prunedInner = mcRemoveAllMoreContent(inner, innerMasked);

  if (!needInsert) {
    return originalHtml.slice(0, h.openEnd) + prunedInner + originalHtml.slice(h.closeStart);
  }

  const baseIndent = indentBefore(originalHtml, h.closeStart, nl);
  const childIndent = baseIndent + "  ";
  const block = mcBuildBlockString(targets, category, lang, nl, childIndent);

  const tailMatch = prunedInner.match(/[ \t\r\n]*$/);
  const tailLen = tailMatch ? tailMatch[0].length : 0;
  const content = prunedInner.slice(0, prunedInner.length - tailLen);
  const tail = prunedInner.slice(prunedInner.length - tailLen);

  const needsLeading = !(content.endsWith("\n") || content.endsWith("\r\n"));
  const prefixStr = needsLeading ? (content + nl + baseIndent) : content;

  const newInner = prefixStr + block + tail;
  return originalHtml.slice(0, h.openEnd) + newInner + originalHtml.slice(h.closeStart);
}

/* ========================================================================== */
/* ======================= SERVER-SIDE MAIN-INFOBOX ========================== */
/* ========================================================================== */

// Генерация инфобокса на этапе Node, без client-side JS/localStorage.
// Идемпотентно: перед вставкой вычищаем все существующие .main-infobox.

function buildInfoboxHtml(texts, indent, nl){
  const t = (v) => decodeHtmlEntities(String(v ?? ""));
  return [
    `${indent}<div class="main-infobox">`,
    `${indent}  <div class="main-infobox-mascotte"></div>`,
    `${indent}  <div class="main-infobox-content">`,
    `${indent}    <div class="main-infobox-content-text">`,
    `${indent}      <div class="main-infobox-content-block">`,
    `${indent}        <p>${t(texts.p1)}</p>`,
    `${indent}        <p>${t(texts.p2)}</p>`,
    `${indent}      </div>`,
    `${indent}    </div>`,
    `${indent}  </div>`,
    `${indent}  <div class="main-infobox-content second">`,
    `${indent}    <div class="main-infobox-content-text">`,
    `${indent}      <div class="main-infobox-content-block">`,
    `${indent}        <p>${t(texts.p3)}</p>`,
    `${indent}        <p>${t(texts.p4)}</p>`,
    `${indent}      </div>`,
    `${indent}    </div>`,
    `${indent}  </div>`,
    `${indent}</div>`
  ].join(nl);
}

function stripAllInfoboxes(html){
  return removeAllBlocksByClass(html, "main-infobox");
}

/**
 * Вставка/обновление main-infobox.
 * – /reviews/... и /mirrors/... → внутрь .boxreview, в конец, с верными отступами
 * – иначе → сразу после первого .boxes-holder
 * – если .boxreview нет, но есть .criteria-descriptions → после него
 */
function upsertMainInfobox(html, urlPath, lang, nl, translations){
  if (!translations || !INFOBOX_LANGS.has(lang)) return html;

  const texts = translations[lang] || translations["en"];
  if (!texts) return html;

  let out = stripAllInfoboxes(html);
  const masked = maskSegments(out);
  const isReviewLike = /\/(reviews|mirrors)\//.test(String(urlPath));

  if (isReviewLike) {
    const boxreview = findFirstByClass(masked, "boxreview");
    if (boxreview){
      const beforeOpen = out.slice(0, boxreview.openEnd);
      const inner      = out.slice(boxreview.openEnd, boxreview.closeStart);
      const after      = out.slice(boxreview.closeStart);

      const cleanedInner = removeAllBlocksByClass(inner, "main-infobox");
      const indent = indentBefore(out, boxreview.closeStart, nl);
      const block  = buildInfoboxHtml(texts, indent, nl);

      return joinBeforeCloseKeepIndent(beforeOpen + cleanedInner, block, after, nl);
    }

    const criteria = findFirstByClass(masked, "criteria-descriptions");
    if (criteria){
      const indent = indentBefore(out, criteria.openStart, nl);
      const block  = buildInfoboxHtml(texts, indent, nl);
      const before = out.slice(0, criteria.closeEnd);
      const after  = out.slice(criteria.closeEnd);
      return joinBlocksNoBlank(before, block, after, nl);
    }
    return out;
  }

  const holders = findAllDivByClass(masked, "boxes-holder");
  if (holders.length){
    const h      = holders[0];
    const indent = indentBefore(out, h.openStart, nl);
    const block  = buildInfoboxHtml(texts, indent, nl);
    const before = out.slice(0, h.closeEnd);
    const after  = out.slice(h.closeEnd);
    return joinBlocksNoBlank(before, block, after, nl);
  }

  return out;
}
