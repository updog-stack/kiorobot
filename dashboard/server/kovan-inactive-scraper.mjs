// KOVAN CATECA 무실적 가맹점현황 수집기
//
// 로그인 → 무실적 가맹점현황(/nKIMOS/mTLF/TrNo.aspx) → 대리점코드 조회(기준일자 D-1)
// → 전 페이지 순회하며 가맹점명·사업자번호 수집 → server/data/inactive.json 저장.
// BFF /api/inactive 가 대시보드에 제공.
//
// 필요: .env 의 KOVAN_ID / KOVAN_PW / KOVAN_AGENCY

import "dotenv/config";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "data", "inactive.json");

const { KOVAN_ID, KOVAN_PW, KOVAN_AGENCY = "A25700" } = process.env;
if (!KOVAN_ID || !KOVAN_PW) {
  console.error("❌ .env 에 KOVAN_ID / KOVAN_PW 가 필요합니다.");
  process.exit(1);
}

const LOGIN_URL = "https://cateca.kovan.com/nKIMOS/Default.aspx";
const URL = "https://cateca.kovan.com/nKIMOS/mTLF/TrNo.aspx";
const PAGE_SEL = "select[id$='ddlPageSelector']";

// 기준일자 D-1 (YYMMDD)
function baseDateYYMMDD(now) {
  const d = new Date(now);
  d.setDate(d.getDate() - 1);
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return { code: `${yy}${mm}${dd}`, iso: d.toISOString().slice(0, 10) };
}

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

async function readPage(page) {
  return page.evaluate(() => {
    const t = document.getElementById("mngGrid");
    if (!t) return [];
    return [...t.rows]
      .map((r) => [...r.cells].map((c) => c.innerText.trim()))
      .filter((r) => /^\d+$/.test(r[0])) // 순번이 숫자인 데이터행만
      .map((r) => ({ daepojeom: r[1], daepojeomName: r[2], bizNo: r[3], storeName: r[4] }));
  });
}

async function main() {
  const now = new Date();
  const base = baseDateYYMMDD(now);

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  try {
    await login(page);
    await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(800);

    await page.fill("#textFind", KOVAN_AGENCY).catch(() => {});
    await page.fill("#sDate", base.code).catch(() => {});
    await Promise.all([
      page.waitForLoadState("networkidle").catch(() => {}),
      page.click("#btnFind"),
    ]);
    await page.waitForTimeout(1200);

    const totalPages = await page.$eval(PAGE_SEL, (s) => s.options.length).catch(() => 1);
    console.log(`총 ${totalPages}페이지 순회…`);

    const stores = [];
    stores.push(...(await readPage(page)));
    for (let p = 2; p <= totalPages; p++) {
      await Promise.all([
        page.waitForLoadState("networkidle").catch(() => {}),
        page.selectOption(PAGE_SEL, String(p)).catch(() => {}),
      ]);
      await page.waitForTimeout(500);
      stores.push(...(await readPage(page)));
    }

    const uniqueBiz = new Set(stores.map((s) => s.bizNo)).size;

    await mkdir(dirname(OUT), { recursive: true });
    await writeFile(
      OUT,
      JSON.stringify(
        {
          updatedAt: now.toISOString(),
          agency: KOVAN_AGENCY,
          baseDate: base.iso,
          count: stores.length,
          uniqueBizCount: uniqueBiz,
          stores,
        },
        null,
        2
      )
    );
    console.log(`✅ 저장: ${OUT} (가맹점 ${stores.length}개, 사업자번호 ${uniqueBiz}개)`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
