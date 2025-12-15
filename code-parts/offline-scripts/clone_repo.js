#!/usr/bin/env node
'use strict';

const fs = require('fs/promises');
const fssync = require('fs');
const path = require('path');
const crypto = require('crypto');
const TRANSFORM_VERSION = '2025-12-15-v2-metrica-safe';

const SCRIPT_DIR = __dirname;

// default:
// C:\Users\xh\Documents\GitHub\CSGOBROKER\code-parts\offline-scripts\sync-to-brokerco.js
// sourceRoot = ...\CSGOBROKER
const DEFAULT_SRC = path.resolve(SCRIPT_DIR, '..', '..');
const DEFAULT_DEST = path.resolve(DEFAULT_SRC, '..', 'BROKERCO');

const MANIFEST_NAME = '.brokerco-sync.json';

// Excluded root directories (as requested)
const EXCLUDED_ROOT_DIRS = new Set([
  'sitemaps_co',
  'sitemaps_com',
  'sitemaps_me',
  '.codegpt',
  '.tmp',
  'cn',
]);

// By default we do NOT copy .git folder (safe). Enable via --include-git
const DEFAULT_EXCLUDE_GIT = true;

// Domain/token rewrite
const FROM_DOMAIN = 'csgobroker.co';
const TO_DOMAIN = 'csgobroker.co';

const CF_TOKEN_CC = 'a11687be24f7402dbdc337d5094ad450';
const CF_TOKEN_CO = 'a11687be24f7402dbdc337d5094ad450';

// --- CLI --------------------------------------------------------------------
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--src') out.src = argv[++i];
    else if (a === '--dest') out.dest = argv[++i];
    else if (a === '--include-git') out.includeGit = true;
    else if (a === '--mirror') out.mirror = true; // delete extraneous files in dest (optional)
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function printHelp() {
  console.log(`
Usage:
  node sync-to-brokerco.js

Options:
  --src "C:\\Users\\xh\\Documents\\GitHub\\CSGOBROKER"
  --dest "C:\\Users\\xh\\Documents\\GitHub\\BROKERCO"
  --include-git     Copy .git folder too (off by default)
  --mirror          Also delete files in DEST that are not in SRC (except excluded dirs)
`);
}

// --- Utils ------------------------------------------------------------------
function toPosixRel(p) {
  return p.split(path.sep).join('/');
}

function joinFromPosix(root, relPosix) {
  return path.join(root, ...relPosix.split('/'));
}

function isExcludedRoot(relPosix, excludeGit) {
  if (!relPosix) return false;
  const first = relPosix.split('/')[0];
  if (first === '.git') return true;
  if (EXCLUDED_ROOT_DIRS.has(first)) return true;
  if (excludeGit && first === '.git') return true;
  return false;
}

function isTextExtension(relPosix) {
  const base = path.basename(relPosix).toLowerCase();
  if (base === 'cname') return true;

  const ext = path.extname(base);
  // treat as text
  return new Set([
    '.html', '.htm',
    '.xml',
    '.txt',
    '.js', '.mjs', '.cjs',
    '.css',
    '.json',
    '.md',
    '.yml', '.yaml',
    '.svg',
    '.ts', '.tsx', '.jsx',
    '.php',
    '.py',
    '.sh', '.bat', '.ps1',
    '.env',
    '.map',
  ]).has(ext);
}

