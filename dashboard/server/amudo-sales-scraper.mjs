// 아무도없개 매출(결제건수·금액) — 코밴 + 다우데이타에서 가맹점명이 '아무도없개'인 매장만 월별 집계.
//   · 코밴: '가맹점별 매출금액 구간집계'(mWork/fixedrate.aspx), 대리점 A25700·A25701 union.
//   · 다우: '가맹점 일별실적'(frmLst_merchDayTran) 엑셀에서 가맹점명 매칭 행 합산.
//   · 매칭: /[아이]무도\s*없개/ (오타·띄어쓰기 변형 포함).
//   · 2026-01부터 현재월까지. 과거월은 VAN별 캐시 재사용, 현재월만 재조회(증분).
//   저장: data/amudo-sales.json { updatedAt, months: { "2026-01": {count, amount, stores, kovan:{...}, ddwm:{...}} } }
import "dotenv/config";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chromium } from "playwright";
import * as XLSX from "xlsx";
import { ddwmLogin } from "./lib/ddwm-login.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "data", "amudo-sales.json");
const { KOVAN_ID, KOVAN_PW } = process.env;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const readJsonSafe = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const num = (v) => Number(String(v).replace(/[^0-9.-]/g, "")) || 0;
const yy = (y) => String(y).slice(2);
const AMUDO_RE = /[아이]무도\s*없개/; // 아무도없개 + 아무도 없개 + 이무도없개
const START_YM = "2026-01"; // 2026년 전체(다인/아무도없개 분리 뷰용). 과거월은 캐시 재사용·현재월만 재조회.
const MNG_CODES = ["A25700", "A25701"]; // 다인 · 아무도없개
const cells = (tr) => [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim());

async function kovanLogin(page) {
  await page.goto("https://cateca.kovan.com/nKIMOS/Default.aspx", { waitUntil: "networkidle", timeout: 30000 });
  await page.fill("#txtUserid", KOVAN_ID); await page.fill("#txtPasswd", KOVAN_PW);
  await Promise.all([page.waitForLoadState("networkidle").catch(() => {}), page.click("#btnLogin")]); await wait(2000);
  if (await page.$("#txtPasswd")) throw new Error("코밴 로그인 실패");
}

// 한 대리점·기간의 아무도없개 매장 행 → Map(사업자번호|거래구분 → {cnt, amt, name})
async function queryAmudo(page, sd, ed, mng) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.goto("https://cateca.kovan.com/nKIMOS/mWork/fixedrate.aspx", { waitUntil: "networkidle", timeout: 30000 }); await wait(900);
      await page.selectOption("#ddlValue", "mng").catch(() => {});
      await page.fill("#txtValue", mng).catch(() => {});
      await page.fill("#txtSdate", sd); await page.fill("#txtEdate", ed);
      await Promise.all([page.waitForLoadState("networkidle").catch(() => {}), page.click("#btnSearch")]); await wait(2500);
      const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.click("#seBtn")]);
      const html = new TextDecoder("euc-kr").decode(readFileSync(await dl.path()));
      const trs = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => cells(m[1]));
      const data = trs.filter((c) => /^(신용|체크)$/.test((c[4] || "").trim()) && c[2]);
      const map = new Map();
      for (const c of data) {
        const name = c[2];
        if (!AMUDO_RE.test(name)) continue;
        const L = c.length; // 합계건수=L-3, 합계금액=L-2, 평균단가=L-1
        const key = `${c[3]}|${c[4]}`; // 사업자번호|거래구분
        map.set(key, { cnt: num(c[L - 3]), amt: num(c[L - 2]), name });
      }
      return map;
    } catch (e) { lastErr = e; if (attempt < 3) await wait(2000); }
  }
  throw lastErr;
}

// ===== 다우데이타(가맹점 일별실적) — 가맹점명 '아무도없개' 행 월별 합산 =====
const DDWM_PAGE = "https://van.daoudata.co.kr/pview/Result/Partner/frmLst_merchDayTran";

// 엑셀 그리드에서 가맹점명·합계건수·합계금액 컬럼 탐지 후 아무도없개 매장 합산
function ddwmAmudo(grid) {
  const h0 = (grid[0] || []).map((s) => String(s ?? "").trim());
  const h1 = (grid[1] || []).map((s) => String(s ?? "").trim());
  let cntCol = -1, amtCol = -1, nameCol = -1;
  for (let i = 0; i < h0.length; i++) {
    if (h0[i] === "합계" && h1[i] === "건수" && cntCol < 0) cntCol = i;
    if (h0[i] === "합계" && h1[i] === "금액" && amtCol < 0) amtCol = i;
  }
  for (let r = 0; r < Math.min(3, grid.length) && nameCol < 0; r++) {
    const row = (grid[r] || []).map((s) => String(s ?? "").trim());
    const j = row.findIndex((c) => c === "가맹점명" || c === "가맹점" || c === "상호" || c === "상호명");
    if (j >= 0) nameCol = j;
  }
  if (cntCol < 0) cntCol = 9;
  if (amtCol < 0) amtCol = 10;
  if (nameCol < 0) nameCol = 1;
  let count = 0, amount = 0; const stores = new Set();
  for (const r of grid) {
    const name = String(r[nameCol] ?? "").trim();
    if (!name || name === "합계" || name === "가맹점명") continue;
    if (!AMUDO_RE.test(name)) continue;
    count += num(r[cntCol]); amount += num(r[amtCol]); stores.add(name);
  }
  return { count, amount, stores: stores.size, cols: { cntCol, amtCol, nameCol } };
}

