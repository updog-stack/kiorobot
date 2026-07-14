// 신규 가맹점 개설 추이 수집기 — 코밴(가입신청서조회) + 다우(대리점별 사업자리스트).
//   사업자번호별 '최초 등록일(개설일)'로 2025/2026 월별 신규 가맹점 수를 집계(코밴+다우 중복 제거).
//   매일 08:00 자동수집(COLLECT_SCRIPTS). BFF /api/merchant-openings 가 대시보드에 제공.
// 저장: server/data/merchant-openings.json
import "dotenv/config";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chromium } from "playwright";
import * as XLSX from "xlsx";
import { ddwmLogin } from "./lib/ddwm-login.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "data", "merchant-openings.json");
const { KOVAN_ID, KOVAN_PW } = process.env;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function readJsonSafe(p) { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } }

// 코밴: 가입신청서조회 엑셀(EUC-KR HTML) → Map{ 사업자번호 → 최초 개설월(YYYY-MM) }
async function kovanOpenings(browser) {
  if (!KOVAN_ID || !KOVAN_PW) throw new Error(".env KOVAN_ID/PW 필요");
  const page = await (await browser.newContext({ ignoreHTTPSErrors: true, acceptDownloads: true })).newPage();
  await page.goto("https://cateca.kovan.com/nKIMOS/Default.aspx", { waitUntil: "networkidle", timeout: 30000 });
  await page.fill("#txtUserid", KOVAN_ID); await page.fill("#txtPasswd", KOVAN_PW);
  await Promise.all([page.waitForLoadState("networkidle").catch(() => {}), page.click("#btnLogin")]); await wait(2000);
  if (await page.$("#txtPasswd")) throw new Error("코밴 로그인 실패");
  await page.goto("https://cateca.kovan.com/nKIMOS/mAgreement/searchVanApplication.aspx", { waitUntil: "networkidle", timeout: 30000 });
  await wait(1200);
  await page.fill("#txtSdate", "250101").catch(() => {});
  await page.fill("#txtEdate", "261231").catch(() => {});
  await Promise.all([page.waitForLoadState("networkidle").catch(() => {}), page.click("#btnSearch")]);
  await wait(3000);
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 45000 }), page.click("#seBtn")]);
  // 코밴 '엑셀'은 EUC-KR HTML 테이블
  const html = new TextDecoder("euc-kr").decode(readFileSync(await dl.path()));
  const wb = XLSX.read(html, { type: "string" });
  const g = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false, defval: "" });
  const map = new Map(); // bizno → 최초 YYYY-MM
  for (let i = 1; i < g.length; i++) {
    const r = g[i];
    if (!/승인/.test(String(r[0]).trim())) continue; // 승인 건만
    const bizno = String(r[5]).replace(/[^0-9]/g, "");
    const d = String(r[7]).replace(/[^0-9]/g, ""); // YYMMDD
    if (bizno.length !== 10 || d.length !== 6) continue;
    const ym = `20${d.slice(0, 2)}-${d.slice(2, 4)}`;
    if (!map.has(bizno) || ym < map.get(bizno)) map.set(bizno, ym);
  }
  console.log(`  코밴 가입(승인) 사업자: ${map.size}`);
  return map;
}

// 다우: 대리점별 사업자리스트 조회 시 getMerchList JSON 가로채기 → Map{ 사업자번호 → 최초 개설월 }
async function ddwmOpenings(browser) {
  const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
  let data = null;
  page.on("response", async (r) => {
    if (/add\/Merch\/getMerchList/.test(r.url())) { try { data = JSON.parse(await r.text()); } catch {} }
  });
  await ddwmLogin(page);
  await page.goto("https://van.daoudata.co.kr/pview/Merch/Merch/frmLstAgencyMerchInfo", { waitUntil: "networkidle", timeout: 40000 });
  await wait(1500);
  await page.locator("label:has-text('전체')").first().click().catch(() => {}); // 조회기간 전체
  await wait(500);
  await page.click("a.searchDD").catch(() => {});
  await wait(7000);
  if (!Array.isArray(data)) throw new Error("다우 가맹점 목록 응답 없음");
  const map = new Map();
  let skipped = 0;
  for (const m of data) {
    if (!/정상/.test(m.merchStatus || "")) { skipped++; continue; } // 해지 등 제외 → 현재 유효만
    const bizno = String(m.bizNbr || "").replace(/[^0-9]/g, "");
    const d = String(m.regDate || "");
    if (bizno.length !== 10 || !/^\d{4}-\d{2}/.test(d)) continue;
    const ym = d.slice(0, 7);
    if (!map.has(bizno) || ym < map.get(bizno)) map.set(bizno, ym);
  }
  console.log(`  다우 가맹점(정상): ${map.size} · 해지 제외 ${skipped}`);
  return map;
}

