// 누적 거래실적 — 역대 '실제 거래한' 단말기 + 가맹점(사업자번호). 등록 목록 리포트가 없어 거래 기준으로 집계.
//   · 코밴: TermCnt '일자별'(캡 없음) 월별 → 단말기(col4)+사업자번호(col3) union. 월별 캐시(자가치유).
//   · 다우: 단말기별 정산내역(frmBill_Trml) 월별 → 단말기번호+사업자번호 union. flat 캐시 + 최근 2개월 재조회.
//   단말기 = 코밴∪다우(번호공간 달라 합산) · 가맹점 = 코밴∪다우 사업자번호 dedup.
//   저장: server/data/terminal-total.json (요약) · 캐시 별도.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chromium } from "playwright";
import * as XLSX from "xlsx";
import { ddwmLogin } from "./lib/ddwm-login.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "data", "terminal-total.json");
const CACHE = join(__dirname, "data", "terminal-total-cache.json");
const { KOVAN_ID, KOVAN_PW } = process.env;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const readJsonSafe = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const yymmdd = (dt) => `${String(dt.getFullYear()).slice(2)}${String(dt.getMonth() + 1).padStart(2, "0")}${String(dt.getDate()).padStart(2, "0")}`;
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
const findHdr = (g) => { let h = 0, b = 0; for (let i = 0; i < Math.min(g.length, 6); i++) { const n = g[i].filter((c) => String(c).trim()).length; if (n > b) { b = n; h = i; } } return h; };
const digits = (v) => String(v).replace(/[^0-9]/g, "");

const KOVAN_START_YEAR = 2019;
const DDWM_START_YM = "2025-01"; // 다인 다우 대리점 인수 시점(그 전은 정산 데이터 없음)

