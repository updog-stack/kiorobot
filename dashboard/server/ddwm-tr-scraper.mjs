// DDWM(다우데이타) 월별 거래 건수 + 금액 수집기 — 가맹점 일별실적 엑셀 파싱.
// 로그인 → 대상 연도(들)의 월별 조회 → 엑셀 '합계' 행의 '합계 건수'/'합계 금액' 추출.
// 다년도 저장: server/data/tr-ddwm.json { van, updatedAt, years: { "2025": {...}, "2026": {...} } }
//
// 대상 연도 지정: 인자 또는 DDWM_YEARS 환경변수(콤마구분). 미지정 시 올해만.
//   예) node ddwm-tr-scraper.mjs 2025,2026

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

// 엑셀 grid에서 '합계' 행의 '합계 건수' + '합계 금액' 추출
function monthStats(grid) {
  const h0 = (grid[0] || []).map(norm);
  const h1 = (grid[1] || []).map(norm);
  let cntCol = -1, amtCol = -1;
  for (let i = 0; i < h0.length; i++) {
    if (h0[i] === "합계" && h1[i] === "건수" && cntCol < 0) cntCol = i;
    if (h0[i] === "합계" && h1[i] === "금액" && amtCol < 0) amtCol = i;
  }
  if (cntCol < 0) cntCol = 9; // 관측된 기본 위치
  if (amtCol < 0) amtCol = 10;
  const totalRow = [...grid].reverse().find((r) => norm(r[0]) === "합계");
  if (!totalRow) throw new Error("엑셀에서 '합계' 행을 찾지 못했습니다.");
  return { count: toNum(totalRow[cntCol]), amount: toNum(totalRow[amtCol]) };
}

async function queryMonth(page, ym) {
  await page.fill("#selectMonth", ym);
  await page.click("a.searchDD");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(2000);
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 40000 }),
    page.click("a.saveExcel"),
  ]);
  const wb = XLSX.read(readFileSync(await download.path()), { type: "buffer" });
  const grid = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false, defval: "" });
  return monthStats(grid);
}

function targetYears() {
  const arg = process.argv[2] || process.env.DDWM_YEARS || "";
  const ys = arg.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => n >= 2020 && n <= 2100);
  return ys.length ? [...new Set(ys)].sort() : [new Date().getFullYear()];
}

async function main() {
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;
  const years = targetYears();

  // 기존 데이터 읽어 병합(지정 안 한 연도 보존)
  let store = { van: "DAOUDATA", years: {} };
  try {
    const prev = JSON.parse(readFileSync(OUT, "utf8"));
    if (prev.years) store.years = prev.years;
    else if (prev.year && prev.monthly) store.years[prev.year] = { monthly: prev.monthly, total: prev.total, avg: prev.avg }; // 구버전 이관
  } catch {}

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, acceptDownloads: true });
  const page = await ctx.newPage();
  try {
    await ddwmLogin(page);
    await page.goto(PAGE, { waitUntil: "networkidle", timeout: 40000 });
    await page.waitForTimeout(1500);

    for (const year of years) {
      const lastMonth = year < curYear ? 12 : year === curYear ? curMonth : 0;
      if (lastMonth < 1) continue;
      const monthly = [];
      for (let m = 1; m <= lastMonth; m++) {
        const ym = `${year}-${String(m).padStart(2, "0")}`;
        const { count, amount } = await queryMonth(page, ym);
        monthly.push({ month: m, count, amount });
        console.log(`  ${ym}: ${count.toLocaleString()}건 · ${amount.toLocaleString()}원`);
      }
      const total = monthly.reduce((s, x) => s + x.count, 0);
      const totalAmount = monthly.reduce((s, x) => s + x.amount, 0);
      const avg = monthly.length ? total / monthly.length : 0;
      store.years[year] = { monthly, total, totalAmount, avg };
      console.log(`✅ ${year}: 총 ${total.toLocaleString()}건 · ${totalAmount.toLocaleString()}원`);
    }

    store.updatedAt = now.toISOString();
    await mkdir(dirname(OUT), { recursive: true });
    await writeFile(OUT, JSON.stringify(store, null, 2));
    console.log(`✅ 저장: ${OUT} (연도: ${Object.keys(store.years).join(", ")})`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
