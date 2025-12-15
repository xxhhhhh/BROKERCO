// File: scripts/run-offline-scripts.js

/**
 * Простая обертка для последовательного запуска скриптов Node.
 * Использование:
 *   node scripts/run-offline-scripts.js [--dir <path>] [--start <name.js>] [--only <a.js,b.js>]
 *                                       [--continue-on-error] [--timeout <ms>] [--help]
 *
 * Примеры:
 *   node scripts/run-offline-scripts.js
 *   node scripts/run-offline-scripts.js --start schema_main.js
 *   node scripts/run-offline-scripts.js --only schema_main.js,schema_review.js --continue-on-error
 *   node scripts/run-offline-scripts.js --dir ./code-parts/offline-scripts --timeout 600000
 *
 * Почему spawn(node, file): единый способ исполнения .js с текущей версией Node, без зависимости от execute-битов.
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ORDER = [
  "static-topics-fill.js",
  "schema-guides.js",
  "schema-main.js",
  "schema-review.js",
  "freebies-fill.js",
  "static-pages-fill.js",
  "alt-langs.js",
  "build-search-config.js",
  "meta-and-sitemap.js",
];

const HELP_TEXT = `
Run offline scripts sequentially.

Options:
  --dir <path>              Директория со скриптами (по умолчанию ./code-parts/offline-scripts).
  --start <name.js>         Начать с указанного файла (включительно).
  --only <a.js,b.js>        Запустить только перечисленные файлы в указанном порядке, но валидировать наличие в ORDER.
  --continue-on-error       Не останавливать цепочку при не-нулевом exit code скрипта.
  --timeout <ms>            Таймаут на каждый скрипт (0 — без таймаута).
  --help                    Показать эту справку.
`.trim();

function parseArgs(argv) {
  const args = new Map();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq !== -1) {
      args.set(a.slice(0, eq), a.slice(eq + 1));
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args.set(a, next);
      i++;
    } else {
      args.set(a, true);
    }
  }
  return args;
}

function resolveDir(cliDir) {
  if (cliDir) return path.resolve(process.cwd(), cliDir);
  // Важно: не использовать абсолютный "/code-parts/..." чтобы не зависеть от корня FS.
  return path.resolve(process.cwd(), "code-parts", "offline-scripts");
}

function filterOrder(order, { onlyList, startFrom }) {
  let list = [...order];

  if (onlyList && onlyList.length) {
    const set = new Set(order); // защита от опечаток
    const invalid = onlyList.filter((n) => !set.has(n));
    if (invalid.length) {
      throw new Error(
        `--only содержит имена вне фиксированного ORDER: ${invalid.join(", ")}`
      );
    }
    list = onlyList;
  }

  if (startFrom) {
    const idx = list.indexOf(startFrom);
    if (idx === -1) {
      throw new Error(
        `--start '${startFrom}' не найден в целевом списке запуска.`
      );
    }
    list = list.slice(idx);
  }

  return list;
}

function exists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function runNodeScript(absPath, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [absPath], {
      stdio: "inherit",
      env: process.env,
    });

    let timeoutHandle = null;
    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        // Почему SIGTERM: даем шанс корректно завершиться.
        child.kill("SIGTERM");
      }, timeoutMs);
    }

    child.on("exit", (code, signal) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      const durationMs = Date.now() - started;
      resolve({ code: code ?? 0, signal: signal ?? null, durationMs });
    });

    child.on("error", (err) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      const durationMs = Date.now() - started;
      // Квазикод 127 для "не удалось запустить".
      resolve({ code: 127, signal: null, durationMs, error: err });
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.has("--help")) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  const dir = resolveDir(args.get("--dir"));
  const continueOnError = args.has("--continue-on-error");
  const timeoutMs = Number(args.get("--timeout") ?? 0) || 0;

  const onlyList = (args.get("--only") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const startFrom = args.get("--start");

  const runList = filterOrder(ORDER, { onlyList, startFrom });

  console.log(`Directory: ${dir}`);
  console.log(`Plan: ${runList.join(" → ")}`);
  if (timeoutMs > 0) {
    console.log(`Per-script timeout: ${timeoutMs} ms`);
  }
  if (continueOnError) {
    console.log(`Mode: continue on error`);
  }
  console.log("");

  let finalExitCode = 0;
  const summary = [];

  for (const name of runList) {
    const abs = path.join(dir, name);

    if (!exists(abs)) {
      console.error(`✖ Файл не найден: ${abs}`);
      summary.push({ name, status: "missing" });
      finalExitCode = finalExitCode || 2; // код "нет файла"
      if (!continueOnError) break;
      continue;
    }

    console.log(`▶ ${name}`);
    const { code, signal, durationMs, error } = await runNodeScript(
      abs,
      timeoutMs
    );

    if (error) {
      console.error(`✖ Ошибка запуска: ${name}: ${error.message}`);
    }

    if (signal) {
      console.error(
        `✖ ${name} завершен по сигналу ${signal} (${durationMs} ms)`
      );
      summary.push({ name, status: `signal:${signal}`, ms: durationMs });
      finalExitCode = finalExitCode || 128;
      if (!continueOnError) break;
      continue;
    }

    if (code !== 0) {
      console.error(`✖ ${name} exit code ${code} (${durationMs} ms)`);
      summary.push({ name, status: `exit:${code}`, ms: durationMs });
      finalExitCode = finalExitCode || code;
      if (!continueOnError) break;
      continue;
    }

    console.log(`✓ ${name} (${durationMs} ms)\n`);
    summary.push({ name, status: "ok", ms: durationMs });
  }

  // Итоговый отчет
  console.log("\nSummary:");
  for (const row of summary) {
    const ms = row.ms != null ? `${row.ms} ms` : "-";
    const mark = row.status === "ok" ? "✓" : "✖";
    console.log(`${mark} ${row.name}  [${row.status}]  ${ms}`);
  }

  process.exit(finalExitCode);
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