// ───────── 코밴: TermCnt '일자별' 월별 → 단말기(col4)+사업자번호(col3) ─────────
async function kovanTotal(browser, cachedMonths) {
  if (!KOVAN_ID || !KOVAN_PW) throw new Error(".env KOVAN_ID/PW 필요");
  const page = await (await browser.newContext({ ignoreHTTPSErrors: true, acceptDownloads: true })).newPage();
  await page.goto("https://cateca.kovan.com/nKIMOS/Default.aspx", { waitUntil: "networkidle", timeout: 30000 });
  await page.fill("#txtUserid", KOVAN_ID); await page.fill("#txtPasswd", KOVAN_PW);
  await Promise.all([page.waitForLoadState("networkidle").catch(() => {}), page.click("#btnLogin")]); await wait(2000);
  if (await page.$("#txtPasswd")) throw new Error("코밴 로그인 실패");
  const selPost = async (sel, opt) => { await page.selectOption(sel, opt).catch(() => {}); await page.waitForLoadState("networkidle").catch(() => {}); await wait(600); };
  const overlayGone = async () => { await page.waitForFunction(() => { const e = document.querySelector("#progressBackgroundFilter") || document.querySelector("#updateProgress"); return !e || e.offsetParent === null; }, { timeout: 150000 }).catch(() => {}); };
  const grab = async (sd, ed) => {
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await page.goto("https://cateca.kovan.com/nKIMOS/mTLF/TermCnt.aspx", { waitUntil: "networkidle", timeout: 30000 }); await wait(700);
        await selPost("#Gcode", "T"); await selPost("#DrView", { label: "일자별" }); await selPost("#Dr3", "000000");
        await page.fill("#sDate", sd); await page.fill("#eDate", ed);
        await page.click("#btnFind"); await wait(1500); await overlayGone(); await wait(700);
        const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 120000 }), page.click("#seBtn")]);
        const html = new TextDecoder("euc-kr").decode(readFileSync(await dl.path()));
        const g = XLSX.utils.sheet_to_json(XLSX.read(html, { type: "string" }).Sheets[XLSX.read(html, { type: "string" }).SheetNames[0]], { header: 1, blankrows: false, defval: "" });
        const t = new Set(), b = new Set();
        for (const r of g) {
          if (!/^\d+$/.test(String(r[0]).trim())) continue;
          const tid = String(r[4]).trim(); if (/^\d{6,}/.test(tid)) t.add(tid);
          const biz = digits(r[3]); if (biz.length === 10) b.add(biz);
        }
        return { t: [...t], b: [...b] };
      } catch (e) { lastErr = e; if (attempt < 3) await wait(2000); }
    }
    throw lastErr;
  };
  const months = { ...(cachedMonths || {}) };
  const cur = new Date();
  const curYm = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`;
  let done = 0, fail = 0;
  for (let y = KOVAN_START_YEAR, m = 1; y < cur.getFullYear() || (y === cur.getFullYear() && m <= cur.getMonth() + 1); ) {
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    if (!(ym !== curYm && months[ym] && Array.isArray(months[ym].t))) {
      const yy = String(y).slice(2), mm = String(m).padStart(2, "0");
      const lastD = new Date(y, m, 0).getDate();
      const sd = `${yy}${mm}01`;
      const ed = ym === curYm ? yymmdd(daysAgo(1)) : `${yy}${mm}${String(lastD).padStart(2, "0")}`;
      try { months[ym] = await grab(sd, ed); done++; if (done % 12 === 0) console.log(`  코밴 ${ym}: 단말기 ${months[ym].t.length}·가맹점 ${months[ym].b.length} (진행 ${done})`); }
      catch (e) { fail++; console.error(`  코밴 ${ym} 실패: ${e.message}`); }
    }
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  const tSet = new Set(), bSet = new Set();
  for (const k of Object.keys(months)) { (months[k].t || []).forEach((x) => tSet.add(x)); (months[k].b || []).forEach((x) => bSet.add(x)); }
  console.log(`  코밴 완료: 수집 ${done}월(실패 ${fail}) · 단말기 ${tSet.size} · 가맹점 ${bSet.size}`);
  return { months, terminals: [...tSet], merchants: [...bSet] };
}

// ───────── 다우: 단말기별 정산내역 월별 → 단말기번호+사업자번호 (flat 캐시, 최근 2개월 재조회) ─────────
async function ddwmTotal(browser, prevTerm, prevBiz, throughYm) {
  const page = await (await browser.newContext({ ignoreHTTPSErrors: true, acceptDownloads: true })).newPage();
  await ddwmLogin(page);
  const grab = async (ym) => {
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await page.goto("https://van.daoudata.co.kr/pview/Bill/partner/frmBill_Trml", { waitUntil: "networkidle", timeout: 40000 }); await wait(1400);
        await page.fill("#selectMonth", ym).catch(() => {});
        await page.click("a.searchDD").catch(() => {}); await wait(3500);
        const [dl] = await Promise.all([
          page.waitForEvent("download", { timeout: 70000 }),
          page.evaluate(() => { const b = document.querySelector("a.saveExcel"); if (b) b.click(); }),
        ]);
        const buf = readFileSync(await dl.path());
        const g = XLSX.utils.sheet_to_json(XLSX.read(buf, { type: "buffer" }).Sheets[XLSX.read(buf, { type: "buffer" }).SheetNames[0]], { header: 1, blankrows: false, defval: "" });
        const h = findHdr(g); const hdr = g[h].map((c) => String(c).replace(/\s/g, ""));
        const cTid = hdr.findIndex((c) => c.includes("단말기번호")); const cBiz = hdr.findIndex((c) => c.includes("사업자번호"));
        const t = new Set(), b = new Set();
        for (let i = h + 1; i < g.length; i++) {
          const tid = String(g[i][cTid] ?? "").trim(); if (/^\d{4,}/.test(tid)) t.add(tid);
          const biz = digits(g[i][cBiz]); if (biz.length === 10) b.add(biz);
        }
        return { t, b };
      } catch (e) { lastErr = e; if (attempt < 3) await wait(2000); }
    }
    throw lastErr;
  };
  const tSet = new Set(prevTerm || []); const bSet = new Set(prevBiz || []);
  const cur = new Date();
  const [ty, tm] = (throughYm && (prevTerm || []).length ? throughYm : DDWM_START_YM).split("-").map(Number);
  let sy = ty, sm = tm;
  if ((prevTerm || []).length) { sm -= 1; if (sm < 1) { sm = 12; sy -= 1; } }
  const months = [];
  for (let y = sy, m = sm; y < cur.getFullYear() || (y === cur.getFullYear() && m <= cur.getMonth() + 1); ) {
    months.push(`${y}-${String(m).padStart(2, "0")}`); m += 1; if (m > 12) { m = 1; y += 1; }
  }
  let done = 0, fail = 0;
  for (const ym of months) {
    try { const r = await grab(ym); r.t.forEach((x) => tSet.add(x)); r.b.forEach((x) => bSet.add(x)); done++; if (done % 12 === 0) console.log(`  다우 ${ym}: 단말기 ${tSet.size}·가맹점 ${bSet.size} (${done}/${months.length})`); }
    catch (e) { fail++; console.error(`  다우 ${ym} 실패: ${e.message}`); }
  }
  const nowYm = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`;
  console.log(`  다우 완료: ${months.length}개월(실패 ${fail}) · 단말기 ${tSet.size} · 가맹점 ${bSet.size}`);
  return { terminals: [...tSet], merchants: [...bSet], throughYm: nowYm };
}

