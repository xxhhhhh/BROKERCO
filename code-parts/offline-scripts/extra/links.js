// File: links.js
// Usage: node links.js
// Purpose: Собрать ссылки из /code-parts/site-infos/*.json в /code-parts/sites-links.json

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const EXTRA_KEYS = new Set([
  'marketplaces',
  'buy-skins',
  'instant-sell',
  'sell-skins',
  'earn-by-play',
  'earn-by-play-en',
]);

const LINK_VARIANT_REGEX = /^link-([a-z0-9-]+)$/i;

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function isProbablyUrl(v) {
  // Почему: отсекаем мусор, но не слишком строго (поддержка http/https)
  return /^https?:\/\//i.test(v.trim());
}

async function readJsonSafe(filePath) {
  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    const cleaned = raw.replace(/^\uFEFF/, '');
    return JSON.parse(cleaned);
  } catch (e) {
    return { __error: e };
  }
}

async function main() {
  const rootDir = __dirname;
  const inputDir = path.resolve(rootDir, 'code-parts', 'site-infos');
  const outputDir = path.resolve(rootDir, 'code-parts');
  const outputFile = path.resolve(outputDir, 'sites-links.json');

  if (!fs.existsSync(inputDir) || !fs.statSync(inputDir).isDirectory()) {
    console.error(`❌ Не найдена директория: ${inputDir}`);
    process.exitCode = 1;
    return;
  }

  const entries = await fsp.readdir(inputDir, { withFileTypes: true });
  const jsonFiles = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.json'))
    .map((e) => e.name);

  const result = Object.create(null);
  let parsedCount = 0;
  let warnings = 0;

  const addPair = (key, value, origin) => {
    if (!isNonEmptyString(value) || !isProbablyUrl(value)) return;
    const v = value.trim();
    if (key in result && result[key] !== v) {
      // Почему: сигналим о коллизии ключей из разных источников
      warnings++;
      console.warn(`⚠️ Конфликт значений для ключа "${key}" (${origin}). Перезапись.`);
    }
    result[key] = v;
  };

  for (const file of jsonFiles) {
    const fullPath = path.join(inputDir, file);
    const base = path.basename(file, path.extname(file));

    const data = await readJsonSafe(fullPath);
    if (data && !data.__error) parsedCount++;
    else {
      warnings++;
      console.warn(`⚠️ Невалидный JSON "${file}": ${data.__error?.message || 'unknown'}`);
      continue;
    }

    // 1) Базовый link → <base>
    if (isNonEmptyString(data.link)) {
      addPair(base, data.link, file);
    }

    // 2) Языковые варианты link-xx → <base>-xx
    for (const [k, v] of Object.entries(data)) {
      const m = LINK_VARIANT_REGEX.exec(k);
      if (m && isNonEmptyString(v)) {
        const suffix = m[1].toLowerCase();
        addPair(`${base}-${suffix}`, v, file);
      }
    }

    // 3) Специальные ключи → <base>-<key>
    for (const k of EXTRA_KEYS) {
      if (k in data && isNonEmptyString(data[k])) {
        addPair(`${base}-${k}`, data[k], file);
      }
    }
  }

  // Стабильная сортировка ключей
  const sortedKeys = Object.keys(result).sort((a, b) => a.localeCompare(b));
  const sortedObj = {};
  for (const k of sortedKeys) sortedObj[k] = result[k];

  const serialized = JSON.stringify(sortedObj, null, 2) + '\n';
  await fsp.mkdir(outputDir, { recursive: true });

  let wrote = false;
  try {
    const existing = await fsp.readFile(outputFile, 'utf8').catch(() => null);
    if (existing !== serialized) {
      await fsp.writeFile(outputFile, serialized, 'utf8');
      wrote = true;
    }
  } catch (err) {
    console.error(`❌ Ошибка записи "${outputFile}": ${err.message}`);
    process.exitCode = 1;
    return;
  }

  if (wrote) {
    console.log(`✅ Обновлён: ${outputFile}`);
  } else {
    console.log(`ℹ️ Без изменений: ${outputFile} уже актуален`);
  }
  console.log(`📦 Файлов: ${jsonFiles.length}, распарсено: ${parsedCount}`);
  console.log(`🔗 Ссылок собрано: ${Object.keys(sortedObj).length}`);
  if (warnings > 0) console.log(`⚠️ Предупреждений: ${warnings} (см. выше)`);
}

main().catch((e) => {
  console.error('❌ Непредвиденная ошибка:', e);
  process.exitCode = 1;
});
