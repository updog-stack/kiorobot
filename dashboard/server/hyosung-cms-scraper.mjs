// 효성CMS 월별 수납(완납) 매출 수집기.
// 로그인(계정=노션 "[다인] VAN/할부/CMS 계정" DB) → 통계 API 범위조회 → 월별 완납액 저장.
//   /report/api/statistics/getBillStatisticsData?startDt=YYYYMM&endDt=YYYYMM
//   clamPayManpayAmt = 완납(수납) 금액, clamAmt = 청구액.
// 저장: server/data/cms-hyosung.json { updatedAt, years: { "2025": {monthly:[{month,paid,billed,cnt}], paidTotal}, ... } }
// 대상 연도: 인자/HYOSUNG_YEARS(콤마) 미지정 시 2025~올해.

import "dotenv/config";
import { Client } from "@notionhq/client";
import { chromium } from "playwright";
import { getVerificationCode, latestCodeMailTime } from "./lib/email-code.mjs";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "data", "cms-hyosung.json");
const CRED_DS = "422a252e-5579-8356-a5f2-07560126d81f";
const LOGIN_URL = "https://ap.hyosungcmsplus.co.kr/login";
const STAT_URL = "https://ap.hyosungcmsplus.co.kr/report/statistics";
const API = "/report/api/statistics/getBillStatisticsData";

const notionText = (p) => !p ? "" : p.type === "rich_text" ? p.rich_text.map((t) => t.plain_text).join("") : p.type === "title" ? p.title.map((t) => t.plain_text).join("") : "";

async function loadCred() {
  if (!process.env.NOTION_TOKEN) throw new Error(".env NOTION_TOKEN 필요(효성CMS 계정 노션 로드)");
  const notion = new Client({ auth: process.env.NOTION_TOKEN });
  const res = await notion.dataSources.query({ data_source_id: CRED_DS, page_size: 100 });
  for (const pg of res.results) {
    if (notionText(pg.properties["서비스명"]).trim() === "효성CMS")
      return { id: notionText(pg.properties["ID"]).trim(), pw: notionText(pg.properties["PW"]).trim() };
  }
  throw new Error("노션 계정표에서 '효성CMS' 행을 못 찾음(라함 통합 공유 확인)");
}

async function killPopups(page) {
  for (let i = 0; i < 6; i++) {
    const c = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button,a")].find((x) => x.offsetParent !== null && /^(닫기|확인|오늘 그만보기|그만보기|다음에|취소)$/.test((x.innerText || "").trim()));
      if (b) { b.click(); return true; } return false;
    });
    if (!c) break; await page.waitForTimeout(400);
  }
}

async function login(page, id, pw) {
  await page.goto(LOGIN_URL, { waitUntil: "networkidle", timeout: 40000 });
  await page.waitForTimeout(1500);
  await killPopups(page);
  await page.click("#accountIdInput"); await page.type("#accountIdInput", id, { delay: 40 });
  await page.click("#pwInput"); await page.type("#pwInput", pw, { delay: 40 });
  await page.waitForTimeout(400);
  await page.click("#idLoginBtn").catch(() => {});
  await page.waitForTimeout(6000);
  await killPopups(page);

  // 이메일 2차인증(다른 IP/24시간) — DDWM처럼 Gmail에서 코드 읽어 처리
  if (/2fa/.test(page.url())) {
    const { GMAIL_USER, GMAIL_APP_PASSWORD } = process.env;
    if (!GMAIL_USER || !GMAIL_APP_PASSWORD) throw new Error("효성CMS 2차인증 필요 — .env GMAIL_USER / GMAIL_APP_PASSWORD 설정 필요");
    await page.click("#emailBtn").catch(() => {}); // 이메일 인증 선택
    await page.waitForTimeout(2500);
    const baseline = await latestCodeMailTime({ user: GMAIL_USER, pass: GMAIL_APP_PASSWORD, match: "효성" }).catch(() => 0);
    const t0 = Date.now();
    await page.evaluate(() => { const b = [...document.querySelectorAll("button,a")].find((x) => x.offsetParent !== null && /인증번호\s*발송/.test((x.innerText || "").trim())); if (b) b.click(); });
    await page.waitForTimeout(3000);
    const code = await getVerificationCode({
      user: GMAIL_USER, pass: GMAIL_APP_PASSWORD, match: "효성",
      sinceMs: Math.max(baseline + 1000, t0 - 90000), timeoutMs: 120000, pollMs: 5000,
    });
    await page.fill("#codeInput", code).catch(async () => {
      await page.evaluate((c) => { const i = [...document.querySelectorAll("input")].find((x) => x.offsetParent !== null && /text|tel|number/.test(x.type) && !x.value); if (i) { i.value = c; i.dispatchEvent(new Event("input", { bubbles: true })); } }, code);
    });
    await page.waitForTimeout(500);
    await page.click("#confirmBtn").catch(() => page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => x.offsetParent !== null && /확인/.test((x.innerText || "").trim())); if (b) b.click(); }));
    await page.waitForTimeout(5000);
    await killPopups(page);
  }

  if (/\/login|2fa/.test(page.url())) {
    const msg = await page.evaluate(() => document.body.innerText.slice(0, 150).replace(/\s+/g, " ")).catch(() => "");
    throw new Error("로그인/2차인증 실패(비번 오류 또는 코드 미도착): " + msg);
  }
}

