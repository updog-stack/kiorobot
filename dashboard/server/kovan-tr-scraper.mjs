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
import { readFileSync } from "node:fs";
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
// 가맹점 금액구간집계(금액 제공) — 코밴은 TrDaily 에 금액이 없어 여기서 월별 금액을 별도 수집.
const FR_URL = "https://cateca.kovan.com/nKIMOS/mWork/fixedrate.aspx";

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
  await page.waitForSelector("#ard2", { timeout: 15000 });
  await page.waitForTimeout(800);

  // '월별' 라디오 → 자동 postback 완료까지 대기
  await page.check("#ard2").catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(800);
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
  // 결과 그리드가 실제로 채워질 때까지 대기(고정시간 대신 요소 대기)
  await page.waitForFunction(() => {
    const t = document.getElementById("GridView1");
    return t && t.rows && t.rows.length >= 2;
  }, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);

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

// fixedrate(가맹점 금액구간집계): 한 달 범위를 조회해 '총합계-합계' 금액을 반환.
//   · 신용+체크 카드 합계. 100만원 초과 절삭·1천원 이하 제외 → 근사치.
//   · KOVAN_AGENCY(관리코드) 기준 = 다인 + 하위대리점(아무도없개) 합산.
//   · 1년 이전 내역은 조회 불가 → null.
async function queryMonthAmount(page, year, month, lastDay) {
  const yy = String(year).slice(2);
  const mm = String(month).padStart(2, "0");
  const sdate = `${yy}${mm}01`;
  const edate = `${yy}${mm}${String(lastDay).padStart(2, "0")}`;
  await page.goto(FR_URL, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForSelector("#txtSdate", { timeout: 15000 });
  await page.fill("#txtSdate", sdate);
  await page.fill("#txtEdate", edate);
  await page.fill("#txtValue", KOVAN_AGENCY).catch(() => {});
  await Promise.all([
    page.waitForLoadState("networkidle").catch(() => {}),
    page.click("#btnSearch"),
  ]);
  await page.waitForTimeout(1500);
  return await page.evaluate(() => {
    const num = (s) => Number(String(s).replace(/[^0-9.-]/g, "")) || 0;
    for (const t of document.querySelectorAll("table")) {
      const rows = [...t.rows].map((r) => [...r.cells].map((c) => c.innerText.trim()));
      if (!rows.length || rows[0][0] !== "총합계") continue;
      const sum = rows.find((r) => r[0] === "합계");
      if (sum) return { amount: num(sum[2]), count: num(sum[1]) };
    }
    return null;
  });
}

// 대상 연도: 인자 또는 KOVAN_YEARS(콤마구분). 미지정 시 올해만.
function targetYears() {
  const arg = process.argv[2] || process.env.KOVAN_YEARS || "";
  const ys = arg.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => n >= 2020 && n <= 2100);
  return ys.length ? [...new Set(ys)].sort() : [new Date().getFullYear()];
}

async function main() {
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;
  const curDay = now.getDate();
  const years = targetYears();

  // 기존 데이터 병합(지정 안 한 연도 보존)
  let store = { agency: KOVAN_AGENCY, years: {} };
  try {
    const prev = JSON.parse(readFileSync(OUT, "utf8"));
    if (prev.years) store.years = prev.years;
    else if (prev.year && prev.monthly) store.years[prev.year] = { monthly: prev.monthly, total: prev.total, avg: prev.avg };
  } catch {}

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  try {
    await login(page);
    for (const year of years) {
      const prevYear = store.years[year];
      const all = await queryYear(page, year);
      const lastMonth = year < curYear ? 12 : year === curYear ? curMonth : 0;
      const monthly = all.filter((m) => m.month >= 1 && m.month <= lastMonth);

      // 월별 금액(fixedrate) 수집 — 1년 이내만 조회 가능, 실패 시 이전 저장값 유지
      for (const m of monthly) {
        const ageMonths = (curYear - year) * 12 + (curMonth - m.month);
        let amount = null;
        // 당월은 '어제'까지만 조회(fixedrate 는 당일 미정산분이 있으면 범위 전체를 0으로 반환).
        const isCurMonth = year === curYear && m.month === curMonth;
        const lastDay = isCurMonth ? curDay - 1 : new Date(year, m.month, 0).getDate();
        if (ageMonths >= 0 && ageMonths <= 12 && m.count > 0 && lastDay >= 1) {
          try {
            const r = await queryMonthAmount(page, year, m.month, lastDay);
            if (r && r.amount > 0) amount = r.amount;
          } catch (e) {
            console.log(`  (금액 조회 실패 ${year}-${m.month}: ${e.message})`);
          }
        }
        if (amount == null) {
          const p = prevYear?.monthly?.find((x) => x.month === m.month);
          if (p && p.amount) amount = p.amount;
        }
        if (amount != null) m.amount = amount;
      }

      const total = monthly.reduce((s, x) => s + x.count, 0);
      const avg = monthly.length ? total / monthly.length : 0;
      monthly.forEach((m) => console.log(`  ${year}-${String(m.month).padStart(2, "0")}: ${m.count.toLocaleString()}건${m.amount ? ` · ${m.amount.toLocaleString()}원` : ""}`));
      store.years[year] = { monthly, total, avg };
      console.log(`✅ ${year}: 총 ${total.toLocaleString()}건`);
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
