// ============================================================================
// File: scripts/alt-langs.js
// Usage examples:
//   node scripts/alt-langs.js --debug-one /pt/csgo/roulette.html --verbose
//   node scripts/alt-langs.js --debug-one /es.html --verbose
//   node scripts/alt-langs.js --verbose
// Options:
//   --root <path>     проект (по умолчанию: cwd)
//   --dry-run         не писать на диск
//   --verbose         подробный лог
//   --limit N         обработать только первые N целей
//   --debug-one <rel> обработать один файл (например: /pt.html, /tr/dota/roulette.html)
// ============================================================================

const fs = require("fs/promises");
const path = require("path");

/* ---------- CLI ---------- */
function parseArgs(argv){
  const get=f=>{const i=argv.indexOf(f); return i>=0? argv[i+1]: null;};
  const root = path.resolve(get("--root") ?? process.cwd());
  const langs = (get("--langs") || "pt,hi,es,tr").split(",").map(s=>s.trim()).filter(Boolean);
  return {
    root, langs,
    dry: argv.includes("--dry-run"),
    verbose: argv.includes("--verbose"),
    debugOne: get("--debug-one") || "",
    limit: Number(get("--limit") || 0) || 0
  };
}
async function exists(p){ try { await fs.access(p); return true; } catch { return false; } }
async function readUtf8(p){ return fs.readFile(p, "utf8"); }
function abs(root, p){ return p.startsWith("/") ? path.join(root, "."+p) : path.join(root, p); }

/* ---------- scan ---------- */
const KNOWN_LANGS = new Set(["ru","en","es","pt","tr","hi"]);
const EXCLUDE_DIRS = new Set(["reviews",".git","node_modules",".next","dist","build","out"]);
async function listLocalizedHtmlFiles(root, langs){
  const out=[];
  for (const lang of langs){
    const base = path.join(root, lang);
    if (!(await exists(base))) continue;
    await walk(base);
    async function walk(dir){
      let ents; try { ents = await fs.readdir(dir, {withFileTypes:true}); } catch { return; }
      for (const e of ents){
        const p = path.join(dir, e.name);
        if (e.isDirectory()){
          if (EXCLUDE_DIRS.has(e.name)) continue;
          await walk(p);
        } else if (e.isFile() && /\.html?$/i.test(e.name)){
          out.push("/" + path.relative(root, p).split(path.sep).join("/"));
        }
      }
    }
  }
  // локализованные главные
  for (const rel of ["/es.html","/pt.html","/hi.html","/tr.html"]){
    if (await exists(abs(root, rel))) out.push(rel);
  }
  return out;
}
function isLocalizedHome(rel){ return ["/es.html","/pt.html","/hi.html","/tr.html"].includes(rel); }
function protoFromLocalized(rel){
  if (isLocalizedHome(rel)) return "/index.html";
  const segs = rel.split("/").filter(Boolean);
  if (segs.length && KNOWN_LANGS.has(segs[0])) segs.shift();
  return "/" + segs.join("/");
}
function detectNL(s){ return s.includes("\r\n") ? "\r\n" : "\n"; }
function langFromRel(rel){
  if (isLocalizedHome(rel)) return rel.slice(1,3);
  const seg=(rel.split("/").filter(Boolean)[0]||"").toLowerCase();
  return KNOWN_LANGS.has(seg)? seg : "en";
}

