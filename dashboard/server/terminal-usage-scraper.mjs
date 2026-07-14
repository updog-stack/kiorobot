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
  // 반환: { set: 단말기번호 Set, info: {tid→{tid,bizno,name}} }  (col3=사업자번호, col4=단말기번호, col5=상호명)
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
    // 코밴 '엑셀'은 실제로 EUC-KR 인코딩 HTML 테이블 → 한글 상호명이 깨지므로 EUC-KR 디코딩 후 파싱
    const html = new TextDecoder("euc-kr").decode(readFileSync(await dl.path()));
    const g = XLSX.utils.sheet_to_json(XLSX.read(html, { type: "string" }).Sheets[XLSX.read(html, { type: "string" }).SheetNames[0]], { header: 1, blankrows: false, defval: "" });
    const set = new Set(); const info = {};
    for (const r of g) {
      const tid = String(r[4]).trim();
      if (/^\d+$/.test(String(r[0]).trim()) && /^\d{6,}/.test(tid)) {
        set.add(tid);
        if (!info[tid]) info[tid] = { tid, bizno: String(r[3]).trim(), name: String(r[5]).trim() };
      }
    }
    return { set, info };
  };
  const u = await tids(daysAgo(7), daysAgo(1));
  const a = await tids(daysAgo(30), daysAgo(1));
  const idleTids = [...a.set].filter((t) => !u.set.has(t));
  const idleList = idleTids.map((t) => a.info[t]).filter(Boolean).sort((x, y) => x.name.localeCompare(y.name, "ko"));
  // 가맹점(사업자번호) 기준 — 한 가맹점이 단말기 여러 대일 수 있어 distinct 사업자번호로 집계
  const bizOf = (r) => [...r.set].map((t) => r.info[t]?.bizno).filter(Boolean);
  const usedBiz = new Set(bizOf(u)), openedBiz = new Set(bizOf(a));
  const merch = { opened: openedBiz.size, used: usedBiz.size, idle: [...openedBiz].filter((b) => !usedBiz.has(b)).length };
  console.log(`  코밴: 단말기 개통 ${a.set.size}·사용 ${u.set.size}·미사용 ${idleTids.length} | 가맹점 개통 ${merch.opened}·사용 ${merch.used}·미사용 ${merch.idle}`);
  return { opened: a.set.size, used: u.set.size, idle: idleTids.length, idleList, merch, biznos: { opened: [...openedBiz], used: [...usedBiz] }, basis: "활성30일 기준·정밀7일", precise: true };
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

// 다우 무실적단말기내역(frmLst_zeroTrml) — 최근 7일간 실적 0인 단말기 = 미사용 (상호/사업자번호).
//   ※ 다인 직접관리 범위만 나옴(히스토그램 개통수와 모집단이 다를 수 있음).
async function ddwmIdleList(page) {
  try {
    const g = await ddwmGrab(page, "https://van.daoudata.co.kr/pview/Result/Partner/frmLst_zeroTrml", async () => {
      await page.fill("#searchStartDate", ymd(daysAgo(7))).catch(() => {});
      await page.fill("#searchEndDate", ymd(daysAgo(1))).catch(() => {});
    });
    const h = findHdr(g); const hdr = g[h].map((c) => String(c).replace(/\s/g, ""));
    const cTid = hdr.findIndex((c) => c.includes("단말기번호"));
    const cBiz = hdr.findIndex((c) => c.includes("사업자번호"));
    const cName = hdr.findIndex((c) => c.includes("가맹점상호") || c.includes("상호") || c.includes("사업자명"));
    const list = [];
    for (let i = h + 1; i < g.length; i++) {
      const tid = String(g[i][cTid] ?? "").trim();
      if (!/^\d{4,}/.test(tid)) continue;
      list.push({ tid, bizno: String(g[i][cBiz] ?? "").trim(), name: String(g[i][cName] ?? "").trim() });
    }
    return list.sort((x, y) => x.name.localeCompare(y.name, "ko"));
  } catch (e) {
    console.error("  다우 무실적명단 오류:", e.message);
    return null;
  }
}

