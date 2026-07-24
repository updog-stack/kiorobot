// 이카운트(ECount) 재고현황(창고별) 수집기.
// 흐름: 로그인(login.ecount.com, '새 기기 알림' 모달은 [등록안함]) → 메뉴검색 '창고별재고현황'(E040711) 열기
//       → [검색] 버튼 클릭 → 리포트가 쏘는 GetListInvByWh 응답을 가로채 파싱.
//   POST /ECAPI/Inventory/MgmtField/GetListInvByWh  (FORM_TYPE SO622, WH_CD="" 전체창고)
//   응답 base64(UTF-8 JSON): Data.Data = 품목행(마지막 합계행은 PROD_CD 없음 → 제외),
//                            Data.ColumnForm.columns = 창고 컬럼(id "_STOCKS_∬S<코드>", title=창고명).
// 저장: server/data/ecount-inventory.json
//   { updatedAt, baseDate, warehouses:[{code,name}], items:[{prodCd,prodDes,size,unit,total,safeQty,byWh}], itemCount, totalQty, byWhTotal }
// 필요 .env: ECOUNT_COM_CODE / ECOUNT_ID / ECOUNT_PW
// 헤드리스는 로그인 단계에서 이카운트가 차단 → 기본 headed(서버는 xvfb-run). ECOUNT_HEADLESS=1 로 강제.

import "dotenv/config";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "data", "ecount-inventory.json");
const LOGIN_URL = "https://login.ecount.com/Login/";
const HEADLESS = process.env.ECOUNT_HEADLESS === "1";
const MENU_KEYWORD = "창고별재고현황";

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// ECAPI 응답은 base64(UTF-8 JSON)인 경우가 많음 → 디코드 후 JSON.parse.
function decodeJson(text) {
  let t = text;
  if (/^[A-Za-z0-9+/=\r\n]+$/.test(t.slice(0, 100))) {
    try { const d = Buffer.from(t, "base64").toString("utf8"); if (/^[{[]/.test(d)) t = d; } catch {}
  }
  return JSON.parse(t);
}

async function login(page) {
  const { ECOUNT_COM_CODE, ECOUNT_ID, ECOUNT_PW } = process.env;
  if (!ECOUNT_COM_CODE || !ECOUNT_ID || !ECOUNT_PW)
    throw new Error(".env 에 ECOUNT_COM_CODE / ECOUNT_ID / ECOUNT_PW 가 필요합니다.");
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.fill("#com_code", ECOUNT_COM_CODE);
  await page.fill("#id", ECOUNT_ID);
  await page.fill("#passwd", ECOUNT_PW);
  await page.click("#save");

  // 로그인 후 '새로운 기기 로그인 알림' 모달이 뜨면 [등록안함] 클릭하며 메인(#inputFavMSearch) 진입까지 폴링.
  const deadline = Date.now() + 70000;
  let entered = false;
  while (Date.now() < deadline) {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button,a")].find((e) => e.offsetParent !== null && /^(등록안함|Do Not Register)$/i.test((e.innerText || "").trim()));
      if (b) b.click();
    }).catch(() => {});
    if (await page.locator("#inputFavMSearch").isVisible().catch(() => false)) { entered = true; break; }
    await page.waitForTimeout(1500);
  }
  if (!entered) throw new Error("이카운트 로그인 실패(비번 오류/추가 2차인증/헤드리스 차단 가능). url=" + page.url());
}

// 모든 프레임에서 '검색' 버튼(#search 우선) 클릭.
async function clickSearch(page) {
  for (const f of page.frames()) {
    try {
      const ok = await f.evaluate(() => {
        const byId = document.querySelector("#search");
        if (byId && byId.offsetParent !== null) { byId.click(); return true; }
        const b = [...document.querySelectorAll("button,a,input[type=button],span.btn")].find((e) => e.offsetParent !== null && /조회|검색/.test(e.innerText || e.value || ""));
        if (b) { b.click(); return true; }
        return false;
      });
      if (ok) return true;
    } catch {}
  }
  return false;
}