/* ---------- light DOM helpers ---------- */
function maskSegments(s){
  return s
    .replace(/<!--[\s\S]*?-->/g, m=>" ".repeat(m.length))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, m=>" ".repeat(m.length))
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,  m=>" ".repeat(m.length));
}
function readTag(s,start){
  let i=start, inS=false, inD=false;
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
// ЗАМЕНИ ЭТУ функцию на более строгую
function fixMainModeLangClasses(html, lang) {
  // Меняем только теги, у которых class содержит ТОКЕН "main-mode"
  return html.replace(
    /<([a-z]+)\b([^>]*\bclass\s*=\s*["'])([^"']*)(["'][^>]*>)/gi,
    (whole, tag, pre, clsStr, post) => {
      const tokens = clsStr.split(/\s+/).filter(Boolean);
      if (!tokens.includes("main-mode")) return whole;            // не наш элемент
      const withoutLang = tokens.filter(t => !/^lang-[a-z]{2}$/i.test(t));
      if (!withoutLang.includes(`lang-${lang}`)) {
        withoutLang.push(`lang-${lang}`);
      }
      const newCls = withoutLang.join(" ");
      return `<${tag}${pre}${newCls}${post}`;
    }
  );
}

function parseClassAttr(attrs){
  const m = attrs.match(/\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
  const val = m ? (m[1] ?? m[2] ?? "") : "";
  return new Set(val.split(/\s+/).filter(Boolean));
}
function findMatchingClose(masked, from, tag){
  const openRe=new RegExp(`<${tag}\\b`,"gi"), closeRe=new RegExp(`</${tag}\\s*>`,"gi");
  let depth=1, i=from;
  while(i<masked.length){
    const s=masked.slice(i);
    const nOpen=s.search(openRe), nClose=s.search(closeRe);
    if (nClose===-1) return -1;
    if (nOpen!==-1 && nOpen<nClose){ const abs=i+nOpen; const { end }=readTag(masked, abs); depth++; i=end; continue; }
    const cabs=i+nClose; const { end:ce }=readTag(masked, cabs);
    depth--; if (depth===0) return cabs; i=ce;
  }
  return -1;
}
function findFirstByClass(masked, clsName, from=0, to=masked.length){
  const openRe = /<div\b/gi;
  let i=from;
  while(true){
    const pos = masked.slice(i, to).search(openRe);
    if (pos === -1) return null;
    const abs = i + pos;
    const { end, attrs } = readTag(masked, abs);
    const cls = parseClassAttr(attrs);
    if (cls.has(clsName)){
      const closeStart = findMatchingClose(masked, end, "div");
      if (closeStart === -1) return null;
      return { openStart: abs, openEnd: end, closeStart, closeEnd: closeStart + "</div>".length };
    }
    i = end;
  }
}
function extractHolder(html){
  const h = findFirstByClass(maskSegments(html), "boxes-holder");
  if (!h) return null;
  return { ...h, inner: html.slice(h.openEnd, h.closeStart) };
}
function withHolderInner(html, fn){
  const h = findFirstByClass(maskSegments(html), "boxes-holder");
  if (!h) return html;
  const inner = html.slice(h.openEnd, h.closeStart);
  const repl = fn(inner);
  if (repl === inner) return html;
  return html.slice(0, h.openEnd) + repl + html.slice(h.closeStart);
}

/* ---------- link utils ---------- */
const PREFIX_LANGS = new Set(["es","pt","tr","hi"]);
function isExternal(href){ return /^https?:\/\//i.test(href); }
function addLangPrefixToHref(href, lang){
  if (!href) return href;
  if (!PREFIX_LANGS.has(lang)) return href;
  if (isExternal(href) || /^#/.test(href)) return href;
  const clean = href.replace(/\/{2,}/g,"/");
  const pathOnly = clean.split("#")[0].split("?")[0];
  const first = (pathOnly.split("/").filter(Boolean)[0]||"").toLowerCase();
  if (first === lang || KNOWN_LANGS.has(first)) return clean; // уже локализовано / другой язык
  const withSlash = pathOnly.startsWith("/") ? pathOnly : `/${pathOnly}`;
  const pref = (`/${lang}${withSlash}`).replace(/\/{2,}/g,"/");
  const suffix = clean.slice(pathOnly.length);
  return pref + suffix;
}
function upsertAttr(openTag, name, value){
  const re = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i");
  if (re.test(openTag)) return openTag.replace(re, (_m,q)=>`${name}=${q}${value}${q}`);
  return openTag.replace(/>$/, ` ${name}="${value}">`);
}

/* ---------- link localization blocks ---------- */
function localizeLogobgAnchors(inner, lang){
  let out=inner, shift=0;
  const masked = maskSegments(out);
  const logobgs = [];
  let pos=0;
  while(true){
    const b = findFirstByClass(masked, "logobg", pos);
    if (!b) break; logobgs.push(b); pos = b.closeEnd;
  }
  for (const b of logobgs){
    const s=b.openEnd+shift, e=b.closeStart+shift;
    const region=out.slice(s,e);
    const idx = region.search(/<a\b/i);
    if (idx === -1) continue;
    const { end: aEnd, tagText } = readTag(region, idx);
    const href = (tagText.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2]) || "";
    const nh = addLangPrefixToHref(href, lang);
    if (nh === href) continue;
    const newOpen = upsertAttr(tagText, "href", nh);
    const newRegion = region.slice(0, idx) + newOpen + region.slice(aEnd);
    out = out.slice(0, s) + newRegion + out.slice(e);
    shift += newRegion.length - region.length;
  }
  return out;
}
function localizeReviewButtons(inner, lang){
  let out=inner, shift=0;
  const masked = maskSegments(out);
  let pos=0;
  while(true){
    const block = findFirstByClass(masked, "content-buttons", pos);
    if (!block) break;
    const s=block.openEnd+shift, e=block.closeStart+shift;
    let region = out.slice(s,e);
    region = region.replace(/<a\b[^>]*>/gi, (open)=>{
      const clsM = open.match(/\bclass\s*=\s*(["'])([^"']*)\1/i);
      const cls = new Set((clsM ? clsM[2] : "").split(/\s+/).filter(Boolean));
      if (!cls.has("review-button")) return open;
      if (cls.has("visit") || cls.has("mirror-visit")) return open;
      const href = (open.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2]) || "";
      const nh = addLangPrefixToHref(href, lang);
      if (nh === href) return open;
      return upsertAttr(open, "href", nh);
    });
    const old = out.slice(s,e);
    if (region !== old){
      out = out.slice(0,s) + region + out.slice(e);
      shift += region.length - old.length;
    }
    pos = block.closeEnd;
  }
  return out;
}
function localizeMoreContent(inner, lang){
  let out=inner, shift=0;
  const masked = maskSegments(out);
  let pos=0;
  while(true){
    const block = findFirstByClass(masked, "more-content", pos);
    if (!block) break;
    const s=block.openEnd+shift, e=block.closeStart+shift;
    let region = out.slice(s,e);
    region = region.replace(/<a\b[^>]*>/gi, (open)=>{
      const href = (open.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2]) || "";
      const nh = addLangPrefixToHref(href, lang);
      if (nh === href) return open;
      return upsertAttr(open, "href", nh);
    });
    const old = out.slice(s,e);
    if (region !== old){
      out = out.slice(0,s) + region + out.slice(e);
      shift += region.length - old.length;
    }
    pos = block.closeEnd;
  }
  return out;
}

/* ---------- main-page specific ---------- */
// Обновляем только href в каждом .main-mode-unit, КРОМЕ .main-mode-unit.topics.
// src картинок НЕ меняем.
function localizeMainModeSelection(inner, lang){
  if (!PREFIX_LANGS.has(lang)) return inner;
  return inner.replace(
    /(<div\b[^>]*class\s*=\s*["'][^"']*\bmain-mode-selection\b[^"']*["'][^>]*>)([\s\S]*?)(<\/div>)/i,
    (m, open, body, close) => {
      let region = body.replace(
        /(<div\b[^>]*class\s*=\s*["']([^"']*\bmain-mode-unit\b[^"']*)["'][^>]*>)([\s\S]*?)(<\/div>)/gi,
        (_m, unitOpen, clsStr, unitBody, unitClose) => {
          if (/\btopics\b/i.test(clsStr)) return _m; // пропускаем topics
          // найти <a> и локализовать href
          const outBody = unitBody.replace(/<a\b[^>]*>/i, (aOpen) => {
            const href = (aOpen.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2]) || "";
            const nh = addLangPrefixToHref(href, lang);
            if (nh === href) return aOpen;
            return upsertAttr(aOpen, "href", nh);
          });
          return unitOpen + outBody + unitClose;
        }
      );
      return open + region + close;
    }
  );
}

function localizeBoxesHolderNameNav(inner, lang){
  if (!PREFIX_LANGS.has(lang)) return inner;
  let out=inner, shift=0;
  const masked=maskSegments(out);
  let pos=0;
  while(true){
    const block = findFirstByClass(masked, "boxes-holder-name", pos);
    if (!block) break;
    const s=block.openEnd+shift, e=block.closeStart+shift;
    let region = out.slice(s,e);
    region = region.replace(/<a\b([^>]*\bclass\s*=\s*["'][^"']*\bboxes-holder-(?:modes|more)\b[^"']*["'][^>]*)>/gi, (open, attrs)=>{
      const href = (open.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2]) || "";
      const nh = addLangPrefixToHref(href, lang);
      if (nh === href) return open;
      return upsertAttr(open, "href", nh);
    });
    const old = out.slice(s,e);
    if (region !== old){
      out = out.slice(0,s) + region + out.slice(e);
      shift += region.length - old.length;
    }
    pos = block.closeEnd;
  }
  return out;
}
function localizeModsBox(inner, lang){
  if (!PREFIX_LANGS.has(lang)) return inner;
  let out=inner, shift=0;
  const masked = maskSegments(out);
  let pos=0;
  while(true){
    const block = findFirstByClass(masked, "mods-box", pos);
    if (!block) break;
    const s=block.openEnd+shift, e=block.closeStart+shift;
    let region = out.slice(s,e);
    region = region.replace(/<a\b[^>]*>/gi, (open)=>{
      const href = (open.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2]) || "";
      const nh = addLangPrefixToHref(href, lang);
      if (nh === href) return open;
      return upsertAttr(open, "href", nh);
    });
    const old = out.slice(s,e);
    if (region !== old){
      out = out.slice(0,s) + region + out.slice(e);
      shift += region.length - old.length;
    }
    pos = block.closeEnd;
  }
  return out;
}

/* ---------- MBX переводы для mods-box ---------- */

const MBX_TRANSLATIONS = {
  "Buy Skins": {
    ru:"Купить скины",
    tr:"Skinler Satın Al",
    pt:"Comprar Skins",
    hi:"स्किन्स खरीदें",
    es:"Comprar Skins"
  },
  "Sell Skins": {
    ru:"Продать скины",
    tr:"Skinler Sat",
    pt:"Vender Skins",
    hi:"स्किन्स बेचें",
    es:"Vender Skins"
  },
  "Trade Skins": {
    ru:"Обменять скины",
    tr:"Skinler Takas Et",
    pt:"Negociar Skins",
    hi:"स्किन्स विनिमय",
    es:"Intercambiar Skins"
  },
  "Buy Items": {
    ru:"Купить предметы",
    tr:"Eşyalar Satın Al",
    pt:"Comprar Itens",
    hi:"वस्तुएँ खरीदें",
    es:"Comprar Ítems"
  },
  "Sell Items": {
    ru:"Продать предметы",
    tr:"Eşyalar Sat",
    pt:"Vender Itens",
    hi:"वस्तुएँ बेचें",
    es:"Vender Ítems"
  },
  "Trade Items": {
    ru:"Обменять предметы",
    tr:"Eşyalar Takas Et",
    pt:"Negociar Itens",
    hi:"वस्तुएँ विनिमय",
    es:"Intercambiar Ítems"
  },
  "Instant Sell": {
    ru:"Быстрая Продажа",
    tr:"Anlık Satış",
    pt:"Venda Imediata",
    hi:"त्वरित बेचें",
    es:"Venta Instantánea"
  },
  "Marketplaces": {
    ru:"Торговые Площадки",
    tr:"Pazarlar",
    pt:"Mercados",
    hi:"बाजार",
    es:"Mercados"
  },
  "Daily Rewards": {
    ru:"Ежедневные Награды",
    tr:"Günlük Ödüller",
    pt:"Recompensas Diárias",
    hi:"दैनिक पुरस्कार",
    es:"Recompensas Diarias"
  },
  "Deposit Bonuses": {
    ru:"Бонусы к Пополнению",
    tr:"Yatırım Bonusları",
    pt:"Bônus de Depósito",
    hi:"जमा बोनस",
    es:"Bonos de Depósito"
  },
  "Giveaways": {
    ru:"Розыгрыши",
    tr:"Çekilişler",
    pt:"Sorteios",
    hi:"गिफ्ट वे",
    es:"Sorteos"
  },
  "Sign Up Bonuses": {
    ru:"Бонусы за Регистрацию",
    tr:"Kayıt Bonusları",
    pt:"Bônus de Inscrição",
    hi:"साइन अप बोनस",
    es:"Bonos de Registro"
  },
  "Bonuses to Sale": {
    ru:"Бонусы к Продаже",
    tr:"Satışa Ek Bonuslar",
    pt:"Bônus na Venda",
    hi:"बिक्री के लिए बोनस",
    es:"Bonos para la Venta"
  },
  "Match Betting": {
    ru:"Ставки на Матчи",
    tr:"Maç Bahisleri",
    pt:"Apostas em Partidas",
    hi:"मैच सट्टेबाजी",
    es:"Apuestas en Partidos"
  },
  Roulette: {
    ru:"Рулетка",
    tr:"Rulet",
    pt:"Roleta",
    hi:"रूले",
    es:"Ruleta"
  },
  "Case Opening": {
    ru:"Открытие Кейсов",
    tr:"Kasa Açma",
    pt:"Abertura de Caixas",
    hi:"केस खोलना",
    es:"Apertura de Cajas"
  },
  Crash: {
    ru:"Краш",
    tr:"Çöküş",
    pt:"Queda",
    hi:"क्रैश",
    es:"Choque"
  },
  Jackpot: {
    ru:"Джекпот",
    tr:"Büyük İkramiye",
    pt:"Jackpot",
    hi:"जैकपॉट",
    es:"Jackpot"
  },
  Coinflip: {
    ru:"Монетка",
    tr:"Yazı Tura",
    pt:"Cara ou Coroa",
    hi:"सिक्का उछालना",
    es:"Lanzamiento de Moneda"
  },
  "Case Battle": {
    ru:"",
    tr:"Kasa Savaşı",
    pt:"Batalha de Caixas",
    hi:"केस बैटल",
    es:"Batalla de Cajas"
  },
  Slots: {
    ru:"",
    tr:"Kumarhane",
    pt:"Cassino",
    hi:"कैसिनो",
    es:"Slots"
  },
  More: {
    ru:"",
    tr:"Daha Fazla",
    pt:"Mais",
    hi:"अधिक",
    es:"Más"
  },
  "Popular CS2 Gambling Sites": {
    ru:"",
    tr:"Popüler CS2 Kumar Siteleri",
    pt:"Sites Populares de Apostas CS2",
    hi:"लोकप्रिय CS2 जुआ साइटें",
    es:"Sitios de Apuestas Populares de CS2"
  },
  "Popular Rust Gambling Sites": {
    ru:"",
    tr:"Popüler Rust Kumar Siteleri",
    pt:"Sites Populares de Apostas Rust",
    hi:"लोकप्रिय Rust जुआ साइटें",
    es:"Sitios de Apuestas Populares de Rust"
  },
  "Popular CS2 Trading Sites": {
    ru:"",
    tr:"Popüler CS2 Takas Siteleri",
    pt:"Sites Populares de Troca CS2",
    hi:"लोकप्रिय CS2 विनिमय साइटें",
    es:"Sitios de Intercambio Populares de CS2"
  },
  "Instant Sell Platforms": {
    ru:"",
    tr:"Hızlı Satış Hizmetleri",
    pt:"Serviços de Venda Rápida",
    hi:"त्वरित बिक्री सेवाएं",
    es:"Servicios de Venta Rápida"
  },
  "Best Task Services": {
    ru:"",
    tr:"En İyi Görev Hizmetleri",
    pt:"Melhores Serviços de Tarefas",
    hi:"सर्वश्रेष्ठ कार्य सेवाएं",
    es:"Mejores Servicios de Tareas"
  }
};

function mbxNormalize(text, lang){
  if (String(lang).toLowerCase() === "tr") {
    return String(text || "").toLocaleLowerCase("tr-TR");
  }
  return String(text || "").toLowerCase();
}

function mbxTranslateLabel(title, lang){
  if (!title) return title;
  const L = String(lang || "en").toLowerCase();
  const keys = Object.keys(MBX_TRANSLATIONS);
  const key = keys.find(k => mbxNormalize(k, L) === mbxNormalize(title, L));
  const map = key ? MBX_TRANSLATIONS[key] : null;
  const res = map && map[L];
  return res || title;
}

/**
 * Переводит подписи в .mods-box:
 * - data-title в <div class="singlemod-box">
 * - <span>внутри <a class="singlemod-select">
 * Работает для es/pt/tr/hi.
 */
function translateModsBoxTitles(inner, lang){
  const L = String(lang || "en").toLowerCase();
  if (!["es","pt","tr","hi"].includes(L)) return inner;

  let out = inner;
  let shift = 0;
  const masked = maskSegments(out); // маска по исходному inner
  let pos = 0;

  while (true) {
    // Ищем <div class="singlemod-box"> структурно, а не регэкспом
    const block = findFirstByClass(masked, "singlemod-box", pos);
    if (!block) break;

    // Координаты блока в реальной строке (учитывая shift)
    const openStart  = block.openStart + shift;
    const openEnd    = block.openEnd   + shift;
    const closeStart = block.closeStart + shift;
    const closeEnd   = block.closeEnd + shift;

    const openTag  = out.slice(openStart, openEnd);
    const body     = out.slice(openEnd, closeStart);
    const closeTag = out.slice(closeStart, closeEnd);

    // 1) Пытаемся взять заголовок из data-title
    const titleAttr = openTag.match(/\bdata-title\s*=\s*(["'])(.*?)\1/i);
    let title = titleAttr ? titleAttr[2] : null;

    // 2) Если data-title нет, вытащим текст из <span> внутри блока
    if (!title) {
      const spanMatch = body.match(/<span\b[^>]*>([\s\S]*?)<\/span>/i);
      if (spanMatch) {
        title = stripHtml(spanMatch[1]).trim();
      }
    }

    if (!title) {
      // Нечего переводить — двигаемся к следующему .singlemod-box
      pos = block.closeEnd;
      continue;
    }

    const translated = mbxTranslateLabel(title, L);
    if (!translated || translated === title) {
      // Перевода нет или он совпадает — ничего не меняем
      pos = block.closeEnd;
      continue;
    }

    // 3) Обновляем / добавляем data-title в открывающем div
    const newOpenTag = upsertAttr(openTag, "data-title", translated);

    // 4) Если есть <span> — заменяем его текст
    const newBody = body.replace(
      /(<span\b[^>]*>)([\s\S]*?)(<\/span>)/i,
      (_m, sOpen, _txt, sClose) => sOpen + translated + sClose
    );

    const newBlock = newOpenTag + newBody + closeTag;

    // Собираем строку обратно
    const oldLen = closeEnd - openStart;
    out = out.slice(0, openStart) + newBlock + out.slice(closeEnd);
    shift += newBlock.length - oldLen;

    // В masked двигаемся по старым координатам (без shift)
    pos = block.closeEnd;
  }

  return out;
}

/* ---------- translations (FIXED) ---------- */
const trCache = new Map();

async function loadTranslations(root, lang){
  if (trCache.has(lang)) return trCache.get(lang);
  const p = abs(root, `/code-parts/main-translations/${lang}.json`);
  try {
    const json = JSON.parse(await fs.readFile(p, "utf8"));
    trCache.set(lang, json);
    return json;
  } catch {
    trCache.set(lang, null);
    return null;
  }
}

function stripHtml(s){ return String(s).replace(/<[^>]*>/g, ""); }
function normalizeText(s){
  return String(s).replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
}

/** Готовит быстрый переводчик с нормализованными ключами */
function makeTranslator(dict){
  if (!dict) return (orig)=>({found:false, value:orig});
  const map = new Map();
  if (dict.texts){
    for (const [k, v] of Object.entries(dict.texts)){
      map.set(normalizeText(k), v);
    }
  }
  const patterns = [];
  if (dict.patterns){
    for (const [pat, repl] of Object.entries(dict.patterns)){
      try { patterns.push([new RegExp(pat), repl]); } catch {}
    }
  }
  return (origHtml) => {
    const plain = normalizeText(stripHtml(origHtml));
    if (!plain) return {found:false, value:origHtml};

    if (map.has(plain)) return {found:true, value:map.get(plain)};

    for (const [re, repl] of patterns){
      const m = re.exec(plain);
      if (m){
        return {found:true, value: String(repl).replace("xote", m[1] ?? "")};
      }
    }
    return {found:false, value:origHtml};
  };
}

/** Переводит тексты в .best, .content p и .content button (включая главную) */
function applyBoxTranslations(inner, lang, dict){
  const translate = makeTranslator(dict);
  let out = inner;

  // 1) Перевод всех .best
  out = out.replace(
    /(<div\b[^>]*class\s*=\s*["'][^"']*\bbest\b[^"']*["'][^>]*>)([\s\S]*?)(<\/div>)/gi,
    (m, open, txt, close) => {
      const res = translate(txt);
      return open + (res.found ? res.value : txt) + close;
    }
  );

  // 2) Перевод <p> и <button> внутри .content
  out = out.replace(
    /(<div\b[^>]*class\s*=\s*["'][^"']*\bcontent\b[^"']*["'][^>]*>)([\s\S]*?)(<\/div>)/gi,
    (m, open, body, close) => {
      let region = body.replace(/(<p\b[^>]*>)([\s\S]*?)(<\/p>)/gi, (_m, pOpen, txt, pClose) => {
        const res = translate(txt);
        return pOpen + (res.found ? res.value : txt) + pClose;
      });
      region = region.replace(/(<button\b[^>]*>)([\s\S]*?)(<\/button>)/gi, (_m, bOpen, txt, bClose) => {
        const res = translate(txt);
        return bOpen + (res.found ? res.value : txt) + bClose;
      });
      return open + region + close;
    }
  );

  return out;
}

/* ---------- [NEW] Перевод текстов внутри <a.review-button> на es|pt|tr|hi ---------- */
// why: переносим боксы с en → локаль; нужно заменить Read More / Visit / Simillar на локальные
const RB_LABELS = {
  es: { read: "Leer más", visit: "Visitar", similar: "Similares" },
  pt: { read: "Ler mais", visit: "Visitar", similar: "Semelhantes" },
  tr: { read: "Devamını oku", visit: "Ziyaret et", similar: "Benzer" },
  hi: { read: "और पढ़ें", visit: "दौरा करें", similar: "समान" }
};
function getReviewButtonLabel(lang, type){
  const L = String(lang || "").toLowerCase();
  const pack = RB_LABELS[L];
  if (!pack) return null;
  if (type === "visit") return pack.visit;
  if (type === "similar") return pack.similar;
  return pack.read;
}
function translateReviewButtonsSpans(inner, lang){
  if (!RB_LABELS[String(lang).toLowerCase()]) return inner;

  // Нормализатор textContent для сравнения
  const textify = (html) => normalizeText(stripHtml(html));

  return inner.replace(
    /(<a\b([^>]*?\bclass\s*=\s*["'][^"']*\breview-button\b[^"']*["'][^>]*?)>)([\s\S]*?)(<\/a>)/gi,
    (full, openStart, attrsPart, innerHtml, closeTag) => {
      const clsM = attrsPart.match(/\bclass\s*=\s*(["'])([^"']*)\1/i);
      const classes = new Set((clsM ? clsM[2] : "").split(/\s+/).filter(Boolean));
      if (!classes.has("review-button")) return full;
      if (classes.has("mirror-visit")) return full; // не трогаем "зеркала"

      // Определяем тип
      let type = "read";
      if (classes.has("visit")) {
        type = "visit";
      } else {
        const aria = (attrsPart.match(/\baria-label\s*=\s*(["'])(.*?)\1/i)?.[2]) || "";
        if (/Similar|Альтернатив/i.test(aria)) type = "similar";
      }

      const label = getReviewButtonLabel(lang, type);
      if (!label) return full; // нецелевой язык

      // Уже локализовано? — оставляем
      if (textify(innerHtml) === normalizeText(label)) return full;

      // Вкладываем ровно один <span>...</span>
      return `${openStart}<span>${label}</span>${closeTag}`;
    }
  );
}

/* ---------- main ---------- */
(async function main(){
  const { root, langs, dry, verbose, debugOne, limit } = parseArgs(process.argv.slice(2));

  let targets = debugOne ? [debugOne] : await listLocalizedHtmlFiles(root, langs);
  if (limit > 0) targets = targets.slice(0, limit);
  if (!targets.length){ console.error("No localized targets found."); process.exit(2); }

  console.log(`Found ${targets.length} localized HTML files`);
  let updated=0, skipped=0;

  for (const rel of targets){
    const lang = langFromRel(rel);
    const protoRel = protoFromLocalized(rel);
    const [protoFull, targetFull] = [abs(root, protoRel), abs(root, rel)];
    if (!(await exists(protoFull))){ if (verbose) console.log(`[MISS PROTO] ${protoRel}`); skipped++; continue; }

    const [protoHtml, targetHtml] = await Promise.all([readUtf8(protoFull), readUtf8(targetFull).catch(()=>"" )]);
    if (!targetHtml){ if (verbose) console.log(`[MISS TARGET] ${rel}`); skipped++; continue; }

    const protoH = extractHolder(protoHtml);
    const targetH = extractHolder(targetHtml);
    if (!protoH || !targetH){ if (verbose) console.log(`[NO HOLDER] ${!protoH?protoRel:rel}`); skipped++; continue; }

    // 1) копируем inner 1:1
    let newHtml = targetHtml.slice(0, targetH.openEnd) + protoH.inner + targetHtml.slice(targetH.closeStart);

    // 2) локализация ссылок по правилам + перевод <span> в .review-button
    newHtml = withHolderInner(newHtml, (inner) => {
      let out = inner;

      // обычные страницы
      if (lang === "es" || lang === "tr"){
        out = localizeLogobgAnchors(out, lang);
        out = localizeReviewButtons(out, lang);
      }
      if (lang === "es" || lang === "tr" || lang === "pt" || lang === "hi"){
        // more-content: ссылки + префиксы
        out = localizeMoreContent(out, lang);
        // mods-box: префиксы в href + перевод подписей
        out = localizeModsBox(out, lang);
        out = translateModsBoxTitles(out, lang);

        // ✨ перевод надписей в <a class="review-button">...</a>
        out = translateReviewButtonsSpans(out, lang);
      }

      // главная — доп. специфичные блоки (main-mode selection, навигация)
      if (isLocalizedHome(rel)){
        out = localizeMainModeSelection(out, lang);   // только href, кроме .topics
        out = localizeBoxesHolderNameNav(out, lang);  // моды + More
      }

      return out;
    });


    // 3) переводы текста (как в клиентском скрипте)
    if (lang !== "en"){
      const dict = await loadTranslations(root, lang);
      if (dict){
        newHtml = withHolderInner(newHtml, (inner) => applyBoxTranslations(inner, lang, dict));
      } else if (verbose){
        console.log(`[NO TRANSLATIONS] /code-parts/main-translations/${lang}.json`);
      }
    }

    // 3b) проставляем lang-* на .main-mode
    newHtml = withHolderInner(newHtml, (inner) => fixMainModeLangClasses(inner, lang));

    // Итог: пишем только при изменениях
    if (newHtml !== targetHtml){
      if (!dry) await fs.writeFile(targetFull, newHtml, "utf8");
      console.log(`[OK] ${rel}  ←  ${protoRel}`);
      updated++;
    } else {
      if (verbose) console.log(`[UNCHANGED] ${rel}`);
      skipped++;
    }
  }

  console.log(`\nDone. Updated: ${updated}, skipped: ${skipped}, processed: ${targets.length}`);
})().catch(e=>{ console.error(e); process.exit(1); });
