// DDWM(다우데이타) 가맹점별 작년(2025) 매출 금액 집계 — merchDay 12개월 합계금액 누적.
// 결과: ddwm-sales-2025.json { year, byBiz: { 사업자번호: 금액 } } → BFF가 무실적 가맹점에 매칭.

import "dotenv/config";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chromium } from "playwright";
import * as XLSX from "xlsx";
import { ddwmLogin } from "./lib/ddwm-login.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PAGE = "https://van.daoudata.co.kr/pview/Result/Partner/frmLst_merchDayTran";
const YEAR = Number(process.env.DDWM_SALES_YEAR || new Date().getFullYear() - 1); // 기본: 작년
const OUT = join(__dirname, "data", `ddwm-sales-${YEAR}.json`);

const norm = (s) => String(s ?? "").trim();
const toNum = (s) => Number(String(s).replace(/[^0-9.-]/g, "")) || 0;

function accumulate(grid, byBiz) {
  const h0 = (grid[0] || []).map(norm);
  const h1 = (grid[1] || []).map(norm);
  const bizCol = h0.findIndex((h) => h === "사업자번호");
  let amtCol = -1;
  for (let i = 0; i < h0.length; i++) if (h0[i] === "합계" && h1[i] === "금액") { amtCol = i; break; }
  if (bizCol < 0 || amtCol < 0) throw new Error("merchDay 엑셀 헤더(사업자번호/합계금액)를 못 찾음");
  for (let i = 2; i < grid.length; i++) {
    const r = grid[i];
    const biz = norm(r[bizCol]).replace(/[^0-9]/g, "");
    if (biz.length !== 10) continue; // 합계행/빈행 제외
    byBiz[biz] = (byBiz[biz] || 0) + toNum(r[amtCol]);
  }
}

async function monthGrid(page, ym) {
  await page.fill("#selectMonth", ym);
  await page.click("a.searchDD");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(2000);
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 40000 }),
    page.click("a.saveExcel"),
  ]);
  const wb = XLSX.read(readFileSync(await download.path()), { type: "buffer" });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false, defval: "" });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, acceptDownloads: true });
  const page = await ctx.newPage();
  try {
    await ddwmLogin(page);
    await page.goto(PAGE, { waitUntil: "networkidle", timeout: 40000 });
    await page.waitForTimeout(1500);

    const byBiz = {};
    for (let m = 1; m <= 12; m++) {
      const ym = `${YEAR}-${String(m).padStart(2, "0")}`;
      const grid = await monthGrid(page, ym);
      accumulate(grid, byBiz);
      console.log(`  ${ym} 집계 완료 (누적 사업자 ${Object.keys(byBiz).length}곳)`);
    }
    const total = Object.values(byBiz).reduce((s, x) => s + x, 0);

    await mkdir(dirname(OUT), { recursive: true });
    await writeFile(OUT, JSON.stringify({ year: YEAR, updatedAt: new Date().toISOString(), byBiz }, null, 2));
    console.log(`✅ 저장: ${OUT} (사업자 ${Object.keys(byBiz).length}곳, 합계 ${total.toLocaleString()}원)`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
