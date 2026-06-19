// KOVAN CATECA 일별 TR현황 자동 수집기
//
// 매일 08:00 윈도우 작업 스케줄러가 실행 → 로그인 → 월별 조회(올해)
// → 대리점코드 KOVAN_AGENCY 의 월별 건수 추출 → server/data/tr.json 저장.
// BFF /api/tr 가 대시보드에 제공.
//
// 필요: .env 의 KOVAN_ID / KOVAN_PW / KOVAN_AGENCY
//
// 구조(확인됨): 일별TR현황(/nKIMOS/mTLF/TrDaily.aspx)에서 '월별' 선택 후 조회하면
//   #GridView1 에 [순번, 대리점, 대리점명, 합계, 1월~12월] 형태로 그 해 전체가 월별로 나옴.
//   대리점코드 행(KOVAN_AGENCY)을 읽어 월별 건수를 집계.

import "dotenv/config";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "data", "tr.json");

const {
  KOVAN_ID,
  KOVAN_PW,
  KOVAN_AGENCY = "A25700",
  KOVAN_TRAN = "A", // A=카드+현금, B=카드, C=현금
} = process.env;
if (!KOVAN_ID || !KOVAN_PW) {
  console.error("❌ .env 에 KOVAN_ID / KOVAN_PW 가 필요합니다.");
  process.exit(1);
}

const LOGIN_URL = "https://cateca.kovan.com/nKIMOS/Default.aspx";
const TR_URL = "https://cateca.kovan.com/nKIMOS/mTLF/TrDaily.aspx";

const toNum = (s) => {
  const n = Number(String(s).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

async function login(page) {
  await page.goto(LOGIN_URL, { waitUntil: "networkidle", timeout: 30000 });
  await page.fill("#txtUserid", KOVAN_ID);
  await page.fill("#txtPasswd", KOVAN_PW);
  await Promise.all([
    page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {}),
    page.click("#btnLogin"),
  ]);
  await page.waitForTimeout(2000);
  if (await page.$("#txtPasswd")) throw new Error("로그인 실패 (ID/PW 확인)");
}

// 월별 모드로 한 해를 조회 → 대리점코드 행의 월별 건수 + 총합 반환
async function queryYear(page, year) {
  await page.goto(TR_URL, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(800);

  // '월별' 라디오 (자동 postback 여유)
  await page.check("#ard2").catch(() => {});
  await page.waitForTimeout(500);
  await page.selectOption("#TranList", KOVAN_TRAN).catch(() => {});
  await page.waitForTimeout(400);
  await page.selectOption("#YearList", String(year)).catch(() => {});
  await page.waitForTimeout(400);
  await page.selectOption("#CodeList", "D").catch(() => {}); // 그룹핑: 대리점코드
  await page.fill("#textFind", KOVAN_AGENCY).catch(() => {});

  await Promise.all([
    page.waitForLoadState("networkidle").catch(() => {}),
    page.click("#btnFind"),
  ]);
  await page.waitForTimeout(1200);

  // #GridView1: 모든 대리점 행(A25700 + 하위 A25701 …)을 월별로 합산 = 총합
  const parsed = await page.evaluate(() => {
    const t = document.getElementById("GridView1");
    if (!t || t.rows.length < 2) return null;
    const rows = [...t.rows].map((r) => [...r.cells].map((c) => c.innerText.trim()));
    const header = rows[0];
    const monthCols = header
      .map((h, i) => (/^\d+월$/.test(h) ? { m: parseInt(h, 10), i } : null))
      .filter(Boolean);
    const num = (s) => Number(String(s).replace(/[^0-9.-]/g, "")) || 0;
    const dataRows = rows.slice(1);
    return {
      rowCount: dataRows.length,
      months: monthCols.map(({ m, i }) => ({
        month: m,
        count: dataRows.reduce((s, r) => s + num(r[i]), 0),
      })),
    };
  });

  if (!parsed) throw new Error("결과 그리드(#GridView1)를 찾지 못했습니다.");
  console.log(`  (대리점 ${parsed.rowCount}개 합산 = 총합)`);
  return parsed.months.map((x) => ({ month: x.month, count: x.count }));
}

async function main() {
  const now = new Date();
  const year = now.getFullYear();
  const curMonth = now.getMonth() + 1;

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  try {
    await login(page);
    const all = await queryYear(page, year);
    // 올해 1월~현재월만
    const monthly = all.filter((m) => m.month >= 1 && m.month <= curMonth);
    const total = monthly.reduce((s, x) => s + x.count, 0);
    const avg = monthly.length ? total / monthly.length : 0;

    monthly.forEach((m) =>
      console.log(`  ${year}-${String(m.month).padStart(2, "0")}: ${m.count.toLocaleString()}건`)
    );

    await mkdir(dirname(OUT), { recursive: true });
    await writeFile(
      OUT,
      JSON.stringify(
        { updatedAt: now.toISOString(), agency: KOVAN_AGENCY, year, monthly, total, avg },
        null,
        2
      )
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
