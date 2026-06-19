// 매일 08:00 작업 스케줄러가 실행하는 통합 수집 러너.
// 두 수집기를 순차 실행 (하나 실패해도 다른 하나는 계속).

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const scripts = [
  "kovan-tr-scraper.mjs",
  "ddwm-tr-scraper.mjs",
  "kovan-inactive-scraper.mjs",
  "ddwm-inactive-scraper.mjs",
];

function run(script) {
  return new Promise((resolve) => {
    console.log(`\n=== ${script} ===`);
    const c = spawn(process.execPath, [join(__dirname, script)], {
      cwd: dirname(__dirname),
      stdio: "inherit",
    });
    c.on("close", (code) => {
      if (code !== 0) console.error(`⚠️ ${script} 실패 (code ${code})`);
      resolve(code);
    });
    c.on("error", (e) => {
      console.error(`⚠️ ${script} 실행 오류: ${e.message}`);
      resolve(1);
    });
  });
}

for (const s of scripts) await run(s);
console.log("\n완료.");
