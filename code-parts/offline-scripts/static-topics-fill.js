// ============================================================================
// File: scripts/static-skins-fill.js
// Usage:
//   node scripts/static-skins-fill.js \
//     [--root path] [--dry-run] [--verbose] \
//     [--prices pathOrUrl] [--paths "/topic,/ru/topic"]
// Features:
//   1) .box-skins-list (mode 1/2) из /code-parts/topics/skins-settings.json
//      mode=1: /skins-list/<topicId>.json
//      mode=2: /skins-list/presets/<topicId>.json
//              fallback: derive из всех /skins-list/*.json по collection/case и slug темы
//   2) Замена плейсхолдеров <div class="skin" weapon="" skin-id=""></div>
//      + ремонт уже записанных блоков (чинит &#39; → ' и &amp; → &)
//   3) Оффлайн loadout для /topic/skins/(cheapest|best)-{color}-skins
//   4) Оффлайн-вставка/ремонт <div class="topic-filter">
// ---------------------------------------------------------------------------
// NOTE (why): финальный no-op guard предотвращает лишние перезаписи файлов,
// когда промежуточные шаги временно меняют контент, но итог возвращается к исходному.
// ============================================================================

const fs = require("fs/promises");
const path = require("path");

// ---------------- CLI ----------------
function parseArgs(argv){
  const get=(f)=>{const i=argv.indexOf(f); return i>=0? argv[i+1]:null;};
  const root   = path.resolve(get("--root") ?? process.cwd());
  const dry    = argv.includes("--dry-run");
  const verbose= argv.includes("--verbose");
  const prices = get("--prices");
  const paths  = (get("--paths") ?? "/topic,/ru/topic").split(",").map(s=>s.trim()).filter(Boolean);
  return { root, dry, verbose, prices, paths };
}

