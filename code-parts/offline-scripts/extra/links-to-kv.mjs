// FILE: scripts/links-to-kv.mjs
/**
 * Конвертирует карту {"slug":"https://..."} → bulk JSON [{key,value}] для KV.
 * Почему: формат bulk JSON Cloudflare ожидает массив объектов { key, value }.
 *
 * Примеры:
 *   node scripts/links-to-kv.mjs --in code-parts/sites-links.json --out ./.tmp/links-bulk.json
 *   node scripts/links-to-kv.mjs --in code-parts/sites-links.json --out ./.tmp/links-bulk.json --upload --binding LINKS_MAP
 *   node scripts/links-to-kv.mjs -i code-parts/sites-links.json -o links-bulk.json --upload --namespace-id 6b25f4bd...
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === "--in" || a === "-i") out.in = next, i++;
    else if (a === "--out" || a === "-o") out.out = next, i++;
    else if (a === "--upload") out.upload = true;
    else if (a === "--binding") out.binding = next, i++;
    else if (a === "--namespace-id") out.namespaceId = next, i++;
  }
  return out;
}

function fail(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

const args = parseArgs(process.argv);

// Входной JSON (по умолчанию — из корня репо)
const inPath = path.resolve(process.cwd(), args.in ?? "code-parts/sites-links.json");

// Куда писать (по умолчанию — рядом с репо в links-bulk.json, либо системный tmp)
const defaultOut = path.resolve(process.cwd(), "links-bulk.json");
let outPath = args.out
  ? path.resolve(process.cwd(), args.out)
  : defaultOut;

// Создадим каталог для outPath (Windows-friendly)
fs.mkdirSync(path.dirname(outPath), { recursive: true });

if (!fs.existsSync(inPath)) fail(`Input file not found: ${inPath}`);

let map;
try {
  map = JSON.parse(fs.readFileSync(inPath, "utf-8"));
} catch (e) {
  fail(`Failed to read/parse JSON at ${inPath}: ${e.message}`);
}

if (map == null || typeof map !== "object" || Array.isArray(map)) {
  fail("Input JSON must be an object map: { \"slug\": \"https://...\" }");
}

const arr = Object.entries(map).map(([key, value]) => ({ key, value }));
fs.writeFileSync(outPath, JSON.stringify(arr));
console.log(`KV bulk file written: ${outPath} • ${arr.length} items`);

if (args.upload) {
  // почему: запускаем wrangler только если явно попросили
  const wranglerArgs = ["kv:bulk", "put", outPath];
  if (args.binding) wranglerArgs.unshift("--binding", args.binding);
  if (args.namespaceId) wranglerArgs.unshift("--namespace-id", args.namespaceId);
  const res = spawnSync("wrangler", wranglerArgs, { stdio: "inherit", shell: true });
  process.exit(res.status ?? 0);
}