// 메뉴검색으로 리포트 열고(키보드 선택) 검색 실행.
async function openReport(page) {
  await page.click("#inputFavMSearch");
  await page.fill("#inputFavMSearch", "");
  await page.type("#inputFavMSearch", MENU_KEYWORD, { delay: 120 });
  await page.waitForTimeout(2500);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(6000); // 리포트 로딩
  const searched = await clickSearch(page);
  if (!searched) throw new Error("리포트의 '검색' 버튼을 찾지 못했습니다(메뉴가 안 열렸을 수 있음).");
}

async function main() {
  const now = new Date();
  const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, "0"), d = String(now.getDate()).padStart(2, "0");
  const baseDate = `${y}${m}${d}`;

  const browser = await chromium.launch({ headless: HEADLESS });
  // locale 고정 필수: 서버(리눅스)는 시스템 로케일이 영어라 이카운트 UI가 영어로 뜬다.
  //   → 메뉴명('창고별재고현황')·컬럼('재고수량')이 한글이어야 검색/파싱이 된다.
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, locale: "ko-KR" });
  const page = await ctx.newPage();
  try {
    await login(page);
    console.log("✅ 로그인 OK");

    const invP = page.waitForResponse((r) => /GetListInvByWh/.test(r.url()) && r.request().method() === "POST", { timeout: 60000 });
    await openReport(page);
    const invResp = await invP;
    const invJson = decodeJson(await invResp.text());

    // 창고 컬럼: id "_STOCKS_∬S<코드>" (BAL_QTY 총계 컬럼은 제외), title = 창고명. 행 데이터 키는 "S<코드>".
    const cols = invJson?.Data?.ColumnForm?.columns || [];
    const warehouses = cols
      .map((c) => { const mm = String(c.id).match(/S(\d+)$/); return mm ? { code: mm[1], colKey: "S" + mm[1], name: c.title } : null; })
      .filter(Boolean);
    if (!warehouses.length) throw new Error("창고 컬럼을 찾지 못했습니다(응답 구조 변경 가능).");
    console.log("창고:", warehouses.map((w) => `${w.name}(${w.code})`).join(", "));

    const rows = invJson?.Data?.Data || [];
    const items = [];
    for (const r of rows) {
      if (!r.PROD_CD) continue; // 합계행 제외
      const byWh = {};
      for (const w of warehouses) byWh[w.code] = num(r[w.colKey]);
      items.push({
        prodCd: r.PROD_CD, prodDes: r.PROD_DES || "", size: r.PROD_SIZE_DES || "", unit: r.UNIT || "",
        total: num(r.BAL_QTY), safeQty: num(r.SAFE_QTY), byWh,
      });
    }
    if (!items.length) throw new Error("재고 품목이 0건입니다(검색 미실행/응답 구조 변경).");

    const totalQty = items.reduce((s, i) => s + i.total, 0);
    const byWhTotal = {};
    for (const w of warehouses) byWhTotal[w.code] = items.reduce((s, i) => s + (i.byWh[w.code] || 0), 0);
    const store = {
      updatedAt: now.toISOString(), baseDate,
      warehouses: warehouses.map(({ code, name }) => ({ code, name })),
      items, itemCount: items.length, totalQty, byWhTotal,
    };
    await mkdir(dirname(OUT), { recursive: true });
    await writeFile(OUT, JSON.stringify(store, null, 2));
    console.log(`✅ 저장: ${OUT}`);
    console.log(`   품목 ${items.length}개 · 총수량 ${totalQty.toLocaleString()} · 창고 ${warehouses.length}개`);
    for (const w of warehouses) console.log(`   - ${w.name}(${w.code}): ${byWhTotal[w.code].toLocaleString()}`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