async function main() {
  const cache = readJsonSafe(CACHE) || {};
  const browser = await chromium.launch({ headless: true });
  let kovanMonths = cache.kovanMonths || {}, kTerm = [], kMerch = [];
  let dTerm = cache.ddwmTerminals || [], dMerch = cache.ddwmMerchants || [], ddwmThroughYm = cache.ddwmThroughYm;
  try {
    try {
      const r = await kovanTotal(browser, cache.kovanMonths); kovanMonths = r.months; kTerm = r.terminals; kMerch = r.merchants;
      // 코밴 완료 즉시 캐시 저장 — 다우 실패해도 코밴 재수집 방지
      await mkdir(dirname(CACHE), { recursive: true });
      await writeFile(CACHE, JSON.stringify({ kovanMonths, ddwmTerminals: dTerm, ddwmMerchants: dMerch, ddwmThroughYm }, null, 2));
      console.log("  💾 코밴 캐시 저장(중간)");
    }
    catch (e) { console.error("  코밴 오류:", e.message); }
    try { const r = await ddwmTotal(browser, cache.ddwmTerminals, cache.ddwmMerchants, cache.ddwmThroughYm); dTerm = r.terminals; dMerch = r.merchants; ddwmThroughYm = r.throughYm; }
    catch (e) { console.error("  다우 오류:", e.message); }
  } finally { await browser.close(); }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(CACHE, JSON.stringify({ kovanMonths, ddwmTerminals: dTerm, ddwmMerchants: dMerch, ddwmThroughYm }, null, 2));
  const merchTotal = new Set([...kMerch, ...dMerch]).size; // 사업자번호 dedup(코밴+다우 겹침 제거)
  const out = {
    updatedAt: new Date().toISOString(),
    terminals: { total: kTerm.length + dTerm.length, kovan: kTerm.length, ddwm: dTerm.length },
    merchants: { total: merchTotal, kovan: kMerch.length, ddwm: dMerch.length },
  };
  await writeFile(OUT, JSON.stringify(out, null, 2));
  console.log(`✅ 거래 단말기 ${out.terminals.total} (코밴 ${out.terminals.kovan}+다우 ${out.terminals.ddwm}) · 거래 가맹점 ${out.merchants.total}`);
  console.log("✅ 저장:", OUT);
}
main().catch((e) => { console.error("❌", e.message); process.exit(1); });
