// 단말기 사용현황 수집기 — 개통/사용(최근 7일)/미사용(휴면).
//  · 코밴: 단말기별집계(일자별) → 최근7일 결제 단말기(사용) + 최근30일 활성(개통근사) → 미사용 = 활성-사용 (정밀 7일)
//  · 다우: 단말기별 건수실적(월 히스토그램) → 개통 총수 + 이번달 0건(미사용) (월 기준, 정밀7일은 추후 일별누적)
// 저장: server/data/terminal-usage.json
// 필요: KOVAN_ID/PW, DDWM_ID/PW + GMAIL_USER/GMAIL_APP_PASSWORD(2차인증)

import "dotenv/config";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chromium } from "playwright";
import * as XLSX from "xlsx";
import { ddwmLogin } from "./lib/ddwm-login.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "data", "terminal-usage.json");
const SNAP = join(__dirname, "data", "terminal-ddwm-snapshots.json"); // 다우 일별 누적 스냅샷
const ymd = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
const daysDiff = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
function readJsonSafe(p) { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const yymmdd = (dt) => `${String(dt.getFullYear()).slice(2)}${String(dt.getMonth() + 1).padStart(2, "0")}${String(dt.getDate()).padStart(2, "0")}`;
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
const num = (v) => Number(String(v).replace(/[^0-9.-]/g, "")) || 0;

// ───────── 코밴: 단말기별집계(일자별) 정밀 ─────────
async function kovanTerminals(browser) {
  const { KOVAN_ID, KOVAN_PW } = process.env;
  if (!KOVAN_ID || !KOVAN_PW) throw new Error(".env KOVAN_ID/PW 필요");
  const page = await (await browser.newContext({ ignoreHTTPSErrors: true, acceptDownloads: true })).newPage();
  await page.goto("https://cateca.kovan.com/nKIMOS/Default.aspx", { waitUntil: "networkidle", timeout: 30000 });
  await page.fill("#txtUserid", KOVAN_ID); await page.fill("#txtPasswd", KOVAN_PW);
  await Promise.all([page.waitForLoadState("networkidle").catch(() => {}), page.click("#btnLogin")]);
  await wait(2000);
  if (await page.$("#txtPasswd")) throw new Error("코밴 로그인 실패");

  const selPost = async (sel, opt) => { await page.selectOption(sel, opt).catch(() => {}); await page.waitForLoadState("networkidle").catch(() => {}); await wait(900); };
  const tids = async (sd, ed) => {
    await page.goto("https://cateca.kovan.com/nKIMOS/mTLF/TermCnt.aspx", { waitUntil: "networkidle", timeout: 30000 });
    await wait(900);
    await selPost("#Gcode", "T");            // 단말기번호별
    await selPost("#DrView", { label: "일자별" });
    await selPost("#Dr3", "000000");         // 전체(다인+아무도없개)
    await page.fill("#sDate", yymmdd(sd)); await page.fill("#eDate", yymmdd(ed));
    await Promise.all([page.waitForLoadState("networkidle").catch(() => {}), page.click("#btnFind")]);
    await wait(2800);
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 45000 }), page.click("#seBtn")]);
    const g = XLSX.utils.sheet_to_json(XLSX.read(readFileSync(await dl.path()), { type: "buffer" }).Sheets[XLSX.read(readFileSync(await dl.path()), { type: "buffer" }).SheetNames[0]], { header: 1, blankrows: false, defval: "" });
    const s = new Set();
    for (const r of g) { if (/^\d+$/.test(String(r[0]).trim()) && /^\d{6,}/.test(String(r[4]).trim())) s.add(String(r[4]).trim()); } // col4=단말기번호
    return s;
  };
  const used7 = await tids(daysAgo(7), daysAgo(1));
  const active30 = await tids(daysAgo(30), daysAgo(1));
  const idle = [...active30].filter((t) => !used7.has(t)).length;
  console.log(`  코밴: 개통(활성30일) ${active30.size} · 사용7일 ${used7.size} · 미사용 ${idle}`);
  return { opened: active30.size, used: used7.size, idle, basis: "활성30일 기준·정밀7일", precise: true };
}

// 다우 엑셀 조회 헬퍼(조회조건 setup → 조회 → 엑셀 → grid)
async function ddwmGrab(page, url, setup) {
  await page.goto(url, { waitUntil: "networkidle", timeout: 40000 });
  await wait(1500);
  if (setup) await setup();
  await page.click("a.searchDD").catch(() => {});
  await wait(3500);
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 45000 }),
    page.evaluate(() => { const b = document.querySelector("a.saveExcel"); if (b) b.click(); }),
  ]);
  const buf = readFileSync(await dl.path());
  return XLSX.utils.sheet_to_json(XLSX.read(buf, { type: "buffer" }).Sheets[XLSX.read(buf, { type: "buffer" }).SheetNames[0]], { header: 1, blankrows: false, defval: "" });
}
const findHdr = (g) => { let h = 0, b = 0; for (let i = 0; i < Math.min(g.length, 6); i++) { const n = g[i].filter((c) => String(c).trim()).length; if (n > b) { b = n; h = i; } } return h; };