// 개설월 Map → { [year]: number[12] }
function buildYears(map) {
  const years = {};
  for (const ym of map.values()) {
    const [y, mo] = ym.split("-").map(Number);
    if (!y || !mo) continue;
    if (!years[y]) years[y] = Array(12).fill(0);
    years[y][mo - 1]++;
  }
  return years;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  let kMap = new Map(), dMap = new Map();
  try {
    try { kMap = await kovanOpenings(browser); } catch (e) { console.error("  코밴 오류:", e.message); }
    try { dMap = await ddwmOpenings(browser); } catch (e) { console.error("  다우 오류:", e.message); }
  } finally { await browser.close(); }

  // 둘 다 실패면 이전 데이터 보존
  if (kMap.size === 0 && dMap.size === 0) {
    const prev = readJsonSafe(OUT);
    if (prev) { console.log("  ⚠️ 코밴·다우 모두 실패 — 이전 데이터 유지"); return; }
  }

  // 통합: 사업자번호별 최초 개설월(코밴·다우 중 이른 것) — 중복 제거
  const combined = new Map();
  for (const [biz, ym] of [...kMap, ...dMap]) {
    if (!combined.has(biz) || ym < combined.get(biz)) combined.set(biz, ym);
  }

  // '운영 기준' 개설추이 — 최근 30일 결제 가맹점(operating-biznos.json)만 개설월로 집계.
  //   → 누적이 전체 운영수(842)에 수렴. 개설월 미상 운영분(KICC 등)은 기준연도 이전(base=2000)으로.
  const OP = readJsonSafe(join(__dirname, "data", "operating-biznos.json"));
  let openYears, totalMerchants;
  if (OP && Array.isArray(OP.biznos) && OP.biznos.length) {
    const opSet = new Set(OP.biznos.map((b) => String(b).replace(/[^0-9]/g, "")));
    const operMap = new Map([...combined].filter(([b]) => opSet.has(b)));
    const total = Number(OP.total) || operMap.size;
    openYears = buildYears(operMap);
    const missing = Math.max(0, total - operMap.size); // 개설월 미상 운영분(KICC·미매칭)
    if (missing) { openYears[2000] = openYears[2000] || Array(12).fill(0); openYears[2000][0] += missing; }
    totalMerchants = total;
    console.log(`  운영기준 개설추이: 운영 ${total}곳 · 개설월확인 ${operMap.size} · 미상(base) ${missing}`);
  } else {
    openYears = buildYears(combined);
    totalMerchants = combined.size;
    console.log("  ⚠️ operating-biznos.json 없음 — 전체(유효) 기준으로 집계");
  }

  const out = {
    updatedAt: new Date().toISOString(),
    combined: buildYears(combined), // 전체 개설(모두·유효) — 신규 개설 추이용
    operating: openYears,           // 현재 운영 기준 — 전체 가맹점 누적용(현재월→842)
    kovan: buildYears(kMap),
    ddwm: buildYears(dMap),
    totalMerchants,                 // 운영 전체 수(842)
  };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out, null, 2));
  const sum = (a) => (a || []).reduce((x, y) => x + y, 0);
  console.log(`  ✅ 신규개설(통합·중복제거) 2025 ${sum(out.combined[2025])}곳 · 2026 ${sum(out.combined[2026])}곳 (총 사업자 ${combined.size})`);
  console.log("✅ 저장:", OUT);
}
main().catch((e) => { console.error("❌", e.message); process.exit(1); });