function isBinaryBuffer(buf) {
  // Heuristic: contains NULL byte
  const len = Math.min(buf.length, 4096);
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function fileExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function safeStat(p) {
  try { return await fs.stat(p); } catch { return null; }
}

async function ensureDirForFile(absFilePath) {
  const dir = path.dirname(absFilePath);
  await fs.mkdir(dir, { recursive: true });
}

// --- Transformations ---------------------------------------------------------
function stripYandexMetrica(content) {
  // ВАЖНО: не пересекаем </script> и </noscript>
  const metricaScriptRe =
    /<script\b[^>]*>(?:(?!<\/script>)[\s\S])*?mc\.yandex\.ru\/metrika\/tag\.js(?:(?!<\/script>)[\s\S])*?<\/script>\s*/gi;

  const metricaNoScriptRe =
    /<noscript\b[^>]*>(?:(?!<\/noscript>)[\s\S])*?mc\.yandex\.ru\/watch\/93265864(?:(?!<\/noscript>)[\s\S])*?<\/noscript>\s*/gi;

  return content.replace(metricaScriptRe, '').replace(metricaNoScriptRe, '');
}

function rewriteDomainAndTokensEverywhere(content, relPosix) {
  // domain
  content = content.replace(/csgobroker\.cc/gi, 'csgobroker.co');
  // cloudflare token cc -> co
  content = content.replace(new RegExp(CF_TOKEN_CC, 'g'), CF_TOKEN_CO);

  const ext = path.extname(relPosix).toLowerCase();
  if (ext === '.html' || ext === '.htm') {
    content = stripYandexMetrica(content);
  }

  return content;
}

function transformSeoRewriteJs(content) {
  // Make it "co-only" and remove any .cc-specific behavior safely.

  // 1) force co-only domains/tokens/names
  content = content.replace(
    /var\s+DISABLE_IDX\s*=\s*['"][^'"]*['"]\s*;/,
    `var DISABLE_IDX = '';`
  );

  content = content.replace(
    /var\s+DOMAINS\s*=\s*\[[\s\S]*?\]\s*;/,
    `var DOMAINS = ['csgobroker.co'];`
  );

  content = content.replace(
    /var\s+TOKENS\s*=\s*\{[\s\S]*?\}\s*;/,
    `var TOKENS = { 'csgobroker.co': '${CF_TOKEN_CO}' };`
  );

  content = content.replace(
    /var\s+SITE_NAMES\s*=\s*\{[\s\S]*?\}\s*;/,
    `var SITE_NAMES = { 'csgobroker.co': 'CSGOBROKER' };`
  );

  // 2) remove/neutralize isCc and its early-exit section
  content = content.replace(/var\s+isCc\s*=\s*[^;]+;/, `var isCc = false;`);

  // remove the whole section "EARLY EXITS FOR .CC" if present (by headings)
  content = content.replace(
    /\/\/\s*---\s*РАННИЕ\s+ВЫХОДЫ\s+ДЛЯ\s+\.CC[\s\S]*?(?=\/\/\s*---\s*CANONICAL)/i,
    ''
  );

  // 3) in Yandex noindex block, remove "except .cc" condition if it exists
  content = content.replace(/d\s*!==\s*['"]csgobroker\.cc['"]\s*&&\s*/gi, '');

  // 4) finally: remove any leftover ".cc" mentions in comments/text
  content = content.replace(/csgobroker\.cc/gi, 'csgobroker.co');

  // also ensure cc token isn't present
  content = content.replace(new RegExp(CF_TOKEN_CC, 'g'), CF_TOKEN_CO);

  // metrica removal (just in case)
  content = stripYandexMetrica(content);

  return content;
}

function transformTextByPath(relPosix, text) {
  const base = path.basename(relPosix).toLowerCase();

  if (base === 'cname') {
    // Force exact
    return 'csgobroker.co\n';
  }

  // Special handling for public/seo-rewrite.js
  if (relPosix.toLowerCase().endsWith('public/seo-rewrite.js') || base === 'seo-rewrite.js') {
    return transformSeoRewriteJs(text);
  }

  return rewriteDomainAndTokensEverywhere(text, relPosix);
}

// --- Manifest ---------------------------------------------------------------
async function loadManifest(destRoot) {
  const p = path.join(destRoot, MANIFEST_NAME);
  try {
    const raw = await fs.readFile(p, 'utf8');
    const json = JSON.parse(raw);
    if (!json || typeof json !== 'object') throw new Error('Bad manifest');
    if (!json.files) json.files = {};
    return json;
  } catch {
    return {
      version: 1,
      createdAt: new Date().toISOString(),
      files: {},
    };
  }
}

async function saveManifest(destRoot, manifest) {
  const p = path.join(destRoot, MANIFEST_NAME);
  const out = JSON.stringify(manifest, null, 2);
  await fs.writeFile(p, out, 'utf8');
}

// --- Core sync --------------------------------------------------------------
async function removeExcludedDirsInDest(destRoot, excludeGit) {
  const roots = Array.from(EXCLUDED_ROOT_DIRS);
  for (const name of roots) {
    const target = path.join(destRoot, name);
    await fs.rm(target, { recursive: true, force: true });
  }
}

async function syncOneFile(absSrc, relPosix, absDest, manifest) {
  const srcStat = await fs.stat(absSrc);

  const rec = manifest.files[relPosix];
  const destStat = await safeStat(absDest);

  // Fast skip: source unchanged + dest untouched since last run
  if (
    rec &&
    rec.transformVersion === TRANSFORM_VERSION &&
    rec.srcMtimeMs === srcStat.mtimeMs &&
    rec.srcSize === srcStat.size &&
    destStat &&
    rec.destMtimeMs === destStat.mtimeMs &&
    rec.outSize === destStat.size
  ) {
    return { status: 'skipped-fast' };
  }

  // Decide text vs binary
  const treatAsText = isTextExtension(relPosix);
  const srcBuf = await fs.readFile(absSrc);

  let outBuf = srcBuf;

  if (treatAsText && !isBinaryBuffer(srcBuf)) {
    const srcText = srcBuf.toString('utf8');
    const outText = transformTextByPath(relPosix, srcText);
    outBuf = Buffer.from(outText, 'utf8');
  }

  const outHash = sha256(outBuf);

  // If dest exists and content identical -> do not rewrite
  if (destStat && destStat.size === outBuf.length) {
    const destBuf = await fs.readFile(absDest);
    const destHash = sha256(destBuf);
    if (destHash === outHash) {
      // update manifest to allow fast-skip next time
      manifest.files[relPosix] = {
        transformVersion: TRANSFORM_VERSION,
        srcMtimeMs: srcStat.mtimeMs,
        srcSize: srcStat.size,
        outHash,
        outSize: outBuf.length,
        destMtimeMs: destStat.mtimeMs,
      };
      return { status: 'skipped-same' };
    }
  }

  await ensureDirForFile(absDest);
  await fs.writeFile(absDest, outBuf);

  const newDestStat = await fs.stat(absDest);

  manifest.files[relPosix] = {
    srcMtimeMs: srcStat.mtimeMs,
    srcSize: srcStat.size,
    outHash,
    outSize: outBuf.length,
    destMtimeMs: newDestStat.mtimeMs,
  };

  return { status: 'written' };
}

async function walkAndSync(sourceRoot, destRoot, excludeGit, manifest, seen) {
  async function walkDir(absDir, relDirPosix) {
    const entries = await fs.readdir(absDir, { withFileTypes: true });

    // Ensure destination dir exists (keeps empty dirs too)
    if (relDirPosix) {
      const absDestDir = joinFromPosix(destRoot, relDirPosix);
      await fs.mkdir(absDestDir, { recursive: true });
    } else {
      await fs.mkdir(destRoot, { recursive: true });
    }

    for (const ent of entries) {
      const relChildPosix = relDirPosix ? `${relDirPosix}/${ent.name}` : ent.name;

      // Skip excluded root dirs
      if (isExcludedRoot(relChildPosix, excludeGit)) {
        continue;
      }

      const absChild = path.join(absDir, ent.name);

      if (ent.isDirectory()) {
        await walkDir(absChild, relChildPosix);
        continue;
      }

      if (!ent.isFile()) {
        continue; // ignore symlinks/etc
      }

      // Never copy manifest from source (only our dest file)
      if (relChildPosix === MANIFEST_NAME) continue;

      const absDestFile = joinFromPosix(destRoot, relChildPosix);
      seen.add(relChildPosix);

      const res = await syncOneFile(absChild, relChildPosix, absDestFile, manifest);

      counts.total++;
      if (res.status === 'written') counts.written++;
      else counts.skipped++;
    }
  }

  await walkDir(sourceRoot, '');
}

async function mirrorPrune(destRoot, excludeGit, seen) {
  // Deletes files in dest that are not present in source scan (seen),
  // but NEVER touches excluded root dirs.
  async function walkDest(absDir, relDirPosix) {
    const entries = await fs.readdir(absDir, { withFileTypes: true });
    for (const ent of entries) {
      const relChildPosix = relDirPosix ? `${relDirPosix}/${ent.name}` : ent.name;

      // Never touch excluded root dirs
      if (isExcludedRoot(relChildPosix, excludeGit)) continue;

      const absChild = path.join(absDir, ent.name);

      if (ent.isDirectory()) {
        await walkDest(absChild, relChildPosix);
        // remove dir if empty after pruning
        const left = await fs.readdir(absChild).catch(() => []);
        if (left.length === 0) {
          await fs.rmdir(absChild).catch(() => {});
        }
        continue;
      }

      if (!ent.isFile()) continue;

      if (relChildPosix === MANIFEST_NAME) continue;

      if (!seen.has(relChildPosix)) {
        await fs.rm(absChild, { force: true });
      }
    }
  }

  if (await fileExists(destRoot)) {
    await walkDest(destRoot, '');
  }
}

// --- Main -------------------------------------------------------------------
const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

const sourceRoot = path.resolve(args.src || DEFAULT_SRC);
const destRoot = path.resolve(args.dest || DEFAULT_DEST);
const excludeGit = !args.includeGit && DEFAULT_EXCLUDE_GIT;

const counts = { total: 0, written: 0, skipped: 0 };

(async () => {
  if (!fssync.existsSync(sourceRoot)) {
    console.error('SOURCE does not exist:', sourceRoot);
    process.exit(1);
  }

  await fs.mkdir(destRoot, { recursive: true });

  // Ensure excluded dirs are removed from destination (so they never "linger")
  await removeExcludedDirsInDest(destRoot, excludeGit);

  const manifest = await loadManifest(destRoot);
  manifest.lastRunAt = new Date().toISOString();
  manifest.sourceRoot = sourceRoot;
  manifest.destRoot = destRoot;
  manifest.rules = {
    fromDomain: FROM_DOMAIN,
    toDomain: TO_DOMAIN,
    cfTokenCc: CF_TOKEN_CC,
    cfTokenCo: CF_TOKEN_CO,
    excludedRootDirs: Array.from(EXCLUDED_ROOT_DIRS),
    excludeGit,
    mirror: !!args.mirror,
  };

  const seen = new Set();

  await walkAndSync(sourceRoot, destRoot, excludeGit, manifest, seen);

  if (args.mirror) {
    await mirrorPrune(destRoot, excludeGit, seen);
  }

  await saveManifest(destRoot, manifest);

  console.log('--- DONE ---');
  console.log('SRC :', sourceRoot);
  console.log('DEST:', destRoot);
  console.log('Files scanned :', counts.total);
  console.log('Files written :', counts.written);
  console.log('Files skipped :', counts.skipped);
  console.log('Manifest      :', path.join(destRoot, MANIFEST_NAME));
})().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
