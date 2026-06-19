// DDWM(다우데이타) 거래 건수(월별) 수집기 — 가맹점 일별실적 엑셀 파싱.
// 로그인 → 월별(1~현재월) 조회 → 엑셀의 '합계' 행 '합계 건수' = 그 달 대리점 전체 거래건수.

import "dotenv/config";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chromium } from "playwright";
import * as XLSX from "xlsx";
import { ddwmLogin } from "./lib/ddwm-login.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "data", "tr-ddwm.json");
const PAGE = "https://van.daoudata.co.kr/pview/Result/Partner/frmLst_merchDayTran";

const norm = (s) => String(s ?? "").trim();
const toNum = (s) => Number(String(s).replace(/[^0-9.-]/g, "")) || 0;

// 엑셀 grid에서 '합계' 행의 '합계 건수' 추출
function monthCount(grid) {
  const h0 = (grid[0] || []).map(norm);
  const h1 = (grid[1] || []).map(norm);
  let col = -1;
  for (let i = 0; i < h0.length; i++) {
    if (h0[i] === "합계" && h1[i] === "건수") { col = i; break; }
  }
  if (col < 0) col = 9; // 관측된 기본 위치
  const totalRow = [...grid].reverse().find((r) => norm(r[0]) === "합계");
  if (!totalRow) throw new Error("엑셀에서 '합계' 행을 찾지 못했습니다.");
  return toNum(totalRow[col]);
}

async function queryMonthCount(page, ym) {
  await page.fill("#selectMonth", ym);
  await page.click("a.searchDD");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(2000);
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 40000 }),
    page.click("a.saveExcel"),
  ]);
  const wb = XLSX.read(readFileSync(await download.path()), { type: "buffer" });
  const grid = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
    header: 1,
    blankrows: false,
    defval: "",
  });
  return monthCount(grid);
}

async function main() {
  const now = new Date();
  const year = now.getFullYear();
  const curMonth = now.getMonth() + 1;

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, acceptDownloads: true });
  const page = await ctx.newPage();
  try {
    await ddwmLogin(page);
    await page.goto(PAGE, { waitUntil: "networkidle", timeout: 40000 });
    await page.waitForTimeout(1500);

    const monthly = [];
    for (let m = 1; m <= curMonth; m++) {
      const ym = `${year}-${String(m).padStart(2, "0")}`;
      const count = await queryMonthCount(page, ym);
      monthly.push({ month: m, count });
      console.log(`  ${ym}: ${count.toLocaleString()}건`);
    }
    const total = monthly.reduce((s, x) => s + x.count, 0);
    const avg = monthly.length ? total / monthly.length : 0;

    await mkdir(dirname(OUT), { recursive: true });
    await writeFile(
      OUT,
      JSON.stringify({ van: "DAOUDATA", updatedAt: now.toISOString(), year, monthly, total, avg }, null, 2)
    );
    console.log(`✅ 저장: ${OUT} (총 ${total.toLocaleString()}건, 월평균 ${Math.round(avg).toLocaleString()}건)`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
