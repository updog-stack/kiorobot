// DDWM(다우데이타) 무실적가맹점 상세내역 수집기 — 엑셀 내보내기 파싱 방식.
// 로그인(이메일 2차인증) → 무실적가맹점 페이지 → 조회 → 엑셀 다운로드 → 사업자번호·가맹점명 추출.

import "dotenv/config";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chromium } from "playwright";
import * as XLSX from "xlsx";
import { ddwmLogin } from "./lib/ddwm-login.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "data", "inactive-ddwm.json");
const PAGE = "https://van.daoudata.co.kr/pview/Result/Partner/frmLst_zeroBiz2";

const norm = (s) => String(s ?? "").trim();

function rowsFromXlsx(buf) {
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" });
}

function parseStores(grid) {
  // 헤더행: '사업자번호' / '가맹점명' 이 들어있는 행 찾기
  const hIdx = grid.findIndex((r) => r.some((c) => norm(c) === "사업자번호"));
  if (hIdx < 0) throw new Error("엑셀에서 헤더(사업자번호)를 찾지 못했습니다.");
  const header = grid[hIdx].map(norm);
  const bizCol = header.findIndex((h) => h === "사업자번호");
  const nameCol = header.findIndex((h) => h === "가맹점명");
  const agencyCol = header.findIndex((h) => h === "대리점명");
  const mobileCol = header.findIndex((h) => h === "휴대폰번호");
  const telCol = header.findIndex((h) => h === "전화번호");
  const stores = [];
  for (let i = hIdx + 1; i < grid.length; i++) {
    const r = grid[i];
    const biz = norm(r[bizCol]);
    const name = norm(r[nameCol]);
    if (!biz) continue;
    const mobile = mobileCol >= 0 ? norm(r[mobileCol]) : "";
    const tel = telCol >= 0 ? norm(r[telCol]) : "";
    stores.push({
      bizNo: biz.replace(/[^0-9]/g, ""),
      storeName: name,
      daepojeomName: agencyCol >= 0 ? norm(r[agencyCol]) : "",
      phone: mobile || tel || "",
    });
  }
  return stores;
}

async function main() {
  const now = new Date();
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, acceptDownloads: true });
  const page = await ctx.newPage();
  try {
    await ddwmLogin(page);
    await page.goto(PAGE, { waitUntil: "networkidle", timeout: 40000 });
    await page.waitForTimeout(1500);

    // 조회
    await page.click("a.searchDD");
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(2500);

    // 엑셀 내보내기 → 다운로드 캡처
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 40000 }),
      page.click("a.saveExcel"),
    ]);
    const fpath = await download.path();
    const grid = rowsFromXlsx(readFileSync(fpath));
    const stores = parseStores(grid);
    const uniqueBiz = new Set(stores.map((s) => s.bizNo)).size;

    await mkdir(dirname(OUT), { recursive: true });
    await writeFile(
      OUT,
      JSON.stringify(
        {
          van: "DAOUDATA",
          updatedAt: now.toISOString(),
          baseDate: now.toISOString().slice(0, 10),
          count: stores.length,
          uniqueBizCount: uniqueBiz,
          stores,
        },
        null,
        2
      )
    );
    console.log(`✅ 저장: ${OUT} (가맹점 ${stores.length}개, 사업자번호 ${uniqueBiz}개)`);
    console.log("샘플:", JSON.stringify(stores.slice(0, 3)));
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