// ───────── 다우: 다인 직접관리 · 7일 미결제 기준(코밴과 동일 정의) ─────────
//   · 이번달 활동 단말기(정산내역) ∪ 무실적7일 = 개통(운영 중)
//   · 미사용 = 무실적단말기내역(최근 7일 결제 없음) — 상호/사업자번호 포함
//   · 사용 = 개통 − 미사용.  히스토그램(1071·폐업 단말 포함)은 쓰지 않음.
async function ddwmTerminals(browser) {
  const page = await (await browser.newContext({ ignoreHTTPSErrors: true, acceptDownloads: true })).newPage();
  await ddwmLogin(page);
  const now = new Date();
  const ymOf = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
  const thisMonth = ymOf(now);
  const lastMonth = ymOf(new Date(now.getFullYear(), now.getMonth() - 1, 1));

  // 최근 30일 활동 단말기 — 이번달 + 지난달 정산내역을 합쳐 롤링 30일(다인 직접관리) 근사.
  //   (이번달만 보면 월 초에는 며칠치뿐이므로 지난달 분을 합쳐 30일 창을 채운다)
  const monthActive = new Set(); const tBiz = {};
  const grabMonth = async (ym) => {
    const gt = await ddwmGrab(page, "https://van.daoudata.co.kr/pview/Bill/partner/frmBill_Trml", async () => {
      await page.fill("#selectMonth", ym).catch(() => {});
    });
    const ht = findHdr(gt); const hdrT = gt[ht].map((c) => String(c).replace(/\s/g, ""));
    const cTid = hdrT.findIndex((c) => c.includes("단말기번호"));
    const cBiz = hdrT.findIndex((c) => c.includes("사업자번호"));
    for (let i = ht + 1; i < gt.length; i++) { const t = String(gt[i][cTid] ?? "").trim(); if (!/^\d{4,}/.test(t)) continue; monthActive.add(t); if (cBiz >= 0 && !tBiz[t]) tBiz[t] = String(gt[i][cBiz] ?? "").trim(); }
  };
  await grabMonth(thisMonth);
  await grabMonth(lastMonth);

  // 미사용 명단(최근 7일 미결제) — 무실적단말기내역(상호/사업자번호)
  const idleList = (await ddwmIdleList(page)) ?? [];
  const idleTids = new Set(idleList.map((x) => x.tid));
  const opened = new Set([...monthActive, ...idleTids]).size;
  const idle = idleTids.size;
  const used = opened - idle;
  // 가맹점(사업자번호) 기준 — distinct 사업자번호
  const usedBiz = new Set([...monthActive].filter((t) => !idleTids.has(t)).map((t) => tBiz[t]).filter(Boolean));
  const idleBiz = new Set(idleList.map((x) => x.bizno).filter(Boolean));
  const openedBiz = new Set([...usedBiz, ...idleBiz]);
  const merch = { opened: openedBiz.size, used: usedBiz.size, idle: [...openedBiz].filter((b) => !usedBiz.has(b)).length };
  console.log(`  다우: 단말기 개통 ${opened}·사용 ${used}·미사용 ${idle} (다인 직접관리·7일 미결제)·명단 ${idleList.length}곳 | 가맹점 개통 ${merch.opened}·사용 ${merch.used}·미사용 ${merch.idle}`);
  return { opened, used, idle, idleList, merch, biznos: { opened: [...openedBiz], used: [...usedBiz] }, basis: "다인 직접관리 · 7일 미결제", precise: true };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const prev = readJsonSafe(OUT) ?? {}; // 이전 저장분 — 수집 실패 시 보존
  const out = { updatedAt: new Date().toISOString(), kovan: null, ddwm: null };
  const keepPrev = (p, e) => (p && !p.error ? { ...p, stale: true } : { error: e.message });
  try {
    try { out.kovan = await kovanTerminals(browser); } catch (e) { console.error("  코밴 오류:", e.message); out.kovan = keepPrev(prev.kovan, e); }
    try { out.ddwm = await ddwmTerminals(browser); } catch (e) { console.error("  다우 오류:", e.message); out.ddwm = keepPrev(prev.ddwm, e); }
  } finally { await browser.close(); }

  // 가맹점(사업자번호) 통합 — 코밴·다우 중복 제거 + KICC 수기.
  //   ※ 통합은 biznos(사업자번호 집합)로 dedup하므로 '양쪽 fresh'일 때만 재계산.
  //     한쪽이라도 실패(stale)면 biznos가 없어 잘못 계산되므로 이전 통합값을 유지한다.
  const KICC_MERCHANTS = 40; // KICC 가맹점(단말기 수집 대상 아님) — 약 40곳 수기 반영
  const kb = out.kovan?.biznos, db = out.ddwm?.biznos;
  if (kb && db) {
    const usedAll = new Set([...kb.used, ...db.used]);
    const openedAll = new Set([...kb.opened, ...db.opened]);
    // 미사용 가맹점 명단 — 미사용 단말기의 사업자번호 중 '사용 가맹점(usedAll)'에 없는 것만
    const idleByBiz = new Map();
    for (const r of [...(out.kovan?.idleList ?? []), ...(out.ddwm?.idleList ?? [])]) {
      if (!r.bizno || usedAll.has(r.bizno) || idleByBiz.has(r.bizno)) continue;
      idleByBiz.set(r.bizno, r.name);
    }
    const idleMerchList = [...idleByBiz.entries()].map(([bizno, name]) => ({ bizno, name })).sort((a, b) => a.name.localeCompare(b.name, "ko"));
    out.merchants = {
      basis: "사업자번호 distinct · 코밴+다우 통합(중복제거) + KICC 수기(+40)",
      kovan: out.kovan?.merch ?? null,
      ddwm: out.ddwm?.merch ?? null,
      kicc: KICC_MERCHANTS,
      combined: {
        opened: openedAll.size + KICC_MERCHANTS,
        used: usedAll.size + KICC_MERCHANTS,
        idle: [...openedAll].filter((b) => !usedAll.has(b)).length,
      },
      idleList: idleMerchList,
    };
    // VAN별 가맹점 미사용 명단(최근 7일 무결제) — 단말기 명단을 사업자번호로 dedup, 7일 사용 가맹점 제외
    const perVanIdle = (list, usedArr) => {
      const used = new Set(usedArr);
      const seen = new Map();
      for (const r of list ?? []) {
        if (!r.bizno || used.has(r.bizno) || seen.has(r.bizno)) continue;
        seen.set(r.bizno, r.name);
      }
      return [...seen.entries()].map(([bizno, name]) => ({ bizno, name })).sort((a, b) => a.name.localeCompare(b.name, "ko"));
    };
    out.merchants.kovanIdle = perVanIdle(out.kovan?.idleList, kb.used);
    out.merchants.ddwmIdle = perVanIdle(out.ddwm?.idleList, db.used);
    console.log(`  ✅ 가맹점 통합: 개통 ${out.merchants.combined.opened} · 사용 ${out.merchants.combined.used} · 미사용 ${out.merchants.combined.idle} (코밴+다우 ${usedAll.size}+KICC ${KICC_MERCHANTS})`);
    // 운영중(최근 30일 결제) 사업자번호 목록 — merchant-openings-scraper가 읽어 '운영 기준 개설추이'로 조인
    try {
      await writeFile(join(dirname(OUT), "operating-biznos.json"), JSON.stringify({
        updatedAt: out.updatedAt,
        biznos: [...openedAll],                 // 코밴+다우 운영중 사업자번호(distinct)
        total: out.merchants.combined.opened,   // + KICC 수기 = 전체 운영 가맹점 수
      }, null, 2));
    } catch (e) { console.error("  운영 사업자목록 저장 오류:", e.message); }
  } else if (prev.merchants) {
    // 한쪽 VAN stale/실패 → 통합 재계산 불가 → 이전 통합값 유지(최신 per-VAN만 반영)
    out.merchants = {
      ...prev.merchants,
      kovan: out.kovan?.merch ?? prev.merchants.kovan,
      ddwm: out.ddwm?.merch ?? prev.merchants.ddwm,
      stale: true,
    };
    console.log(`  ⚠️ 한쪽 VAN stale — 이전 가맹점 통합값 유지: 개통 ${out.merchants.combined?.opened} · 사용 ${out.merchants.combined?.used}`);
  }
  // 원본 사업자번호 배열은 저장 파일에서 제거(용량·민감도)
  if (out.kovan) delete out.kovan.biznos;
  if (out.ddwm) delete out.ddwm.biznos;

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out, null, 2));
  console.log("✅ 저장:", OUT);
}
main().catch((e) => { console.error("❌", e.message); process.exit(1); });