// ───────── 다우: 개통(월 히스토그램) + 단말기별 일별누적으로 정밀 7일 ─────────
async function ddwmTerminals(browser) {
  const page = await (await browser.newContext({ ignoreHTTPSErrors: true, acceptDownloads: true })).newPage();
  await ddwmLogin(page);
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const today = ymd(now);

  // (1) 개통 총수 + 이번달 0건 — 단말기별 건수실적 히스토그램
  const gh = await ddwmGrab(page, "https://van.daoudata.co.kr/pview/Result/Partner/frmLst_sumTrml", async () => {
    await page.fill("#searchStartDate", month).catch(() => {});
  });
  const hh = findHdr(gh); const cCnt = gh[hh].map((c) => String(c).replace(/\s/g, "")).findIndex((c) => c === "단말기수");
  let opened = 0, zeroMonth = 0;
  for (let i = hh + 1; i < gh.length; i++) { const rg = String(gh[i][0] ?? "").trim(); const n = num(gh[i][cCnt]); if (/합계|소계|총/.test(rg)) continue; opened += n; if (/^0건/.test(rg)) zeroMonth = n; }

  // (2) 단말기별 이번달 누적건수 — 단말기별 정산내역
  const gt = await ddwmGrab(page, "https://van.daoudata.co.kr/pview/Bill/partner/frmBill_Trml", async () => {
    await page.fill("#selectMonth", month).catch(() => {});
  });
  const ht = findHdr(gt); const hdrT = gt[ht].map((c) => String(c).replace(/\s/g, ""));
  const cTid = hdrT.findIndex((c) => c.includes("단말기번호")); const cTot = hdrT.findIndex((c) => c === "총건수");
  const cumToday = {};
  for (let i = ht + 1; i < gt.length; i++) { const t = String(gt[i][cTid] ?? "").trim(); if (!/^\d{4,}/.test(t)) continue; cumToday[t] = num(gt[i][cTot]); }

  // (3) 스냅샷 누적 + 오늘 활성 단말기 산출
  const store = readJsonSafe(SNAP) ?? { days: [] };
  const prev = store.days[store.days.length - 1];
  let active;
  if (prev && prev.month === month) active = Object.keys(cumToday).filter((t) => (cumToday[t] || 0) > (prev.cum[t] || 0));
  else active = Object.keys(cumToday).filter((t) => cumToday[t] > 0); // 첫날/월경계: 이번달 실적 있으면 활성
  store.days = store.days.filter((d) => d.date !== today);
  store.days.push({ date: today, month, cum: cumToday, active });
  store.days = store.days.slice(-12);
  await writeFile(SNAP, JSON.stringify(store));

  // (4) 롤링 7일: 최근 7일 스냅샷의 활성 단말기 합집합
  const last7 = store.days.filter((d) => daysDiff(d.date, today) < 7);
  const used = new Set(); last7.forEach((d) => d.active.forEach((t) => used.add(t)));
  const covered = new Set(last7.map((d) => d.date)).size;

  if (covered >= 7) {
    console.log(`  다우: 개통 ${opened} · 사용7일 ${used.size} · 미사용 ${opened - used.size} (정밀·${covered}일누적)`);
    return { opened, used: used.size, idle: opened - used.size, basis: "정밀 7일(일별 누적)", precise: true };
  }
  console.log(`  다우: 개통 ${opened} · 사용 ${opened - zeroMonth} · 미사용 ${zeroMonth} (월근사·정밀워밍업 ${covered}/7일)`);
  return { opened, used: opened - zeroMonth, idle: zeroMonth, basis: `월 근사(정밀 워밍업 ${covered}/7일)`, precise: false };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const out = { updatedAt: new Date().toISOString(), kovan: null, ddwm: null };
  try {
    try { out.kovan = await kovanTerminals(browser); } catch (e) { console.error("  코밴 오류:", e.message); out.kovan = { error: e.message }; }
    try { out.ddwm = await ddwmTerminals(browser); } catch (e) { console.error("  다우 오류:", e.message); out.ddwm = { error: e.message }; }
  } finally { await browser.close(); }
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out, null, 2));
  console.log("✅ 저장:", OUT);
}
main().catch((e) => { console.error("❌", e.message); process.exit(1); });
