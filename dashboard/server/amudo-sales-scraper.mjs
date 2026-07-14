// 아무도없개 매출(결제건수·금액) — 코밴 '가맹점별 매출금액 구간집계'(mWork/fixedrate.aspx)에서 월별 집계.
//   · 가맹점명이 '아무도없개'(오타·띄어쓰기 변형 포함, /[아이]무도\s*없개/)인 매장만 합산.
//   · 대리점 A25700(다인)·A25701(아무도없개) 둘 다 조회 후 사업자번호로 union(대리점 이동 대비).
//   · 2026-06부터 현재월까지. 과거월은 캐시 재사용, 현재월만 재조회(증분).
//   저장: server/data/amudo-sales.json { updatedAt, months: { "2026-06": {count, amount, stores} } }
import "dotenv/config";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "data", "amudo-sales.json");
const { KOVAN_ID, KOVAN_PW } = process.env;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const readJsonSafe = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const num = (v) => Number(String(v).replace(/[^0-9.-]/g, "")) || 0;
const yy = (y) => String(y).slice(2);
const AMUDO_RE = /[아이]무도\s*없개/; // 아무도없개 + 아무도 없개 + 이무도없개
const START_YM = "2026-06";
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

async function main() {
  const prev = readJsonSafe(OUT) || { months: {} };
  const months = { ...(prev.months || {}) };
  const now = new Date();
  const curYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  // 수집 대상 월: START_YM ~ 현재월 (과거월 캐시 있으면 skip, 현재월은 항상 재조회)
  const targets = [];
  const [sy, sm] = START_YM.split("-").map(Number);
  for (let y = sy, m = sm; y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1); ) {
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    if (ym === curYm || !months[ym]) targets.push(ym);
    m += 1; if (m > 12) { m = 1; y += 1; }
  }

  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ ignoreHTTPSErrors: true, acceptDownloads: true })).newPage();
  try {
    await kovanLogin(page);
    for (const ym of targets) {
      const [y, m] = ym.split("-").map(Number);
      const lastD = new Date(y, m, 0).getDate();
      const sd = `${yy(y)}${String(m).padStart(2, "0")}01`;
      const isCur = ym === curYm;
      const ed = isCur
        ? `${yy(now.getFullYear())}${String(now.getMonth() + 1).padStart(2, "0")}${String(Math.max(1, now.getDate() - 1)).padStart(2, "0")}` // 어제까지
        : `${yy(y)}${String(m).padStart(2, "0")}${String(lastD).padStart(2, "0")}`;
      try {
        const merged = new Map();
        for (const mng of MNG_CODES) {
          const map = await queryAmudo(page, sd, ed, mng);
          for (const [k, v] of map) if (!merged.has(k)) merged.set(k, v); // 사업자번호|구분 dedup
        }
        let count = 0, amount = 0; const stores = new Set();
        for (const v of merged.values()) { count += v.cnt; amount += v.amt; stores.add(v.name); }
        months[ym] = { count, amount, stores: stores.size, partial: isCur || undefined };
        console.log(`  ${ym}: ${count.toLocaleString()}건 · ${amount.toLocaleString()}원 · ${stores.size}개 매장${isCur ? " (진행 중)" : ""}`);
      } catch (e) { console.error(`  ${ym} 실패: ${e.message}`); }
    }
  } finally { await browser.close(); }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify({ updatedAt: new Date().toISOString(), months }, null, 2));
  console.log("✅ 저장:", OUT, "· 월수:", Object.keys(months).length);
}
main().catch((e) => { console.error("❌", e.message); process.exit(1); });