function targetYears() {
  const arg = process.argv[2] || process.env.HYOSUNG_YEARS || "";
  const ys = arg.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => n >= 2020 && n <= 2100);
  if (ys.length) return [...new Set(ys)].sort();
  const cur = new Date().getFullYear();
  const out = []; for (let y = 2025; y <= cur; y++) out.push(y);
  return out;
}

async function main() {
  const now = new Date();
  const curYm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const years = targetYears();
  const startDt = `${years[0]}01`;
  const endDt = curYm;

  const { id, pw } = await loadCred();
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  let store = { years: {} };
  try {
    const prev = JSON.parse(readFileSync(OUT, "utf8")); if (prev.years) store.years = prev.years;
  } catch {}
  try {
    await login(page, id, pw);
    await page.goto(STAT_URL, { waitUntil: "networkidle", timeout: 40000 });
    await page.waitForTimeout(1500);
    const data = await page.evaluate(async ([api, s, e]) => {
      const r = await fetch(`${api}?startDt=${s}&endDt=${e}`, { headers: { Accept: "application/json" } });
      if (!r.ok) return { err: r.status };
      return { rows: await r.json() };
    }, [API, startDt, endDt]);
    if (data.err) throw new Error("통계 API 오류: HTTP " + data.err);
    if (!Array.isArray(data.rows)) throw new Error("통계 응답이 배열이 아님");

    const byYear = {};
    for (const x of data.rows) {
      const ym = String(x.statsAnmon || "");
      const y = ym.slice(0, 4), m = parseInt(ym.slice(4, 6), 10);
      if (!y || !m) continue;
      (byYear[y] ||= []).push({ month: m, paid: Number(x.clamPayManpayAmt) || 0, billed: Number(x.clamAmt) || 0, cnt: Number(x.clamPayManpayCnt) || 0 });
    }
    for (const y of Object.keys(byYear)) {
      const monthly = byYear[y].sort((a, b) => a.month - b.month);
      store.years[y] = { monthly, paidTotal: monthly.reduce((s, r) => s + r.paid, 0), billedTotal: monthly.reduce((s, r) => s + r.billed, 0) };
      monthly.forEach((r) => console.log(`  ${y}-${String(r.month).padStart(2, "0")}: 완납 ${r.paid.toLocaleString()}원 (${r.cnt}건)`));
      console.log(`✅ ${y}: 완납 총 ${store.years[y].paidTotal.toLocaleString()}원`);
    }
    store.updatedAt = now.toISOString();
    await mkdir(dirname(OUT), { recursive: true });
    await writeFile(OUT, JSON.stringify(store, null, 2));
    console.log(`✅ 저장: ${OUT} (연도: ${Object.keys(store.years).join(", ")})`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