// ---------------- FS/HTML UTILS ----------------
async function listHtmlFiles(root){
  const out=[]; async function walk(d){
    for (const e of await fs.readdir(d,{withFileTypes:true})) {
      const p=path.join(d,e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && e.name.toLowerCase().endsWith(".html")) out.push(p);
    }
  } await walk(root); return out;
}
function abs(root, p){ return p && p.startsWith("/") ? path.join(root,"."+p) : path.join(root,p); }
function fileToUrlPath(root, file){
  const rel = path.relative(root, file).split(path.sep).join("/").replace(/\\/g,"/");
  if (rel.toLowerCase().endsWith("/index.html")) {
    const base = "/" + rel.slice(0, -"/index.html".length);
    return base.endsWith("/")? base: base + "/";
  }
  if (rel.toLowerCase().endsWith(".html")) return "/" + rel.slice(0, -".html".length).replace(/\/{2,}/g,"/");
  return "/" + rel.replace(/\/{2,}/g,"/");
}
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
function findAllTagsByClass(masked, clsName, tags=["div"], from=0, to=masked.length){
  const out=[]; let idx=from;
  while(true){
    let nextPos=-1, nextTag=null;
    for (const t of tags){
      const pos = masked.toLowerCase().indexOf(`<${t}`, idx);
      if (pos !== -1 && (nextPos === -1 || pos < nextPos)) { nextPos = pos; nextTag = t; }
    }
    if (nextPos === -1 || nextPos >= to) break;
    const { end, attrs }=readTag(masked,nextPos);
    const cls=parseClassAttr(attrs);
    if (cls.has(clsName)){
      const closeStart=findMatchingClose(masked,end,nextTag);
      if (closeStart===-1){ idx=end; continue; }
      out.push({ tag:nextTag, openStart:nextPos, openEnd:end, closeStart, closeEnd:closeStart+(`</${nextTag}>`).length });
      idx=closeStart+(`</${nextTag}>`).length;
    } else idx=end;
  }
  return out;
}
function indentBefore(s, idx, nl){ const ls=s.lastIndexOf(nl, idx-1); const lineStart=ls===-1?0:ls+nl.length; const m=s.slice(lineStart, idx).match(/^[\t ]*/); return m? m[0] : ""; }
function replaceWithin(s, a, b, repl){ return s.slice(0,a) + repl + s.slice(b); }
function collapseWS(s){ return s.replace(/[ \t]+$/gm,"").replace(/\r?\n{3,}/g,"\n\n"); }
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
  const right = after.replace(/^[ \t]*\r?\n/g, "");
  return left + block + nl + right;
}
function escapeHtml(s=""){ // текст внутри <div> — НЕ кодируем &
  return String(s).replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function decodeHtmlEntities(s = "") {
  // decode amp last to avoid turning &amp;lt; into < by double-decoding
  return String(s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}
// атрибуты в двойных кавычках: НЕ кодируем & и ' (как просили)
function escapeAttrDblNoApos(s=""){
  return String(s)
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;");
}

// ---------------- DATA LOADERS / CACHES ----------------
async function safeJson(p){ try { return JSON.parse(await fs.readFile(p,"utf8")); } catch { return null; } }
const SETTINGS_FILE   = "/code-parts/topics/skins-settings.json";
const WEAPON_JSON_DIR = "/code-parts/topics/skins-list";
const PRESETS_DIR     = "/code-parts/topics/skins-list/presets";
const LOADOUT_DIR     = "/code-parts/topics/topic-color-lists/loadout";
const TOPIC_NAV_FILE  = "/code-parts/topics/topics-nav.json";

const weaponCache = new Map();
async function loadWeaponJson(root, weapon){
  if (weaponCache.has(weapon)) return weaponCache.get(weapon);
  const full = abs(root, `${WEAPON_JSON_DIR}/${weapon}.json`);
  const data = await safeJson(full);
  weaponCache.set(weapon, data || {});
  return weaponCache.get(weapon);
}

// ---------------- PRICES ----------------
async function loadPrices(pricesArg){
  if (!pricesArg) return null;
  try {
    if (/^https?:\/\//i.test(pricesArg)){
      const res = await fetch(pricesArg);
      if (!res.ok) throw new Error(`prices URL ${res.status}`);
      const json = await res.json();
      return Array.isArray(json) ? json : null;
    } else {
      const txt = await fs.readFile(path.resolve(pricesArg), "utf8");
      const json = JSON.parse(txt);
      return Array.isArray(json) ? json : null;
    }
  } catch { return null; }
}
function formatRange(nums){
  if (!nums.length) return "";
  const sorted=[...nums].sort((a,b)=>a-b);
  const lo=sorted[0], hi=sorted[sorted.length-1];
  const f=(n)=>`${n.toFixed(2)}$`;
  return lo===hi? f(lo) : `${f(lo)} - ${f(hi)}`;
}
function computePriceHtml(name, pricesArr){
  if (!pricesArr) return { html: "", has:false };
  const isSticker = name.startsWith("Sticker |");
  const matched = pricesArr.filter(s => typeof s?.name==="string" && (isSticker ? s.name === name : s.name.includes(name)));
  if (!matched.length) return { html:"", has:false };
  const normal = matched.filter(s=>!String(s.name).startsWith("Souvenir")).map(s=>+s.price).filter(Number.isFinite);
  const souv   = matched.filter(s=> String(s.name).startsWith("Souvenir")).map(s=>+s.price).filter(Number.isFinite);
  const normalTxt = formatRange(normal);
  const souvTxt   = formatRange(souv);
  let html = "";
  if (normalTxt) html += `${escapeHtml(normalTxt)}`;
  if (souvTxt)   html += `<div class="souvenir-price-info">${escapeHtml(souvTxt)}</div>`;
  return { html, has: Boolean(normalTxt || souvTxt) };
}

// ---------------- RENDER .skin ----------------
function normalizeEntitiesInBlock(block){
  // ремонт существующих блоков: &#39; -> ' и &amp; -> &
  block = block.replace(
    /(skin-id|weapon|alt)="([^"]*?)"/g,
    (_, attr, val) => `${attr}="${val.replace(/&#39;/g, "'").replace(/&amp;/g, "&")}"`
  );
  block = block.replace(
    /(<div class="skin-desc-name">)([\s\S]*?)(<\/div>)/,
    (_, a, txt, c) => a + txt.replace(/&#39;/g, "'").replace(/&amp;/g, "&") + c
  );
  return block;
}

function renderSkinBlock({tag="div", indent, nl, weapon, skinId, skinData, priceHtml, putLoadingClass}){
  const classes = ["skin"];
  if (skinData.class) classes.push(String(skinData.class));
  const classAttr = classes.join(" ");
  const innerIndent = indent + "  ";
  const priceCls = putLoadingClass ? "skin-price-info loading" : "skin-price-info";
  const img  = skinData.image || "";
  const name = skinData.name  || (skinId === "Vanilla" ? "Vanilla" : "");
  const block = [
    `${indent}<${tag} class="${classAttr}" skin-id="${escapeAttrDblNoApos(skinId)}" weapon="${escapeAttrDblNoApos(weapon)}">`,
    `${innerIndent}<img src="${escapeAttrDblNoApos(img)}" draggable="false" alt="${escapeAttrDblNoApos(name)}">`,
    `${innerIndent}<div class="skin-desc-name">${escapeHtml(name)}</div>`,
    `${innerIndent}<div class="${priceCls}">${priceHtml || ""}</div>`,
    `${indent}</${tag}>`
  ].join(nl);
  return normalizeEntitiesInBlock(block);
}

// ---------------- BOX-SKINS-LIST (mode 1/2) ----------------
function detectAutoImportContext(urlPath, settings){
  const m = urlPath.match(/\/(?:ru\/)?topic\/(items|collections|stickers|charms)\/([^\/]+)(?:\/|$)/i);
  if (!m) return null;
  const section = m[1].toLowerCase();
  const topicId = m[2];
  let mode = settings?.[topicId];
  // дефолты: stickers/charms/items -> 1; collections -> 2
  if (!mode) {
    if (section==="collections") mode=2;
    if (section==="stickers" || section==="charms") mode=1;
  }
  if (!mode) return null;
  return { section, topicId, mode };
}

// ---- slug/token helpers (fallback derive) ----
const STOP = new Set(["the","collection","collections","case","weapon","capsule","autograph","sticker","stickers","charm","charms","pack","bundle","csgo","cs2","of","and"]);
function toTokens(str){
  const s = String(str||"").toLowerCase()
    .replace(/&/g," and ")
    .replace(/[«»“”‘’"’]/g," ")
    .replace(/[^a-z0-9]+/g," ")
    .trim();
  if (!s) return [];
  return s.split(/\s+/).filter(t=>!STOP.has(t));
}
function dedupe(arr, keyFn){ const seen=new Set(); const out=[]; for(const x of arr){ const k=keyFn(x); if(seen.has(k)) continue; seen.add(k); out.push(x);} return out; }
function rarityRank(cls){ const order={red:6,pink:5,purple:4,blue:3,lblue:2,white:1,gold:7}; return order[String(cls||"").toLowerCase()]||0; }

async function listWeaponJsonFiles(root){
  const dir = abs(root, WEAPON_JSON_DIR);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter(e=>e.isFile() && e.name.toLowerCase().endsWith(".json"))
    .map(e=>path.join(dir, e.name))
    .filter(p=>!/[\/\\]presets[\/\\]?/i.test(p));
}

/**
 * Fallback для mode=2: собрать пары по совпадению topicId с skin.collection или skin.case по токенам.
 */
async function derivePairsByTopicSlug(root, topicId){
  const topicTokens = toTokens(topicId.replace(/-/g," "));
  if (!topicTokens.length) return [];
  const files = await listWeaponJsonFiles(root);
  const pairs=[];
  for (const fp of files){
    const weapon = path.basename(fp, ".json");
    const m = await safeJson(fp);
    if (!m || typeof m!=="object") continue;
    for (const [skinId, skinData] of Object.entries(m)){
      const cands = [];
      if (skinData?.collection) cands.push(skinData.collection);
      if (skinData?.case)       cands.push(skinData.case);
      let matched = false;
      for (const cand of cands){
        const ct = toTokens(cand);
        if (!ct.length) continue;
        const set = new Set(ct);
        matched = topicTokens.every(t=>set.has(t));
        if (matched) break;
      }
      if (matched) pairs.push({ weapon, "skin-id": skinId });
    }
  }
  if (!pairs.length) return [];
  // Отсортируем: редкость ↓, затем имя
  const weaponCacheLocal = {};
  const uniqWeapons = Array.from(new Set(pairs.map(p=>p.weapon)));
  await Promise.all(uniqWeapons.map(async w=>{ weaponCacheLocal[w] = await loadWeaponJson(root, w) || {}; }));
  const sorted = pairs.slice().sort((a,b)=>{
    const ca = weaponCacheLocal[a.weapon]?.[a["skin-id"]]?.class;
    const cb = weaponCacheLocal[b.weapon]?.[b["skin-id"]]?.class;
    const r = rarityRank(cb) - rarityRank(ca);
    if (r!==0) return r;
    const na = weaponCacheLocal[a.weapon]?.[a["skin-id"]]?.name || a["skin-id"];
    const nb = weaponCacheLocal[b.weapon]?.[b["skin-id"]]?.name || b["skin-id"];
    return String(na).localeCompare(String(nb), "en");
  });
  return dedupe(sorted, x=>`${x.weapon}::${x["skin-id"]}`);
}

async function buildSkinsListForTopic(root, ctx, pricesArr, { verbose=false }={}){
  const { topicId, mode, section } = ctx;
  const items=[];
  if (mode===1){
    const p = abs(root, `${WEAPON_JSON_DIR}/${topicId}.json`);
    const weaponData = await safeJson(p);
    if (!weaponData || typeof weaponData!=="object" || !Object.keys(weaponData).length){
      if (verbose) console.warn(`[DATA] ${section}/${topicId}: skins-list missing/empty -> ${path.relative(root,p)}`);
      return ()=>"";
    }
    for (const [skinId, skinData] of Object.entries(weaponData)){
      items.push({ weapon: topicId, skinId, skinData });
    }
  } else if (mode===2){
    const presetPath = abs(root, `${PRESETS_DIR}/${topicId}.json`);
    let preset = await safeJson(presetPath);
    let src = "preset";
    if (!Array.isArray(preset) || !preset.length){
      preset = await derivePairsByTopicSlug(root, topicId);
      src = "derived";
      if (!preset.length){
        if (verbose) console.warn(`[DATA] ${section}/${topicId}: no preset and no derived pairs by topic slug`);
        return ()=>"";
      }
    }
    const uniqueWeapons = Array.from(new Set(preset.map(it=>it.weapon).filter(Boolean)));
    const cache={}; await Promise.all(uniqueWeapons.map(async w=>{
      const wp = abs(root, `${WEAPON_JSON_DIR}/${w}.json`);
      cache[w] = await safeJson(wp) || {};
      if (!Object.keys(cache[w]).length && verbose){
        console.warn(`[DATA] ${section}/${topicId}: weapon data missing/empty -> ${path.relative(root,wp)}`);
      }
    }));
    let ok=0, miss=0;
    for (const it of preset){
      const w   = it.weapon;
      const sid = it["skin-id"] ?? it.skin_id ?? it.skinId ?? it["skin id"] ?? "";
      const data = w ? cache[w]?.[sid] : undefined;
      if (w && sid && data){ items.push({ weapon:w, skinId:sid, skinData:data }); ok++; }
      else miss++;
    }
    if (!items.length){
      if (verbose) console.warn(`[DATA] ${section}/${topicId}: unresolved pairs (src=${src}, missing=${miss}/${preset.length})`);
      return ()=>"";
    }
    if (verbose) console.log(`[OK] ${section}/${topicId}: ${items.length} skins (src=${src})`);
  }
  return function render(nl, baseIndent){
    const indent = baseIndent + "  ";
    return items.map(({weapon, skinId, skinData})=>{
      const { html: priceHtml, has } = computePriceHtml(String(skinData.name||""), pricesArr);
      return renderSkinBlock({ tag:"div", indent, nl, weapon, skinId, skinData, priceHtml, putLoadingClass: !has && !pricesArr });
    }).join(nl);
  };
}

async function processBoxSkinsLists({root, file, html, pricesArr, settings, verbose}){
  const nl = html.includes("\r\n") ? "\r\n" : "\n";
  const urlPath = fileToUrlPath(root, file);
  const ctx = detectAutoImportContext(urlPath, settings);
  if (!ctx) return { html, changed:false };
  const masked = maskSegments(html);
  const lists = findAllTagsByClass(masked, "box-skins-list", ["div","ul","section"]);
  if (!lists.length) return { html, changed:false };
  const renderer = await buildSkinsListForTopic(root, ctx, pricesArr, { verbose });
  let out = html, shift=0, changed=false, injectedCount=0;
  for (const list of lists){
    const openAbs = list.openEnd + shift, closeAbs = list.closeStart + shift;
    const baseIndent = indentBefore(out, openAbs, nl);
    const block = renderer(nl, baseIndent);
    if (!block.trim()) continue;
    const next = joinBlocksNoBlank(out.slice(0,openAbs), block, out.slice(closeAbs), nl);
    if (collapseWS(next) !== collapseWS(out)){
      changed=true; shift += next.length - out.length; out = next; injectedCount++;
    }
  }
  if (changed && verbose) {
    console.log(`[OK] ${path.relative(root,file)} :: .box-skins-list (mode=${ctx.mode}), lists=${injectedCount}`);
  }
  if (!changed && verbose && lists.length){
    console.warn(`[WARN] ${path.relative(root,file)} :: .box-skins-list found=${lists.length}, but nothing rendered`);
  }
  return { html: out, changed };
}

// ---------------- PLACEHOLDER <div class="skin"> ----------------
async function processSkinPlaceholders({root, html, pricesArr, verbose, file}){
  const nl = html.includes("\r\n") ? "\r\n" : "\n";
  const masked = maskSegments(html);
  const skins = findAllTagsByClass(masked, "skin", ["div","span"]);
  if (!skins.length) return { html, changed:false };
  let out = html, shift=0, anyChange=false;
  for (const s of skins){
    const openAbs = s.openStart + shift, closeAbs = s.closeEnd + shift;
    const open = readTag(out, openAbs);
    const attrs = open.attrs;
    const weaponRaw = (attrs.match(/\bweapon\s*=\s*(["'])(.*?)\1/i)?.[2] || "").trim();
    const skinIdRaw = (attrs.match(/\bskin-id\s*=\s*(["'])(.*?)\1/i)?.[2] || "").trim();
    const weapon = decodeHtmlEntities(weaponRaw);
    const skinId = decodeHtmlEntities(skinIdRaw);
    if (!weapon || !skinId) continue;
    const tag = s.tag;
    const indent = indentBefore(out, openAbs, nl);
    const weaponMap = await loadWeaponJson(root, weapon);
    const skinData = weaponMap?.[skinId] || {};
    const { html: priceHtml, has } = computePriceHtml(String(skinData.name||""), pricesArr);
    const newBlock = renderSkinBlock({ tag, indent, nl, weapon, skinId, skinData, priceHtml, putLoadingClass: !has && !pricesArr });
    const next = joinBlocksNoBlank(out.slice(0,openAbs), newBlock, out.slice(closeAbs), nl);
    if (collapseWS(next) !== collapseWS(out)){ anyChange=true; shift += next.length - out.length; out = next; if (verbose) console.log(`[OK] ${path.relative(root,file)} :: <${tag}.skin> ${weapon}/${skinId}`); }
  }
  return { html: out, changed:anyChange };
}

// ---------------- TOPIC-FILTER (topic-boxes-holder) ----------------
async function loadTopicNav(root){
  const data = await safeJson(abs(root, TOPIC_NAV_FILE));
  return Array.isArray(data) ? data : [];
}
function localizeHrefForRu(href, isRu){
  if (!href) return "#";
  if (isRu && /^\/(?!ru\/)/.test(href)) return "/ru" + href;
  return href;
}
function pickActiveIndex(nav, urlPath, isRu){
  let bestIdx = -1, bestLen = -1;
  nav.forEach((btn, i)=>{
    const h = localizeHrefForRu(String(btn.href||""), isRu);
    if (!h) return;
    if (urlPath.includes(h) && h.length > bestLen){
      bestLen = h.length; bestIdx = i;
    }
  });
  return bestIdx;
}
function renderTopicFilterHtml({nav, indent, nl, urlPath, isRu}){
  const lines = [];
  lines.push(`${indent}<div class="topic-filter">`);
  lines.push(`${indent}  <input class="singlemod-box topic-filter-tab" type="text" placeholder="" aria-label="Filter Topic" autocomplete="off">`);
  const activeIdx = pickActiveIndex(nav, urlPath, isRu);
  nav.forEach((btn, i)=>{
    const boxTitle = isRu && btn["data-title-ru"] ? btn["data-title-ru"] : (btn.alt || "");
    const href = localizeHrefForRu(String(btn.href||"#"), isRu);
    const img  = String(btn.img||"");
    const alt  = String(btn.alt||"");
    lines.push(`${indent}  <div class="singlemod-box${i===activeIdx ? " active" : ""}" data-title="${escapeAttrDblNoApos(boxTitle)}">`);
    lines.push(`${indent}    <a href="${escapeAttrDblNoApos(href)}" class="singlemod-select">`);
    lines.push(`${indent}      <img src="${escapeAttrDblNoApos(img)}" alt="${escapeAttrDblNoApos(alt)}">`);
    lines.push(`${indent}    </a>`);
    lines.push(`${indent}  </div>`);
  });
  lines.push(`${indent}</div>`);
  return lines.join(nl);
}
async function processTopicFilters({root, file, html, verbose}){
  const nl = html.includes("\r\n") ? "\r\n" : "\n";
  const urlPath = fileToUrlPath(root, file);
  const masked = maskSegments(html);
  const holders = findAllTagsByClass(masked, "topic-boxes-holder", ["div","section"]);
  if (!holders.length) return { html, changed:false };
  const nav = await loadTopicNav(root);
  if (!nav.length) return { html, changed:false };
  let out = html, shift = 0, changed = false;
  for (const h of holders){
    const openAbs   = h.openStart + shift;
    const openEnd   = h.openEnd   + shift;
    const closeAbs  = h.closeStart+ shift;
    const openTag = readTag(out, openAbs);
    const classes = parseClassAttr(openTag.attrs);
    const isRu = urlPath.startsWith("/ru/") || classes.has("lang-ru");
    const baseIndent = indentBefore(out, openEnd, nl);
    const innerIndent = baseIndent + "  ";
    const maskedAll = maskSegments(out);
    const filters = findAllTagsByClass(maskedAll, "topic-filter", ["div"], openEnd, closeAbs);
    let innerBefore = out.slice(openEnd, closeAbs);
    if (filters.length){
      let parts = []; let cursor = openEnd;
      for (const f of filters){ const fOpen = f.openStart, fClose = f.closeEnd; parts.push(out.slice(cursor, fOpen)); cursor = fClose; }
      parts.push(out.slice(cursor, closeAbs));
      innerBefore = parts.join("");
    }
    const rest = innerBefore.replace(/^[ \t]*\r?\n+/,"");
    const filterHtml = renderTopicFilterHtml({ nav, indent: innerIndent, nl, urlPath, isRu });
    const newInner = filterHtml + (rest.startsWith(nl) ? rest : (rest ? nl + rest : ""));
    const next = out.slice(0, openEnd) + nl + newInner + out.slice(closeAbs);
    if (collapseWS(next) !== collapseWS(out)){
      if (verbose) console.log(`[OK] ${path.relative(root,file)} :: topic-filter fixed/inserted`);
      changed = true; shift += next.length - out.length; out = next;
    }
  }
  return { html: out, changed };
}

// ---------------- LOADOUT PAGES ----------------
function detectLoadoutContext(urlPath){
  const m = urlPath.match(/\/(?:ru\/)?topic\/skins\/(cheapest|best)-([a-z]+)-skins(?:\/|$)/i);
  if (!m) return null;
  const mode = m[1].toLowerCase();
  const color = m[2].toLowerCase();
  return { mode, color };
}
function pickLoadoutPairsFromValue(value, mode){
  if (value && typeof value === "object" && ("best" in value || "cheapest" in value)){
    const pair = mode === "best" ? value.best : value.cheapest;
    const weapon = Array.isArray(pair) ? pair[0] : "";
    let skinId = Array.isArray(pair) ? pair[1] : "";
    if (!skinId || !String(skinId).trim()) skinId = "Vanilla";
    return { weapon, skinId };
  }
  const arr = Array.isArray(value) ? value : [value];
  const safe = arr.length === 1 ? [arr[0], arr[0]] : arr;
  let skinId = mode === "cheapest" ? safe[1] : safe[0];
  if (!skinId || !String(skinId).trim()) skinId = "Vanilla";
  return { weapon:null, skinId };
}
async function buildLoadoutHtml(root, ctx, pricesArr, nl, baseIndent){
  const jsonPath = abs(root, `${LOADOUT_DIR}/${ctx.color}.json`);
  const data = await safeJson(jsonPath); if (!data || typeof data!=="object") return "";
  const pairs = [];
  for (const [key,value] of Object.entries(data)){
    const picked = pickLoadoutPairsFromValue(value, ctx.mode);
    const weapon = picked.weapon || key;
    pairs.push({ weapon, skinId: picked.skinId });
  }
  const top7   = pairs.slice(0, 7);
  const left11 = pairs.slice(7, 18);
  const right11= pairs.slice(18, 29);
  const bottom7= pairs.slice(29, 36);
  const allWeapons = Array.from(new Set(pairs.map(p=>p.weapon)));
  const cache = {};
  await Promise.all(allWeapons.map(async w => { cache[w] = await loadWeaponJson(root, w); }));
  function renderSection(cls, list){
    const secIndent = baseIndent + "  ";
    const items = list.map(({weapon, skinId})=>{
      const data = cache[weapon]?.[skinId] || (skinId==="Vanilla" ? { name:"Vanilla", image:"", class:"" } : {});
      const { html: priceHtml, has } = computePriceHtml(String(data.name||""), pricesArr);
      return renderSkinBlock({ tag:"div", indent: secIndent + "  ", nl, weapon, skinId, skinData:data, priceHtml, putLoadingClass: !has && !pricesArr });
    }).join(nl);
    return [
      `${secIndent}<div class="character-items-list ${cls}">`,
      items,
      `${secIndent}</div>`
    ].join(nl);
  }
  const lines = [];
  lines.push(`${baseIndent}<!-- loadout auto-filled -->`);
  lines.push(renderSection("top", top7));
  lines.push(renderSection("left", left11));
  lines.push(`${baseIndent}  <div class="character-model"></div>`);
  lines.push(renderSection("right", right11));
  lines.push(renderSection("bottom", bottom7));
  return lines.join(nl);
}
async function processLoadoutPages({root, file, html, pricesArr, verbose}){
  const nl = html.includes("\r\n") ? "\r\n" : "\n";
  const urlPath = fileToUrlPath(root, file);
  const ctx = detectLoadoutContext(urlPath);
  if (!ctx) return { html, changed:false };
  const masked = maskSegments(html);
  const sitepages = findAllTagsByClass(masked, "sitepage", ["div","section"]);
  let box=null;
  for (const sp of sitepages){
    const open = readTag(html, sp.openStart);
    if (parseClassAttr(open.attrs).has("loadout")){
      const regionMasked = maskSegments(html.slice(sp.openEnd, sp.closeStart));
      const charBoxes = findAllTagsByClass(regionMasked, "character-box", ["div","section"]);
      if (charBoxes.length){
        const c = charBoxes[0];
        box = { absOpenEnd: sp.openEnd + c.openEnd, absCloseStart: sp.openEnd + c.closeStart };
        break;
      }
    }
  }
  if (!box) return { html, changed:false };
  const baseIndent = indentBefore(html, box.absOpenEnd, nl);
  const built = await buildLoadoutHtml(root, ctx, pricesArr, nl, baseIndent);
  if (!built) return { html, changed:false };
  const before = html.slice(0, box.absOpenEnd);
  const after  = html.slice(box.absCloseStart);
  const next   = joinBlocksNoBlank(before, built, after, nl);
  if (collapseWS(next) !== collapseWS(html)){
    if (verbose) console.log(`[OK] ${path.relative(root,file)} :: loadout ${ctx.mode}/${ctx.color}`);
    return { html: next, changed:true };
  }
  return { html, changed:false };
}

// ---------------- MAIN ----------------
(async function main(){
  const { root, dry, verbose, prices, paths } = parseArgs(process.argv.slice(2));
  const files = await listHtmlFiles(root);
  const settings = await safeJson(abs(root, SETTINGS_FILE)) || {};
  const pricesArr = await loadPrices(prices);

  let updated=0, skipped=0;

  for (const file of files){
    const urlPath = fileToUrlPath(root, file);
    const allowed = paths.some(p => urlPath.toLowerCase().startsWith(p.toLowerCase()));
    if (!allowed){ skipped++; continue; }

    try{
      // --- финальный no-op guard начинается здесь ---
      const origHtml = await fs.readFile(file,"utf8"); // исходник
      let html = origHtml;
      let changed = false;

      // 1) .box-skins-list
      const resList = await processBoxSkinsLists({root, file, html, pricesArr, settings, verbose});
      if (resList.changed){ html = resList.html; changed = true; }

      // 2) loadout pages
      const resLoad = await processLoadoutPages({root, file, html, pricesArr, verbose});
      if (resLoad.changed){ html = resLoad.html; changed = true; }

      // 3) одиночные плейсхолдеры .skin (+ ремонт уже записанных блоков)
      const resSkins = await processSkinPlaceholders({root, html, pricesArr, verbose, file});
      if (resSkins.changed){ html = resSkins.html; changed = true; }

      // 4) topic-filter вставка/ремонт
      const resFilter = await processTopicFilters({root, file, html, verbose});
      if (resFilter.changed){ html = resFilter.html; changed = true; }

      // --- ключ: писать только если ПО-ИТОГУ контент реально изменился ---
      const finalChanged = html !== origHtml;

      if (finalChanged){
        if (!dry) await fs.writeFile(file, html, "utf8");
        updated++;
      } else {
        skipped++;
      }
    } catch(e){
      console.error(`[ERR] ${path.relative(root,file)}:`, e.message);
      skipped++;
    }
  }

  console.log(`\nDone. Updated: ${updated}, skipped: ${skipped}, total: ${files.length}`);
})().catch(e=>{ console.error(e); process.exit(1); });