async function queryDdwm(page, ym) {
  await page.fill("#selectMonth", ym);
  await page.click("a.searchDD");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(2000);
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 40000 }), page.click("a.saveExcel")]);
  const wb = XLSX.read(readFileSync(await dl.path()), { type: "buffer" });
  const grid = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false, defval: "" });
  return ddwmAmudo(grid);
}

function targetMonths(months, curYm, van) {
  const out = [];
  const [sy, sm] = START_YM.split("-").map(Number);
  const [cy, cm] = curYm.split("-").map(Number);
  for (let y = sy, m = sm; y < cy || (y === cy && m <= cm); ) {
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    if (ym === curYm || !months[ym]?.[van]) out.push(ym); // 현재월 재조회, 과거월은 해당 VAN 캐시 없을 때만
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

async function main() {
  const prev = readJsonSafe(OUT) || { months: {} };
  const months = { ...(prev.months || {}) };
  const now = new Date();
  const curYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // ── 코밴 ──
  const kTargets = targetMonths(months, curYm, "kovan");
  if (kTargets.length) {
    const browser = await chromium.launch({ headless: true });
    const page = await (await browser.newContext({ ignoreHTTPSErrors: true, acceptDownloads: true })).newPage();
    try {
      await kovanLogin(page);
      for (const ym of kTargets) {
        const [y, m] = ym.split("-").map(Number);
        const lastD = new Date(y, m, 0).getDate();
        const isCur = ym === curYm;
        const sd = `${yy(y)}${String(m).padStart(2, "0")}01`;
        const ed = isCur
          ? `${yy(now.getFullYear())}${String(now.getMonth() + 1).padStart(2, "0")}${String(Math.max(1, now.getDate() - 1)).padStart(2, "0")}`
          : `${yy(y)}${String(m).padStart(2, "0")}${String(lastD).padStart(2, "0")}`;
        try {
          const merged = new Map();
          for (const mng of MNG_CODES) {
            const map = await queryAmudo(page, sd, ed, mng);
            for (const [k, v] of map) if (!merged.has(k)) merged.set(k, v);
          }
          let count = 0, amount = 0; const stores = new Set();
          for (const v of merged.values()) { count += v.cnt; amount += v.amt; stores.add(v.name); }
          months[ym] = { ...(months[ym] || {}), kovan: { count, amount, stores: stores.size } };
          console.log(`  [코밴] ${ym}: ${count.toLocaleString()}건 · ${amount.toLocaleString()}원 · ${stores.size}개${isCur ? " (진행 중)" : ""}`);
        } catch (e) { console.error(`  [코밴] ${ym} 실패: ${e.message}`); }
      }
    } finally { await browser.close(); }
  }

  // ── 다우데이타 ──
  const dTargets = targetMonths(months, curYm, "ddwm");
  if (dTargets.length) {
    const browser = await chromium.launch({ headless: true });
    const page = await (await browser.newContext({ ignoreHTTPSErrors: true, acceptDownloads: true })).newPage();
    try {
      await ddwmLogin(page);
      await page.goto(DDWM_PAGE, { waitUntil: "networkidle", timeout: 40000 });
      await page.waitForTimeout(1500);
      let firstLog = true;
      for (const ym of dTargets) {
        const isCur = ym === curYm;
        try {
          const { count, amount, stores, cols } = await queryDdwm(page, ym);
          months[ym] = { ...(months[ym] || {}), ddwm: { count, amount, stores } };
          console.log(`  [다우] ${ym}: ${count.toLocaleString()}건 · ${amount.toLocaleString()}원 · ${stores}개${isCur ? " (진행 중)" : ""}`);
          if (firstLog) { console.log(`        (컬럼 탐지: 가맹점명=${cols.nameCol}, 건수=${cols.cntCol}, 금액=${cols.amtCol})`); firstLog = false; }
        } catch (e) { console.error(`  [다우] ${ym} 실패: ${e.message}`); }
      }
    } finally { await browser.close(); }
  }

  // ── VAN 합산 → count/amount ──
  for (const ym of Object.keys(months)) {
    const k = months[ym].kovan || { count: 0, amount: 0, stores: 0 };
    const d = months[ym].ddwm || { count: 0, amount: 0, stores: 0 };
    months[ym].count = k.count + d.count;
    months[ym].amount = k.amount + d.amount;
    months[ym].stores = k.stores + d.stores; // VAN별 매장수 단순합(참고치)
    months[ym].partial = ym === curYm || undefined;
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify({ updatedAt: new Date().toISOString(), months }, null, 2));
  console.log("✅ 저장:", OUT, "· 월수:", Object.keys(months).length);
}
main().catch((e) => { console.error("❌", e.message); process.exit(1); });
